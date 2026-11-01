/* Study evidence is local metadata; TimeLog remains the only time ledger. */
(function(root){
  const subjects=['math','cs408','english','cs50p'];
  function defaults(){return {tasks:{math:{title:'数学二 · 当前章节',goal:'不看答案独立尝试 3 道当前进度习题，标出卡住的步骤',minutes:40},cs408:{title:'408 · 当前章节',goal:'闭卷回忆一个核心概念，再独立尝试 3 道配套题',minutes:40},english:{title:'英语 · 每日保持',goal:'主动回忆 10 个旧词，并精读或独立完成一小段材料',minutes:25},cs50p:{title:'CS50P · 辅助练习',goal:'独立完成当前练习的一个可运行步骤，不挤占数学和 408',minutes:25}},active:null};}
  function validateTask(t){if(!t||typeof t.title!=='string'||!t.title.trim()||t.title.length>80||typeof t.goal!=='string'||!t.goal.trim()||t.goal.length>300||![8,15,25,40,60].includes(t.minutes))throw new Error('请填写任务、完成标准和有效时长');return t;}
  function capture(s,plan,spec){
    const settings=s.study,old=s.local.current,active=settings.active;
    if(old&&subjects.includes(old.event_key)){
      const event=plan.writes.find(w=>w.event.event_id===old.event_id)?.event;
      if(event){const task=active?.event_id===old.event_id?active.task:settings.tasks[old.event_key]||defaults().tasks[old.event_key];
        s.m.put({event,task,interrupted:!!spec.studyTask?.rescue,result:null},'study-session:'+event.end_at+':'+event.event_id);}
    }
    const cur=plan.state.current;
    if(cur&&subjects.includes(cur.event_key)){
      const task=spec.studyTask||settings.tasks[cur.event_key]||defaults().tasks[cur.event_key];validateTask(task);settings.active={event_id:cur.event_id,task:JSON.parse(JSON.stringify(task))};
    }else settings.active=null;
    s.m.put(settings,'study-settings');
  }
  function validateResult(r){
    if(!r||!Number.isInteger(r.attempted)||!Number.isInteger(r.correct)||r.attempted<0||r.attempted>100||r.correct<0||r.correct>r.attempted)throw new Error('独立正确题数应在 0 到尝试题数之间');
    if(r&&r.completed!==undefined&&typeof r.completed!=='boolean')throw new Error('任务完成状态无效');
    if(!['unverified','understood','independent','nextday','weekly'].includes(r.stage))throw new Error('请选择验收阶段');
    if(typeof r.ids!=='string'||r.ids.length>300||typeof r.next!=='string'||r.next.length>300)throw new Error('题号和下一步最多 300 字');
    if(['independent','nextday','weekly'].includes(r.stage)&&(!r.ids.trim()||!r.correct))throw new Error('通过验收需填写具体题号和独立正确题数');
  }
  function validateBackup(b){if(b?.version!==1||b.kind!=='study-backup'||!Array.isArray(b.sessions)||b.sessions.length>100000)throw new Error('学习备份格式无效');for(const k of subjects)validateTask(b.settings?.tasks?.[k]);const keys=new Set();for(const entry of b.sessions){const e=TimeCore.validateEvent(entry.event);validateTask(entry.task);if(entry.result)validateResult(entry.result);if(entry.key!=='study-session:'+e.end_at+':'+e.event_id||keys.has(entry.key))throw new Error('学习局标识无效或重复');keys.add(entry.key);}return b;}
  function challenge(key){
    return ({math:'从当前章节选 1 道没做过的变式题，先不看答案独立尝试，再写一句：它与刚才的题有什么不同。',cs408:'改变刚才题目的 1 个条件，先预测结果，再用推导、例子或反例验证，并解释为什么。',english:'从今天材料选 1 个句子，遮住原文复述含义，再用其中一个表达写自己的句子。',cs50p:'给当前代码补 1 个边界测试，先预测输出，再运行检查。'})[key]||'选一个刚学过的知识点，用一个新例子检验自己的理解。';
  }
  // Bounded recent-session evidence only; time alone never completes a mission.
  function missionBoard(settings,sessions,now,timezone='Asia/Shanghai'){
    const day=ms=>new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));
    const today=day(now),ordered=[...sessions].sort((a,b)=>Date.parse(b.event.end_at)-Date.parse(a.event.end_at));
    const done=key=>ordered.some(s=>s.event.event_key===key&&day(s.event.end_at)===today&&s.result?.completed===true);
    const key=['math','cs408','english'].find(k=>!done(k))||'math';
    const previous=ordered.find(s=>s.event.event_key===key&&s.result?.next?.trim());
    const base=settings.tasks[key]||defaults().tasks[key];
    const task={...base,goal:previous?previous.result.next:base.goal};
    const review=ordered.find(s=>['math','cs408'].includes(s.event.event_key)&&s.result?.stage==='independent'&&day(s.event.end_at)!==today&&!ordered.some(n=>n.event.event_key===s.event.event_key&&['nextday','weekly'].includes(n.result?.stage)&&n.result.ids.trim()===s.result.ids.trim()&&Date.parse(n.event.start_at)>Date.parse(s.event.end_at)));
    return {key,task,continued:!!previous,done:['math','cs408','english'].filter(done),mainDone:done('math')&&done('cs408'),review};
  }
  root.TimeStudy={challenge,missionBoard,validateBackup,defaults,subjects,validateTask,capture,validateResult};
})(globalThis);
