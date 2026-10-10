/* Shared deterministic domain logic. Build copies this file to Apps Script. */
(function (root) {
  'use strict';
  const VERSION = 1, DAY = 86400000, MAX_SPAN = 366 * DAY;
  const HEADERS = ['event_id','start_at','end_at','duration_seconds','event_name','category','note','timezone','source','created_at','updated_at','schema_version','event_key','revision','deleted','text_originals_json'];
  const SUMMARY_HEADERS = ['date','total_seconds','study_seconds','math_seconds','408_seconds','english_seconds','cs50p_seconds','fitness_seconds','commute_seconds','entertainment_seconds','fragmented_seconds','by_event_json','by_category_json','schema_version'];
  const fixed = {math:'math_seconds',cs408:'408_seconds',english:'english_seconds',cs50p:'cs50p_seconds',fitness:'fitness_seconds',commute:'commute_seconds',entertainment:'entertainment_seconds',fragmented:'fragmented_seconds'};
  const DEFAULT_CONFIG = {schema_version:1,timezone:'Asia/Shanghai',events:[
    {id:'math',name:'数学二',category:'学习'},{id:'cs408',name:'408',category:'学习'},
    {id:'english',name:'英语',category:'学习'},{id:'cs50p',name:'CS50P',category:'学习'},
    {id:'fitness',name:'健身',category:'健身'},{id:'commute',name:'通勤',category:'通勤'},
    {id:'entertainment',name:'娱乐',category:'娱乐'},{id:'fragmented',name:'碎片时间',category:'碎片时间'},
    {id:'meal',name:'吃饭',category:'生活'},{id:'sleep',name:'睡眠',category:'睡眠'},
    {id:'wash',name:'洗漱',category:'生活'},{id:'other',name:'其他',category:'其他'}]};
  function assert(ok, msg) { if (!ok) throw new Error(msg); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function uuid(v) { return typeof v==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v); }
  function time(v) { const n = Date.parse(v); assert(typeof v==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(n), '时间必须是带时区及秒的 ISO 8601');const calendar=new Date(v.slice(0,10)+'T00:00:00Z');assert(calendar.toISOString().slice(0,10)===v.slice(0,10)&&Number(v.slice(11,13))<24&&Number(v.slice(14,16))<60&&Number(v.slice(17,19))<60,'日期或时间无效'); return n; }
  function iso(v) { return new Date(typeof v === 'number' ? v : time(v)).toISOString(); }
  const fmts = new Map(), midnights = new Map();
  function parts(ms, tz) {
    if (!fmts.has(tz)) fmts.set(tz,new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}));
    const out={}; for (const p of fmts.get(tz).formatToParts(new Date(ms))) if(p.type!=='literal') out[p.type]=Number(p.value);
    return out;
  }
  function dateKey(ms,tz) { const p=parts(ms,tz); return `${String(p.year).padStart(4,'0')}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`; }
  function shiftDate(date,days) { assert(/^\d{4}-\d{2}-\d{2}$/.test(date),'日期格式错误'); const d=new Date(date+'T00:00:00Z'); assert(d.toISOString().slice(0,10)===date,'日期无效'); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); }
  // Locate first instant of a local calendar date. Binary search handles 23/25h DST days.
  function midnight(date,tz) {
    const key=tz+':'+date;if(midnights.has(key))return midnights.get(key);
    const utc=Date.parse(date+'T00:00:00Z'); assert(Number.isFinite(utc),'日期无效');
    let lo=utc-2*DAY,hi=utc+2*DAY;
    while(lo<hi) { const mid=Math.floor((lo+hi)/2); if(dateKey(mid,tz)<date)lo=mid+1;else hi=mid; }
    assert(dateKey(lo,tz)===date,'该时区不存在这个日期');midnights.set(key,lo);return lo;
  }
  function validateConfig(config) {
    assert(config && config.schema_version===VERSION,'不支持的配置版本'); parts(Date.now(),config.timezone);
    assert(Array.isArray(config.events)&&config.events.length>0&&config.events.length<=80,'快捷事件需要 1～80 个');
    const ids=new Set(); for(const e of config.events) { assert(/^[a-zA-Z0-9_-]{1,64}$/.test(e.id)&&!['__proto__','constructor','prototype'].includes(e.id)&&!ids.has(e.id),'事件 ID 无效或重复'); ids.add(e.id); assert(typeof e.name==='string'&&e.name.trim().length>0&&e.name.length<=80,'名称长度为 1～80'); assert(typeof e.category==='string'&&e.category.trim().length>0&&e.category.length<=80&&!['__proto__','constructor','prototype'].includes(e.category),'分类无效'); }
    return clone(config);
  }
  function validateEvent(event) {
    const e=clone(event); assert(uuid(e.event_id),'event_id 必须是 UUID');
    const a=time(e.start_at), b=time(e.end_at); assert(b>=a && b-a<=MAX_SPAN,'结束不能早于开始，单条事件最多 366 天');
    e.start_at=iso(a);e.end_at=iso(b);e.duration_seconds=Math.floor((b-a)/1000);
    assert(e.schema_version===VERSION,'不支持的记录版本'); parts(a,e.timezone);
    assert(typeof e.event_name==='string'&&e.event_name.trim()&&e.event_name.length<=80,'事件名称无效');
    assert(typeof e.category==='string'&&e.category.trim()&&e.category.length<=80&&!['__proto__','constructor','prototype'].includes(e.category),'分类无效');
    assert(typeof e.event_key==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(e.event_key)&&!['__proto__','constructor','prototype'].includes(e.event_key),'event_key 无效');
    assert(typeof e.note==='string'&&e.note.length<=2000,'备注最多 2000 字');
    assert(['mobile_pwa','manual','chatgpt','import'].includes(e.source),'来源无效');
    e.created_at=iso(e.created_at);e.updated_at=iso(e.updated_at);e.deleted=!!e.deleted;
    const originals={};for(const h of ['event_name','category','note'])if(/^[=+\-@\t\r']/.test(e[h]))originals[h]=e[h];e.text_originals_json=JSON.stringify(originals);
    return e;
  }
  function eventYear(e) { return dateKey(time(e.start_at),e.timezone).slice(0,4); }
  function splitDays(e) {
    if(e.deleted)return [];
    const start=time(e.start_at),end=time(e.end_at);const out=[];let cursor=start;
    while(cursor<end) {
      const date=dateKey(cursor,e.timezone),boundary=midnight(shiftDate(date,1),e.timezone),stop=Math.min(end,boundary);
      assert(stop>cursor,'时区分割失败');
      const seconds=Math.floor((stop-start)/1000)-Math.floor((cursor-start)/1000);
      out.push({date,seconds,event_key:e.event_key,event_name:e.event_name,category:e.category});cursor=stop;
    } return out;
  }
  function emptySummary(date) { return {date,total_seconds:0,study_seconds:0,by_event:{},by_category:{},schema_version:VERSION}; }
  function addSegment(s,p,sign=1) {
    s.total_seconds+=p.seconds*sign; if(p.category==='学习')s.study_seconds+=p.seconds*sign;
    if(!Object.prototype.hasOwnProperty.call(s.by_event,p.event_key))s.by_event[p.event_key]={name:p.event_name,seconds:0};
    s.by_event[p.event_key].seconds+=p.seconds*sign;
    s.by_category[p.category]=(Object.prototype.hasOwnProperty.call(s.by_category,p.category)?s.by_category[p.category]:0)+p.seconds*sign;
    return s;
  }
  function addSummary(target,s,sign=1) {
    target.total_seconds+=s.total_seconds*sign;target.study_seconds+=s.study_seconds*sign;
    for(const [id,v] of Object.entries(s.by_event)) { if(!Object.prototype.hasOwnProperty.call(target.by_event,id))target.by_event[id]={name:v.name,seconds:0};target.by_event[id].seconds+=v.seconds*sign; }
    for(const [id,v] of Object.entries(s.by_category)) target.by_category[id]=(Object.prototype.hasOwnProperty.call(target.by_category,id)?target.by_category[id]:0)+v*sign;
    return target;
  }
  function cleanSummary(s) {
    assert(Number.isSafeInteger(s.total_seconds)&&s.total_seconds>=0&&s.study_seconds>=0,'汇总校验失败，请重建受影响年度');
    for(const [k,v] of Object.entries(s.by_event)){assert(v.seconds>=0,'科目汇总出现负数');if(v.seconds===0)delete s.by_event[k];}
    for(const [k,v] of Object.entries(s.by_category)){assert(v>=0,'分类汇总出现负数');if(v===0)delete s.by_category[k];}return s;
  }
  function summaryRow(s) { return SUMMARY_HEADERS.map(h=>h==='by_event_json'?JSON.stringify(s.by_event):h==='by_category_json'?JSON.stringify(s.by_category):h in s?s[h]:Object.entries(fixed).find(([,v])=>v===h)?(s.by_event[Object.entries(fixed).find(([,v])=>v===h)[0]]||{seconds:0}).seconds:0); }
  function summaryFromRow(row) {const o=Object.fromEntries(SUMMARY_HEADERS.map((h,i)=>[h,row[i]]));return {date:String(o.date),total_seconds:Number(o.total_seconds),study_seconds:Number(o.study_seconds),by_event:JSON.parse(o.by_event_json||'{}'),by_category:JSON.parse(o.by_category_json||'{}'),schema_version:Number(o.schema_version)};}
  function buildCurrent(op,config) {
    const def=config.events.find(e=>e.id===op.event_key);assert(def,'快捷事件不存在');assert(uuid(op.event_id),'活动 UUID 无效');
    return {event_id:op.event_id,start_at:iso(op.at),end_at:null,duration_seconds:0,event_name:def.name,category:def.category,note:'',timezone:config.timezone,source:'mobile_pwa',created_at:iso(op.at),updated_at:iso(op.at),schema_version:VERSION,event_key:def.id,revision:0,deleted:false};
  }
  function closeCurrent(current,at) { return validateEvent({...current,end_at:iso(at),updated_at:iso(at)}); }
  // Durable plan contains absolute post-images: replaying it cannot double-count.
  function planOperation(op,state,repo,now) {
    assert(uuid(op.op_id)&&uuid(op.device_id),'操作 UUID 无效'); time(op.queued_at);
    assert(op.base_revision===state.revision,'CONFLICT');
    const next=clone(state);next.revision++;next.last_operation_id=op.op_id;
    const changes=[];
    if(op.type==='switch'||op.type==='stop') {
      time(op.at);assert(time(op.at)<=now+5*60000,'手机时钟超前，请校准');
      if(state.current) { const event=closeCurrent(state.current,op.at);event.revision=next.revision;changes.push({before:null,after:event}); }
      if(op.type==='switch') {next.current=buildCurrent(op,state.config);assert((!state.current||state.current.event_id!==op.event_id)&&!repo.getEvent(eventYear(next.current),op.event_id),'活动 UUID 已存在');}
      else next.current=null;
    } else if(op.type==='config') next.config=validateConfig(op.config);
    else if(op.type==='edit'||op.type==='delete'||op.type==='split') {
      assert(/^\d{4}$/.test(op.year)&&uuid(op.event_id),'记录索引无效');
      const before=repo.getEvent(op.year,op.event_id);assert(before&&!before.deleted&&eventYear(before)===op.year,'记录不存在或已迁移，请刷新列表');
      if(op.type==='delete')changes.push({before,after:{...before,deleted:true,updated_at:iso(now),revision:next.revision}});
      else if(op.type==='edit') {
        const after=validateEvent({...before,...op.patch,event_id:before.event_id,created_at:before.created_at,updated_at:iso(now),revision:next.revision,deleted:false});
        changes.push({before,after});
      } else {
        const pivot=time(op.at);assert(pivot>time(before.start_at)&&pivot<time(before.end_at),'拆分时间必须在记录内部');
        const def=state.config.events.find(e=>e.id===op.event_key);assert(def&&uuid(op.new_event_id),'拆分事件无效');
        assert(!repo.getEvent(eventYear(before),op.new_event_id),'新 UUID 已存在');
        changes.push({before,after:validateEvent({...before,end_at:iso(pivot),updated_at:iso(now),revision:next.revision})});
        changes.push({before:null,after:validateEvent({...before,event_id:op.new_event_id,start_at:iso(pivot),event_key:def.id,event_name:def.name,category:def.category,created_at:iso(now),updated_at:iso(now),revision:next.revision})});
      }
    } else if(op.type==='import') {
      assert(Array.isArray(op.events)&&op.events.length>0&&op.events.length<=24,'每批导入 1～24 条');
      const ids=new Set();
      for(const raw of op.events) { const after=validateEvent(raw);assert(!ids.has(after.event_id)&&(!state.current||state.current.event_id!==after.event_id),'导入批次 UUID 重复或与当前活动冲突');ids.add(after.event_id);assert(!after.deleted,'不能导入墓碑');assert(after.duration_seconds===raw.duration_seconds,'备份秒数与起止时间不符');
        const before=repo.getEvent(eventYear(after),after.event_id);if(before&&!before.deleted){const fields=HEADERS.filter(h=>!['revision','deleted'].includes(h));assert(JSON.stringify(fields.map(h=>before[h]))===JSON.stringify(fields.map(h=>after[h])),'已有 UUID 内容不同，禁止覆盖');continue;}after.revision=next.revision;changes.push({before,after}); }
    } else throw new Error('不支持的操作');
    const days={},years={},writes=[];
    for(const {before,after} of changes) {
      if(before && eventYear(before)!==eventYear(after))writes.push({year:eventYear(before),event:{...before,deleted:true,updated_at:iso(now),revision:next.revision}});
      writes.push({year:eventYear(after),event:after});
      for(const [e,sign] of [[before,-1],[after,1]])if(e)for(const seg of splitDays(e)) {
        if(!days[seg.date])days[seg.date]=clone(repo.getDay(seg.date)||emptySummary(seg.date));
        addSegment(days[seg.date],seg,sign);
      }
    }
    for(const [date,s] of Object.entries(days)) {
      cleanSummary(s);const year=date.slice(0,4);if(!years[year])years[year]=clone(repo.getAnnual(year)||emptySummary(year));
      addSummary(years[year],repo.getDay(date)||emptySummary(date),-1);addSummary(years[year],s);cleanSummary(years[year]);
    }
    return {op_id:op.op_id,queued_at:op.queued_at,state:next,writes,days:Object.values(days),years:Object.values(years)};
  }
  function range(mode,value,tz,now=Date.now()) {
    const today=dateKey(now,tz);let a,b;
    if(mode==='all')return {from:'0001-01-01',to:'9999-12-31'};
    if(mode==='day'){a=value||today;b=shiftDate(a,1);}
    else if(mode==='week'){a=value||today;const d=new Date(a+'T12:00:00Z');a=shiftDate(a,-((d.getUTCDay()+6)%7));b=shiftDate(a,7);}
    else if(mode==='month'){a=(value||today.slice(0,7))+'-01';shiftDate(a,0);const d=new Date(a+'T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);b=d.toISOString().slice(0,10);}
    else if(mode==='year'){assert(/^\d{4}$/.test(value||today.slice(0,4)),'年份无效');a=(value||today.slice(0,4))+'-01-01';b=String(Number(a.slice(0,4))+1).padStart(4,'0')+'-01-01';}
    else throw new Error('查询模式无效');return {from:a,to:b};
  }
  function duration(s){s=Math.max(0,Math.floor(s));return `${Math.floor(s/3600)}h ${Math.floor(s%3600/60)}m`;}
  function canonical(x) { if(Array.isArray(x))return '['+x.map(canonical).join(',')+']';if(x&&typeof x==='object')return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';return JSON.stringify(x); }
  const api={VERSION,DAY,MAX_SPAN,HEADERS,SUMMARY_HEADERS,DEFAULT_CONFIG,assert,clone,uuid,time,iso,parts,dateKey,shiftDate,midnight,validateConfig,validateEvent,eventYear,splitDays,emptySummary,addSegment,addSummary,cleanSummary,summaryRow,summaryFromRow,buildCurrent,closeCurrent,planOperation,range,duration,canonical};
  root.TimeCore=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
