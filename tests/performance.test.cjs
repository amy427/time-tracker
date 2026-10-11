const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const C=require('../frontend/core.js'),{environment}=require('./fake-gas.cjs');
const clone=v=>JSON.parse(JSON.stringify(v));
const event=(i=0,year='2026')=>{const start=new Date(Date.parse(year+'-01-02T00:00:00Z')+i*60000).toISOString(),end=new Date(Date.parse(start)+30000).toISOString();return C.validateEvent({event_id:crypto.randomUUID(),start_at:start,end_at:end,event_name:'数学',category:'学习',note:'',timezone:'UTC',source:'mobile_pwa',created_at:start,updated_at:end,schema_version:1,event_key:'math',revision:0,deleted:false});};
const op=(revision,type,extras={})=>({op_id:crypto.randomUUID(),device_id:crypto.randomUUID(),queued_at:new Date().toISOString(),base_revision:revision,type,...extras});
const batch=(n,revision=0)=>Array.from({length:n},(_,i)=>op(revision+i,'import',{events:[event(i)]}));
function allRecords(g,year){let offset=0,events=[];do{const r=g.records_({year,offset});events.push(...r.events);offset=r.next;}while(offset!==null);return events;}
for(const n of [1,3,10])test(`${n} pending ops: one batch, ordered commits and UUID retransmission`,()=>{const {context:g}=environment(),ops=batch(n),r=g.commitBatch_(ops);assert.equal(r.ok,true);assert.deepEqual(clone(r.confirmed),ops.map(o=>o.op_id));assert.equal(r.state.revision,n);assert.equal(allRecords(g,'2026').length,n);const retry=g.commitBatch_(ops);assert.equal(retry.state.revision,n);assert.equal(allRecords(g,'2026').length,n);});
test('middle revision conflict returns only confirmed prefix and failure position',()=>{const {context:g}=environment(),ops=batch(10);ops[4].base_revision=0;const r=g.commitBatch_(ops);assert.equal(r.code,'CONFLICT');assert.equal(r.failed_index,4);assert.equal(r.confirmed.length,4);assert.equal(r.state.revision,4);assert.equal(allRecords(g,'2026').length,4);});
test('middle validation error does not execute later ops; retry after a lost reply deduplicates',()=>{const {context:g}=environment(),ops=batch(3);ops[1].type='invalid';let r=g.commitBatch_(ops);assert.equal(r.failed_index,1);assert.equal(r.confirmed.length,1);ops[1].type='import';r=g.commitBatch_(ops);assert.equal(r.ok,true);assert.equal(r.state.revision,3);assert.equal(allRecords(g,'2026').length,3);assert.throws(()=>g.commitBatch_(batch(11)));});
test('doPost authenticates once, locks once, caches each workbook per execution',()=>{const env=environment(),g=env.context;let verified=0;g.verifyIdToken_=()=>{verified++;return "owner-sub";};const ops=batch(10);env.metrics.opens.length=0;const before=env.metrics.locks;
  const response=g.doPost({parameter:{payload:JSON.stringify({action:'sync_batch',ops,nonce:crypto.randomUUID(),origin:'https://owner.github.io',token:'test-only'})}});
  assert.match(response.html,/"ok":true/);assert.equal(verified,1);assert.equal(env.metrics.locks-before,1);assert.equal(new Set(env.metrics.opens).size,env.metrics.opens.length);
  const opens=env.metrics.opens.length;g.doPost({parameter:{payload:JSON.stringify({action:'state',nonce:crypto.randomUUID(),origin:'https://owner.github.io',token:'test-only'})}});assert.ok(env.metrics.opens.length>opens,'new execution must reopen workbook objects');
});
for(const n of [0,2,100,101,5000])test(`records ${n}: lazy index, bounded pages, revision unchanged reads no events`,()=>{const env=environment(),g=env.context,b=g.yearBook_('2026'),raw=b.getSheetByName('events'),truth=Array.from({length:n},(_,i)=>event(i));
  if(n)raw.getRange(2,1,n,C.HEADERS.length).setValues(truth.map(e=>C.HEADERS.map(h=>e[h])));
  let r=g.records_({year:'2026'});assert.equal(r.events.length,Math.min(100,n));assert.equal(r.next,n>100?100:null);
  env.metrics.reads.length=0;const read=allRecords(g,'2026');assert.deepEqual(read.map(e=>e.event_id),truth.slice().reverse().map(e=>e.event_id));
  assert.equal(env.metrics.reads.filter(r=>r.sheet==='events').length,0);assert.ok(env.metrics.reads.filter(r=>r.sheet==='records_index').every(r=>r.rows<=100));
  env.metrics.reads.length=0;r=g.records_({year:'2026',check_only:true,cloud_revision:0});assert.equal(r.not_modified,true);assert.equal(env.metrics.reads.filter(r=>r.sheet==='records_index'||r.sheet==='events').length,0);
  g.rebuildRecordsIndex('2026');assert.deepEqual(allRecords(g,'2026').map(e=>e.event_id),read.map(e=>e.event_id));
});
test('index agrees with raw truth after edit, delete, split, cross-year move and ten edits',()=>{const {context:g}=environment(),events=[event(0),event(1)];g.commit_(op(0,'import',{events}));
  g.commit_(op(1,'split',{year:'2026',event_id:events[0].event_id,at:new Date(Date.parse(events[0].start_at)+15000).toISOString(),new_event_id:crypto.randomUUID(),event_key:'english'}));
  g.commit_(op(2,'edit',{year:'2026',event_id:events[1].event_id,patch:{start_at:'2027-01-02T00:00:00Z',end_at:'2027-01-02T00:01:00Z'}}));
  const edits=Array.from({length:10},(_,i)=>op(3+i,'edit',{year:'2027',event_id:events[1].event_id,patch:{note:'edit '+i}}));assert.equal(g.commitBatch_(edits).ok,true);
  g.commit_(op(13,'delete',{year:'2026',event_id:events[0].event_id}));
  for(const year of ['2026','2027']){const truth=g.rows_(g.existingYear_(year).getSheetByName('events'),C.HEADERS.length).map(g.eventFromRow_).filter(e=>!e.deleted).sort((a,b)=>C.time(b.start_at)-C.time(a.start_at)||a.event_id.localeCompare(b.event_id));assert.deepEqual(clone(allRecords(g,year)),clone(truth));g.rebuildRecordsIndex(year);assert.deepEqual(clone(allRecords(g,year)),clone(truth));}
  assert.equal(g.records_({year:'2027'}).events[0].note,'edit 9');
});
test('changed revision invalidates a pagination cursor, including empty archive',()=>{const {context:g}=environment();g.commitBatch_(batch(3));let r=g.records_({year:'2026',offset:100,cloud_revision:0});assert.equal(r.reset,true);assert.equal(r.offset,0);assert.equal(r.events.length,3);r=g.records_({year:'1901'});assert.equal(r.next,null);assert.equal(r.events.length,0);});
test('index repair can recover at every persisted write boundary without changing raw truth',()=>{const setup=()=>{const env=environment();env.context.commit_(op(0,'import',{events:[event()]}));return env;};const sample=setup();sample.setFailure(Infinity);sample.context.rebuildRecordsIndex('2026');const count=sample.writes;
  for(let fault=1;fault<=count;fault++){const env=setup(),g=env.context,b=g.existingYear_('2026'),raw=clone(b.getSheetByName('events').data);env.setFailure(fault);try{g.rebuildRecordsIndex('2026');}catch(e){assert.match(e.message,/SIMULATED/);}env.clearFailure();g.resetExecution_();g.recover_();g.records_({year:'2026'});assert.deepEqual(clone(b.getSheetByName('events').data),raw);assert.equal(g.records_({year:'2026'}).events.length,1);assert.equal(g.pending_(),null);}
});
test('batch interruptions at every persisted boundary recover and deduplicate the unconfirmed suffix',t=>{const ops=batch(3),sample=environment();sample.setFailure(Infinity);sample.context.commitBatch_(ops);const count=sample.writes;
  for(let fault=1;fault<=count;fault++){const env=environment(),g=env.context;env.setFailure(fault);const r=g.commitBatch_(ops);assert.deepEqual(clone(r.confirmed),ops.slice(0,r.confirmed.length).map(o=>o.op_id));env.clearFailure();g.resetExecution_();if(r.confirmed.length<3)assert.equal(g.commitBatch_(ops.slice(r.confirmed.length)).ok,true);assert.equal(g.state_().revision,3);assert.equal(allRecords(g,'2026').length,3);assert.equal(g.query_({mode:'all'}).total.total_seconds,90);assert.equal(g.pending_(),null);}t.diagnostic('Batch recovery checked at '+count+' persisted boundaries.');
});

test('busy lock returns retryable BUSY without recovery or writes; auth runs before acquisition',()=>{
  const {context:g}=environment();let verified=0,attempts=0;g.verifyIdToken_=()=>{verified++;return 'owner-sub';};g.recover_=()=>{throw Error('must not recover without lock');};
  g.LockService.getScriptLock=()=>({tryLock(ms){assert.equal(verified,1);assert.equal(ms,1000);attempts++;return false;},releaseLock(){throw Error('unowned lock');}});
  const r=g.doPost({parameter:{payload:JSON.stringify({action:'state',token:'test',origin:'https://owner.github.io',nonce:crypto.randomUUID()})}});
  assert.match(r.html,/"code":"BUSY"/);assert.match(r.html,/"retry_after_ms":15000/);assert.equal(attempts,1);
});

test('first-login owner is checked again inside lock and auth failure acquires no lock',()=>{
  const {context:g,properties}=environment();let attempts=0;g.verifyIdToken_=()=>{throw Error('AUTH_REQUIRED');};g.LockService.getScriptLock=()=>({tryLock(){attempts++;properties.set('OWNER_SUB','other');return true;},releaseLock(){}});
  const payload={action:'state',token:'test',origin:'https://owner.github.io',nonce:crypto.randomUUID()};assert.match(g.doPost({parameter:{payload:JSON.stringify(payload)}}).html,/AUTH_REQUIRED/);assert.equal(attempts,0);
  g.verifyIdToken_=()=> 'owner';assert.match(g.doPost({parameter:{payload:JSON.stringify(payload)}}).html,/无权访问/);assert.equal(properties.get('OWNER_SUB'),'other');
});

test('batch time budget yields only between commits and remainder can resume without duplicates',()=>{
  const {context:g}=environment(),ops=batch(3),r=g.commitBatch_(ops,1);assert.equal(r.code,'YIELD');assert.equal(r.failed_index,1);assert.deepEqual(clone(r.confirmed),[ops[0].op_id]);assert.equal(r.state.revision,1);
  const rest=g.commitBatch_(ops);assert.equal(rest.ok,true);assert.equal(rest.state.revision,3);assert.equal(allRecords(g,'2026').length,3);assert.equal(g.pending_(),null);
});

test('maintenance uploads immutable backup files without holding ScriptLock',()=>{
  const {context:g}=environment();let held=false;g.LockService.getScriptLock=()=>({tryLock(){assert.equal(held,false);held=true;return true;},releaseLock(){assert.equal(held,true);held=false;}});
  const capture=g.captureBackup_,write=g.writeBackup_,publish=g.publishBackup_;let phases=[];
  g.captureBackup_=p=>{assert.equal(held,true);phases.push('capture');return capture(p);};g.writeBackup_=s=>{assert.equal(held,false);phases.push('upload');return write(s);};g.publishBackup_=(s,w)=>{assert.equal(held,true);phases.push('publish');return publish(s,w);};
  g.maintenance();assert.deepEqual(phases,['capture','upload','publish']);assert.equal(held,false);
});

test('backup captured before a concurrent commit cannot clear dirty flag or replace config',()=>{
  const {context:g}=environment();g.commitBatch_(batch(1));const snapshot=g.captureBackup_('2026'),written=g.writeBackup_(snapshot);g.commitBatch_(batch(1,1));assert.equal(g.publishBackup_(snapshot,written),false);
  const row=g.rows_(g.master_().getSheetByName('backup_index'),5).find(r=>r[0]==='2026');assert.equal(row[4],true);assert.equal(row[1],'');assert.equal(g.state_().revision,2);
});

test('duplicate receipt cache hit opens no OperationIndex book; altered payload is still rejected',()=>{
  const env=environment(),g=env.context,request=batch(1)[0];g.commit_(request);const bucket=env.properties.get('OP_BUCKET_'+request.op_id.slice(0,2));g.resetExecution_();env.metrics.opens.length=0;
  assert.equal(g.commit_(request).duplicate,true);assert.equal(env.metrics.opens.filter(id=>id===bucket).length,0);
  assert.throws(()=>g.commit_({...request,events:[{...request.events[0],note:'changed'}]}),/UUID/);
  assert.equal(g.state_().revision,1);assert.equal(g.query_({mode:'all'}).total.total_seconds,30);
});

test('eviction, malformed cache and CacheService outages all fall back to durable receipts',()=>{
  for(const mode of ['evicted','malformed','outage']){const env=environment(),g=env.context,request=batch(1)[0];g.commit_(request);const key=g.receiptCacheKey_(request.op_id),bucket=env.properties.get('OP_BUCKET_'+request.op_id.slice(0,2));
    if(mode==='evicted')env.cache.delete(key);if(mode==='malformed')env.cache.set(key,'not JSON');if(mode==='outage')g.CacheService.getScriptCache=()=>{throw Error('cache offline');};
    g.resetExecution_();env.metrics.opens.length=0;assert.equal(g.commit_(request).duplicate,true);assert.ok(env.metrics.opens.includes(bucket));assert.equal(g.state_().revision,1);assert.equal(allRecords(g,'2026').length,1);
  }
});

test('no receipt cache before successful flush; recovery fills it only after durable receipt',()=>{
  const env=environment(),g=env.context,request=batch(1)[0],timed=g.perfTimed_;let crash=true,flushed=false;
  g.perfTimed_=(p,key,fn)=>{if(key==='flush_receipt_ms'&&crash)throw Error('crash before receipt flush');const result=timed(p,key,fn);if(key==='flush_receipt_ms')flushed=true;return result;};
  const cache=g.cacheReceipt_;g.cacheReceipt_=r=>{assert.equal(flushed,true);cache(r);};assert.throws(()=>g.commit_(request),/receipt flush/);assert.equal(env.cache.has(g.receiptCacheKey_(request.op_id)),false);
  crash=false;g.resetExecution_();assert.equal(g.commit_(request).duplicate,true);assert.equal(env.cache.has(g.receiptCacheKey_(request.op_id)),true);assert.equal(g.state_().revision,1);assert.equal(allRecords(g,'2026').length,1);
});

test('soft budget yields after five duplicates plus one 11s commit, before a second 21s commit',()=>{
  const env=environment(),g=env.context,ops=batch(10);g.commitBatch_(ops.slice(0,5));let now=Date.now(),real=0;g.Date=class extends Date{static now(){return now;}};const commit=g.commit_;
  g.commit_=o=>{const result=commit(o);now+=result.duplicate?20:(++real===1?11000:21000);return result;};const start=now,r=g.commitBatch_(ops,start+10000);
  assert.equal(r.code,'YIELD');assert.equal(r.confirmed.length,6);assert.equal(r.failed_index,6);assert.equal(now-start,11100);assert.equal(real,1);
  let remaining=ops.slice(6);while(remaining.length){const reply=g.commitBatch_(remaining);remaining=remaining.slice(reply.confirmed.length);}
  assert.equal(g.state_().revision,10);assert.equal(allRecords(g,'2026').length,10);assert.equal(g.query_({mode:'all'}).total.total_seconds,300);
});

test('lost replies and repeated full replay keep events/summaries/receipts unique with warm and evicted cache',()=>{
  const env=environment(),g=env.context,ops=batch(3);for(let attempt=0;attempt<4;attempt++){if(attempt%2)env.cache.clear();g.resetExecution_();const r=g.commitBatch_(ops);assert.equal(r.ok,true);assert.equal(r.state.revision,3);}
  assert.equal(allRecords(g,'2026').length,3);assert.equal(g.query_({mode:'all'}).total.total_seconds,90);assert.equal(g.rows_(g.logSheet_(ops[0].queued_at),5).length,3);
  for(const o of ops)assert.equal(g.rows_(g.operationIndex_(o.op_id),5).filter(r=>r[0]===o.op_id).length,1);
});

test('known rows eliminate repeated event/record/backup searches and new receipt searches',()=>{
  const env=environment(),g=env.context,e=event(),first=op(0,'import',{events:[e]});g.commit_(first);env.metrics.finds.length=0;
  const edit=op(1,'edit',{year:'2026',event_id:e.event_id,patch:{note:'updated'}});g.commit_(edit);
  const calls=env.metrics.finds;assert.equal(calls.filter(q=>q.sheet==='events'&&q.key===e.event_id).length,1);
  assert.equal(calls.filter(q=>q.sheet==='records_index'&&q.key===e.event_id).length,1);
  for(const period of ['2026','2026-01'])assert.equal(calls.filter(q=>q.sheet==='backup_index'&&q.key===period).length,1);
  assert.equal(calls.filter(q=>q.sheet.startsWith('operations_')&&q.key===edit.op_id).length,0);
  assert.ok(calls.filter(q=>q.sheet==='operations'&&q.key===edit.op_id).length<=1);
});
