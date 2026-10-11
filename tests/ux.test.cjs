const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {IDBFactory,IDBKeyRange}=require('fake-indexeddb'),C=require('../frontend/core.js'),{environment}=require('./fake-gas.cjs');
const clone=v=>JSON.parse(JSON.stringify(v));
function timers(){let now=0,next=0;const jobs=new Map();return {jobs,setTimeout(fn,ms){const id=++next;jobs.set(id,{fn,at:now+ms});return id;},clearTimeout(id){jobs.delete(id);},advance(ms){now+=ms;for(const [id,j]of [...jobs])if(j.at<=now){jobs.delete(id);j.fn();}},now:()=>now};}
class Node{constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.style={};this.hidden=false;this.value='';this.textContent='';this.attrs={};}append(...v){for(const n of v)n.parent=this;this.children.push(...v);}prepend(...v){for(const n of v)n.parent=this;this.children.unshift(...v);}replaceChildren(...v){this.children=[];this.append(...v);}remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}replaceWith(n){const p=this.parent;if(p){n.parent=p;p.children[p.children.indexOf(this)]=n;}}get lastElementChild(){return this.children.at(-1);}setAttribute(k,v){this.attrs[k]=v;}addEventListener(){}scrollIntoView(){}showModal(){this.open=true;}close(){this.open=false;}}
function runtime(app=false,debug=false){const clock=timers(),nodes=new Map(),detail=Object.assign(new Node(),{open:true}),g=vm.createContext({console,crypto,structuredClone,Map,Set,Date,Intl,TimeCore:C,IDBKeyRange,indexedDB:new IDBFactory(),atob:s=>Buffer.from(s,'base64').toString(),setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout,setInterval(){},addEventListener(){},navigator:{onLine:true},location:{origin:'https://owner.github.io',search:debug?'?debug=1':''},document:{getElementById:id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);},createElement:t=>new Node(t),querySelector:s=>s==='.history-records'?detail:null,querySelectorAll:()=>[],addEventListener(){},head:new Node(),body:new Node()}});
  for(const f of ['db.js','ux.js','transport.js'])vm.runInContext(fs.readFileSync('frontend/'+f,'utf8'),g,{filename:f});
  if(app){let source=fs.readFileSync('frontend/app.js','utf8');source=source.slice(0,source.lastIndexOf('init().catch'));g.TimeTransport.ready=()=>true;g.google={accounts:{id:{initialize(){},renderButton(){},prompt(){}}}};vm.runInContext(source,g,{filename:'app.js'});}
  return {g,clock,nodes,detail,run:s=>vm.runInContext(s,g)};
}
function event(i=0){const a=new Date(Date.parse('2026-01-02T00:00:00Z')+i*60000).toISOString();return C.validateEvent({event_id:crypto.randomUUID(),start_at:a,end_at:new Date(Date.parse(a)+30000).toISOString(),event_name:'数学',category:'学习',note:'',timezone:'UTC',source:'mobile_pwa',created_at:a,updated_at:a,schema_version:1,event_key:'math',revision:0,deleted:false});}
async function app(){const r=runtime(true),env=environment(),g=r.g,D=g.TimeDB,calls=[];const database=await D.open();g.TimeTransport.call=async(_,p)=>{calls.push(p);switch(p.action){case 'sync_batch':return clone(env.context.commitBatch_(p.ops));case 'state':return {ok:true,state:clone(env.context.state_())};case 'query':return clone(env.context.query_(p));case 'records':return clone(env.context.records_(p));default:throw Error('unexpected action');}};
  await r.run("settings={backendUrl:'https://script.google.com/macros/s/test/exec',clientId:'test.apps.googleusercontent.com'};repaint()");g.document.getElementById('record-year').value='2026';return {...r,D,env,calls,database};
}
test('Toast loading persists; success 1800ms/error 4000ms; old timers cannot dismiss new toast',()=>{const {g,clock}=runtime(),node=new Node(),t=g.TimeUX.toast(node,clock);t.show('sync','loading','sync');clock.advance(10000);assert.equal(node.hidden,false);t.show('saved');clock.advance(2000);assert.equal(node.textContent,'sync');t.clear('sync');assert.equal(node.hidden,true);t.show('success');clock.advance(1799);assert.equal(node.hidden,false);clock.advance(1);assert.equal(node.hidden,true);t.show('old');clock.advance(1000);t.show('failed','error');clock.advance(800);assert.equal(node.textContent,'failed');clock.advance(3199);assert.equal(node.hidden,false);clock.advance(1);assert.equal(node.hidden,true);});
test('GIS returning-user auto select, expiry re-prompt throttling, manual fallback, memory-only token',()=>{const {g,clock}=runtime();let config,prompts=0,buttons=0,success=0,fallback=0;const id={initialize:c=>config=c,renderButton:()=>buttons++,prompt:()=>prompts++},transport=g.TimeTransport,ui=g.TimeUX.identity({getId:()=>id,transport,onCredential:()=>success++,onFallback:()=>fallback++,now:clock.now});const node=new Node();ui.start('client',node);assert.equal(config.auto_select,true);assert.equal(config.button_auto_select,true);assert.equal(config.use_fedcm_for_button,true);assert.equal(prompts,1);ui.start('client',node);assert.equal(prompts,1);const jwt=exp=>'header.'+Buffer.from(JSON.stringify({exp})).toString('base64url')+'.signature';config.callback({credential:jwt(Date.now()/1000+3600)});assert.equal(success,1);assert.equal(transport.ready(),true);ui.expired();clock.advance(60000);ui.start('client',node);assert.equal(prompts,2);config.callback({credential:jwt(Date.now()/1000-1)});assert.equal(transport.ready(),false);assert.equal(fallback,2);assert.ok(buttons>=3);assert.equal(runtime().g.TimeTransport.ready(),false,'reload loses token');});
for(const n of [1,3,10])test(`client sync ${n}: one request, immediate completion before delayed summary`,async()=>{const {D,run,calls,clock,nodes}=await app();for(let i=0;i<n;i++)await D.enqueue({type:'import',events:[event(i)]});await run('sync()');assert.equal((await D.snapshot()).ops.length,0);assert.deepEqual(calls.map(c=>c.action),['sync_batch']);assert.equal(calls[0].ops.length,n);assert.equal(nodes.get('toast').textContent,'同步完成');assert.ok([...clock.jobs.values()].some(j=>j.at===2000));});
test('middle conflict deletes only confirmed ops; remainder survives reload',async()=>{const {D,run,env}=await app();for(let i=0;i<10;i++)await D.enqueue({type:'import',events:[event(i)]});const original=env.context.commit_;let count=0;env.context.commit_=op=>{if(++count===5)return {ok:false,code:'CONFLICT',state:env.context.state_(),message:'conflict'};return original(op);};await run('sync()');let s=await D.snapshot();assert.equal(s.ops.length,6);assert.equal(s.conflict.state.revision,4);const ids=s.ops.map(o=>o.op_id);await D.open();s=await D.snapshot();assert.deepEqual(s.ops.map(o=>o.op_id),ids);});
test('lost batch reply leaves durable pending, replay is deduplicated without data loss',async()=>{const {g,D,run,env}=await app();for(let i=0;i<3;i++)await D.enqueue({type:'import',events:[event(i)]});const send=g.TimeTransport.call;g.TimeTransport.call=async(...args)=>{await send(...args);throw Error('network interrupted');};await run('sync()');assert.equal((await D.snapshot()).ops.length,3);assert.equal(env.context.state_().revision,3);await D.open();g.TimeTransport.call=send;await run('sync()');assert.equal((await D.snapshot()).ops.length,0);assert.equal(env.context.state_().revision,3);});
test('invalid acknowledgement cannot delete any queued op',async()=>{const {g,D}=await app();await D.enqueue({type:'import',events:[event()]});const s=await D.snapshot();await assert.rejects(g.TimeUX.acceptResponse(D,s.ops,{ok:true,confirmed:[crypto.randomUUID()],state:s.local}),/回执/);assert.equal((await D.snapshot()).ops.length,1);});
test('local-first list is visible while request is pending; cache hit makes zero requests',async()=>{const {g,D,run,calls,nodes}=await app(),e=event();await D.remember([e]);let resolve,started;const requestStarted=new Promise(r=>started=r);g.TimeTransport.call=(_,p)=>{calls.push(p);return new Promise(r=>{resolve=r;started();});};const loading=run('loadRecords()');await requestStarted;assert.equal(nodes.get('records').children.length,1);assert.equal(nodes.get('records').children[0].tagName,'div');assert.deepEqual(calls.map(c=>c.action),['records']);resolve({ok:true,events:[e],offset:0,next:null,cloud_revision:0});await loading;calls.length=0;await run('loadRecords()');assert.equal(calls.length,0);const meta=await D.get('cache','records:2026');assert.equal(meta.complete,true);assert.equal(meta.year,'2026');assert.equal(meta.next_cursor,null);assert.ok(meta.fetched_at>0);});
test('101 cached records: next page fetch once, back and reopen from cache; unchanged revision no redownload',async()=>{const {D,run,calls,env,nodes}=await app(),events=Array.from({length:101},(_,i)=>event(i)),s=env.context.yearBook_('2026').getSheetByName('events');s.getRange(2,1,101,C.HEADERS.length).setValues(events.map(e=>C.HEADERS.map(h=>e[h])));await run('loadRecords()');assert.equal(nodes.get('records').children.length,100);await run('loadRecords(true)');assert.equal(nodes.get('records').children.length,1);assert.deepEqual(calls.map(c=>[c.action,c.offset]),[['records',0],['records',100]]);await run("loadRecords('previous')");await run('loadRecords()');assert.equal(calls.length,2);let meta=await D.get('cache','records:2026');assert.equal(meta.complete,true);meta.fetched_at=0;await D.cache('records:2026',meta);await run('loadRecords()');assert.equal(calls.length,3);assert.equal(calls[2].check_only,true);assert.equal((await D.snapshot()).events.length,101);});
test('optimistic delete disappears before networking; failed delete stays durable and cached cloud cannot resurrect it',async t=>{const {g,D,run,nodes}=await app(),e=event();await D.rememberPage('2026',{events:[e],offset:0,next:null,cloud_revision:0});await run('loadRecords()');g.e=e;const start=performance.now();await run("act({type:'delete',year:'2026',event_id:e.event_id})");const elapsed=performance.now()-start;assert.equal(nodes.get('records').children[0].tagName,'p');g.TimeTransport.call=async()=>{throw Error('offline');};await run('sync()');assert.match(nodes.get('toast').textContent,/云端未确认.*本机/);assert.equal((await D.snapshot()).ops.length,1);await D.rememberPage('2026',{events:[e],offset:0,next:null,cloud_revision:0});assert.equal((await D.snapshot()).events[0].deleted,true);await D.open();assert.equal((await D.snapshot()).ops.length,1);t.diagnostic(`Simulated local delete to rendered disappearance: ${elapsed.toFixed(1)} ms; 0 network requests required.`);});
test('optimistic edit/split/cross-year effects, ten queued modifications share one batch',async()=>{const {g,D,run,calls}=await app(),e=event();await D.enqueue({type:'import',events:[e]});await run('sync()');await D.rememberPage('2026',{events:(await D.snapshot()).events,offset:0,next:null,cloud_revision:1});await run('loadRecords()');g.e=e;
  await run("act({type:'edit',year:'2026',event_id:e.event_id,patch:{note:'edited'}})");assert.equal((await D.snapshot()).events[0].note,'edited');
  await D.enqueue({type:'split',year:'2026',event_id:e.event_id,at:new Date(Date.parse(e.start_at)+15000).toISOString(),event_key:'english',new_event_id:crypto.randomUUID()});assert.equal((await D.snapshot()).events.filter(e=>!e.deleted).length,2);
  await D.enqueue({type:'edit',year:'2026',event_id:e.event_id,patch:{start_at:'2027-01-02T00:00:00Z',end_at:'2027-01-02T00:00:15Z'}});assert.equal(C.eventYear((await D.snapshot()).events.find(v=>v.event_id===e.event_id)),'2027');
  for(let i=0;i<7;i++)await D.enqueue({type:'edit',year:'2027',event_id:e.event_id,patch:{note:'note'+i}});calls.length=0;await run('sync()');assert.deepEqual(calls.map(p=>p.action),['sync_batch']);assert.equal(calls[0].ops.length,10);assert.equal((await D.snapshot()).ops.length,0);
});
test('confirmed effects reconcile separately; delayed older query cannot roll totals back',async()=>{const {D,run,env}=await app(),e=event();await D.enqueue({type:'import',events:[e]});await run('sync()');const old=clone(env.context.query_({mode:'all'})),key='query:all:all';await D.cache(key,old);await D.enqueue({type:'edit',year:'2026',event_id:e.event_id,patch:{start_at:'2027-01-02T00:00:00Z',end_at:'2027-01-02T00:01:00Z'}});const pending=await D.getSyncState();await run('sync()');await D.reconcileConfirmedCaches(pending.ops.map(i=>({revision:i.op.base_revision,effects:i.effects})));assert.equal((await D.get('cache',key)).total.total_seconds,60);const stale=await D.cache(key,old);assert.equal(stale.total.total_seconds,60);assert.equal(stale.state.revision,2);});
test('old records response cannot override a newer confirmed edit or newer pagination generation',async()=>{const {D,run}=await app(),e=event();await D.enqueue({type:'import',events:[e]});await run('sync()');await D.rememberPage('2026',{events:[{...e,revision:1}],offset:0,next:null,cloud_revision:1});await D.enqueue({type:'edit',year:'2026',event_id:e.event_id,patch:{note:'new'}});await run('sync()');await D.rememberPage('2026',{events:[e],offset:0,next:null,cloud_revision:1});assert.equal((await D.snapshot()).events[0].note,'new');});
test('complete fresh remote cache removes stale remote-deleted events but protects unsynced edits',async()=>{const {D}=await app(),a=event(),b=event(1);await D.remember([a,b]);await D.enqueue({type:'edit',year:'2026',event_id:b.event_id,patch:{note:'pending'}});await D.rememberPage('2026',{events:[],offset:0,next:null,cloud_revision:1});const s=await D.snapshot();assert.equal(s.events.length,1);assert.equal(s.events[0].event_id,b.event_id);assert.equal(s.events[0].note,'pending');});
test('large batches respect envelope budget and preserve queue order',()=>{const {g}=runtime(),ops=Array.from({length:10},(_,i)=>({op_id:String(i),op:{note:'x'.repeat(20000)}})),selected=g.TimeUX.batch(ops);assert.equal(selected.length,4);assert.deepEqual(clone(selected.map(i=>i.op_id)),['0','1','2','3']);});
test('optimistic edits do not duplicate cards across cached pages',async()=>{const {g,D}=await app(),events=Array.from({length:101},(_,i)=>event(i)).reverse();await D.rememberPage('2026',{events:events.slice(0,100),offset:0,next:100,cloud_revision:0});await D.rememberPage('2026',{events:events.slice(100),offset:100,next:null,cloud_revision:0});await D.enqueue({type:'edit',year:'2026',event_id:events[0].event_id,patch:{note:'pending'}});const s=await D.snapshot(),meta=await D.get('cache','records:2026');const first=g.TimeUX.recordsView(s,'2026',0,meta),last=g.TimeUX.recordsView(s,'2026',100,meta);assert.equal(first.length,100);assert.equal(last.length,1);assert.equal(new Set([...first,...last].map(e=>e.event_id)).size,101);});
test('adopting cloud invalidates record metadata along with cleared events',async()=>{const {D}=await app(),e=event();await D.rememberPage('2026',{events:[e],offset:0,next:null,cloud_revision:0});await D.freeze((await D.snapshot()).local);await D.useCloud();assert.equal(await D.get('cache','records:2026'),undefined);assert.equal((await D.snapshot()).events.length,0);});
test('AUTH_REQUIRED retains pending; a fresh credential can resume through manual fallback',async()=>{const {g,D,run,nodes}=await app();await D.enqueue({type:'import',events:[event()]});const send=g.TimeTransport.call;g.TimeTransport.call=async()=>({ok:false,code:'AUTH_REQUIRED'});await run('sync()');assert.equal((await D.snapshot()).ops.length,1);assert.match(nodes.get('toast').textContent,/登录已过期/);g.TimeTransport.call=send;await run('sync()');assert.equal((await D.snapshot()).ops.length,0);});

function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
const activity=(key,at)=>({type:'switch',at:new Date(at).toISOString(),event_id:crypto.randomUUID(),event_key:key});
async function start408(r){const at=Date.now()-6000;await r.D.enqueue(activity('math',at));await r.D.enqueue(activity('cs408',at+1000));await r.run('repaint()');return at+2000;}
function holdFirstBatch(r){const started=deferred(),gate=deferred(),send=r.g.TimeTransport.call;let held=false;
  r.g.TimeTransport.call=async(settings,payload)=>{if(payload.action==='sync_batch'&&!held){held=true;started.resolve(payload);await gate.promise;}return send(settings,payload);};return {started:started.promise,release:gate.resolve};
}
function instrument(database){const transactions=[],requests=[],original=database.transaction.bind(database);database.transaction=(stores,mode,...rest)=>{
  transactions.push({stores:[...typeof stores==='string'?[stores]:stores],mode:mode||'readonly'});const tx=original(stores,mode,...rest),objectStore=tx.objectStore.bind(tx),seen=new WeakSet();
  const wrap=(object,store)=>{if(seen.has(object))return object;seen.add(object);for(const method of ['get','getAll','getAllKeys','count','put','delete','openKeyCursor'])if(object[method]){const call=object[method].bind(object);object[method]=(...args)=>{requests.push({store,method});return call(...args);};}return object;};
  tx.objectStore=name=>{const s=objectStore(name);if(!seen.has(s)){const index=s.index.bind(s);s.index=name=>wrap(index(name),s.name+'.'+name);}return wrap(s,name);};return tx;
};return {transactions,requests,reset(){transactions.length=0;requests.length=0;},restore(){database.transaction=original;}};}
test('A: unresolved sync_batch cannot block math → english → fitness or disable quick input',{timeout:3000},async()=>{
  const r=await app(),at=await start408(r),hold=holdFirstBatch(r),flight=r.run('sync()'),sent=await hold.started;
  assert.equal(sent.ops.length,2);const buttons=[...r.nodes.get('quick').children];
  for(const [i,key]of ['math','english','fitness'].entries()){r.g.spec=activity(key,at+i*1000);await r.run('act(spec)');}
  const s=await r.D.snapshot();assert.equal(s.local.current.event_key,'fitness');assert.equal(s.ops.length,5);assert.deepEqual(s.ops.slice(2).map(i=>i.op.event_key),['math','english','fitness']);
  assert.equal(r.nodes.get('current-name').textContent,'健身');assert.equal(buttons.find(b=>b.dataset.eventKey==='fitness').className,'active');assert.ok(buttons.every(b=>!b.disabled));assert.deepEqual(r.nodes.get('quick').children,buttons,'buttons must retain identity');
  assert.match(r.nodes.get('toast').textContent,/正在同步…/);
  hold.release();await flight;assert.equal((await r.D.snapshot()).ops.length,0);assert.equal(r.env.context.state_().current.event_key,'fitness');assert.equal(r.nodes.get('current-name').textContent,'健身');assert.deepEqual(r.calls.filter(p=>p.action==='sync_batch').map(p=>p.ops.length),[2,3]);
});
test('B: 100 cached cards, closed history, 30-second network stall: fast path touches no records DOM/cache',{timeout:3000},async()=>{
  const r=await app(),events=Array.from({length:100},(_,i)=>event(i));await r.D.rememberPage('2026',{events,offset:0,next:null,cloud_revision:0});await r.run('loadRecords()');assert.equal(r.nodes.get('records').children.length,100);
  r.detail.open=false;const cards=[...r.nodes.get('records').children],at=await start408(r),hold=holdFirstBatch(r),flight=r.run('sync()');await hold.started;
  r.run('var recordPaintCalls=0;const originalRecordPaint=paintRecords;paintRecords=(...args)=>{recordPaintCalls++;return originalRecordPaint(...args);};');
  // Advance only the mock clock; the batch remains unresolved beyond 30 seconds.
  r.clock.advance(30000);const io=instrument(r.database);r.g.spec=activity('math',at);await r.run('act(spec)');io.restore();
  assert.equal(r.nodes.get('current-name').textContent,'数学二');assert.equal(r.run('recordPaintCalls'),0);assert.deepEqual(r.nodes.get('records').children,cards);assert.ok(io.requests.every(q=>!['getAll','getAllKeys'].includes(q.method)&&q.store!=='cache'));
  assert.equal(io.transactions.length,1);assert.equal(r.calls.filter(p=>p.action==='records').length,0);hold.release();await flight;
});
test('C: a delayed old repaint cannot overwrite a newer committed switch; same-activity no-op repairs UI',{timeout:3000},async()=>{
  const r=await app(),at=await start408(r),started=deferred(),gate=deferred(),read=r.D.getOverview;r.D.getOverview=async()=>{const old=await read();assert.equal(old.local.current.event_key,'cs408');started.resolve();await gate.promise;return old;};
  const oldPaint=r.run('repaint()');await started.promise;r.g.spec=activity('math',at);await r.run('act(spec)');gate.resolve();await oldPaint;r.D.getOverview=read;
  assert.equal((await r.D.getCurrent()).event_key,'math');assert.equal(r.nodes.get('current-name').textContent,'数学二');
  const count=await r.D.getQueueCount();r.nodes.get('current-name').textContent='408';for(const b of r.nodes.get('quick').children)b.className=b.dataset.eventKey==='cs408'?'active':'';
  await r.run('act(spec)');assert.equal(await r.D.getQueueCount(),count);assert.equal(r.nodes.get('current-name').textContent,'数学二');assert.equal(r.nodes.get('quick').children.find(b=>b.dataset.eventKey==='math').className,'active');
});
test('D: enqueue during batch acknowledgement preserves the unsent operation and newer local state',{timeout:3000},async()=>{
  const r=await app(),at=await start408(r),hold=holdFirstBatch(r),flight=r.run('sync()'),sent=await hold.started;r.g.spec=activity('math',at);await r.run('act(spec)');const added=(await r.D.snapshot()).ops.at(-1),accept=r.D.acceptBatch;let inspected=false;
  r.D.acceptBatch=async(ids,state)=>{await accept(ids,state);if(!inspected){inspected=true;assert.deepEqual(clone(ids),sent.ops.map(o=>o.op_id));const s=await r.D.snapshot();assert.deepEqual(s.ops.map(o=>o.op_id),[added.op_id]);assert.equal(s.local.current.event_key,'math');assert.equal(s.cloud.current.event_key,'cs408');assert.equal(s.local.revision,3);assert.equal(s.cloud.revision,2);}};
  hold.release();await flight;assert.equal(inspected,true);assert.equal(r.nodes.get('current-name').textContent,'数学二');
});
test('switch/stop: exactly one bounded IDB transaction, no getAll/cache/network or button rebuild',async t=>{
  const r=await app(),at=await start408(r),io=instrument(r.database),buttons=[...r.nodes.get('quick').children];
  r.g.spec=activity('math',at);let begin=performance.now();await r.run('act(spec)');const switchMs=performance.now()-begin;
  assert.equal(io.transactions.length,1);assert.deepEqual(io.transactions[0],{stores:['meta','ops','events'],mode:'readwrite'});assert.equal(io.requests.filter(q=>['get','count','openKeyCursor'].includes(q.method)).length,6);assert.equal(io.requests.filter(q=>q.method==='put').length,4);assert.ok(io.requests.every(q=>q.store!=='cache'&&!q.method.startsWith('getAll')));
  io.reset();r.g.stopSpec={type:'stop',at:new Date(at+1000).toISOString()};begin=performance.now();await r.run('act(stopSpec)');const stopMs=performance.now()-begin;
  assert.equal(io.transactions.length,1);assert.equal(io.requests.filter(q=>['get','count','openKeyCursor'].includes(q.method)).length,5);assert.equal(io.requests.filter(q=>q.method==='put').length,4);assert.ok(io.requests.every(q=>q.store!=='cache'&&!q.method.startsWith('getAll')));assert.equal(r.calls.length,0);assert.equal(r.nodes.get('current-name').textContent,'尚未开始');assert.equal(r.nodes.get('stop').disabled,true);assert.deepEqual(r.nodes.get('quick').children,buttons);io.restore();
  t.diagnostic(`Commit-to-UI test: switch ${switchMs.toFixed(2)} ms / stop ${stopMs.toFixed(2)} ms; one transaction each, 0 bulk reads, 0 network requests.`);
});
test('history repaint post-work cannot hold the input serial queue; closed config/import skip cards',{timeout:3000},async()=>{
  const r=await app(),at=await start408(r),started=deferred(),gate=deferred();r.g.startHistory=started.resolve;r.g.historyGate=gate.promise;r.run("recordsYear='2026';paintRecords=()=>{startHistory();return historyGate;};");
  r.g.e=event();const importing=r.run("act({type:'import',events:[e]})");await importing;r.clock.advance(500);await started.promise;r.g.spec=activity('english',at);await r.run('act(spec)');assert.equal(r.nodes.get('current-name').textContent,'英语');gate.resolve();await importing;
  r.detail.open=false;r.run("paintRecords=()=>{throw Error('closed history must not repaint');};");r.g.e=event(1);await r.run("act({type:'import',events:[e]})");await r.run("act({type:'config',config:snap.local.config})");
});
test('old duplicate acknowledgement cannot roll back an already fully confirmed newer local state',async()=>{const r=await app(),at=await start408(r),first=(await r.D.snapshot()).ops,old=clone(r.env.context.commitBatch_(first.map(i=>i.op)));await r.D.acceptBatch(old.confirmed,old.state);await r.D.enqueue(activity('math',at));await r.run('sync()');await r.D.acceptBatch(old.confirmed,old.state);assert.equal((await r.D.getCurrent()).event_key,'math');assert.equal((await r.D.getOverview()).cloud.revision,3);});
test('stop during an unresolved batch is durable and immediately clears current UI',{timeout:3000},async()=>{const r=await app(),at=await start408(r),hold=holdFirstBatch(r),flight=r.run('sync()');await hold.started;r.g.spec={type:'stop',at:new Date(at).toISOString()};await r.run('act(spec)');assert.equal(await r.D.getCurrent(),null);assert.equal(r.nodes.get('current-name').textContent,'尚未开始');assert.equal(r.nodes.get('stop').disabled,true);assert.equal(await r.D.getQueueCount(),3);hold.release();await flight;assert.equal(r.env.context.state_().current,null);});
test('simultaneous enqueue and acknowledgement are safe in either IDB transaction order',async()=>{for(const acknowledgeFirst of [true,false]){const r=await app(),at=await start408(r),s=await r.D.snapshot(),reply=clone(r.env.context.commitBatch_(s.ops.map(o=>o.op))),ack=()=>r.D.acceptBatch(reply.confirmed,reply.state),add=()=>r.D.enqueue(activity('math',at));await Promise.all(acknowledgeFirst?[ack(),add()]:[add(),ack()]);const result=await r.D.snapshot();assert.equal(result.ops.length,1);assert.equal(result.local.current.event_key,'math');assert.equal(result.local.revision,3);assert.equal(result.ops[0].op.base_revision,2);}});
test('failed fast transaction leaves durable current and displayed current unchanged',async()=>{const r=await app();await start408(r);const before=await r.D.snapshot();r.g.spec={type:'stop',at:'2025-01-01T00:00:00Z'};const report=r.g.console;r.g.console={...console,error(){}};await assert.rejects(r.run('act(spec)'));r.g.console=report;assert.deepEqual(await r.D.snapshot(),before);assert.equal(r.nodes.get('current-name').textContent,'408');});


// Keep an actual cache-only write transaction alive until explicitly released.
// A Promise alone would not expose IndexedDB store-lock regressions.
function holdCacheWrites(r){
  const started=deferred(),gate=deferred();let held,release=false;
  r.D.reconcileConfirmedCaches=()=>held||(held=new Promise((resolve,reject)=>{
    const tx=r.database.transaction('cache','readwrite'),store=tx.objectStore('cache');
    gate.promise.then(()=>release=true);
    const pump=()=>{const q=store.get('settings');q.onsuccess=()=>{started.resolve(tx);if(!release)pump();};};pump();
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  }));
  return {started:started.promise,release:()=>gate.resolve(),done:()=>held};
}
async function cachedHistory(r,n=100){const rows=Array.from({length:n},(_,i)=>event(i));await r.D.rememberPage('2026',{events:rows,offset:0,next:null,cloud_revision:0});return rows;}

test('E: acknowledgement resolves before a held cache write; three switches persist and paint',{timeout:3000},async()=>{
  const r=await app();await cachedHistory(r);for(let i=0;i<4;i++)await r.D.cache('query:test:'+i,clone(r.env.context.query_({mode:'all'})));
  const at=Date.now()-20000;for(const [i,key]of ['math','english','fitness','math','cs408'].entries())await r.D.enqueue(activity(key,at+i*1000));await r.run('repaint()');
  const cache=holdCacheWrites(r);await r.run('sync()');r.clock.advance(0);const tx=await cache.started;assert.deepEqual([...tx.objectStoreNames],['cache']);
  try{for(const [i,key]of ['math','english','fitness'].entries()){r.g.spec=activity(key,at+(i+5)*1000);await r.run('act(spec)');}
    assert.equal((await r.D.getCurrent()).event_key,'fitness');assert.equal(r.nodes.get('current-name').textContent,'健身');assert.equal(await r.D.getQueueCount(),3);
  }finally{cache.release();await cache.done();}
});

test('F: acknowledgement core locks only meta/ops; bounded keyed reads, no bulk reads',async()=>{
  const r=await app();await cachedHistory(r);await start408(r);const s=await r.D.getSyncState(),io=instrument(r.database);
  await r.D.acceptBatchCore(s.ops.map(i=>i.op_id),s.local);io.restore();
  assert.deepEqual(io.transactions,[{stores:['meta','ops'],mode:'readwrite'}]);
  assert.ok(io.requests.every(q=>['meta','ops'].includes(q.store)&&!q.method.startsWith('getAll')));
  assert.equal(io.requests.filter(q=>q.store==='ops'&&q.method==='get').length,2);
  assert.equal(io.requests.filter(q=>q.store==='ops'&&q.method==='count').length,1);
});

test('G: 1000 caches and 100 record pages cannot increase acknowledgement/switch I/O',{timeout:5000},async()=>{
  const counts=[];for(const size of [0,1000]){const r=await app();
    await new Promise((resolve,reject)=>{const tx=r.database.transaction('cache','readwrite'),s=tx.objectStore('cache');for(let i=0;i<size;i++)s.put({payload:'x'.repeat(100)},'other:'+i);for(let i=0;i<(size?100:0);i++)s.put({pages:{[i*100]:{ids:[],next:null}}},'records:page:'+i);for(let i=0;i<(size?10:0);i++)s.put(clone(r.env.context.query_({mode:'all'})),'query:'+i);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
    const at=await start408(r),s=await r.D.getSyncState(),io=instrument(r.database);r.g.spec=activity('math',at);
    await Promise.all([r.D.acceptBatchCore(s.ops.map(i=>i.op_id),s.local),r.run('act(spec)')]);io.restore();
    counts.push({transactions:io.transactions.length,reads:io.requests.filter(q=>['get','count','openKeyCursor'].includes(q.method)).length});
    assert.ok(io.requests.every(q=>q.store!=='cache'&&!q.method.startsWith('getAll')));assert.equal((await r.D.getCurrent()).event_key,'math');
  }assert.deepEqual(counts,[{transactions:2,reads:12},{transactions:2,reads:12}]);
});

test('H: aborted cache reconciliation cannot undo acknowledgement; fresh query repairs summaries',{timeout:3000},async()=>{
  const r=await app(),e=event();await r.D.enqueue({type:'import',events:[e]});await r.run('sync()');const key='query:all:all';await r.D.cache(key,clone(r.env.context.query_({mode:'all'})));
  await r.D.enqueue({type:'edit',year:'2026',event_id:e.event_id,patch:{note:'confirmed'}});const s=await r.D.getSyncState(),reply=clone(r.env.context.commitBatch_(s.ops.map(i=>i.op)));
  await r.D.enqueue(activity('math',Date.now()-1000));const accepted=await r.D.acceptBatch(reply.confirmed,reply.state);
  const original=r.database.transaction.bind(r.database);r.database.transaction=(stores,mode,...args)=>{const tx=original(stores,mode,...args);if(stores==='cache'&&mode==='readwrite'){const store=tx.objectStore('cache'),cursor=store.openCursor.bind(store);store.openCursor=(...a)=>{const req=cursor(...a);req.addEventListener('success',()=>tx.abort(),{once:true});return req;};}return tx;};
  await assert.rejects(r.D.reconcileConfirmedCaches(accepted));r.database.transaction=original;
  const after=await r.D.getSyncState();assert.equal(after.ops.length,1);assert.equal(after.cloud.revision,2);assert.equal(after.local.current.event_key,'math');
  r.g.spec=activity('english',Date.now());await r.run('act(spec)');assert.equal(await r.D.getQueueCount(),2);
  await r.run('sync()');await r.run("view='history';historyMode='all';renderStats(true)");
  assert.equal((await r.D.get('cache',key)).state.revision,4);assert.equal(await r.D.getQueueCount(),0);
});

test('I: history deletes acknowledged while cache locked; every quick switch completes',{timeout:3000},async()=>{
  const r=await app(),rows=Array.from({length:5},(_,i)=>event(i));await r.D.enqueue({type:'import',events:rows});await r.run('sync()');await r.run('loadRecords()');
  const at=Date.now()-10000;await r.D.enqueue(activity('cs408',at));for(const e of rows.slice(0,3)){r.g.e=e;await r.run("act({type:'delete',year:'2026',event_id:e.event_id})");}
  const cache=holdCacheWrites(r);await r.run('sync()');r.clock.advance(0);await cache.started;
  try{for(const [i,key]of ['english','cs50p','fragmented','entertainment'].entries()){
      const def=C.DEFAULT_CONFIG.events.find(d=>d.id===key);assert.ok(def,'known activity '+key);r.g.spec=activity(key,at+(i+1)*1000);await r.run('act(spec)');assert.equal((await r.D.getCurrent()).event_key,key);assert.equal(r.nodes.get('current-name').textContent,def.name);
    }assert.equal(await r.D.getQueueCount(),4);
  }finally{cache.release();await cache.done();}
});


test('missed reconciliation/reload never labels stale totals current; later query repairs them',async()=>{
  const r=await app(),key='query:all:all',old=clone(r.env.context.query_({mode:'all'}));await r.D.cache(key,{...old,fetched_at:Date.now()});
  for(let i=0;i<2;i++)await r.D.enqueue({type:'import',events:[event(i)]});const s=await r.D.getSyncState(),reply=clone(r.env.context.commitBatch_(s.ops.map(i=>i.op)));
  const accepted=await r.D.acceptBatchCore(reply.confirmed,reply.state);await r.D.reconcileConfirmedCaches(accepted.slice(1));
  assert.equal((await r.D.get('cache',key)).state.revision,0,'missing prefix must not be skipped');
  await r.D.open();await r.run("repaint();view='history';historyMode='all';renderStats(false,true)");
  assert.match(r.nodes.get('stats-note').textContent,/仅本机已缓存/);assert.equal(await r.D.getQueueCount(),0);
  await r.run('renderStats(true)');assert.equal((await r.D.get('cache',key)).state.revision,2);
});

async function seedLargeHistory(r,n){
  const rows=Array.from({length:n},(_,i)=>event(i));
  await new Promise((resolve,reject)=>{const tx=r.database.transaction('events','readwrite'),store=tx.objectStore('events');for(const e of rows)store.put(e);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
  await r.D.cache('records:2026',{year:'2026',cloud_revision:0,fetched_at:Date.now(),complete:n<=100,pages:{0:{ids:rows.slice(0,100).map(e=>e.event_id),next:n>100?100:null}}});
  return rows;
}
function forbidBulkEvents(r){let calls=0;const original=r.database.transaction.bind(r.database);r.database.transaction=(...args)=>{const tx=original(...args),get=tx.objectStore.bind(tx);tx.objectStore=name=>{const store=get(name);if(name==='events')store.getAll=()=>{calls++;throw Error('mobile 5000ms events.getAll trap: hot path forbidden');};return store;};return tx;};return {calls:()=>calls,restore:()=>r.database.transaction=original};}
async function settle(){for(let i=0;i<20;i++)await new Promise(setImmediate);}

test('J: page read, optimistic delete, deferred stats and sync never bulk-read events',{timeout:3000},async()=>{
  const r=await app(),rows=await seedLargeHistory(r,100),guard=forbidBulkEvents(r),io=instrument(r.database);
  await r.D.cache('query:all:all',clone(r.env.context.query_({mode:'all'})));r.run("view='history';historyMode='all';");
  await r.run('loadRecords()');r.g.e=rows[0];await r.run("act({type:'delete',year:'2026',event_id:e.event_id})");
  assert.ok(r.nodes.get('records').children.every(n=>n.dataset.eventId!==rows[0].event_id));
  r.g.TimeTransport.call=async(_,p)=>{assert.equal(p.action,'sync_batch');return {ok:true,confirmed:p.ops.map(o=>o.op_id),state:await r.D.getLocalState()};};
  await r.run('sync()');r.clock.advance(500);await settle();
  assert.equal(guard.calls(),0);assert.ok(io.requests.every(q=>q.store!=='events'||q.method!=='getAll'));io.restore();guard.restore();
});

test('K: mobile 5-second bulk-read trap remains unused while background work and switches run',{timeout:3000},async()=>{
  const r=await app();await seedLargeHistory(r,100);const at=await start408(r),guard=forbidBulkEvents(r);
  await r.run('loadRecords()');r.g.navigator.onLine=false;
  for(const [i,key]of ['math','english','fitness'].entries()){r.g.spec=activity(key,at+i*1000);await r.run('act(spec)');r.clock.advance(350);await settle();}
  assert.equal(guard.calls(),0);assert.equal((await r.D.getCurrent()).event_key,'fitness');assert.equal(r.nodes.get('current-name').textContent,'健身');guard.restore();
});

test('L: 100 vs 10000 historical events: page gets <=100, delete/edit/switch counts identical',{timeout:5000},async t=>{
  const results=[];for(const n of [100,10000]){const r=await app(),rows=await seedLargeHistory(r,n),guard=forbidBulkEvents(r),io=instrument(r.database);
    await r.run('loadRecords()');const page=io.requests.filter(q=>q.store==='events'&&q.method==='get').length;assert.equal(page,100);
    const stable=r.nodes.get('records').children.find(n=>n.dataset.eventId===rows[2].event_id);
    const count=()=>({tx:io.transactions.length,reads:io.requests.filter(q=>['get','count','openKeyCursor','getAll','getAllKeys'].includes(q.method)).length});
    io.reset();r.g.e=rows[0];await r.run("act({type:'delete',year:'2026',event_id:e.event_id})");const del=count();assert.equal(r.nodes.get('records').children.find(n=>n.dataset.eventId===rows[2].event_id),stable);
    io.reset();r.g.e=rows[1];await r.run("act({type:'edit',year:'2026',event_id:e.event_id,patch:{note:'new'}})");const edit=count();assert.equal(r.nodes.get('records').children.find(n=>n.dataset.eventId===rows[2].event_id),stable);
    io.reset();r.g.spec=activity('math',Date.now());await r.run('act(spec)');const sw=count();
    results.push({page,del,edit,sw});assert.equal(guard.calls(),0);io.restore();guard.restore();
  }assert.deepEqual(results[0],results[1]);assert.deepEqual(results[0],{page:100,del:{tx:1,reads:6},edit:{tx:1,reads:6},sw:{tx:1,reads:6}});t.diagnostic(JSON.stringify(results));
});

test('M: cached stats with 10000 events use zero events transactions and include effects/current',{timeout:5000},async()=>{
  const r=await app();await seedLargeHistory(r,10000);const e=event(),summary=clone(r.env.context.query_({mode:'all'}));await r.D.cache('query:all:all',summary);
  await r.D.enqueue({type:'import',events:[e]});await r.D.enqueue(activity('fitness',Date.now()-10000));await r.run('repaint()');r.run("view='history';historyMode='all';");
  const io=instrument(r.database);await r.run('renderStats(false,true)');io.restore();
  assert.ok(io.transactions.every(t=>!t.stores.includes('events')));assert.ok(io.requests.every(q=>q.store!=='events'));
  assert.equal(r.nodes.get('study-total').textContent,C.duration(30));assert.equal(r.nodes.get('all-total').textContent,C.duration(40));
});

test('ten deletes patch existing DOM immediately and coalesce to one bounded reconciliation',async()=>{
  const r=await app(),rows=await seedLargeHistory(r,100);await r.run('loadRecords()');r.g.navigator.onLine=false;const survivor=r.nodes.get('records').children.find(n=>n.dataset.eventId===rows[99].event_id);
  r.run('var reconciles=0;const paintBefore=paintRecords;paintRecords=(...args)=>{reconciles++;return paintBefore(...args);};');
  for(const e of rows.slice(0,10)){r.g.e=e;await r.run("act({type:'delete',year:'2026',event_id:e.event_id})");assert.ok(r.nodes.get('records').children.every(n=>n.dataset.eventId!==e.event_id));}
  assert.equal(r.run('reconciles'),0);assert.equal(r.nodes.get('records').children.find(n=>n.dataset.eventId===rows[99].event_id),survivor);
  r.clock.advance(500);await settle();assert.equal(r.run('reconciles'),1);assert.equal(r.nodes.get('records').children.length,90);
});

test('split patches only affected cards and survives debounce after acknowledgement',async()=>{
  const r=await app(),rows=await seedLargeHistory(r,2);await r.run('loadRecords()');const survivor=r.nodes.get('records').children.find(n=>n.dataset.eventId===rows[1].event_id),id=crypto.randomUUID();r.g.spec={type:'split',year:'2026',event_id:rows[0].event_id,new_event_id:id,event_key:'english',at:new Date(Date.parse(rows[0].start_at)+15000).toISOString()};
  await r.run('act(spec)');assert.ok(r.nodes.get('records').children.some(n=>n.dataset.eventId===id));assert.equal(r.nodes.get('records').children.find(n=>n.dataset.eventId===rows[1].event_id),survivor);
  const s=await r.D.getSyncState();await r.D.acceptBatchCore(s.ops.map(o=>o.op_id),s.local);await r.run('paintRecords()');assert.ok(r.nodes.get('records').children.some(n=>n.dataset.eventId===id));
});

test('debug=1 logs tap, first IDB request, completion, current paint and explicit bulk export',async()=>{
  for(const enabled of [false,true]){const r=runtime(true,enabled),logs=[];r.g.console={...console,debug:(tag,value)=>logs.push(value)};await r.g.TimeDB.open();await r.run('repaint()');r.g.spec=activity('math',Date.now());await r.run('act(spec)');await r.g.TimeDB.snapshot();
    if(!enabled){assert.equal(logs.length,0);continue;}
    for(const stage of ['tap','enqueue called','transaction created','first request success','transaction complete','paintCurrent finished','events.getAll'])assert.ok(logs.some(l=>l.stage===stage),stage);
    assert.ok(logs.filter(l=>l.stage==='transaction complete').every(l=>l.durationMs>=0&&l.scope.length));
    assert.ok(logs.findIndex(l=>l.stage==='enqueue called')<logs.findIndex(l=>l.stage==='paintCurrent finished'));
  }
});

test('cold recovery reads at most 25 per transaction; page API rejects 101 IDs',async()=>{
  const r=await app();await seedLargeHistory(r,100);const io=instrument(r.database);const chunk=await r.D.getRecoveryChunk();io.restore();assert.equal(chunk.events.length,25);assert.equal(chunk.done,false);assert.ok(io.requests.every(q=>q.method!=='getAll'));
  await assert.rejects(r.D.getEventsByIds(Array.from({length:101},(_,i)=>String(i))),/100/);
});

test('fresh old-year page cannot delete a confirmed cross-year cached event',async()=>{
  const r=await app(),e=event();await r.D.enqueue({type:'import',events:[e]});await r.run('sync()');await r.D.rememberPage('2026',{events:[e],offset:0,next:null,cloud_revision:1});
  await r.D.enqueue({type:'edit',year:'2026',event_id:e.event_id,patch:{start_at:'2027-01-02T00:00:00Z',end_at:'2027-01-02T00:00:30Z'}});await r.run('sync()');await r.D.rememberPage('2026',{events:[],offset:0,next:null,cloud_revision:2});
  assert.equal(C.eventYear((await r.D.getEventsByIds([e.event_id]))[0]),'2027');
});

test('cloud BUSY cooldown survives repeated taps and keeps durable queue',async()=>{
  const r=await app(),at=await start408(r);let calls=0;r.g.TimeTransport.call=async()=>{calls++;return {ok:false,code:'BUSY',retry_after_ms:15000};};await r.run('sync()');assert.equal(calls,1);assert.equal(await r.D.getQueueCount(),2);assert.match(r.nodes.get('toast').textContent,/云端暂忙/);
  r.g.spec=activity('english',at);await r.run('act(spec)');await r.run('sync()');await r.run('sync()');assert.equal(calls,1);assert.equal(await r.D.getQueueCount(),3);assert.equal(r.nodes.get('current-name').textContent,'英语');
  assert.ok(r.run('cloudRetryAt-Date.now()')>=14000);
});

test('sync and stats requests share one network flight; expired transport pauses retry',async()=>{
  const r=await app(),gate=deferred(),started=deferred();let active=0,max=0,calls=0;r.g.TimeTransport.call=async()=>{active++;max=Math.max(max,active);calls++;if(calls===1){started.resolve();await gate.promise;}active--;return {ok:true};};
  const first=r.run("send({action:'state'})");await started.promise;const second=r.run("send({action:'query',mode:'all'})");await settle();assert.equal(calls,1);gate.resolve();await Promise.all([first,second]);assert.equal(max,1);assert.equal(calls,2);
  r.g.TimeTransport.call=async()=>{throw Error('网络请求超时；待同步记录已保留');};await assert.rejects(r.run("send({action:'state'})"));assert.ok(r.run('cloudRetryAt-Date.now()')>=59000);
});

test('YIELD confirms only committed prefix and retains rest for later sync',async()=>{
  const r=await app();for(let i=0;i<3;i++)await r.D.enqueue({type:'import',events:[event(i)]});r.g.TimeTransport.call=async(_,p)=>clone(r.env.context.commitBatch_(p.ops,1));await r.run('sync()');assert.equal(await r.D.getQueueCount(),2);assert.equal((await r.D.getSyncState()).cloud.revision,1);assert.equal((await r.D.getLocalState()).revision,3);
  r.run('cloudRetryAt=0');r.g.TimeTransport.call=async(_,p)=>clone(r.env.context.commitBatch_(p.ops));await r.run('sync()');assert.equal(await r.D.getQueueCount(),0);assert.equal(r.env.context.state_().revision,3);
});
