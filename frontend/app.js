/* Buildless PWA. No analytics, remote database keys, or localStorage. */
'use strict';
const $=id=>document.getElementById(id),C=TimeCore,D=TimeDB,T=TimeTransport;
let snap,settings={},view='day',historyMode='month',historyValue='',subject='',busy=false,editEvent=null,splitEvent=null,verified=null,recordOffset=0,draftConfig,installPrompt;
let googleIdentityInitialized=false;
let serial=Promise.resolve(),syncTimer,retryMs=5000,flash='',flashUntil=0;
function el(tag,text,className){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;}
function notify(msg){flash=msg;flashUntil=Date.now()+7000;paintStatus();}
function failed(err){notify(String(err.message||err));console.error(err);}
function download(name,text,type='application/json'){const url=URL.createObjectURL(new Blob([text],{type})),a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function paintStatus(){if(!snap)return;const count=snap.ops.length;let text=snap.conflict?'设备冲突 · 原队列已保留':!navigator.onLine?`离线 · ${count} 个操作待同步`:busy?`正在同步 · ${count} 个操作`:count?`${count} 个操作已保存到本机 · ${T.ready()?'等待同步':'请登录同步'}`:`${snap.cloud?'云端已确认':'本机已就绪'} · ${T.ready()?'已登录':'登录后自动同步'}`;if(flash&&Date.now()<flashUntil)text=flash+' · '+text;$('status').textContent=text;}
function tick(){if(!snap)return;const cur=snap.local.current;$('elapsed').textContent=cur?(()=>{const s=Math.max(0,Math.floor((Date.now()-C.time(cur.start_at))/1000));return [Math.floor(s/3600),Math.floor(s%3600/60),s%60].map(v=>String(v).padStart(2,'0')).join(':');})():'00:00:00';paintStatus();}
async function repaint(){snap=await D.snapshot();const cur=snap.local.current;$('current-name').textContent=cur?cur.event_name:'尚未开始';$('started').textContent=cur?'开始于 '+new Date(cur.start_at).toLocaleString('zh-CN',{timeZone:cur.timezone})+' · '+cur.timezone:'点一个活动，开始记录';$('stop').disabled=!cur||!!snap.conflict;$('conflict').hidden=!snap.conflict;
  const quick=$('quick');quick.replaceChildren();for(const def of snap.local.config.events){const b=el('button',def.name,cur&&cur.event_key===def.id?'active':'');b.disabled=!!snap.conflict;b.onclick=()=>act({type:'switch',at:new Date().toISOString(),event_id:crypto.randomUUID(),event_key:def.id});quick.append(b);}tick();
}
function act(spec){const task=serial.then(async()=>{const state=(await D.snapshot()).local;if(spec.type==='switch'&&state.current&&state.current.event_key===spec.event_key)return;if(spec.type==='stop'&&!state.current)return;await D.enqueue(spec);await repaint();notify('已保存到本机');announce();renderStats();scheduleSync(100);});serial=task.catch(failed);return task;}
const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('time-tracker-v1'):null;
function announce(){if(channel)channel.postMessage('changed');}
if(channel)channel.onmessage=()=>repaint().then(()=>renderStats()).catch(failed);
function configured(){return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(settings.backendUrl||'')&&/^[A-Za-z0-9.-]+\.apps\.googleusercontent\.com$/.test(settings.clientId||'');}
function scheduleSync(delay=retryMs){clearTimeout(syncTimer);syncTimer=setTimeout(()=>sync().catch(failed),delay);}
async function send(payload){if(!configured())throw new Error('请先保存后端网址和 Google Client ID');const r=await T.call(settings,payload);if(!r.ok){if(r.code==='AUTH_REQUIRED'){T.credential('');throw new Error('AUTH_REQUIRED');}if(r.code==='CONFLICT'){await D.freeze(r.state);await repaint();throw new Error('设备冲突，队列已保留，请处理后继续');}throw new Error(r.message||'服务端暂时未确认');}return r;}
async function sync(){
  if(busy||!navigator.onLine||!configured()||!T.ready())return;
  const run=async()=>{busy=true;paintStatus();try{
    let s=await D.snapshot();if(s.conflict)return;
    if(!s.ops.length){const r=await send({action:'state'});await D.remote(r.state);}
    else while(s.ops.length){const next=s.ops[0];const r=await send({action:'sync',op:next.op});await D.accept(next.op_id,r.state);s=await D.snapshot();if(s.conflict)break;}
    retryMs=5000;await repaint();announce();await renderStats(true);
  }catch(err){retryMs=Math.min(300000,retryMs*2);failed(err);}finally{busy=false;paintStatus();if((await D.snapshot()).ops.length&&!snap.conflict&&T.ready()&&navigator.onLine)scheduleSync();}};
  if(navigator.locks)await navigator.locks.request('time-tracker-sync',{ifAvailable:true},lock=>lock?run():scheduleSync(5000));else await run();
}
function googleLogin(){
  if(!configured())return;

  const init=()=>{
    if(!googleIdentityInitialized){
      google.accounts.id.initialize({
        client_id:settings.clientId,
        callback:response=>{
          T.credential(response.credential);
          notify('登录成功');
          sync().catch(failed);
        },
        auto_select:false,
        use_fedcm_for_button:true,
        nonce:crypto.randomUUID()
      });

      googleIdentityInitialized=true;
    }

    $('google-signin').replaceChildren();
    google.accounts.id.renderButton(
      $('google-signin'),
      {
        theme:'outline',
        size:'large',
        text:'signin_with',
        locale:'zh_CN'
      }
    );
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
async function renderStats(refresh=false){
  if(!snap)return;const gen=++statsGeneration,q=querySpec();let r;
  try{
    const range=C.range(q.mode,q.value,snap.local.config.timezone),key='query:'+q.mode+':'+(q.mode==='all'?'all':range.from);
    r=await D.get('cache',key);
    if(navigator.onLine&&T.ready()&&configured()&&(refresh||!r||Date.now()-r.fetched_at>30000)){
      const response=await send({action:'query',...q});r={...response,fetched_at:Date.now()};await D.cache(key,r);
    }
    const s=await D.snapshot();if(gen!==statsGeneration)return;
    let total=C.clone(r?.total||C.emptySummary('total')),days=new Map((r?.days||[]).map(d=>[d.date,C.clone(d)])),rev=r?.state.revision;
    if(r){for(const item of s.ops){if(item.op.base_revision<rev)continue;for(const change of item.effects)for(const [e,sign]of [[change.before,-1],[change.after,1]])if(e)for(const p of C.splitDays(e))if(p.date>=range.from&&p.date<range.to){C.addSegment(total,p,sign);if(!days.has(p.date))days.set(p.date,C.emptySummary(p.date));C.addSegment(days.get(p.date),p,sign);}}}
    else {for(const event of s.events)for(const p of C.splitDays(event))if(p.date>=range.from&&p.date<range.to){C.addSegment(total,p);if(!days.has(p.date))days.set(p.date,C.emptySummary(p.date));C.addSegment(days.get(p.date),p);}}
    const cur=s.local.current;if(cur){const end=Math.max(C.time(cur.start_at),Math.min(Date.now(),C.time(cur.start_at)+C.MAX_SPAN));for(const p of C.splitDays({...cur,end_at:C.iso(end)}))if(p.date>=range.from&&p.date<range.to){C.addSegment(total,p);if(!days.has(p.date))days.set(p.date,C.emptySummary(p.date));C.addSegment(days.get(p.date),p);}}
    $('range-label').textContent=q.mode==='all'?'全部历史（年度汇总）':range.from+' 至 '+C.shiftDate(range.to,-1);
    $('stats-note').textContent=(r?'云端汇总，截至 '+new Date(r.fetched_at).toLocaleString('zh-CN'):'仅本机已缓存记录，历史可能不完整')+'；含当前活动估计'+(s.conflict?'；设备冲突期间为本机分支估计':'');
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
async function loadRecords(more=false){
  const year=String($('record-year').value);if(!/^\d{4}$/.test(year))throw new Error('请输入四位年份');
  if(!more){recordOffset=0;$('records').replaceChildren();}
  let events,next=null;
  if(navigator.onLine&&T.ready()&&configured()){await sync();if((await D.snapshot()).ops.length)throw new Error('请先完成同步后修正历史');const r=await send({action:'records',year,offset:recordOffset});events=r.events;next=r.next;await D.remember(events);}
  else {events=(await D.snapshot()).events.filter(e=>!e.deleted&&C.eventYear(e)===year).sort((a,b)=>b.start_at.localeCompare(a.start_at));if(more)events=[];notify('离线列表仅包含本机缓存');}
  for(const event of events){const card=el('div',undefined,'record');card.append(el('strong',event.event_name+' · '+C.duration(event.duration_seconds)),el('p',new Date(event.start_at).toLocaleString('zh-CN',{timeZone:event.timezone})+' → '+new Date(event.end_at).toLocaleString('zh-CN',{timeZone:event.timezone}), 'subtle'));if(event.note)card.append(el('p',event.note,'subtle'));
    const row=el('div',undefined,'row');for(const [text,fn]of [['修改',()=>openEditor(event)],['拆分',()=>openSplitter(event)],['删除',()=>{if(confirm('删除这条记录？统计将同步扣除。Drive 原始表保留删除标记。'))act({type:'delete',year:C.eventYear(event),event_id:event.event_id});}]]){const b=el('button',text,'quiet');b.onclick=fn;row.append(b);}card.append(row);$('records').append(card);}
  if(!events.length&&!more)$('records').append(el('p','该归档没有记录，或本机尚未缓存。','subtle'));recordOffset=next;$('more-records').hidden=next===null;
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
  try{for(let i=0;i<verified.events.length;i+=5){await act({type:'import',events:verified.events.slice(i,i+5)});await sync();if((await D.snapshot()).ops.length)throw new Error('导入暂停，未确认批次已保留。恢复网络后同步，再重试导入（UUID 去重）。');$('restore-report').textContent=`已确认 ${Math.min(i+5,verified.events.length)} / ${verified.events.length}`;}notify('记录恢复完成，统计已重算');}finally{$('restore').disabled=false;}
}
async function init(){
  await D.open();settings=await D.get('cache','settings')||{};await repaint();$('backend-url').value=settings.backendUrl||'';$('client-id').value=settings.clientId||'';$('record-year').value=C.dateKey(Date.now(),snap.local.config.timezone).slice(0,4);selectors();renderConfig();await renderStats();
  if(!configured())$('settings').hidden=false;googleLogin();
  if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(err=>notify('离线页面缓存未就绪：'+err.message));
  if(navigator.storage?.estimate){const estimate=await navigator.storage.estimate();$('storage-info').textContent=`本机已用约 ${Math.ceil((estimate.usage||0)/1024/1024)} MB。浏览器持久存储：${await navigator.storage.persisted()?'已获准':'未获准'}`;}
  setInterval(tick,1000);setInterval(()=>renderStats(),60000);
}
$('stop').onclick=()=>act({type:'stop',at:new Date().toISOString()});
$('settings-toggle').onclick=()=>{$('settings').hidden=!$('settings').hidden;if(!$('settings').hidden){renderConfig();googleLogin();$('settings').scrollIntoView({behavior:'smooth'});}};
$('save-settings').onclick=async()=>{try{const proposed={backendUrl:$('backend-url').value.trim(),clientId:$('client-id').value.trim()},old=settings;settings=proposed;if(!configured()){settings=old;throw new Error('网址必须以 /exec 结尾，Client ID 必须是 Google 网页应用 ID');}await D.cache('settings',settings);T.credential('');googleLogin();notify('连接已保存，请登录');}catch(err){failed(err);}};
$('sync').onclick=()=>T.ready()?sync().catch(failed):notify('请先使用 Google 按钮登录');
$('persist').onclick=async()=>{try{notify(navigator.storage?.persist&&await navigator.storage.persist()?'浏览器已允许持久存储':'浏览器尚未允许；经常使用并安装 App 后可再试');}catch(err){failed(err);}};
$('export-local').onclick=()=>exportLocal().catch(failed);$('export-conflict').onclick=$('export-local').onclick;
$('use-cloud').onclick=async()=>{if(!confirm('采用云端状态并将本机未同步记录保存为冲突副本？建议先导出。'))return;try{await D.useCloud();await repaint();renderConfig();renderStats(true);announce();notify('已采用云端状态；冲突副本可从本地导出文件找回');}catch(err){failed(err);}};
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{view=b.dataset.tab;historyValue='';document.querySelectorAll('[data-tab]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));selectors();renderStats();});
$('load-records').onclick=()=>loadRecords().catch(failed);$('more-records').onclick=()=>loadRecords(true).catch(failed);
$('cancel-edit').onclick=()=>$('editor').close();$('cancel-split').onclick=()=>$('splitter').close();
$('edit-form').onsubmit=async e=>{e.preventDefault();try{const patch={start_at:inputInstant($('edit-start').value,editEvent.timezone),end_at:inputInstant($('edit-end').value,editEvent.timezone),event_name:$('edit-name').value,category:$('edit-category').value,note:$('edit-note').value};await act({type:'edit',year:C.eventYear(editEvent),event_id:editEvent.event_id,patch});$('editor').close();}catch(err){failed(err);}};
$('split-form').onsubmit=async e=>{e.preventDefault();try{await act({type:'split',year:C.eventYear(splitEvent),event_id:splitEvent.event_id,at:inputInstant($('split-at').value,splitEvent.timezone),event_key:$('split-key').value,new_event_id:crypto.randomUUID()});$('splitter').close();}catch(err){failed(err);}};
$('add-event').onclick=()=>{draftConfig.events.push({id:'custom_'+crypto.randomUUID(),name:'新活动',category:'其他'});paintConfig();};
$('save-config').onclick=async()=>{try{draftConfig.timezone=$('timezone').value.trim();C.validateConfig(draftConfig);await act({type:'config',config:C.clone(draftConfig)});selectors();notify('配置已保存到本机，等待同步');}catch(err){failed(err);}};
$('verify-backup').onclick=()=>verifyBackup().catch(err=>{$('restore-report').textContent=err.message;failed(err);});$('restore').onclick=()=>restore().catch(failed);
$('restore-config').onclick=()=>verified&&act({type:'config',config:verified.metadata.config});
$('restore-local').onclick=async()=>{try{const file=$('local-restore-file').files[0];if(!file)throw new Error('请选择本地恢复副本');const backup=JSON.parse(await file.text());if(!confirm('恢复这个副本中的原始队列、当前活动和本机记录？原 UUID 保留，连接设置保持当前值。'))return;await D.restoreLocal(backup);await repaint();renderConfig();selectors();renderStats();announce();notify('本地副本已恢复，请登录同步');scheduleSync(300);}catch(err){failed(err);}};
$('restore-current').onclick=()=>{if(verified?.metadata.current&&confirm('从现在重新开始这个活动？备份时刻到现在的空缺不会自动记为持续活动。')){const c=verified.metadata.current;if(!snap.local.config.events.some(e=>e.id===c.event_key))return notify('请先恢复配置');act({type:'switch',event_key:c.event_key,event_id:crypto.randomUUID(),at:new Date().toISOString()});}};
addEventListener('online',()=>{googleLogin();scheduleSync(200);renderStats();});addEventListener('offline',paintStatus);document.addEventListener('visibilitychange',()=>{if(!document.hidden){repaint().then(()=>renderStats()).catch(failed);scheduleSync(200);}});
addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;$('install').hidden=false;});$('install').onclick=async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;$('install').hidden=true;}};
init().catch(err=>{$('status').textContent='无法打开本地存储，未开始记录：'+err.message;document.querySelectorAll('#quick button,#stop').forEach(b=>b.disabled=true);});
