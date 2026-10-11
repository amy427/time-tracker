function markBackupsDirty_(writes,revision){
  var s=master_().getSheetByName('backup_index'),periods={};writes.forEach(function(w){periods[w.year]=true;periods[TimeCore.dateKey(TimeCore.time(w.event.start_at),w.event.timezone).slice(0,7)]=true;});
  Object.keys(periods).forEach(function(period){var row=findRow_(s,period),old=row?s.getRange(row,1,1,5).getValues()[0]:[period,'','',0,true];old[4]=true;upsert_(s,period,old);});
}
function csv_(events){
  function cell(v){var s=String(v==null?'':v);if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
  return '\uFEFF'+TimeCore.HEADERS.join(',')+'\r\n'+events.map(function(e){return TimeCore.HEADERS.map(function(h){return cell(e[h]);}).join(',');}).join('\r\n')+(events.length?'\r\n':'');
}
/** Immutable backup files: manifest is written last; index never references an incomplete version. */
function captureBackup_(period){
  TimeCore.assert(/^\d{4}(-\d{2})?$/.test(period),'备份周期无效');recover_();
  var year=period.slice(0,4),b=existingYear_(year),events=b?rows_(b.getSheetByName('events'),TimeCore.HEADERS.length).map(eventFromRow_).filter(function(e){return !e.deleted&&(period.length===4||TimeCore.dateKey(TimeCore.time(e.start_at),e.timezone).slice(0,7)===period);}):[];
  var jsonl=events.map(function(e){return JSON.stringify(e);}).join('\n')+(events.length?'\n':''),csv=csv_(events),state=state_();
  var metadata={schema_version:1,period:period,config:state.config,current:state.current,revision:state.revision,annual_summary:repository_().getAnnual(year),daily_summary:b?rows_(b.getSheetByName('daily_summary'),TimeCore.SUMMARY_HEADERS.length).map(TimeCore.summaryFromRow):[],file_index:rows_(master_().getSheetByName('file_index'),4)};
  return {period:period,year:year,events:events,jsonl:jsonl,csv:csv,state:state,metadata:metadata};
}
// This phase writes immutable files only; no shared sheets/state or config changes.
function writeBackup_(snapshot){
  var period=snapshot.period,year=snapshot.year,events=snapshot.events,state=snapshot.state,metadata=snapshot.metadata,jsonl=snapshot.jsonl,csv=snapshot.csv;
  var folder=folder_(DriveApp.getFolderById(props_().getProperty('BACKUP_FOLDER_ID')),year),stamp=new Date().toISOString().replace(/[:.]/g,'-')+'-'+Utilities.getUuid().slice(0,8),base=period+'-'+stamp;
  var contents=[{name:base+'-events.jsonl',text:jsonl,type:'application/x-ndjson'},{name:base+'-events.csv',text:csv,type:'text/csv'},{name:base+'-metadata.json',text:JSON.stringify(metadata,null,2),type:'application/json'}];
  var files=contents.map(function(c){var blob=Utilities.newBlob(c.text,c.type,c.name),file=folder.createFile(blob);return {name:c.name,file_id:file.getId(),sha256:hash_(c.text),bytes:blob.getBytes().length};});
  var manifest={schema_version:1,period:period,generated_at:new Date().toISOString(),record_count:events.length,selection:'event start local month/year; cross-boundary intervals stored whole',files:files};
  var mf=folder.createFile(base+'-manifest.json',JSON.stringify(manifest,null,2),'application/json');
  return {manifest:manifest,file_id:mf.getId()};
}
function publishBackup_(snapshot,written){
  // A concurrent commit must not be marked backed up by an older snapshot.
  if(pending_()||state_().revision!==snapshot.state.revision)return false;
  var period=snapshot.period,state=snapshot.state,manifest=written.manifest;
  upsert_(master_().getSheetByName('backup_index'),period,[period,written.file_id,manifest.generated_at,snapshot.events.length,false]);
  // Refresh a portable config snapshot without accumulating duplicate named config files.
  var cf=DriveApp.getFolderById(props_().getProperty('CONFIG_FOLDER_ID')),it=cf.getFilesByName('config.json');if(it.hasNext())it.next().setContent(JSON.stringify(state.config,null,2));else cf.createFile('config.json',JSON.stringify(state.config,null,2),'application/json');
  SpreadsheetApp.flush();return true;
}
// Compatibility for editor/tests already holding the lock.
function backupPeriod_(period){var snapshot=captureBackup_(period),written=writeBackup_(snapshot);publishBackup_(snapshot,written);return written.manifest;}
function maintenance(){
  resetExecution_();var lock=LockService.getScriptLock(),snapshot;
  // Background work yields immediately to foreground operations.
  if(!lock.tryLock(1))return;
  try{
    recover_();var today=TimeCore.dateKey(Date.now(),'Asia/Shanghai'),month=today.slice(0,7),year=today.slice(0,4);yearBook_(year);
    var index={};rows_(master_().getSheetByName('backup_index'),5).forEach(function(r){index[r[0]]=r;});
    var periods=[];rows_(master_().getSheetByName('file_index'),4).forEach(function(r){var y=String(r[0]);for(var m=1;m<=12;m++){var p=y+'-'+String(m).padStart(2,'0');if(p<month)periods.push(p);}if(y<year)periods.push(y);});
    periods.sort().reverse();var target=periods.find(function(p){return !index[p]||!index[p][1]||index[p][4]===true||index[p][4]==='true';});
    if(target)snapshot=captureBackup_(target);
    SpreadsheetApp.flush();
  }catch(err){props_().setProperty('LAST_MAINTENANCE_ERROR',String(err.message||err));throw err;}finally{lock.releaseLock();}
  try{
    if(snapshot){var written=writeBackup_(snapshot);if(!lock.tryLock(1000))return;
      try{resetExecution_();if(!publishBackup_(snapshot,written))return;props_().setProperty('LAST_BACKUP_OK',new Date().toISOString());}finally{lock.releaseLock();}
    }
    props_().setProperty('LAST_MAINTENANCE_OK',new Date().toISOString());props_().deleteProperty('LAST_MAINTENANCE_ERROR');
  }catch(err){props_().setProperty('LAST_MAINTENANCE_ERROR',String(err.message||err));throw err;}
}
/** Choose the year in this function before running it from the editor. */
function backupYear(year){
  year=String(year||TimeCore.dateKey(Date.now(),'Asia/Shanghai').slice(0,4));resetExecution_();var lock=LockService.getScriptLock(),snapshot;
  if(!lock.tryLock(1000))throw new Error('云端暂忙，请稍后运行备份');
  try{snapshot=captureBackup_(year);SpreadsheetApp.flush();}finally{lock.releaseLock();}
  var written=writeBackup_(snapshot);if(!lock.tryLock(1000))throw new Error('备份文件已生成，索引待下次备份确认');
  try{resetExecution_();if(!publishBackup_(snapshot,written))throw new Error('备份期间记录已更新，请稍后重试');console.log(JSON.stringify(written.manifest));}finally{lock.releaseLock();}
}
/** Repair only the requested year's statistics after external raw edits; does not read 100 years. */
function rebuildYear(year){
  TimeCore.assert(/^\d{4}$/.test(String(year)),'在编辑器新增包装函数，例如 function repair(){ rebuildYear(2026); }');year=String(year);
  var lock=LockService.getScriptLock();lock.waitLock(20000);try{
    recover_();var days={};for(var y=Number(year)-2;y<=Number(year);y++){var b=existingYear_(String(y));if(b)rows_(b.getSheetByName('events'),TimeCore.HEADERS.length).map(eventFromRow_).forEach(function(raw){if(raw.deleted)return;var event=TimeCore.validateEvent(raw);TimeCore.assert(raw.duration_seconds===event.duration_seconds,'Raw 秒数与时间不符，请修复后重试');TimeCore.splitDays(event).forEach(function(p){if(p.date.slice(0,4)===year){if(!days[p.date])days[p.date]=TimeCore.emptySummary(p.date);TimeCore.addSegment(days[p.date],p);}});});}
    var sheet=yearBook_(year).getSheetByName('daily_summary');rows_(sheet,TimeCore.SUMMARY_HEADERS.length).forEach(function(r){if(!days[r[0]])days[r[0]]=TimeCore.emptySummary(String(r[0]));});
    var annual=TimeCore.emptySummary(year);Object.values(days).forEach(function(d){TimeCore.addSummary(annual,d);});
    var state=state_();state.revision++;state.last_operation_id=Utilities.getUuid();
    var plan={op_id:state.last_operation_id,queued_at:new Date().toISOString(),request_hash:'maintenance-rebuild',state:state,writes:[],days:Object.values(days),years:[annual]};setPending_(plan);applyPlan_(plan);
    console.log('重建完成 '+year+' 秒数 '+annual.total_seconds);
  }finally{lock.releaseLock();}
}
