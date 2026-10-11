/* All sheet writes occur under ScriptLock; annual files bound data growth. */
var YEAR_LIMIT = 100000;
// Objects live only in this Apps Script execution, never in Properties/CacheService.
var executionBooks_ = {}, executionSheets_ = {}, executionYears_ = {};
function resetExecution_(){executionBooks_={};executionSheets_={};executionYears_={};}
function openBook_(id){return executionBooks_[id]||(executionBooks_[id]=SpreadsheetApp.openById(id));}
function props_() { return PropertiesService.getScriptProperties(); }
function table_(book, name, headers) {
  var key=book.getId()+':'+name,s=executionSheets_[key]||(executionSheets_[key]=book.getSheetByName(name)||book.insertSheet(name));
  if(s.getLastRow()===0){s.getRange(1,1,1,headers.length).setValues([headers]);s.setFrozenRows(1);}
  return s;
}
function safeCell_(v){return typeof v==='string'&&/^[=+\-@\t\r]/.test(v)?"'"+v:v;}
function readCell_(v){return typeof v==='string'&&/^'[=+\-@\t\r]/.test(v)?v.slice(1):v;}
function rows_(s,n){return s.getLastRow()>1?s.getRange(2,1,s.getLastRow()-1,n).getValues().map(function(r){return r.map(readCell_);}):[];}
function findRow_(s,key){if(s.getLastRow()<2)return null;var found=s.getRange(2,1,s.getLastRow()-1,1).createTextFinder(String(key)).matchEntireCell(true).useRegularExpression(false).findNext();return found?found.getRow():null;}
function upsert_(s,key,row){var r=findRow_(s,key)||s.getLastRow()+1;if(r>s.getMaxRows())s.insertRowsAfter(s.getMaxRows(),Math.max(100,r-s.getMaxRows()));s.getRange(r,1,1,row.length).setNumberFormat('@').setValues([row.map(safeCell_)]);}
function master_(){var id=props_().getProperty('MASTER_ID');if(!id)throw new Error('先运行 setup');return openBook_(id);}
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
  if(executionYears_[year])return executionYears_[year];
  var m=master_(), index=m.getSheetByName('file_index'),r=findRow_(index,year);
  if(r)return executionYears_[year]=openBook_(String(index.getRange(r,2).getValue()));
  var folder=DriveApp.getFolderById(props_().getProperty('RAW_FOLDER_ID')),name='TimeLog_'+year,it=folder.getFilesByName(name),b;
  if(it.hasNext())b=openBook_(it.next().getId());
  else {b=SpreadsheetApp.create(name);DriveApp.getFileById(b.getId()).moveTo(folder);}
  table_(b,'events',TimeCore.HEADERS);table_(b,'daily_summary',TimeCore.SUMMARY_HEADERS);
  upsert_(index,year,[String(year),b.getId(),1,new Date().toISOString()]);executionBooks_[b.getId()]=b;return executionYears_[year]=b;
}
function existingYear_(year){if(Object.prototype.hasOwnProperty.call(executionYears_,year))return executionYears_[year];var s=master_().getSheetByName('file_index'),r=findRow_(s,year);return executionYears_[year]=r?openBook_(String(s.getRange(r,2).getValue())):null;}
function eventFromRow_(r){var e={};TimeCore.HEADERS.forEach(function(h,i){e[h]=r[i];});e.duration_seconds=Number(e.duration_seconds);e.schema_version=Number(e.schema_version);e.revision=Number(e.revision);e.deleted=e.deleted===true||e.deleted==='true';e.text_originals_json=e.text_originals_json||'{}';var originals=JSON.parse(e.text_originals_json);['event_name','category','note'].forEach(function(h){if(Object.prototype.hasOwnProperty.call(originals,h))e[h]=originals[h];});return e;}
function repository_(){return {
  getEvent:function(year,id){var locator=eventIndex_(id),lr=findRow_(locator,id);if(lr)year=String(locator.getRange(lr,2).getValue());var b=existingYear_(year);if(!b)return null;var s=b.getSheetByName('events'),r=findRow_(s,id);return r?eventFromRow_(s.getRange(r,1,1,TimeCore.HEADERS.length).getValues()[0].map(readCell_)):null;},
  getDay:function(date){var b=existingYear_(date.slice(0,4));if(!b)return null;var s=b.getSheetByName('daily_summary'),r=findRow_(s,date);return r?TimeCore.summaryFromRow(s.getRange(r,1,1,TimeCore.SUMMARY_HEADERS.length).getValues()[0].map(readCell_)):null;},
  getAnnual:function(year){var s=master_().getSheetByName('annual_summary'),r=findRow_(s,year);return r?TimeCore.summaryFromRow(s.getRange(r,1,1,TimeCore.SUMMARY_HEADERS.length).getValues()[0].map(readCell_)):null;}
};}
function logSheet_(queued){var date=queued.slice(0,10);return table_(yearBook_(date.slice(0,4)),'operations_'+date.slice(5,7),['op_id','request_sha256','committed_revision','queued_at','committed_at']);}
function indexBook_(id){
  var bucket=id.slice(0,2).toLowerCase(),p=props_(),key='OP_BUCKET_'+bucket,stored=p.getProperty(key),b;
  if(stored)b=openBook_(stored);
  else{var folder=DriveApp.getFolderById(p.getProperty('OP_FOLDER_ID')),name='OperationIndex_'+bucket,it=folder.getFilesByName(name);if(it.hasNext())b=openBook_(it.next().getId());else{b=SpreadsheetApp.create(name);DriveApp.getFileById(b.getId()).moveTo(folder);}p.setProperty(key,b.getId());executionBooks_[b.getId()]=b;}
  return b;
}
function operationIndex_(id){return table_(indexBook_(id),'operations',['op_id','request_sha256','committed_revision','queued_at','committed_at']);}
function eventIndex_(id){return table_(indexBook_(id),'event_locator',['event_id','year','deleted']);}
function lookupOp_(op){var s=operationIndex_(op.op_id),r=findRow_(s,op.op_id);return r?s.getRange(r,1,1,5).getValues()[0]:null;}
function hash_(text){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text,Utilities.Charset.UTF_8).map(function(b){return ((b+256)%256).toString(16).padStart(2,'0');}).join('');}
function applyPlan_(p){
  if(p.rebuild_records_year){var rebuildBook=existingYear_(p.rebuild_records_year);if(rebuildBook)rebuildRecordIndex_(rebuildBook);}
  var indexes={};
  p.writes.forEach(function(w){var book=yearBook_(w.year),s=book.getSheetByName('events'),index=recordIndex_(book);indexes[w.year]=index;if(!findRow_(s,w.event.event_id)&&s.getLastRow()>YEAR_LIMIT)throw new Error('年度容量已达安全上限，请先迁移；本地队列仍保留');upsert_(s,w.event.event_id,TimeCore.HEADERS.map(function(h){return w.event[h];}));upsert_(eventIndex_(w.event.event_id),w.event.event_id,[w.event.event_id,w.year,w.event.deleted]);
    var row=findRow_(index,w.event.event_id);if(w.event.deleted){if(row)index.deleteRow(row);}else upsert_(index,w.event.event_id,recordIndexRow_(w.event));
  });
  Object.keys(indexes).forEach(function(y){sortRecordIndex_(indexes[y]);});
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
function commitBatch_(ops,deadline){
  TimeCore.assert(Array.isArray(ops)&&ops.length>0&&ops.length<=10,'每批必须包含 1 至 10 个操作');
  var confirmed=[],result;
  for(var i=0;i<ops.length;i++){
    if(i>0&&deadline&&Date.now()>=deadline)return {ok:false,code:'YIELD',message:'本批已部分同步，稍后继续',confirmed:confirmed,state:result.state,failed_index:i,retry_after_ms:3000};
    try{result=commit_(ops[i]);}catch(err){return {ok:false,code:'ERROR',message:String(err.message||err),confirmed:confirmed,state:state_(),failed_index:i};}
    if(!result.ok)return {ok:false,code:result.code,message:result.message,confirmed:confirmed,state:result.state,failed_index:i};
    confirmed.push(ops[i].op_id);
  }
  return {ok:true,confirmed:confirmed,state:result.state,failed_index:null};
}
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
// Covering index: full post-images avoid 100 individual event lookups per page.
// Numeric instant avoids offset-string ordering errors; UUID is a stable tie-breaker.
var RECORD_HEADERS_;
function recordHeaders_(){return RECORD_HEADERS_||(RECORD_HEADERS_=TimeCore.HEADERS.concat(['sort_instant']));}
function recordIndexRow_(e){return TimeCore.HEADERS.map(function(h){return e[h];}).concat([TimeCore.time(e.start_at)]);}
function sortRecordIndex_(s){
  var headers=recordHeaders_();
  if(s.getLastRow()>2)s.getRange(2,1,s.getLastRow()-1,headers.length).sort([{column:headers.length,ascending:false},{column:1,ascending:true}]);
}
function rebuildRecordIndex_(book){
  var headers=recordHeaders_(),meta=table_(book,'records_index_meta',['key','value']),s=table_(book,'records_index',headers);
  meta.getRange(2,1,1,2).setValues([['ready','']]);SpreadsheetApp.flush();
  s.clearContents();s.getRange(1,1,1,headers.length).setValues([headers]);
  var data=rows_(book.getSheetByName('events'),TimeCore.HEADERS.length).map(eventFromRow_).filter(function(e){return !e.deleted;}).map(recordIndexRow_);
  if(data.length){if(data.length+1>s.getMaxRows())s.insertRowsAfter(s.getMaxRows(),data.length+1-s.getMaxRows());s.getRange(2,1,data.length,headers.length).setNumberFormat('@').setValues(data.map(function(r){return r.map(safeCell_);}));}
  sortRecordIndex_(s);SpreadsheetApp.flush();meta.getRange(2,2).setValue('v1');SpreadsheetApp.flush();return s;
}
function recordIndex_(book){var meta=table_(book,'records_index_meta',['key','value']);return meta.getRange(2,2).getValue()==='v1'?table_(book,'records_index',RECORD_HEADERS_):rebuildRecordIndex_(book);}
/** Add a wrapper, e.g. function repairRecords(){ rebuildRecordsIndex(2026); }. Raw data is untouched. */
function rebuildRecordsIndex(year){
  TimeCore.assert(/^\d{4}$/.test(String(year)),'年份无效');resetExecution_();var lock=LockService.getScriptLock();lock.waitLock(20000);
  try{recover_();
    // Invalidate client cursors/caches through the same durable state/receipt protocol.
    var state=state_();state.revision++;state.last_operation_id=Utilities.getUuid();
    var p={op_id:state.last_operation_id,queued_at:new Date().toISOString(),request_hash:'maintenance-record-index',state:state,rebuild_records_year:String(year),writes:[],days:[],years:[]};setPending_(p);applyPlan_(p);
  }finally{lock.releaseLock();}
}
function records_(request){
  var year=String(request.year);TimeCore.assert(/^\d{4}$/.test(year),'年份无效');var revision=state_().revision;
  if(request.cloud_revision===revision&&request.check_only)return {ok:true,not_modified:true,cloud_revision:revision};
  var offset=Math.max(0,Number(request.offset)||0);TimeCore.assert(Number.isSafeInteger(offset),'分页无效');
  var reset=offset>0&&request.cloud_revision!==undefined&&request.cloud_revision!==revision;if(reset)offset=0;
  var b=existingYear_(year),s=b?recordIndex_(b):null,count=s?Math.max(0,s.getLastRow()-1):0,events=[];
  // Date-filtered compatibility path scans the index in bounded pages, never raw events.
  var position=offset;
  while(position<count&&events.length<100){var n=Math.min(100-events.length,count-position),page=s.getRange(position+2,1,n,TimeCore.HEADERS.length).getValues().map(function(r){return eventFromRow_(r.map(readCell_));});position+=n;events=events.concat(request.date?page.filter(function(e){return TimeCore.splitDays(e).some(function(p){return p.date===request.date;});}):page);}
  return {ok:true,year:year,events:events,offset:offset,next:position<count?position:null,cloud_revision:revision,reset:reset};
}
