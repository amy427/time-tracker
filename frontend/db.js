/* IndexedDB is the source of truth for local activity and unsent operations. */
(function(root){
  'use strict'; let db;
  const request=p=>new Promise((resolve,reject)=>{p.onsuccess=()=>resolve(p.result);p.onerror=()=>reject(p.error);});
  async function open(name='time-tracker-v1'){
    if(db)db.close();
    const r=indexedDB.open(name,1);
    r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore('meta');const ops=d.createObjectStore('ops',{keyPath:'op_id'});ops.createIndex('seq','seq',{unique:true});d.createObjectStore('events',{keyPath:'event_id'});d.createObjectStore('cache');d.createObjectStore('conflicts',{keyPath:'id'});};
    db=await request(r);db.onversionchange=()=>db.close();return db;
  }
  async function get(store,key){return request(db.transaction(store).objectStore(store).get(key));}
  async function all(store){return request(db.transaction(store).objectStore(store).getAll());}
  function initial(){return {revision:0,current:null,config:TimeCore.clone(TimeCore.DEFAULT_CONFIG),last_operation_id:null};}
  // Read -> derive -> write within one transaction. No awaited network or timer inside.
  function mutate(fn){return new Promise((resolve,reject)=>{
    const tx=db.transaction(['meta','ops','events','conflicts'],'readwrite'),m=tx.objectStore('meta'),o=tx.objectStore('ops'),e=tx.objectStore('events'),c=tx.objectStore('conflicts');
    const reads=[m.get('local'),m.get('cloud'),o.getAll(),e.getAll(),m.get('device'),m.get('conflict')];let n=0,result;
    const values=[];reads.forEach((r,i)=>{r.onsuccess=()=>{values[i]=r.result;if(++n===reads.length){try{result=fn({local:values[0]||initial(),cloud:values[1]||null,ops:values[2]||[],events:values[3]||[],device:values[4]||crypto.randomUUID(),conflict:values[5]||null,m,o,e,c});}catch(err){reject(err);tx.abort();}}};});
    tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('本地保存中断'));
  });}
  async function snapshot(){return mutate(s=>{s.m.put(s.device,'device');s.m.put(s.local,'local');return {local:s.local,cloud:s.cloud,ops:s.ops.sort((a,b)=>a.seq-b.seq),events:s.events,device:s.device,conflict:s.conflict};});}
  async function enqueue(spec){return mutate(s=>{
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
    const effects=plan.writes.map(w=>({before:byId.get(w.event.event_id)||null,after:w.event}));
    for(const w of plan.writes)s.e.put(w.event);
    const seq=s.ops.length?Math.max(...s.ops.map(v=>v.seq))+1:1;
    s.o.put({op_id:op.op_id,seq,op,effects});s.m.put(plan.state,'local');s.m.put(s.device,'device');return plan.state;
  });}
  async function accept(opId,state){return mutate(s=>{s.o.delete(opId);s.m.put(state,'cloud');if(!s.ops.some(o=>o.op_id!==opId))s.m.put(state,'local');
    const protectedIds=new Set(s.ops.filter(o=>o.op_id!==opId).flatMap(o=>o.effects.map(e=>e.after.event_id)));
    const cutoff=Date.now()-90*TimeCore.DAY;for(const e of s.events)if(TimeCore.time(e.end_at)<cutoff&&!protectedIds.has(e.event_id))s.e.delete(e.event_id);
  });}
  async function remote(state){return mutate(s=>{s.m.put(state,'cloud');if(!s.ops.length&&!s.conflict)s.m.put(state,'local');});}
  async function freeze(state){return mutate(s=>{s.m.put({state,at:new Date().toISOString()},'conflict');s.m.put(state,'cloud');});}
  async function useCloud(){return mutate(s=>{
    if(!s.conflict)throw new Error('没有待处理冲突');s.c.put({id:crypto.randomUUID(),saved_at:new Date().toISOString(),local:s.local,ops:s.ops,events:s.events});s.o.clear();s.e.clear();s.m.put(s.conflict.state,'local');s.m.put(s.conflict.state,'cloud');s.m.delete('conflict');return s.conflict.state;
  });}
  async function cache(key,value){return new Promise((resolve,reject)=>{const tx=db.transaction('cache','readwrite');tx.objectStore('cache').put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
  async function remember(events){return mutate(s=>{const protectedIds=new Set(s.ops.flatMap(o=>o.effects.map(e=>e.after.event_id)));for(const e of events)if(!protectedIds.has(e.event_id))s.e.put(e);});}
  async function restoreLocal(backup){
    TimeCore.assert(backup?.schema_version===1&&backup.kind==='local-recovery','不是本地恢复副本');TimeCore.validateConfig(backup.local.config);TimeCore.assert(Number.isSafeInteger(backup.local.revision)&&Array.isArray(backup.ops)&&Array.isArray(backup.events),'副本结构无效');
    if(backup.local.current)TimeCore.validateEvent({...backup.local.current,end_at:backup.local.current.start_at});
    const events=backup.events.map(TimeCore.validateEvent),ids=new Set();for(const item of backup.ops){TimeCore.assert(TimeCore.uuid(item.op_id)&&item.op_id===item.op.op_id&&!ids.has(item.op_id)&&TimeCore.uuid(item.op.device_id)&&Number.isSafeInteger(item.op.base_revision),'队列校验失败');ids.add(item.op_id);}
    return mutate(s=>{TimeCore.assert(!s.local.current&&!s.ops.length,'先结束活动并完成同步，再恢复本地副本');s.e.clear();for(const e of events)s.e.put(e);for(const item of backup.ops)s.o.put(item);s.m.put(backup.local,'local');if(backup.cloud)s.m.put(backup.cloud,'cloud');else s.m.delete('cloud');s.m.put(TimeCore.uuid(backup.device)?backup.device:crypto.randomUUID(),'device');if(backup.conflict)s.m.put(backup.conflict,'conflict');else s.m.delete('conflict');for(const branch of backup.conflicts||[])s.c.put(branch);});
  }
  root.TimeDB={open,get,all,snapshot,enqueue,accept,remote,freeze,useCloud,cache,remember,restoreLocal};
})(globalThis);
