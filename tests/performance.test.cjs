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
test('doPost authenticates once, locks once, caches each workbook per execution',()=>{const env=environment(),g=env.context;let verified=0;g.verifyIdToken_=()=>{verified++;};const ops=batch(10);env.metrics.opens.length=0;const before=env.metrics.locks;
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
