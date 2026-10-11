/* No persisted authentication state. Small controllers are independently testable. */
(function(root){
  'use strict';
  function toast(node,timers=root){
    const entries=new Map();let generation=0;
    function paint(){const all=[...entries.values()];const entry=all.find(e=>e.kind==='error')||all.find(e=>e.kind==='loading')||all.at(-1);node.hidden=!entry;if(entry){node.textContent=entry.text;node.dataset.kind=entry.kind;}}
    return {
      show(text,kind='success',key='notice'){const old=entries.get(key);if(old)timers.clearTimeout(old.timer);const entry={text,kind,id:++generation};entries.set(key,entry);if(kind!=='loading')entry.timer=timers.setTimeout(()=>{if(entries.get(key)===entry){entries.delete(key);paint();}},kind==='error'?4000:1800);paint();},
      clear(key='notice'){const old=entries.get(key);if(old)timers.clearTimeout(old.timer);entries.delete(key);paint();}
    };
  }
  function identity({getId,transport,onCredential,onFallback,now=()=>Date.now()}){
    let client='',lastPrompt=-Infinity,interaction=false,buttonNode=null;
    function fallback(){
      if(transport.ready()||interaction)return;
      interaction=true;
      if(buttonNode){buttonNode.hidden=false;buttonNode.replaceChildren();getId().renderButton(buttonNode,{theme:'outline',size:'large',text:'signin_with',locale:'zh_CN'});}
      onFallback();
    }
    return {start(clientId,node){const id=getId();buttonNode=node;
      if(client!==clientId){id.cancel?.();client=clientId;lastPrompt=-Infinity;interaction=false;id.initialize({client_id:clientId,auto_select:true,use_fedcm_for_prompt:true,use_fedcm_for_button:true,button_auto_select:true,nonce:crypto.randomUUID(),callback:r=>{transport.credential(r.credential);if(transport.ready()){interaction=false;node.hidden=true;onCredential();}else fallback();}});}
      node.hidden=!interaction;
      if(!transport.ready()&&!interaction&&now()-lastPrompt>=60000){lastPrompt=now();try{id.prompt(n=>{
        // FedCM has no display-moment notification. Only a concluded/skipped prompt
        // exposes the manual fallback; credential delivery/cancel() are not failures.
        if(n.isSkippedMoment?.()||n.isDismissedMoment?.()&&n.getDismissedReason?.()==='flow_restarted')fallback();
      });}catch{/* A transient SDK failure is retried by scheduleSync, not treated as user consent. */}}
    },expired(){transport.credential('');},needsInteraction(){return interaction;}};
  }

  // A response may confirm only a prefix. Validate before deleting ANY local operation.
  async function acceptResponse(db,batch,r){
    const ids=r.confirmed;
    if(!Array.isArray(ids)||!r.state||ids.length>batch.length||ids.some((id,i)=>id!==batch[i].op_id)||
      (r.ok?ids.length!==batch.length:r.failed_index!==ids.length))throw new Error('批次回执无效；记录已保存在本机');
    await db.acceptBatch(ids,r.state);
    if(!r.ok){if(r.code==='CONFLICT')await db.freeze(r.state);throw Object.assign(new Error(r.message||'云端未确认'),{code:r.code});}
  }
  function batch(ops){const result=[];let size=0;for(const item of ops.slice(0,10)){const length=JSON.stringify(item.op).length+1;if(result.length&&size+length>85000)break;result.push(item);size+=length;}return result;}
  function recordsView(s,year,offset,meta){
    const pageIds=new Set(meta?.pages[offset]?.ids||[]),byId=new Map(s.events.filter(e=>!pageIds.size||pageIds.has(e.event_id)).map(e=>[e.event_id,e]));
    for(const item of s.ops)for(const change of item.effects){const e=change.after;
      if(pageIds.has(e.event_id)||pageIds.has(item.op?.event_id)||offset===0&&!Object.values(meta?.pages||{}).some(p=>p.ids.includes(e.event_id)))byId.set(e.event_id,e);
    }
    return [...byId.values()].filter(e=>!e.deleted&&TimeCore.eventYear(e)===year)
      .sort((a,b)=>TimeCore.time(b.start_at)-TimeCore.time(a.start_at)||a.event_id.localeCompare(b.event_id)).slice(0,100);
  }
  root.TimeUX={toast,identity,acceptResponse,recordsView,batch};
})(globalThis);
