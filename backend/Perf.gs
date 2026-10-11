/* Temporary, content-free timings. Persistence is best-effort AFTER ScriptLock release. */
var perfProfile_=null;
var PERF_COMMIT_KEYS_=['index','total_ms','recover_ms','state_ms','lookup_op_ms','planning_ms','capacity_check_ms','set_pending_ms','pending_drive_ms','pending_pointer_ms','pending_flush_ms','apply_plan_ms'];
var PERF_APPLY_KEYS_=['rebuild_index_ms','event_write_ms','event_index_ms','record_index_ms','record_sort_ms','daily_summary_ms','annual_summary_ms','backup_dirty_ms','flush_before_state_ms','set_state_ms','flush_state_ms','receipt_write_ms','flush_receipt_ms','clear_pending_ms','clear_pending_flush_ms','clear_pending_drive_ms'];
function perfZeros_(keys){var value={};keys.forEach(function(k){value[k]=0;});return value;}
function perfBegin_(){var start=Date.now();return perfProfile_={timestamp:new Date(start).toISOString(),_started:start,_held:false,action:'unknown',auth_ms:0,lock_wait_ms:0,lock_ms:0,recover_ms:0,batch_size:0,commits:[]};}
function perfTimed_(target,key,fn){if(!target)return fn();var start=Date.now();try{return fn();}finally{target[key]=(target[key]||0)+Math.max(0,Date.now()-start);}}
function perfNumbers_(source,keys){var result={};keys.forEach(function(k){var v=source&&source[k];if(typeof v==='number'&&Number.isFinite(v)&&v>=0)result[k]=Math.round(v);});return result;}
function perfFinish_(p){
  // Return content-free status for the manual self-test; doPost ignores it.
  var step='prepare';
  try{
    p.total_ms=Math.max(0,Date.now()-p._started);
    if(p._held!==false)return {status:'skipped',reason:'lock_not_confirmed_released'};
    if(!(p.total_ms>=8000||p.lock_ms>=8000||p.exception||p.commits.some(function(c){return c.total_ms>=8000;})))return {status:'skipped',reason:'fast_request'};
    var safe=perfNumbers_(p,['total_ms','auth_ms','lock_wait_ms','lock_ms','recover_ms','batch_size','state_ms','query_ms','records_ms']);
    safe.timestamp=p.timestamp;safe.action=['sync','sync_batch','state','query','records','diagnostic'].indexOf(p.action)>=0?p.action:'unknown';if(p.exception)safe.exception=true;
    safe.commits=p.commits.slice(0,10).map(function(c){var out=perfNumbers_(c,PERF_COMMIT_KEYS_);out.apply=perfNumbers_(c.apply,PERF_APPLY_KEYS_);if(c.exception)out.exception=true;return out;});
    if(p.recovery_apply)safe.recovery_apply=perfNumbers_(p.recovery_apply,PERF_APPLY_KEYS_);
    var json=JSON.stringify(safe);
    // ScriptProperties has a per-value size limit. All stored keys/values are ASCII.
    if(json.length>8000){safe.truncated=true;safe.commits.sort(function(a,b){return b.total_ms-a.total_ms;});while(JSON.stringify(safe).length>8000&&safe.commits.length>1)safe.commits.pop();json=JSON.stringify(safe);}
    if(json.length>8000)return {status:'skipped',reason:'profile_too_large'};
    step='read_sequence';
    var props=PropertiesService.getScriptProperties(),seq=Number(props.getProperty('PERF_SEQ'));
    if(!Number.isSafeInteger(seq)||seq<0||seq>=Number.MAX_SAFE_INTEGER)seq=0;
    var update={};update['PERF_SLOT_'+(seq%10)]=json;update.PERF_SEQ=String(seq+1);step='write_properties';props.setProperties(update);return {status:'saved',slot:'PERF_SLOT_'+(seq%10),total_ms:safe.total_ms};
  }catch(ignore){return {status:'failed',step:step};}finally{if(perfProfile_===p)perfProfile_=null;}
}
function perfDiagnostics(){
  var props=PropertiesService.getScriptProperties(),profiles=[];
  for(var i=0;i<10;i++){var raw=props.getProperty('PERF_SLOT_'+i);if(raw){try{var p=JSON.parse(raw);if(p&&typeof p.timestamp==='string')profiles.push(p);}catch(ignore){}}}
  profiles.sort(function(a,b){return a.timestamp.localeCompare(b.timestamp);});profiles.forEach(function(p){console.log(JSON.stringify(p,null,2));});
  if(!profiles.length){console.log('No saved slow/error profiles.');return;}
  var slowest=profiles.reduce(function(a,b){return b.total_ms>a.total_ms?b:a;}),commit=null,stage=null;
  profiles.forEach(function(p){(p.commits||[]).forEach(function(c){if(!commit||c.total_ms>commit.total_ms)commit=Object.assign({timestamp:p.timestamp},c);PERF_APPLY_KEYS_.forEach(function(k){if(!stage||(c.apply&&c.apply[k]||0)>stage.ms)stage={timestamp:p.timestamp,index:c.index,stage:k,ms:c.apply&&c.apply[k]||0};});});
    if(p.recovery_apply)PERF_APPLY_KEYS_.forEach(function(k){if(!stage||(p.recovery_apply[k]||0)>stage.ms)stage={timestamp:p.timestamp,index:'recovery (aggregate)',stage:k,ms:p.recovery_apply[k]||0};});
  });
  console.log('SLOWEST REQUEST:\n'+JSON.stringify({timestamp:slowest.timestamp,total_ms:slowest.total_ms,action:slowest.action,auth_ms:slowest.auth_ms,lock_wait_ms:slowest.lock_wait_ms,lock_ms:slowest.lock_ms},null,2));
  console.log('SLOWEST COMMIT:\n'+JSON.stringify(commit,null,2));console.log('SLOWEST APPLY STAGE:\n'+JSON.stringify(stage,null,2));
}
function clearPerfDiagnostics(){var props=PropertiesService.getScriptProperties();props.deleteProperty('PERF_SEQ');for(var i=0;i<10;i++)props.deleteProperty('PERF_SLOT_'+i);}

/** Manual editor test: writes a real nine-second diagnostic and reads it back. */
function testPerfDiagnosticsWrite(){
  var p=perfBegin_();p.action='diagnostic';p._started=Date.now()-9000;p._held=false;
  var result;
  try{
    result=perfFinish_(p);
    if(result&&result.status==='saved'){
      try{var raw=PropertiesService.getScriptProperties().getProperty(result.slot),saved=raw?JSON.parse(raw):null;
        result.verified=!!saved&&saved.action==='diagnostic'&&saved.total_ms>=9000;
        if(!result.verified){result.status='failed';result.step='read_back';}
      }catch(ignore){result={status:'failed',step:'read_back'};}
    }
    console.log('PERF WRITE TEST: '+JSON.stringify(result));return result;
  }finally{if(perfProfile_===p)perfProfile_=null;}
}
