const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {environment}=require('./fake-gas.cjs'),C=require('../frontend/core.js');
function fixture(){
  const env=environment(),g=env.context;let now=Date.now(),held=false,perfWrites=0;const logs=[];
  g.Date=class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
  g.console.log=s=>logs.push(s);
  g.verifyIdToken_=()=> 'verified-owner';
  g.LockService.getScriptLock=()=>({tryLock(){assert.equal(held,false);held=true;return true;},releaseLock(){assert.equal(held,true);held=false;}});
  const props=g.PropertiesService.getScriptProperties(),save=props.setProperties.bind(props);
  props.setProperties=obj=>{if(Object.keys(obj).some(k=>k.startsWith('PERF_'))){assert.equal(held,false,'profiling writes must follow release');perfWrites++;}return save(obj);};
  function run(action='state',ops){return g.doPost({parameter:{payload:JSON.stringify({action,ops,nonce:crypto.randomUUID(),token:'SECRET-TOKEN',email:'private@example.com',note:'SECRET-NOTE',origin:'https://owner.github.io'})}});}
  return {...env,g,run,logs,props,advance:ms=>now+=ms,held:()=>held,writes:()=>perfWrites,profiles:()=>[...env.properties].filter(([k])=>/^PERF_SLOT_\d$/.test(k)).map(([,v])=>JSON.parse(v))};
}
function operation(){const at='2026-01-02T00:00:00.000Z';return {op_id:crypto.randomUUID(),device_id:crypto.randomUUID(),queued_at:at,base_revision:0,type:'import',events:[C.validateEvent({event_id:crypto.randomUUID(),start_at:at,end_at:'2026-01-02T00:00:30.000Z',event_name:'SECRET-EVENT',category:'学习',note:'PRIVATE-EVENT-NOTE',timezone:'UTC',source:'mobile_pwa',created_at:at,updated_at:at,schema_version:1,event_key:'math',revision:0,deleted:false})]};}

test('profiler fast requests persist nothing and produce no Web App console logs',()=>{const f=fixture();assert.match(f.run().html,/"ok":true/);assert.equal(f.writes(),0);assert.equal(f.profiles().length,0);assert.equal(f.logs.length,0);assert.equal(f.g.perfProfile_,null);});

test('profiler >=8 seconds saves only after lock release and excludes persistence time',()=>{
  const f=fixture(),state=f.g.state_;f.g.state_=()=>{f.advance(8000);return state();};const save=f.props.setProperties;f.props.setProperties=v=>{f.advance(3000);return save(v);};
  assert.match(f.run().html,/"ok":true/);assert.equal(f.writes(),1);const p=f.profiles()[0];assert.equal(p.total_ms,8000);assert.equal(p.lock_ms,8000);assert.equal(f.held(),false);
});

test('profiler isolates auth, lock wait, recover and reports receipt flush in slowest overview',()=>{
  const f=fixture(),g=f.g;g.verifyIdToken_=()=>{f.advance(120);return 'verified-owner';};const lock=g.LockService.getScriptLock;g.LockService.getScriptLock=()=>{const l=lock(),take=l.tryLock;l.tryLock=()=>{f.advance(35);return take();};return l;};
  const timed=g.perfTimed_;g.perfTimed_=(target,key,fn)=>timed(target,key,()=>{if(key==='flush_receipt_ms')f.advance(52100);if(key==='set_pending_ms')f.advance(3200);return fn();});
  const op=operation();assert.match(f.run('sync_batch',[op]).html,/"ok":true/);const p=f.profiles()[0];assert.equal(p.auth_ms,120);assert.equal(p.lock_wait_ms,35);assert.equal(p.lock_ms,55300);assert.equal(p.total_ms,55455);assert.equal(p.batch_size,1);
  const c=p.commits[0];assert.equal(c.index,0);assert.equal(c.set_pending_ms,3200);assert.equal(c.apply.flush_receipt_ms,52100);assert.equal(c.apply_plan_ms,52100);assert.equal(c.total_ms,55300);
  for(const key of g.PERF_COMMIT_KEYS_)assert.equal(typeof c[key],'number');for(const key of g.PERF_APPLY_KEYS_)assert.equal(typeof c.apply[key],'number');
  const saved=JSON.stringify(p);for(const secret of ['SECRET-TOKEN','private@example.com','SECRET-NOTE','SECRET-EVENT','PRIVATE-EVENT-NOTE',op.op_id,op.device_id,op.events[0].event_id])assert.ok(!saved.includes(secret),secret);
  g.perfDiagnostics();assert.match(f.logs.join('\n'),/SLOWEST REQUEST/);assert.match(f.logs.join('\n'),/SLOWEST COMMIT/);assert.match(f.logs.join('\n'),/SLOWEST APPLY STAGE/);assert.match(f.logs.at(-1),/flush_receipt_ms/);
});

test('profiler ring remains ten slots after twelve errors; action and errors cannot leak input',()=>{
  const f=fixture();f.g.verifyIdToken_=()=>{throw Error('token=SECRET-TOKEN email=private@example.com note=SECRET-NOTE');};
  for(let i=0;i<12;i++){f.advance(1000);f.run('arbitrary-SECRET-NOTE');}
  assert.equal(f.profiles().length,10);assert.equal(f.properties.get('PERF_SEQ'),'12');assert.equal([...f.properties.keys()].filter(k=>k.startsWith('PERF_')).length,11);
  for(const p of f.profiles()){assert.equal(p.exception,true);assert.equal(p.action,'unknown');assert.equal(p.lock_ms,0);assert.equal(p.total_ms,0);assert.doesNotMatch(JSON.stringify(p),/SECRET|private@example/);}
  f.g.perfDiagnostics();const printed=f.logs.filter(s=>s.startsWith('{')).map(JSON.parse);assert.deepEqual(printed.map(p=>p.timestamp),printed.map(p=>p.timestamp).sort());
});

test('profiler quota/write failure leaves successful response and real state unchanged',()=>{
  const f=fixture(),state=f.g.state_;f.g.state_=()=>{f.advance(9000);return state();};f.props.setProperties=()=>{throw Error('quota exhausted');};assert.match(f.run().html,/"ok":true/);assert.equal(f.g.perfProfile_,null);assert.equal(f.held(),false);
});

test('clearPerfDiagnostics deletes exactly the diagnostic ring and keeps business properties',()=>{
  const f=fixture();for(let i=0;i<10;i++)f.properties.set('PERF_SLOT_'+i,'{}');f.properties.set('PERF_SEQ','42');f.properties.set('OAUTH_SECRET_TEST','keep');f.properties.set('PERF_UNRELATED','keep');const before=new Map(f.properties);
  f.g.clearPerfDiagnostics();for(const [k,v]of before){if(k==='PERF_SEQ'||/^PERF_SLOT_\d$/.test(k))assert.equal(f.properties.has(k),false);else assert.equal(f.properties.get(k),v);}
  f.g.perfDiagnostics();assert.match(f.logs.at(-1),/No saved/);
});

test('failed commit captures timing without storing thrown content or changing error response',()=>{
  const f=fixture(),g=f.g;g.lookupOp_=()=>{f.advance(123);throw Error('PRIVATE-EVENT-NOTE');};const reply=f.run('sync_batch',[operation()]);assert.match(reply.html,/PRIVATE-EVENT-NOTE/);const p=f.profiles()[0];assert.equal(p.exception,true);assert.equal(p.commits[0].exception,true);assert.equal(p.commits[0].lookup_op_ms,123);assert.doesNotMatch(JSON.stringify(p),/PRIVATE/);
});

test('ten detailed commit profiles fit a ScriptProperties slot',()=>{
  const f=fixture(),p=f.g.perfBegin_();p.lock_ms=99999;
  for(let i=0;i<10;i++){const c={};for(const k of f.g.PERF_COMMIT_KEYS_)c[k]=999999;c.index=i;c.apply={};for(const k of f.g.PERF_APPLY_KEYS_)c.apply[k]=999999;p.commits.push(c);}
  f.g.perfFinish_(p);assert.equal(f.profiles()[0].commits.length,10);assert.ok(Buffer.byteLength(f.properties.get('PERF_SLOT_0'),'utf8')<9000);
});

test('recovery apply and pending Drive/flush timings are captured without altering recovery',()=>{
  const f=fixture(),g=f.g,op=operation(),plan=C.planOperation(op,g.state_(),g.repository_(),Date.now());plan.request_hash=g.hash_(C.canonical(op));g.setPending_(plan);
  const timed=g.perfTimed_;g.perfTimed_=(target,key,fn)=>timed(target,key,()=>{if(key==='clear_pending_flush_ms')f.advance(9000);return fn();});
  assert.match(f.run().html,/"ok":true/);const p=f.profiles()[0];assert.equal(p.recover_ms,9000);assert.equal(p.recovery_apply.clear_pending_ms,9000);assert.equal(p.recovery_apply.clear_pending_flush_ms,9000);assert.equal(g.pending_(),null);assert.equal(g.state_().revision,1);
});

test('pending create and flush attribution and post-return HTML errors are saved',()=>{
  const f=fixture(),g=f.g,timed=g.perfTimed_;g.perfTimed_=(target,key,fn)=>timed(target,key,()=>{if(key==='pending_drive_ms')f.advance(6000);if(key==='pending_flush_ms')f.advance(2500);return fn();});
  assert.match(f.run('sync_batch',[operation()]).html,/"ok":true/);const c=f.profiles()[0].commits[0];assert.equal(c.set_pending_ms,8500);assert.equal(c.pending_drive_ms,6000);assert.equal(c.pending_flush_ms,2500);
  g.HtmlService.createHtmlOutput=()=>{throw Error('private response failure');};assert.throws(()=>f.run(),/private response failure/);assert.equal(f.profiles().length,2);assert.equal(f.profiles()[1].exception,true);assert.doesNotMatch(JSON.stringify(f.profiles()[1]),/private response/);
});

test('held profile cannot persist; same profile can persist only after explicit release',()=>{
  const f=fixture(),p=f.g.perfBegin_();p._started-=9000;p._held=true;
  assert.equal(f.g.perfFinish_(p).reason,'lock_not_confirmed_released');assert.equal(f.writes(),0);
  p._held=false;assert.equal(f.g.perfFinish_(p).status,'saved');assert.equal(f.writes(),1);assert.equal(f.profiles()[0].total_ms,9000);
});

test('manual nine-second diagnostic self-test saves and verifies a readable diagnostic profile',()=>{
  const f=fixture(),result=f.g.testPerfDiagnosticsWrite();assert.equal(result.status,'saved');assert.equal(result.verified,true);assert.equal(f.profiles()[0].action,'diagnostic');assert.equal(f.profiles()[0].total_ms,9000);
  f.g.perfDiagnostics();assert.ok(f.logs.some(s=>s.includes('"action": "diagnostic"')));assert.ok(!f.logs.some(s=>s==='No saved slow/error profiles.'));assert.equal(f.g.perfProfile_,null);
});

test('manual write test reports persistence failure instead of claiming success',()=>{
  const f=fixture();f.props.setProperties=()=>{throw Error('PRIVATE-SERVICE-DETAIL');};const result=f.g.testPerfDiagnosticsWrite();assert.equal(result.status,'failed');assert.equal(result.step,'write_properties');assert.doesNotMatch(f.logs.join('\n'),/PRIVATE-SERVICE/);
});

test('one outer finally finalizes successful and failed slow requests strictly after one release',()=>{
  for(const fail of [false,true]){const f=fixture(),g=f.g,events=[];let held=false,releaseCalls=0,finishes=0;
    g.LockService.getScriptLock=()=>({tryLock(){held=true;events.push('acquire');return true;},releaseLock(){assert.equal(held,true);held=false;releaseCalls++;events.push('release');}});
    const state=g.state_;g.state_=()=>{f.advance(9000);if(fail)throw Error('business failure');return state();};
    const finish=g.perfFinish_;g.perfFinish_=p=>{assert.equal(held,false);assert.equal(p._held,false);finishes++;events.push('finish');return finish(p);};
    const response=f.run();assert.match(response.html,fail?/business failure/:/"ok":true/);assert.equal(releaseCalls,1);assert.equal(finishes,1);assert.deepEqual(events,['acquire','release','finish']);assert.equal(f.profiles().length,1);assert.equal(g.perfProfile_,null);
  }
});

test('lock acquisition failure finalizes error with no release',()=>{
  const f=fixture(),g=f.g;let releases=0,finishes=0;g.LockService.getScriptLock=()=>({tryLock(){return false;},releaseLock(){releases++;}});
  const finish=g.perfFinish_;g.perfFinish_=p=>{finishes++;assert.equal(p._held,false);return finish(p);};assert.match(f.run().html,/BUSY/);assert.equal(releases,0);assert.equal(finishes,1);assert.equal(f.profiles()[0].exception,true);
});

test('outer cleanup retries only an uncompleted release and does not persist while lock remains held',()=>{
  for(const canRelease of [true,false]){const f=fixture(),g=f.g;let held=false,attempts=0,finishes=0;
    g.LockService.getScriptLock=()=>({tryLock(){held=true;return true;},hasLock(){return held;},releaseLock(){attempts++;if(attempts===1||!canRelease)throw Error('release failed');held=false;}});
    const finish=g.perfFinish_;g.perfFinish_=p=>{assert.equal(held,false);finishes++;return finish(p);};
    assert.match(f.run().html,/release failed/);assert.equal(attempts,2);assert.equal(finishes,canRelease?1:0);assert.equal(f.profiles().length,canRelease?1:0);assert.equal(g.perfProfile_,null);
  }
});

test('release that throws after actually releasing is not called twice',()=>{
  const f=fixture(),g=f.g;let held=false,attempts=0;g.LockService.getScriptLock=()=>({tryLock(){held=true;return true;},hasLock(){return held;},releaseLock(){attempts++;held=false;throw Error('released but service failed');}});
  assert.match(f.run().html,/released but service failed/);assert.equal(attempts,1);assert.equal(f.profiles().length,1);assert.equal(f.profiles()[0].exception,true);
});

test('unexpected profiler finalization error cannot replace doPost response or leak global profile',()=>{
  const f=fixture();f.g.perfFinish_=()=>{throw Error('profiler failure');};assert.match(f.run().html,/"ok":true/);assert.equal(f.g.perfProfile_,null);
});
