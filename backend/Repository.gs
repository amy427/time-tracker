/* All sheet writes occur under ScriptLock; annual files bound data growth. */
var YEAR_LIMIT = 100000;
function props_() { return PropertiesService.getScriptProperties(); }
function table_(book, name, headers) {
  var s=book.getSheetByName(name)||book.insertSheet(name);
  if(s.getLastRow()===0){s.getRange(1,1,1,headers.length).setValues([headers]);s.setFrozenRows(1);}
  return s;
}
function safeCell_(v){return typeof v==='string'&&/^[=+\-@\t\r]/.test(v)?"'"+v:v;}
function readCell_(v){return typeof v==='string'&&/^'[=+\-@\t\r]/.test(v)?v.slice(1):v;}
function rows_(s,n){return s.getLastRow()>1?s.getRange(2,1,s.getLastRow()-1,n).getValues().map(function(r){return r.map(readCell_);}):[];}
function findRow_(s,key){if(s.getLastRow()<2)return null;var found=s.getRange(2,1,s.getLastRow()-1,1).createTextFinder(String(key)).matchEntireCell(true).useRegularExpression(false).findNext();return found?found.getRow():null;}
function upsert_(s,key,row){var r=findRow_(s,key)||s.getLastRow()+1;if(r>s.getMaxRows())s.insertRowsAfter(s.getMaxRows(),Math.max(100,r-s.getMaxRows()));s.getRange(r,1,1,row.length).setNumberFormat('@').setValues([row.map(safeCell_)]);}
function master_(){var id=props_().getProperty('MASTER_ID');if(!id)throw new Error('先运行 setup');return SpreadsheetApp.openById(id);}
function state_(){var raw=master_().getSheetByName('state').getRange(2,2).getValue();return JSON.parse(raw);}
function setState_(s){master_().getSheetByName('state').getRange(2,2).setValue(JSON.stringify(s));}
function pending_(){var v=master_().getSheetByName('state').getRange(3,2).getValue();if(!v)return null;var pointer=JSON.parse(v),json=DriveApp.getFileById(pointer.file_id).getBlob().getDataAsString('UTF-8');if(hash_(json)!==pointer.sha256)throw new Error('恢复计划校验失败，暂停写入');return JSON.parse(json);}
function setPending_(p){
  var cell=master_().getSheetByName('state').getRange(3,2),old=cell.getValue();
  if(p){var json=JSON.stringify(p);if(json.length>2000000)throw new Error('操作过大，请缩小批次');var file=DriveApp.getFolderById(props_().getProperty('CONFIG_FOLDER_ID')).createFile('pending-'+p.op_id+'.json',json,'application/json');cell.setValue(JSON.stringify({file_id:file.getId(),sha256:hash_(json)}));SpreadsheetApp.flush();}
  else{cell.setValue('');SpreadsheetApp.flush();if(old){try{DriveApp.getFileById(JSON.parse(old).file_id).setTrashed(true);}catch(err){console.warn('恢复计划已完成，临时文件清理未完成');}}}
}
function folder_(parent,name){var it=parent.getFoldersByName(name);return it.hasNext()?it.next():parent.createFolder(name);}
function yearBook_(year){
  if(!/^\d{4}$/.test(String(year)))throw new Error('年份无效');
  var m=master_(), index=m.getSheetByName('file_index'),r=findRow_(index,year);
  if(r)return SpreadsheetApp.openById(String(index.getRange(r,2).getValue()));
  var folder=DriveApp.getFolderById(props_().getProperty('RAW_FOLDER_ID')),name='TimeLog_'+year,it=folder.getFilesByName(name),b;
  if(it.hasNext())b=SpreadsheetApp.openById(it.next().getId());
  else {b=SpreadsheetApp.create(name);DriveApp.getFileById(b.getId()).moveTo(folder);}
  table_(b,'events',TimeCore.HEADERS);table_(b,'daily_summary',TimeCore.SUMMARY_HEADERS);
  upsert_(index,year,[String(year),b.getId(),1,new Date().toISOString()]);return b;
}
function existingYear_(year){var s=master_().getSheetByName('file_index'),r=findRow_(s,year);return r?SpreadsheetApp.openById(String(s.getRange(r,2).getValue())):null;}
function eventFromRow_(r){var e={};TimeCore.HEADERS.forEach(function(h,i){e[h]=r[i];});e.duration_seconds=Number(e.duration_seconds);e.schema_version=Number(e.schema_version);e.revision=Number(e.revision);e.deleted=e.deleted===true||e.deleted==='true';e.text_originals_json=e.text_originals_json||'{}';var originals=JSON.parse(e.text_originals_json);['event_name','category','note'].forEach(function(h){if(Object.prototype.hasOwnProperty.call(originals,h))e[h]=originals[h];});return e;}
function repository_(){return {
  getEvent:function(year,id){var locator=eventIndex_(id),lr=findRow_(locator,id);if(lr)year=String(locator.getRange(lr,2).getValue());var b=existingYear_(year);if(!b)return null;var s=b.getSheetByName('events'),r=findRow_(s,id);return r?eventFromRow_(s.getRange(r,1,1,TimeCore.HEADERS.length).getValues()[0].map(readCell_)):null;},
  getDay:function(date){var b=existingYear_(date.slice(0,4));if(!b)return null;var s=b.getSheetByName('daily_summary'),r=findRow_(s,date);return r?TimeCore.summaryFromRow(s.getRange(r,1,1,TimeCore.SUMMARY_HEADERS.length).getValues()[0].map(readCell_)):null;},
  getAnnual:function(year){var s=master_().getSheetByName('annual_summary'),r=findRow_(s,year);return r?TimeCore.summaryFromRow(s.getRange(r,1,1,TimeCore.SUMMARY_HEADERS.length).getValues()[0].map(readCell_)):null;}
};}
function logSheet_(queued){var date=queued.slice(0,10);return table_(yearBook_(date.slice(0,4)),'operations_'+date.slice(5,7),['op_id','request_sha256','committed_revision','queued_at','committed_at']);}
function indexBook_(id){
  var bucket=id.slice(0,2).toLowerCase(),p=props_(),key='OP_BUCKET_'+bucket,stored=p.getProperty(key),b;
  if(stored)b=SpreadsheetApp.openById(stored);
  else{var folder=DriveApp.getFolderById(p.getProperty('OP_FOLDER_ID')),name='OperationIndex_'+bucket,it=folder.getFilesByName(name);if(it.hasNext())b=SpreadsheetApp.openById(it.next().getId());else{b=SpreadsheetApp.create(name);DriveApp.getFileById(b.getId()).moveTo(folder);}p.setProperty(key,b.getId());}
  return b;
}
function operationIndex_(id){return table_(indexBook_(id),'operations',['op_id','request_sha256','committed_revision','queued_at','committed_at']);}
function eventIndex_(id){return table_(indexBook_(id),'event_locator',['event_id','year','deleted']);}
function lookupOp_(op){var s=operationIndex_(op.op_id),r=findRow_(s,op.op_id);return r?s.getRange(r,1,1,5).getValues()[0]:null;}
function hash_(text){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text,Utilities.Charset.UTF_8).map(function(b){return ((b+256)%256).toString(16).padStart(2,'0');}).join('');}
function applyPlan_(p){
  p.writes.forEach(function(w){var s=yearBook_(w.year).getSheetByName('events');if(!findRow_(s,w.event.event_id)&&s.getLastRow()>YEAR_LIMIT)throw new Error('年度容量已达安全上限，请先迁移；本地队列仍保留');upsert_(s,w.event.event_id,TimeCore.HEADERS.map(function(h){return w.event[h];}));upsert_(eventIndex_(w.event.event_id),w.event.event_id,[w.event.event_id,w.year,w.event.deleted]);});
  p.days.forEach(function(d){upsert_(yearBook_(d.date.slice(0,4)).getSheetByName('daily_summary'),d.date,TimeCore.summaryRow(d));});
  p.years.forEach(function(y){upsert_(master_().getSheetByName('annual_summary'),y.date,TimeCore.summaryRow(y));});
  if(p.writes.length)markBackupsDirty_(p.writes,p.state.revision);
  SpreadsheetApp.flush();
  setState_(p.state);SpreadsheetApp.flush();
  var receipt=[p.op_id,p.request_hash,p.state.revision,p.queued_at,new Date().toISOString()];
  upsert_(logSheet_(p.queued_at),p.op_id,receipt);upsert_(operationIndex_(p.op_id),p.op_id,receipt);SpreadsheetApp.flush();
  setPending_(null);
}
function recover_(){var p=pending_();if(p)applyPlan_(p);}
function commit_(op){
  TimeCore.assert(op&&TimeCore.uuid(op.op_id),'操作无效');TimeCore.time(op.queued_at);TimeCore.assert(op.queued_at===TimeCore.iso(op.queued_at),'queued_at 必须是 UTC ISO');
  recover_();var state=state_(),hash=hash_(TimeCore.canonical(op)),old=lookupOp_(op);
  if(old){if(old[1]!==hash)throw new Error('同一 UUID 不得提交不同内容');return {ok:true,duplicate:true,revision:Number(old[2]),state:state};}
  if(op.base_revision!==state.revision)return {ok:false,code:'CONFLICT',state:state,message:'云端版本已变化，本地队列已保留'};
  var plan=TimeCore.planOperation(op,state,repository_(),Date.now());plan.request_hash=hash;
  TimeCore.assert(JSON.stringify(plan.state).length<45000,'配置或状态过大，请先迁移');
  plan.days.concat(plan.years).forEach(function(s){TimeCore.summaryRow(s).forEach(function(v){TimeCore.assert(typeof v!=='string'||v.length<45000,'年度科目映射接近单元格上限，请迁移汇总格式后继续');});});
  // Reject capacity before writing a pending plan; recovery must not get stuck on a known limit.
  var additions={};plan.writes.forEach(function(w){var s=yearBook_(w.year).getSheetByName('events');if(!findRow_(s,w.event.event_id)){additions[w.year]=(additions[w.year]||0)+1;if(s.getLastRow()-1+additions[w.year]>YEAR_LIMIT)throw new Error('年度容量已达安全上限，请迁移后再同步');}});
  setPending_(plan);applyPlan_(plan);return {ok:true,revision:plan.state.revision,state:plan.state};
}
function query_(request){
  var state=state_(),r=TimeCore.range(request.mode,request.value,state.config.timezone),days=[],total=TimeCore.emptySummary('total');
  if(request.mode==='all')rows_(master_().getSheetByName('annual_summary'),TimeCore.SUMMARY_HEADERS.length).forEach(function(row){TimeCore.addSummary(total,TimeCore.summaryFromRow(row));});
  else {for(var y=Number(r.from.slice(0,4));y<=Number(r.to.slice(0,4));y++){var b=existingYear_(String(y).padStart(4,'0'));if(b)rows_(b.getSheetByName('daily_summary'),TimeCore.SUMMARY_HEADERS.length).forEach(function(row){var s=TimeCore.summaryFromRow(row);if(s.date>=r.from&&s.date<r.to){days.push(s);TimeCore.addSummary(total,s);}});}}
  days.sort(function(a,b){return a.date.localeCompare(b.date);});return {ok:true,range:r,days:days,total:total,state:state};
}
function records_(request){
  var year=String(request.year);TimeCore.assert(/^\d{4}$/.test(year),'年份无效');var b=existingYear_(year),events=b?rows_(b.getSheetByName('events'),TimeCore.HEADERS.length).map(eventFromRow_).filter(function(e){return !e.deleted;}):[];
  if(request.date)events=events.filter(function(e){return TimeCore.splitDays(e).some(function(p){return p.date===request.date;});});
  events.sort(function(a,b){return b.start_at.localeCompare(a.start_at);});var offset=Math.max(0,Number(request.offset)||0);return {ok:true,events:events.slice(offset,offset+100),next:offset+100<events.length?offset+100:null};
}
