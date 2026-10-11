/* Buildless PWA. No analytics, remote database keys, or localStorage. */
'use strict';
const $=id=>document.getElementById(id),C=TimeCore,D=TimeDB,T=TimeTransport;
let snap,settings={},view='day',historyMode='month',historyValue='',subject='',busy=false,editEvent=null,splitEvent=null,verified=null,recordOffset=0,draftConfig,installPrompt;
let cloudSerial=Promise.resolve(),cloudRetryAt=0;
let serial=Promise.resolve(),syncTimer,statsTimer,retryMs=5000,flash='',flashUntil=0,syncFlight=null;
let uiGeneration=0,paintRequest=0,localStatsTimer;
const toast=TimeUX.toast($('toast'));
const identity=TimeUX.identity({getId:()=>google.accounts.id,transport:T,onCredential:()=>{notify('Google 登录成功');scheduleSync(100);},onFallback:()=>notify('登录已过期或未完成，请在设置中使用 Google 登录按钮','error')});
function el(tag,text,className){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;}
function notify(msg,kind='success',key='notice'){flash=msg;flashUntil=Date.now()+7000;paintStatus();toast.show(msg,kind,key);}
function failed(err){notify(String(err.message||err),'error');console.error(err);}
function download(name,text,type='application/json'){const url=URL.createObjectURL(new Blob([text],{type})),a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function paintStatus(){if(!snap)return;const count=snap.queueCount;let text=snap.conflict?'设备冲突 · 原队列已保留':!navigator.onLine?`离线 · ${count} 个操作待同步`:busy?`正在同步 · ${count} 个操作`:count?`${count} 个操作已保存到本机 · ${T.ready()?'等待同步':'请登录同步'}`:`${snap.cloud?'云端已确认':'本机已就绪'} · ${T.ready()?'已登录':'登录后自动同步'}`;if(flash&&Date.now()<flashUntil)text=flash+' · '+text;$('status').textContent=text;}
function tick(){if(!snap)return;const cur=snap.local.current;$('elapsed').textContent=cur?(()=>{const s=Math.max(0,Math.floor((Date.now()-C.time(cur.start_at))/1000));return [Math.floor(s/3600),Math.floor(s%3600/60),s%60].map(v=>String(v).padStart(2,'0')).join(':');})():'00:00:00';paintStatus();}
function paintCurrent(state,{allowReset=false}={}){
  if(snap&&!allowReset&&state.revision<snap.local.revision)return false;
  ++uiGeneration;snap={...snap,local:state,queueCount:state.queueCount??snap?.queueCount??0};
  const cur=state.current;$('current-name').textContent=cur?cur.event_name:'尚未开始';$('started').textContent=cur?'开始于 '+new Date(cur.start_at).toLocaleString('zh-CN',{timeZone:cur.timezone})+' · '+cur.timezone:'点一个活动，开始记录';$('stop').disabled=!cur||!!snap.conflict;$('conflict').hidden=!snap.conflict;
  for(const b of $('quick').children){b.className=cur?.event_key===b.dataset.eventKey?'active':'';b.disabled=!!snap.conflict;}tick();return true;
}
async function refreshCurrent(rebuild=false,{allowReset=false}={}){
  const generation=uiGeneration,request=++paintRequest,latest=await D.getOverview();
  if(generation!==uiGeneration||request!==paintRequest||snap&&!allowReset&&latest.local.revision<snap.local.revision)return false;
  const configChanged=!snap||JSON.stringify(snap.local.config)!==JSON.stringify(latest.local.config);
  snap=latest;
  if(rebuild||configChanged){const quick=$('quick');quick.replaceChildren();for(const def of snap.local.config.events){const b=el('button',def.name);b.dataset.eventKey=def.id;b.addEventListener('pointerdown',()=>D.debug('pointerdown',{eventKey:def.id}));b.onclick=()=>act({type:'switch',at:new Date().toISOString(),event_id:crypto.randomUUID(),event_key:def.id});quick.append(b);}}
  return paintCurrent(latest.local,{allowReset});
}
const repaint=options=>refreshCurrent(true,options);
function deferLocalStats(){clearTimeout(localStatsTimer);localStatsTimer=setTimeout(()=>renderStats(false,true),350);}
function recordsAffected(spec){return ['delete','edit','split'].includes(spec.type)&&(spec.year===recordsYear||spec.patch?.start_at)||spec.type==='import'&&spec.events.some(e=>C.eventYear(e)===recordsYear);}
function act(spec){
  D.debug('tap',{type:spec.type});
  ++uiGeneration; // Invalidate any read started before this input, even for a no-op.
  ++statsGeneration;
  const fast=spec.type==='switch'||spec.type==='stop';
  const committed=serial.then(async()=>{
    const state=await D.enqueue(spec);
    paintCurrent(state);D.debug('paintCurrent finished',{revision:state.revision});
    if(!fast&&recordsAffected(spec))optimisticRecords(state.effects||[]); // The transaction's committed post-image; no reread, even on no-op.
    if(!fast&&recordsAffected(spec))++recordsPaintGeneration;
    notify(({delete:'已删除，正在同步…（已保存到本机）',edit:'修改已保存到本机，正在同步…',split:'拆分已保存到本机，正在同步…'})[spec.type]||'已保存到本机');
    announce();deferLocalStats();scheduleSync(300);return state;
  });
  // Only persistence/current UI is serialized. History/summary/network never enter this chain.
  serial=committed.catch(err=>{failed(err);refreshCurrent().catch(failed);});
  if(fast)return committed;
  const finished=committed.then(async state=>{if(spec.type==='config')await repaint();if(recordsVisible()&&recordsAffected(spec))scheduleRecordsReconcile();return state;});finished.catch(failed);return finished;
}
const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('time-tracker-v1'):null;
function announce(){if(channel)channel.postMessage('changed');}
if(channel)channel.onmessage=()=>repaint().then(()=>renderStats()).catch(failed);
function configured(){return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(settings.backendUrl||'')&&/^[A-Za-z0-9.-]+\.apps\.googleusercontent\.com$/.test(settings.clientId||'');}
function scheduleSync(delay=retryMs){clearTimeout(syncTimer);syncTimer=setTimeout(()=>sync().catch(failed),Math.max(delay,cloudRetryAt-Date.now()));}
function cloudPause(ms=15000){cloudRetryAt=Math.max(cloudRetryAt,Date.now()+ms+Math.floor(Math.random()*3000));}
function send(payload){const flight=cloudSerial.then(()=>sendOne(payload));cloudSerial=flight.catch(()=>{});return flight;}
async function sendOne(payload){
  if(Date.now()<cloudRetryAt)throw Object.assign(new Error('云端暂忙，稍后自动重试'),{code:'BUSY'});
  if(!configured())throw new Error('请先保存后端网址和 Google Client ID');
  let r;try{r=await T.call(settings,payload);}catch(err){if(err.code==='NETWORK_TIMEOUT'||/网络请求超时/.test(err.message)){cloudPause(60000);err.code='NETWORK_TIMEOUT';}throw err;}
  if(!r.ok){
    if(r.code==='BUSY'||/Lock timeout/i.test(r.message||'')){cloudPause(Math.max(15000,Math.min(300000,Number(r.retry_after_ms)||15000)));throw Object.assign(new Error('云端暂忙，记录已保存在本机，稍后自动重试。'),{code:'BUSY'});}
    if(r.code==='AUTH_REQUIRED'){identity.expired();googleLogin();throw new Error('登录已过期，请使用 Google 登录按钮重试');}
    if(payload.action==='sync_batch'&&Array.isArray(r.confirmed)){if(r.code==='YIELD')cloudPause(3000);return r;}
    if(r.code==='CONFLICT'){await D.freeze(r.state);await repaint();throw new Error('设备冲突，队列已保留，请处理后继续');}
    throw new Error(r.message||'服务端暂时未确认');
  }return r;
}
function deferStats(){clearTimeout(statsTimer);statsTimer=setTimeout(()=>{if(busy)return deferStats();renderStats(true);},2000);}
async function sync(){
  if(syncFlight)return syncFlight;
  if(!navigator.onLine||!configured())return;
  if(Date.now()<cloudRetryAt){scheduleSync(cloudRetryAt-Date.now());return;}
  if(!T.ready()){googleLogin();return;}
  const run=async()=>{busy=true;clearTimeout(statsTimer);paintStatus();try{
    let s=await D.getSyncState();if(s.conflict)return;
    const types=new Set(s.ops.map(i=>i.op.type));notify('正在同步…','loading','sync');
    if(!s.ops.length){const r=await send({action:'state'});await D.remote(r.state);}
    else while(s.ops.length){const batch=TimeUX.batch(s.ops);const r=await send({action:'sync_batch',ops:batch.map(i=>i.op)});await TimeUX.acceptResponse(D,batch,r);s=await D.getSyncState();if(s.conflict)throw new Error('设备冲突');}
    retryMs=5000;await refreshCurrent();announce();toast.clear('sync');notify(types.size===1?({delete:'删除已同步到云端',edit:'修改已同步',split:'拆分已同步'})[[...types][0]]||'同步完成':'同步完成');deferLocalStats();deferStats();
  }catch(err){retryMs=Math.min(300000,retryMs*2);await refreshCurrent();notify(['BUSY','YIELD'].includes(err.code)?'云端暂忙，记录已保存在本机，稍后自动重试。':'云端未确认，操作仍安全保存在本机；记录已保存在本机。'+err.message,['BUSY','YIELD'].includes(err.code)?'success':'error');}finally{busy=false;toast.clear('sync');paintStatus();if(await D.getQueueCount()&&!snap.conflict&&T.ready()&&navigator.onLine)scheduleSync();}};
  syncFlight=(navigator.locks?navigator.locks.request('time-tracker-sync',{ifAvailable:true},lock=>lock?run():scheduleSync(5000)):run()).finally(()=>{syncFlight=null;});return syncFlight;
}
function googleLogin(){
  if(!configured())return;

  const init=()=>{
    identity.start(settings.clientId,$('google-signin'));
  };

  if(globalThis.google?.accounts?.id)return init();

  if(document.querySelector('script[data-google-identity]'))return;

  const script=el('script');
  script.src='https://accounts.google.com/gsi/client';
  script.async=true;
  script.dataset.googleIdentity='true';
  script.onload=init;
  script.onerror=()=>{
    script.remove();
    notify('Google 登录无法加载；联网后打开设置重试');
  };

  document.head.append(script);
}
function selectors(){const box=$('selectors');box.replaceChildren();let mode=view,value='';
  if(view==='history'){const select=el('select');for(const [v,n]of [['day','日期'],['week','周（周一开始）'],['month','月份'],['year','年份'],['all','全部时间']]){const o=el('option',n);o.value=v;select.append(o);}select.value=historyMode;select.onchange=()=>{historyMode=select.value;historyValue='';selectors();renderStats();};box.append(select);mode=historyMode;}
  if(view==='month'||view==='history'&&mode!=='all'){
    const input=el('input');input.type=mode==='month'?'month':mode==='year'?'number':'date';input.setAttribute('aria-label','选择历史范围');const today=C.dateKey(Date.now(),snap.local.config.timezone);input.value=historyValue||(mode==='month'?today.slice(0,7):mode==='year'?today.slice(0,4):today);if(mode==='year'){input.min='1900';input.max='9998';}value=input.value;input.onchange=()=>{historyValue=input.value;renderStats();};box.append(input);
  }
  if(view==='history'){const select=el('select');const all=el('option','所有科目');all.value='';select.append(all);for(const def of snap.local.config.events){const o=el('option',def.name);o.value=def.id;select.append(o);}select.value=subject;select.onchange=()=>{subject=select.value;renderStats();};box.append(select);}
  return {mode,value};
}
function querySpec(){let mode=view==='history'?historyMode:view;const today=C.dateKey(Date.now(),snap.local.config.timezone);let value=(view==='history'||view==='month')?historyValue:'';if(!value)value=mode==='month'?today.slice(0,7):mode==='year'?today.slice(0,4):today;return {mode,value};}
let statsGeneration=0;
async function recoverLocalStats(range,key,generation){
  const before=await D.getStatsState(),total=C.emptySummary('total'),days=new Map();let after;
  while(true){if(generation!==statsGeneration)return null;const chunk=await D.getRecoveryChunk(after);
    for(const event of chunk.events)for(const p of C.splitDays(event))if(p.date>=range.from&&p.date<range.to){C.addSegment(total,p);if(!days.has(p.date))days.set(p.date,C.emptySummary(p.date));C.addSegment(days.get(p.date),p);}
    if(chunk.done)break;after=chunk.next;await new Promise(resolve=>setTimeout(resolve,0));
  }
  const latest=await D.getStatsState();if(generation!==statsGeneration||latest.local.revision!==before.local.revision)return null;
  return D.cache(key,{total,days:[...days.values()],range,state:latest.local,local_only:true,fetched_at:0});
}
async function renderStats(refresh=false,localOnly=false,allowLocalRecovery=false){
  if(!snap)return;const gen=++statsGeneration,q=querySpec();let r;
  try{
    const range=C.range(q.mode,q.value,snap.local.config.timezone),key='query:'+q.mode+':'+(q.mode==='all'?'all':range.from);
    r=await D.get('cache',key);
    if(!localOnly&&!busy&&navigator.onLine&&T.ready()&&configured()&&(refresh||!r||Date.now()-r.fetched_at>30000)){
      const response=await send({action:'query',...q});r=await D.cache(key,{...response,fetched_at:Date.now()});
    }
    if(!r&&allowLocalRecovery&&!localOnly)r=await recoverLocalStats(range,key,gen);
    const s=await D.getStatsState();if(gen!==statsGeneration)return;
    // Cache reconciliation is disposable: never treat an older summary as current.
    if(r&&s.cloud&&r.state.revision<s.cloud.revision){r=null;if(!localOnly&&!busy)deferStats();}
    let total=C.clone(r?.total||C.emptySummary('total')),days=new Map((r?.days||[]).map(d=>[d.date,C.clone(d)])),rev=r?.state.revision;
    if(r){for(const item of s.ops){if(item.op.base_revision<rev)continue;for(const change of item.effects)for(const [e,sign]of [[change.before,-1],[change.after,1]])if(e)for(const p of C.splitDays(e))if(p.date>=range.from&&p.date<range.to){C.addSegment(total,p,sign);if(!days.has(p.date))days.set(p.date,C.emptySummary(p.date));C.addSegment(days.get(p.date),p,sign);}}}
    else {const known=new Map();for(const item of s.ops)for(const effect of item.effects)known.set(effect.after.event_id,effect.after);for(const event of known.values())for(const p of C.splitDays(event))if(p.date>=range.from&&p.date<range.to){C.addSegment(total,p);if(!days.has(p.date))days.set(p.date,C.emptySummary(p.date));C.addSegment(days.get(p.date),p);}}
    const cur=s.local.current;if(cur){const end=Math.max(C.time(cur.start_at),Math.min(Date.now(),C.time(cur.start_at)+C.MAX_SPAN));for(const p of C.splitDays({...cur,end_at:C.iso(end)}))if(p.date>=range.from&&p.date<range.to){C.addSegment(total,p);if(!days.has(p.date))days.set(p.date,C.emptySummary(p.date));C.addSegment(days.get(p.date),p);}}
    $('range-label').textContent=q.mode==='all'?'全部历史（年度汇总）':range.from+' 至 '+C.shiftDate(range.to,-1);
    $('stats-note').textContent=(r&&!r.local_only?'云端汇总，截至 '+new Date(r.fetched_at).toLocaleString('zh-CN'):'仅本机已缓存记录，历史可能不完整')+'；含当前活动估计'+(s.conflict?'；设备冲突期间为本机分支估计':'');
    $('study-total').textContent=C.duration(total.study_seconds);$('all-total').textContent=C.duration(total.total_seconds);
    const breakdown=$('breakdown');breakdown.replaceChildren();const defs=new Map(s.local.config.events.map(d=>[d.id,d.name]));for(const [id,v]of Object.entries(total.by_event))if(!defs.has(id))defs.set(id,v.name);
    for(const [id,name]of defs){if(view==='history'&&subject&&subject!==id)continue;const seconds=total.by_event[id]?.seconds||0;const row=el('div',undefined,'stat-row'),label=el('div',name),bar=el('div',undefined,'bar'),fill=el('span');fill.style.width=(total.total_seconds?Math.max(0,Math.min(100,seconds/total.total_seconds*100)):0)+'%';bar.append(fill);label.append(bar);label.style.flex='1';row.append(label,el('strong',C.duration(seconds)));breakdown.append(row);}
    if(view==='history'&&subject){const heading=el('h2','所选科目累计 '+C.duration(total.by_event[subject]?.seconds||0));breakdown.prepend(heading);}
    const cat=el('details'),title=el('summary','按分类查看');cat.append(title);for(const [name,seconds]of Object.entries(total.by_category)){const row=el('div',undefined,'stat-row');row.append(el('span',name),el('strong',C.duration(seconds)));cat.append(row);}breakdown.append(cat);
    const daily=$('daily');daily.replaceChildren();if(q.mode==='week'||q.mode==='month'){daily.append(el('h2','每日记录 / 学习'));for(let date=range.from;date<range.to;date=C.shiftDate(date,1)){const d=days.get(date)||C.emptySummary(date),row=el('div',undefined,'stat-row');row.append(el('span',date.slice(5)+' '+new Date(date+'T12:00:00Z').toLocaleDateString('zh-CN',{weekday:'short',timeZone:'UTC'})),el('strong',C.duration(d.total_seconds)+' / '+C.duration(d.study_seconds)));daily.append(row);}}
  }catch(err){if(gen===statsGeneration)$('stats-note').textContent='统计暂未刷新：'+err.message;}
}
function localInput(iso,tz){const p=C.parts(C.time(iso),tz);return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}T${String(p.hour).padStart(2,'0')}:${String(p.minute).padStart(2,'0')}:${String(p.second).padStart(2,'0')}`;}
function inputInstant(value,tz){
  const base=Date.parse(value+'Z');if(!Number.isFinite(base))throw new Error('时间格式错误');const offsets=new Set();
  for(let d=-2;d<=2;d++){const ms=base+d*C.DAY,p=C.parts(ms,tz);offsets.add(Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)-ms);}
  const normalized=value.length===16?value+':00':value;
  const candidates=[...offsets].map(offset=>C.iso(base-offset)).filter(iso=>localInput(iso,tz)===normalized);
  if(!candidates.length)throw new Error('该本地时间位于夏令时跳过区间，请选择有效时间');
  if(candidates.length>1){const choice=prompt('夏令时回拨产生两个相同本地时间。请复制选择一个 UTC 时间：\n'+candidates.join('\n'),candidates[0]);if(!candidates.includes(choice))throw new Error('未确认夏令时重叠时间');return choice;}
  return candidates[0];
}
let recordsYear='',recordNext=null,recordsGeneration=0,recordsPaintGeneration=0,recordsReconcileTimer;
const recordsOptimistic=new Map();
const recordsFlights=new Map();
function recordsVisible(){return !!document.querySelector('.history-records')?.open;}
function recordCard(event){
  const card=el('div',undefined,'record');card.dataset.eventId=event.event_id;card.append(el('strong',event.event_name+' · '+C.duration(event.duration_seconds)),el('p',new Date(event.start_at).toLocaleString('zh-CN',{timeZone:event.timezone})+' → '+new Date(event.end_at).toLocaleString('zh-CN',{timeZone:event.timezone}), 'subtle'));if(event.note)card.append(el('p',event.note,'subtle'));
    const row=el('div',undefined,'row');for(const [text,fn]of [['修改',()=>openEditor(event)],['拆分',()=>openSplitter(event)],['删除',()=>{if(confirm('删除这条记录？统计将同步扣除。Drive 原始表保留删除标记。'))act({type:'delete',year:C.eventYear(event),event_id:event.event_id});}]]){const b=el('button',text,'quiet');b.onclick=fn;row.append(b);}card.append(row);return card;
}
function emptyRecords(){if(!$('records').children.length)$('records').append(el('p','该页没有记录，或本机尚未缓存。','subtle'));}
function optimisticRecords(effects){
  if(!recordsVisible())return;
  const box=$('records');for(const {after:event}of effects){
    recordsOptimistic.set(event.event_id,{event,year:recordsYear,offset:recordOffset,revision:snap.local.revision});
    const card=[...box.children].find(n=>n.dataset.eventId===event.event_id);
    if(event.deleted||C.eventYear(event)!==recordsYear){if(card)card.remove();continue;}
    if(card)card.replaceWith(recordCard(event));
    else {for(const child of [...box.children])if(!child.dataset.eventId)child.remove();box.prepend(recordCard(event));if(box.children.length>100)box.lastElementChild.remove();}
  }emptyRecords();
}
function scheduleRecordsReconcile(){
  clearTimeout(recordsReconcileTimer);recordsReconcileTimer=setTimeout(()=>paintRecords().catch(failed),500);
}
async function paintRecords(){
  if(!recordsYear||!recordsVisible())return;
  const year=recordsYear,offset=recordOffset,generation=++recordsPaintGeneration;
  const meta=await D.get('cache','records:'+year),events=await D.getEventsByIds(meta?.pages[offset]?.ids||[]),s=await D.getStatsState();
  if(year!==recordsYear||offset!==recordOffset||!recordsVisible()||generation!==recordsPaintGeneration)return;
  const projected=TimeUX.recordsView({...s,events},year,offset,meta),byId=new Map(projected.map(e=>[e.event_id,e]));
  for(const [id,entry]of recordsOptimistic){if(meta&&meta.cloud_revision>=entry.revision){recordsOptimistic.delete(id);continue;}if(entry.year!==year||entry.offset!==offset)continue;
    if(entry.event.deleted||C.eventYear(entry.event)!==year)byId.delete(id);else byId.set(id,entry.event);
  }
  const visible=[...byId.values()].sort((a,b)=>C.time(b.start_at)-C.time(a.start_at)||a.event_id.localeCompare(b.event_id)).slice(0,100);
  $('records').replaceChildren(...visible.map(recordCard));emptyRecords();
  recordNext=meta?.pages[offset]?.next??null;
  $('more-records').hidden=recordNext===null;$('previous-records').hidden=offset===0;
  $('record-page').textContent='第 '+(Math.floor(offset/100)+1)+' 页'+(meta?.complete?' · 全年已缓存':' · 已显示本机缓存');
}
async function loadRecords(direction=false){
  const year=String($('record-year').value);if(!/^\d{4}$/.test(year))throw new Error('请输入四位年份');
  if(year!==recordsYear||!direction)recordOffset=0;
  else recordOffset=direction==='previous'?Math.max(0,recordOffset-100):recordNext??recordOffset;
  recordsYear=year;const generation=++recordsGeneration,offset=recordOffset;toast.clear('records');
  notify('正在显示本机记录');await paintRecords();
  if(!navigator.onLine){notify('离线状态：记录已保存在本机，当前显示本机缓存','error');return;}
  if(!configured()||!T.ready()){googleLogin();return;}
  const meta=await D.get('cache','records:'+year),s=await D.getSyncState();
  if(!s.ops.length&&meta?.pages[offset]&&meta.cloud_revision>=(s.cloud?.revision??0)&&Date.now()-meta.fetched_at<30000){notify('记录已是最新（本机缓存）');return;}
  const key=year+':'+offset;
  if(!recordsFlights.has(key))recordsFlights.set(key,(async()=>{
    if(s.ops.length)await sync();
    if(await D.getQueueCount())throw new Error('云端未确认，操作仍安全保存在本机');
    if(generation===recordsGeneration)notify('正在检查云端更新…','loading','records');
    const current=await D.get('cache','records:'+year);
    const r=await send({action:'records',year,offset,cloud_revision:current?.cloud_revision,check_only:!!current?.pages[offset]});
    await D.rememberPage(year,r);return r;
  })().finally(()=>recordsFlights.delete(key)));
  try{const r=await recordsFlights.get(key);if(generation!==recordsGeneration)return;if(r.reset)recordOffset=0;await paintRecords();notify('记录已是最新');}
  catch(err){if(generation===recordsGeneration)notify('云端未确认，记录已保存在本机。'+err.message,'error');}
  finally{if(generation===recordsGeneration)toast.clear('records');}
}
function openEditor(event){editEvent=event;$('edit-start').value=localInput(event.start_at,event.timezone);$('edit-end').value=localInput(event.end_at,event.timezone);$('edit-name').value=event.event_name;$('edit-category').value=event.category;$('edit-note').value=event.note;$('edit-zone').textContent=event.timezone+'；开始年份改变会自动迁移归档。';$('editor').showModal();}
function openSplitter(event){splitEvent=event;$('split-at').value=localInput(C.iso((C.time(event.start_at)+C.time(event.end_at))/2),event.timezone);$('split-key').replaceChildren();for(const def of snap.local.config.events){const o=el('option',def.name);o.value=def.id;$('split-key').append(o);}$('splitter').showModal();}
function renderConfig(){draftConfig=C.clone(snap.local.config);$('timezone').value=draftConfig.timezone;paintConfig();}
function paintConfig(){const box=$('config-events');box.replaceChildren();draftConfig.events.forEach((def,i)=>{const card=el('div',undefined,'config-item'),name=el('input'),category=el('input');name.value=def.name;name.setAttribute('aria-label','事件名称');category.value=def.category;category.setAttribute('aria-label','分类');name.oninput=()=>def.name=name.value;category.oninput=()=>def.category=category.value;card.append(name,category);const row=el('div',undefined,'row');for(const [text,action]of [['↑',()=>{if(i>0)[draftConfig.events[i-1],draftConfig.events[i]]=[draftConfig.events[i],draftConfig.events[i-1]];}],['↓',()=>{if(i<draftConfig.events.length-1)[draftConfig.events[i+1],draftConfig.events[i]]=[draftConfig.events[i],draftConfig.events[i+1]];}],['移除',()=>draftConfig.events.splice(i,1)]]){const b=el('button',text,'quiet');b.onclick=()=>{action();paintConfig();};row.append(b);}card.append(row);box.append(card);});}
async function exportLocal(){const s=await D.snapshot(),conflicts=await D.all('conflicts');download('time-tracker-local-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify({schema_version:1,kind:'local-recovery',generated_at:new Date().toISOString(),...s,conflicts},null,2));notify('本地副本已导出');}
async function sha(text){const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));return [...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function verifyBackup(){
  verified=null;$('restore').disabled=true;$('restore-config').disabled=true;$('restore-current').disabled=true;
  const files=[...$('restore-files').files],mf=files.find(f=>f.name.endsWith('-manifest.json'));if(!mf)throw new Error('请选择 manifest 文件和它对应的 JSONL、metadata');
  const manifest=JSON.parse(await mf.text());if(manifest.schema_version!==1)throw new Error('不支持的备份版本');
  let events=null,metadata=null;for(const entry of manifest.files){const file=files.find(f=>f.name===entry.name);if(!file){if(entry.name.endsWith('.csv'))continue;throw new Error('缺少 '+entry.name);}const text=await file.text();if(await sha(text)!==entry.sha256||new TextEncoder().encode(text).length!==entry.bytes)throw new Error('校验失败：'+file.name);if(file.name.endsWith('.jsonl'))events=text.split('\n').filter(Boolean).map(line=>{const raw=JSON.parse(line),event=C.validateEvent(raw);if(raw.duration_seconds!==event.duration_seconds)throw new Error('记录秒数不一致');return event;});if(file.name.endsWith('-metadata.json'))metadata=JSON.parse(text);}
  if(!events||events.length!==manifest.record_count)throw new Error('记录数不匹配');if(new Set(events.map(e=>e.event_id)).size!==events.length)throw new Error('备份有重复 UUID');if(!metadata)throw new Error('缺少 metadata');C.validateConfig(metadata.config);
  verified={manifest,events,metadata};$('restore-report').textContent=`校验通过：${manifest.period}\n${events.length} 条记录\n生成时间：${manifest.generated_at}\nSHA-256、秒数、UUID 和版本已检查。`;$('restore').disabled=false;$('restore-config').disabled=false;$('restore-current').disabled=!metadata.current;
}
async function restore(){
  if(!verified)throw new Error('先校验备份');if(!T.ready())throw new Error('请先登录');
  if(!confirm('将已校验记录导入云端。同 UUID 同内容会跳过，不同内容会拒绝。首次恢复请使用空库。继续？'))return;
  $('restore').disabled=true;
  try{for(let i=0;i<verified.events.length;i+=5){await act({type:'import',events:verified.events.slice(i,i+5)});await sync();if(await D.getQueueCount())throw new Error('导入暂停，未确认批次已保留。恢复网络后同步，再重试导入（UUID 去重）。');$('restore-report').textContent=`已确认 ${Math.min(i+5,verified.events.length)} / ${verified.events.length}`;}notify('记录恢复完成，统计已重算');}finally{$('restore').disabled=false;}
}
async function init(){
  await D.open();settings=await D.get('cache','settings')||{};await repaint();$('backend-url').value=settings.backendUrl||'';$('client-id').value=settings.clientId||'';$('record-year').value=C.dateKey(Date.now(),snap.local.config.timezone).slice(0,4);selectors();renderConfig();await renderStats(false,false,true);
  if(!configured())$('settings').hidden=false;googleLogin();if(!navigator.onLine)notify('离线状态：记录已保存在本机','error');
  if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(err=>notify('离线页面缓存未就绪：'+err.message));
  if(navigator.storage?.estimate){const estimate=await navigator.storage.estimate();$('storage-info').textContent=`本机已用约 ${Math.ceil((estimate.usage||0)/1024/1024)} MB。浏览器持久存储：${await navigator.storage.persisted()?'已获准':'未获准'}`;}
  setInterval(tick,1000);setInterval(()=>renderStats(),60000);
}
$('stop').onclick=()=>act({type:'stop',at:new Date().toISOString()});
$('settings-toggle').onclick=()=>{$('settings').hidden=!$('settings').hidden;if(!$('settings').hidden){renderConfig();googleLogin();$('settings').scrollIntoView({behavior:'smooth'});}};
$('save-settings').onclick=async()=>{try{const proposed={backendUrl:$('backend-url').value.trim(),clientId:$('client-id').value.trim()},old=settings;settings=proposed;if(!configured()){settings=old;throw new Error('网址必须以 /exec 结尾，Client ID 必须是 Google 网页应用 ID');}await D.cache('settings',settings);T.credential('');googleLogin();notify('连接已保存，请登录');}catch(err){failed(err);}};
$('sync').onclick=()=>{if(!T.ready()){$('settings').hidden=false;googleLogin();notify('正在尝试自动登录，也可使用 Google 登录按钮');}else sync().catch(failed);};
$('persist').onclick=async()=>{try{notify(navigator.storage?.persist&&await navigator.storage.persist()?'浏览器已允许持久存储':'浏览器尚未允许；经常使用并安装 App 后可再试');}catch(err){failed(err);}};
$('export-local').onclick=()=>exportLocal().catch(failed);$('export-conflict').onclick=$('export-local').onclick;
$('use-cloud').onclick=async()=>{if(!confirm('采用云端状态并将本机未同步记录保存为冲突副本？建议先导出。'))return;try{await D.useCloud();await repaint({allowReset:true});renderConfig();renderStats(true);announce();notify('已采用云端状态；冲突副本可从本地导出文件找回');}catch(err){failed(err);}};
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{view=b.dataset.tab;historyValue='';document.querySelectorAll('[data-tab]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));selectors();renderStats();});
$('load-records').onclick=()=>loadRecords().catch(failed);$('more-records').onclick=()=>loadRecords(true).catch(failed);$('previous-records').onclick=()=>loadRecords('previous').catch(failed);document.querySelector('.history-records').addEventListener('toggle',e=>{if(e.target.open)loadRecords().catch(failed);});
$('cancel-edit').onclick=()=>$('editor').close();$('cancel-split').onclick=()=>$('splitter').close();
$('edit-form').onsubmit=async e=>{e.preventDefault();try{const patch={start_at:inputInstant($('edit-start').value,editEvent.timezone),end_at:inputInstant($('edit-end').value,editEvent.timezone),event_name:$('edit-name').value,category:$('edit-category').value,note:$('edit-note').value};await act({type:'edit',year:C.eventYear(editEvent),event_id:editEvent.event_id,patch});$('editor').close();}catch(err){failed(err);}};
$('split-form').onsubmit=async e=>{e.preventDefault();try{await act({type:'split',year:C.eventYear(splitEvent),event_id:splitEvent.event_id,at:inputInstant($('split-at').value,splitEvent.timezone),event_key:$('split-key').value,new_event_id:crypto.randomUUID()});$('splitter').close();}catch(err){failed(err);}};
$('add-event').onclick=()=>{draftConfig.events.push({id:'custom_'+crypto.randomUUID(),name:'新活动',category:'其他'});paintConfig();};
$('save-config').onclick=async()=>{try{draftConfig.timezone=$('timezone').value.trim();C.validateConfig(draftConfig);await act({type:'config',config:C.clone(draftConfig)});selectors();notify('配置已保存到本机，等待同步');}catch(err){failed(err);}};
$('verify-backup').onclick=()=>verifyBackup().catch(err=>{$('restore-report').textContent=err.message;failed(err);});$('restore').onclick=()=>restore().catch(failed);
$('restore-config').onclick=()=>verified&&act({type:'config',config:verified.metadata.config});
$('restore-local').onclick=async()=>{try{const file=$('local-restore-file').files[0];if(!file)throw new Error('请选择本地恢复副本');const backup=JSON.parse(await file.text());if(!confirm('恢复这个副本中的原始队列、当前活动和本机记录？原 UUID 保留，连接设置保持当前值。'))return;await D.restoreLocal(backup);await repaint({allowReset:true});renderConfig();selectors();renderStats();announce();notify('本地副本已恢复，请登录同步');scheduleSync(300);}catch(err){failed(err);}};
$('restore-current').onclick=()=>{if(verified?.metadata.current&&confirm('从现在重新开始这个活动？备份时刻到现在的空缺不会自动记为持续活动。')){const c=verified.metadata.current;if(!snap.local.config.events.some(e=>e.id===c.event_key))return notify('请先恢复配置');act({type:'switch',event_key:c.event_key,event_id:crypto.randomUUID(),at:new Date().toISOString()});}};
addEventListener('online',()=>{googleLogin();scheduleSync(200);renderStats();});addEventListener('offline',()=>{paintStatus();notify('离线状态：记录已保存在本机，联网后自动同步','error');});document.addEventListener('visibilitychange',()=>{if(!document.hidden){repaint().then(()=>renderStats()).catch(failed);scheduleSync(200);}});
addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;$('install').hidden=false;});$('install').onclick=async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;$('install').hidden=true;}};
init().catch(err=>{$('status').textContent='无法打开本地存储，未开始记录：'+err.message;document.querySelectorAll('#quick button,#stop').forEach(b=>b.disabled=true);});
