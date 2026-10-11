/* IndexedDB is the source of truth for local activity and unsent operations. */
(function(root){
  'use strict'; let db;
  const request=p=>new Promise((resolve,reject)=>{p.onsuccess=()=>resolve(p.result);p.onerror=()=>reject(p.error);});
  async function open(name='time-tracker-v1'){
    if(db)db.close();
    const r=indexedDB.open(name,1);
    r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore('meta');const ops=d.createObjectStore('ops',{keyPath:'op_id'});ops.createIndex('seq','seq',{unique:true});d.createObjectStore('events',{keyPath:'event_id'});d.createObjectStore('cache');d.createObjectStore('conflicts',{keyPath:'id'});};
    db=await request(r);db.onversionchange=()=>db.close();
    await new Promise((resolve,reject)=>{const tx=db.transaction('meta','readwrite'),m=tx.objectStore('meta');for(const [key,make]of [['local',initial],['device',()=>crypto.randomUUID()]]){const r=m.get(key);r.onsuccess=()=>{if(!r.result)m.put(make(),key);};}tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});return db;
  }
  async function get(store,key){return request(db.transaction(store).objectStore(store).get(key));}
  async function all(store){return request(db.transaction(store).objectStore(store).getAll());}
  function initial(){return {revision:0,current:null,config:TimeCore.clone(TimeCore.DEFAULT_CONFIG),last_operation_id:null};}
  // Read -> derive -> write within one transaction. No awaited network or timer inside.
  function mutate(fn,{events=true,caches=true,conflicts=false}={}){return new Promise((resolve,reject)=>{
    const stores=['meta','ops',...(events?['events']:[]),...(caches?['cache']:[]),...(conflicts?['conflicts']:[])];
    const tx=db.transaction(stores,'readwrite'),m=tx.objectStore('meta'),o=tx.objectStore('ops'),e=events?tx.objectStore('events'):null,c=conflicts?tx.objectStore('conflicts'):null,cacheStore=caches?tx.objectStore('cache'):null;
    const reads=[m.get('local'),m.get('cloud'),o.getAll(),events?e.getAll():null,m.get('device'),m.get('conflict'),caches?cacheStore.getAllKeys():null,caches?cacheStore.getAll():null];let n=0,result;
    const values=[];reads.forEach((r,i)=>{const done=()=>{values[i]=r?r.result:[];if(++n===reads.length){try{result=fn({local:values[0]||initial(),cloud:values[1]||null,ops:values[2]||[],events:values[3]||[],device:values[4]||crypto.randomUUID(),conflict:values[5]||null,caches:new Map(values[6].map((k,j)=>[k,values[7][j]])),cacheStore,m,o,e,c});}catch(err){reject(err);tx.abort();}}};if(r)r.onsuccess=done;else done();});
    tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('本地保存中断'));
  });}
  // UI and sync reads never read the event/cache stores. Full snapshots are readonly.
  function readState(kind){return new Promise((resolve,reject)=>{
    const tx=db.transaction(kind==='snapshot'?['meta','ops','events']:['meta','ops'],'readonly'),m=tx.objectStore('meta'),o=tx.objectStore('ops');
    const reads=[m.get('local'),m.get('cloud'),m.get('device'),m.get('conflict'),kind==='overview'?o.count():o.index('seq').getAll()];if(kind==='snapshot')reads.push(tx.objectStore('events').getAll());
    const values=[];reads.forEach((r,i)=>r.onsuccess=()=>{values[i]=r.result;});
    tx.oncomplete=()=>resolve({local:values[0]||initial(),cloud:values[1]||null,device:values[2],conflict:values[3]||null,...(kind==='overview'?{queueCount:values[4]}:{ops:values[4],events:values[5]||[]})});tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('本地读取中断'));
  });}
  const snapshot=()=>readState('snapshot'),getOverview=()=>readState('overview'),getSyncState=()=>readState('sync');
  const getLocalState=async()=>await get('meta','local')||initial();
  const getCurrent=async()=>(await getLocalState()).current;
  const getQueueCount=()=>request(db.transaction('ops','readonly').objectStore('ops').count());
  // One bounded transaction: keyed preimages only, last seq key, and a queue count.
  // No timer/network await, no getAll, and no cache-store access on any enqueue.
  function enqueue(spec){return new Promise((resolve,reject)=>{
    const tx=db.transaction(['meta','ops','events'],'readwrite'),m=tx.objectStore('meta'),o=tx.objectStore('ops'),e=tx.objectStore('events');
    const ids=[...new Set([spec.event_id,spec.new_event_id,...(spec.events||[]).map(e=>e.event_id)].filter(Boolean))];
    const reads=[m.get('local'),m.get('device'),m.get('conflict'),o.index('seq').openKeyCursor(null,'prev'),o.count(),...ids.map(id=>e.get(id))];let n=0,result;
    const values=[];reads.forEach((r,i)=>r.onsuccess=()=>{values[i]=r.result;if(++n!==reads.length)return;
      try{
        const s={local:values[0]||initial(),device:values[1]||crypto.randomUUID(),conflict:values[2],events:values.slice(5).filter(Boolean),m,o,e};
        if(s.conflict)throw new Error('请先处理设备冲突，原离线记录已保留');
        const noOp=spec.type==='switch'&&s.local.current?.event_key===spec.event_key||spec.type==='stop'&&!s.local.current;
        const state=noOp?s.local:saveEnqueued(spec,s,(values[3]?.key||0)+1);
        // Non-enumerable receipt is UI-only: never written into meta/local or sent to Google.
        result=Object.defineProperty(state,'queueCount',{value:values[4]+(noOp?0:1)});
      }catch(err){reject(err);tx.abort();}
    });tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('本地保存中断'));
  });}
  function saveEnqueued(spec,s,seq){
    if(s.conflict)throw new Error('请先处理设备冲突，原离线记录已保留');
    const op={...spec,op_id:crypto.randomUUID(),device_id:s.device,queued_at:new Date().toISOString(),base_revision:s.local.revision};
    const byId=new Map(s.events.map(e=>[e.event_id,e]));
    const repo={getEvent:(year,id)=>byId.get(id)||null,getDay:()=>null,getAnnual:()=>null};
    // Local plan only validates events; daily summary subtraction needs known preimages.
    const touched=new Set([spec.event_id,...(spec.events||[]).map(e=>e.event_id)]);
    const dayMap={},annualMap={};for(const ev of s.events.filter(e=>touched.has(e.event_id)))for(const p of TimeCore.splitDays(ev)){if(!dayMap[p.date])dayMap[p.date]=TimeCore.emptySummary(p.date);TimeCore.addSegment(dayMap[p.date],p);}
    for(const d of Object.values(dayMap)){const y=d.date.slice(0,4);if(!annualMap[y])annualMap[y]=TimeCore.emptySummary(y);TimeCore.addSummary(annualMap[y],d);}
    repo.getDay=d=>dayMap[d]||null;repo.getAnnual=y=>annualMap[y]||null;
    const plan=TimeCore.planOperation(op,s.local,repo,Date.now());
    const effects=plan.writes.map(w=>{const before=byId.get(w.event.event_id)||null;byId.set(w.event.event_id,w.event);return {before,after:w.event};});
    for(const w of plan.writes)s.e.put(w.event);
    s.o.put({op_id:op.op_id,seq,op,effects});s.m.put(plan.state,'local');s.m.put(s.device,'device');return plan.state;
  }
  // Reliable acknowledgement is bounded by the batch size, never by cache/queue size.
  function acceptBatchCore(ids,state){return new Promise((resolve,reject)=>{
    const unique=[...new Set(ids)];if(unique.length>10){reject(new Error('确认批次超过 10 个操作'));return;}
    const tx=db.transaction(['meta','ops'],'readwrite'),m=tx.objectStore('meta'),o=tx.objectStore('ops');
    const reads=[m.get('local'),m.get('cloud'),m.get('conflict'),o.count(),...unique.map(id=>o.get(id))];
    const values=[];let remaining=reads.length,accepted=[];
    for(const [i,r]of reads.entries())r.onsuccess=()=>{values[i]=r.result;if(--remaining)return;
      accepted=values.slice(4).filter(Boolean).sort((a,b)=>a.seq-b.seq);
      for(const item of accepted)o.delete(item.op_id);
      const [local,cloud,conflict,count]=values;
      if(!cloud||state.revision>=cloud.revision)m.put(state,'cloud');
      if(!conflict&&count===accepted.length&&state.revision>=(local?.revision||0))m.put(state,'local');
    };
    tx.oncomplete=()=>resolve(accepted.map(({op,effects})=>({revision:op.base_revision,effects})));
    tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('确认保存中断'));
  });}
  // Derived summaries have no transaction overlap with enqueue. Cursor callbacks yield
  // between entries and never materialize records pages or the complete cache store.
  function reconcileConfirmedCaches(accepted){return new Promise((resolve,reject)=>{
    const tx=db.transaction('cache','readwrite'),store=tx.objectStore('cache');
    const read=store.openCursor(IDBKeyRange.bound('query:','query:\uffff'));
    read.onsuccess=()=>{const cursor=read.result;if(!cursor)return;const r=cursor.value;
      if(r.state&&r.range){for(const item of accepted){
        if(item.revision<r.state.revision)continue;
        // A missed earlier reconciliation cannot safely be patched with later effects.
        if(item.revision>r.state.revision){r.fetched_at=0;break;}
        for(const change of item.effects)for(const [ev,sign]of [[change.before,-1],[change.after,1]])if(ev)for(const p of TimeCore.splitDays(ev))if(p.date>=r.range.from&&p.date<r.range.to){TimeCore.addSegment(r.total,p,sign);let d=r.days.find(d=>d.date===p.date);if(!d){d=TimeCore.emptySummary(p.date);r.days.push(d);}TimeCore.addSegment(d,p,sign);}
        r.state.revision=item.revision+1;
      }cursor.update(r);}cursor.continue();
    };
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('统计缓存更新中断'));
  });}
  async function acceptBatch(ids,state){
    const accepted=await acceptBatchCore(ids,state);
    // Resolve acknowledgement before scheduling disposable cache work. Failure must
    // never resurrect acknowledged UUIDs. Stats rejects caches behind cloud revision.
    if(accepted.length)setTimeout(()=>{Promise.resolve().then(()=>root.TimeDB.reconcileConfirmedCaches(accepted)).catch(()=>{});},0);
    return accepted;
  }
  async function accept(opId,state){return acceptBatch([opId],state);}
  async function remote(state){return mutate(s=>{if(!s.cloud||state.revision>=s.cloud.revision)s.m.put(state,'cloud');if(!s.ops.length&&!s.conflict&&state.revision>=s.local.revision)s.m.put(state,'local');},{events:false,caches:false});}
  async function freeze(state){return mutate(s=>{s.m.put({state,at:new Date().toISOString()},'conflict');s.m.put(state,'cloud');},{events:false,caches:false});}
  async function useCloud(){return mutate(s=>{
    if(!s.conflict)throw new Error('没有待处理冲突');s.c.put({id:crypto.randomUUID(),saved_at:new Date().toISOString(),local:s.local,ops:s.ops,events:s.events});s.o.clear();s.e.clear();for(const key of s.caches.keys())if(key.startsWith('records:')||key.startsWith('query:'))s.cacheStore.delete(key);s.m.put(s.conflict.state,'local');s.m.put(s.conflict.state,'cloud');s.m.delete('conflict');return s.conflict.state;
  },{conflicts:true});}
  async function cache(key,value){return new Promise((resolve,reject)=>{const tx=db.transaction('cache','readwrite'),s=tx.objectStore('cache'),r=s.get(key);let saved=value;r.onsuccess=()=>{if(key.startsWith('query:')&&r.result?.state.revision>value.state.revision)saved=r.result;else s.put(value,key);};tx.oncomplete=()=>resolve(saved);tx.onerror=()=>reject(tx.error);});}
  async function remember(events){return mutate(s=>{const protectedIds=new Set(s.ops.flatMap(o=>o.effects.map(e=>e.after.event_id)));for(const e of events)if(!protectedIds.has(e.event_id))s.e.put(e);},{events:true,caches:false});}
  async function rememberPage(year,response){return mutate(s=>{
    const key='records:'+year,old=s.caches.get(key),same=old&&old.cloud_revision===response.cloud_revision;
    if(old&&old.cloud_revision>response.cloud_revision)return old;
    if(response.not_modified){if(old){old.fetched_at=Date.now();s.cacheStore.put(old,key);}return old;}
    const meta=same?old:{year,cloud_revision:response.cloud_revision,pages:{},complete:false};
    meta.pages[response.offset||0]={ids:response.events.map(e=>e.event_id),next:response.next};meta.fetched_at=Date.now();
    let cursor=0;while(meta.pages[cursor]){cursor=meta.pages[cursor].next;if(cursor===null)break;}meta.next_cursor=cursor;meta.complete=cursor===null;
    const protectedIds=new Set(s.ops.flatMap(o=>o.effects.map(e=>e.after.event_id)));
    // A later operation/query may have advanced cloud state while this request was in flight.
    if(s.cloud&&s.cloud.revision>response.cloud_revision)return old;
    for(const e of response.events)if(!protectedIds.has(e.event_id))s.e.put(e);
    if(meta.complete){const live=new Set(Object.values(meta.pages).flatMap(p=>p.ids));for(const e of s.events)if(TimeCore.eventYear(e)===year&&!live.has(e.event_id)&&!protectedIds.has(e.event_id))s.e.delete(e.event_id);}
    s.cacheStore.put(meta,key);return meta;
  });}
  async function restoreLocal(backup){
    TimeCore.assert(backup?.schema_version===1&&backup.kind==='local-recovery','不是本地恢复副本');TimeCore.validateConfig(backup.local.config);TimeCore.assert(Number.isSafeInteger(backup.local.revision)&&Array.isArray(backup.ops)&&Array.isArray(backup.events),'副本结构无效');
    if(backup.local.current)TimeCore.validateEvent({...backup.local.current,end_at:backup.local.current.start_at});
    const events=backup.events.map(TimeCore.validateEvent),ids=new Set();for(const item of backup.ops){TimeCore.assert(TimeCore.uuid(item.op_id)&&item.op_id===item.op.op_id&&!ids.has(item.op_id)&&TimeCore.uuid(item.op.device_id)&&Number.isSafeInteger(item.op.base_revision),'队列校验失败');ids.add(item.op_id);}
    return mutate(s=>{TimeCore.assert(!s.local.current&&!s.ops.length,'先结束活动并完成同步，再恢复本地副本');s.e.clear();for(const key of s.caches.keys())if(key.startsWith('records:')||key.startsWith('query:'))s.cacheStore.delete(key);for(const e of events)s.e.put(e);for(const item of backup.ops)s.o.put(item);s.m.put(backup.local,'local');if(backup.cloud)s.m.put(backup.cloud,'cloud');else s.m.delete('cloud');s.m.put(TimeCore.uuid(backup.device)?backup.device:crypto.randomUUID(),'device');if(backup.conflict)s.m.put(backup.conflict,'conflict');else s.m.delete('conflict');for(const branch of backup.conflicts||[])s.c.put(branch);},{conflicts:true});
  }
  root.TimeDB={open,get,all,snapshot,getOverview,getSyncState,getLocalState,getCurrent,getQueueCount,enqueue,accept,acceptBatch,acceptBatchCore,reconcileConfirmedCaches,remote,freeze,useCloud,cache,remember,rememberPage,restoreLocal};
})(globalThis);
