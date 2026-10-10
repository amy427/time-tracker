/** Run once from the Apps Script editor after adding Script Properties. */
function setup(){
  var p=props_();['OWNER_EMAIL','GOOGLE_CLIENT_ID','ALLOWED_ORIGIN'].forEach(function(k){if(!p.getProperty(k))throw new Error('请先填写脚本属性 '+k);});
  if(!/^https:\/\/[^/]+$/.test(p.getProperty('ALLOWED_ORIGIN'))&&!/^http:\/\/localhost:\d+$/.test(p.getProperty('ALLOWED_ORIGIN')))throw new Error('ALLOWED_ORIGIN 是不带路径的 HTTPS 来源');
  if(!p.getProperty('MASTER_ID')){
    var root=DriveApp.createFolder('TimeTracker'),mf=folder_(root,'Master'),raw=folder_(root,'Raw'),opFolder=folder_(mf,'OperationIndex'),backup=folder_(root,'Backup'),config=folder_(root,'Config'),book=SpreadsheetApp.create('TimeTracker_Master');DriveApp.getFileById(book.getId()).moveTo(mf);
    table_(book,'state',['key','value']);table_(book,'file_index',['year','spreadsheet_id','schema_version','created_at']);table_(book,'annual_summary',TimeCore.SUMMARY_HEADERS);table_(book,'backup_index',['period','manifest_file_id','generated_at','record_count','dirty']);
    book.getSheetByName('state').getRange(2,1,2,2).setValues([['state',JSON.stringify({revision:0,current:null,config:TimeCore.DEFAULT_CONFIG,last_operation_id:null})],['pending','']]);
    p.setProperties({ROOT_FOLDER_ID:root.getId(),RAW_FOLDER_ID:raw.getId(),OP_FOLDER_ID:opFolder.getId(),BACKUP_FOLDER_ID:backup.getId(),CONFIG_FOLDER_ID:config.getId(),MASTER_ID:book.getId()});
    config.createFile('config.json',JSON.stringify(TimeCore.DEFAULT_CONFIG,null,2),'application/json');
  }
  var handlers=ScriptApp.getProjectTriggers().map(function(t){return t.getHandlerFunction();});
  if(handlers.indexOf('maintenance')<0)ScriptApp.newTrigger('maintenance').timeBased().everyDays(1).atHour(3).inTimezone('Asia/Shanghai').create();
  yearBook_(TimeCore.dateKey(Date.now(),'Asia/Shanghai').slice(0,4));
  console.log('初始化完成。Master: https://docs.google.com/spreadsheets/d/'+p.getProperty('MASTER_ID'));
}
function diagnostics(){var lock=LockService.getScriptLock();lock.waitLock(20000);try{recover_();var s=state_();console.log(JSON.stringify({schema_version:1,revision:s.revision,timezone:s.config.timezone,bigint:powMod_(BigInt(2),BigInt(10),BigInt(1000)).toString(),public_keys:publicKeys_(true).length,trigger_count:ScriptApp.getProjectTriggers().length,master_id:props_().getProperty('MASTER_ID')}));}finally{lock.releaseLock();}}
