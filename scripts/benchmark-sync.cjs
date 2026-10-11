/* Deterministic latency model, NOT a Google/phone benchmark.
   Optional argument: baseline Git ref. Same service-latency model on both versions. */
const vm=require('node:vm'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {environment}=require('../tests/fake-gas.cjs'),C=require('../frontend/core.js');
function run(ref=null){
  const env=environment(),g=env.context;if(ref)for(const name of ['Repository.gs','Backup.gs','Auth.gs'])vm.runInContext(execFileSync('git',['show',ref+':backend/'+name],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'}),g);
  let now=Date.parse('2026-10-11T00:00:00Z'),enabled=false,real=0,lockMs=0,commits=[],current=null;const add=ms=>{if(enabled)now+=ms;};
  g.Date=class extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}};
  const id=(prefix,n)=>prefix+'000000-0000-4000-8000-'+String(n).padStart(12,'0');
  const ops=Array.from({length:10},(_,i)=>{const start=new Date(Date.parse('2026-01-02T00:00:00Z')+i*60000).toISOString();return {op_id:id('aa',i),device_id:id('cc',0),queued_at:'2026-10-11T00:00:00.000Z',base_revision:i,type:'import',events:[C.validateEvent({event_id:id('bb',i),start_at:start,end_at:new Date(Date.parse(start)+30000).toISOString(),event_name:'math',category:'学习',note:'',timezone:'UTC',source:'mobile_pwa',created_at:start,updated_at:start,schema_version:1,event_key:'math',revision:0,deleted:false})]};});
  // Same initial data and five lost replies. All persistent receipt caches, if supported,
  // are populated by real commits, never by inserting fabricated cache entries.
  g.commitBatch_(ops.slice(0,5));env.properties.set('OWNER_SUB','owner');
  const wrap=(object,key,ms)=>{const fn=object[key];object[key]=function(...a){add(ms);return fn.apply(this,a);};};
  const sheet=g.master_().getSheetByName('state'),range=sheet.getRange(2,2),rp=Object.getPrototypeOf(range),sp=Object.getPrototypeOf(sheet);
  for(const [key,ms]of [['getValues',90],['setValues',160],['setNumberFormat',15]])wrap(rp,key,ms);
  for(const [key,ms]of [['getLastRow',30],['getMaxRows',15]])wrap(sp,key,ms);
  const finder=rp.createTextFinder;rp.createTextFinder=function(...args){const f=finder.apply(this,args);wrap(f,'findNext',180);return f;};
  wrap(g.SpreadsheetApp,'openById',250);wrap(g.SpreadsheetApp,'flush',350);
  const folder=g.DriveApp.getFolderById(env.properties.get('CONFIG_FOLDER_ID'));wrap(Object.getPrototypeOf(folder),'createFile',800);
  wrap(Object.getPrototypeOf([...env.files.values()][0]),'setTrashed',150);
  const cache=g.CacheService.getScriptCache;g.CacheService.getScriptCache=()=>{const c=cache();wrap(c,'get',8);wrap(c,'put',8);return c;};
  g.verifyIdToken_=()=>{add(120);return 'owner';};const lock=g.LockService.getScriptLock;g.LockService.getScriptLock=()=>{const l=lock(),take=l.tryLock,release=l.releaseLock;let start;l.tryLock=()=>{add(35);start=now;return take();};l.releaseLock=()=>{lockMs+=now-start;return release();};return l;};
  // Two variable storage stalls, identical in both implementations. Later commits
  // use the smaller stall. RPC counts still come from the actual repository code.
  const commit=g.commit_;g.commit_=function(...a){const start=now,c={index:commits.length,lookup_op_ms:0,apply_plan_ms:0};current=c;try{return commit.apply(this,a);}finally{c.total_ms=now-start;commits.push(c);current=null;}};
  const lookup=g.lookupOp_;g.lookupOp_=function(...a){const start=now;try{return lookup.apply(this,a);}finally{if(current)current.lookup_op_ms+=now-start;}};
  const apply=g.applyPlan_;g.applyPlan_=function(...a){const start=now;try{if(enabled){real++;add(real===2?13000:3000);}return apply.apply(this,a);}finally{if(current)current.apply_plan_ms+=now-start;}};
  enabled=true;let pending=ops.slice(),requests=[];
  while(pending.length){env.metrics.finds.length=0;commits=[];lockMs=0;const begin=now,html=g.doPost({parameter:{payload:JSON.stringify({action:'sync_batch',ops:pending,token:'test',origin:'https://owner.github.io',nonce:id('dd',requests.length)})}}).html;
    const match=html.match(/w.postMessage\((.*),"https:\/\/owner.github.io"\);/);if(!match)throw Error('response parse');const reply=JSON.parse(match[1]).reply;if(!reply.confirmed?.length)throw Error(JSON.stringify(reply));
    requests.push({total_ms:now-begin,lock_ms:lockMs,elapsed_ms:now-begin,confirmed:reply.confirmed.length,code:reply.code||'OK',text_finders:env.metrics.finds.length,commits:commits.map(c=>({index:c.index,total_ms:c.total_ms,lookup_op_ms:c.lookup_op_ms,apply_plan_ms:c.apply_plan_ms}))});pending=pending.slice(reply.confirmed.length);
  }
  enabled=false;return {requests,all_request_total_ms:requests.reduce((n,r)=>n+r.total_ms,0),max_request_ms:Math.max(...requests.map(r=>r.total_ms)),final_revision:g.state_().revision,total_seconds:g.query_({mode:'all'}).total.total_seconds};
}
if(require.main===module){const ref=process.argv[2];const result={model:'Fixed per-service costs plus identical 3s/13s storage stalls; synthetic, not production measurements',...(ref?{baseline_ref:ref,before:run(ref)}:{}),after:run()};console.log(JSON.stringify(result,null,2));}
module.exports={run};
