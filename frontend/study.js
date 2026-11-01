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
    if(!['unverified','understood','independent','nextday','weekly'].includes(r.stage))throw new Error('请选择验收阶段');
    if(typeof r.ids!=='string'||r.ids.length>300||typeof r.next!=='string'||r.next.length>300)throw new Error('题号和下一步最多 300 字');
    if(['independent','nextday','weekly'].includes(r.stage)&&(!r.ids.trim()||!r.correct))throw new Error('通过验收需填写具体题号和独立正确题数');
  }
  function validateBackup(b){if(b?.version!==1||b.kind!=='study-backup'||!Array.isArray(b.sessions)||b.sessions.length>100000)throw new Error('学习备份格式无效');for(const k of subjects)validateTask(b.settings?.tasks?.[k]);const keys=new Set();for(const entry of b.sessions){const e=TimeCore.validateEvent(entry.event);validateTask(entry.task);if(entry.result)validateResult(entry.result);if(entry.key!=='study-session:'+e.end_at+':'+e.event_id||keys.has(entry.key))throw new Error('学习局标识无效或重复');keys.add(entry.key);}return b;}
  root.TimeStudy={validateBackup,defaults,subjects,validateTask,capture,validateResult};
})(globalThis);
