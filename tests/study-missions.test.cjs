const test=require('node:test'),assert=require('node:assert/strict');
require('../frontend/study.js');const S=globalThis.TimeStudy,now=Date.parse('2026-11-01T10:00:00Z');
const entry=(key,result,end='2026-11-01T09:00:00Z')=>({event:{event_key:key,start_at:'2026-10-31T08:00:00Z',end_at:end},result,task:{title:key}});
test('mission starts with math and carries next concrete action',()=>{const b=S.missionBoard(S.defaults(),[entry('math',{next:'完成第4题'})],now);assert.equal(b.key,'math');assert.equal(b.task.goal,'完成第4题');});
test('time and correctness alone cannot complete daily mission',()=>{assert.equal(S.missionBoard(S.defaults(),[entry('math',{correct:10,stage:'independent',ids:'1'})],now).key,'math');});
test('main priorities and explicit daily completion produce a stopping point',()=>{const b=S.missionBoard(S.defaults(),[entry('math',{completed:true}),entry('cs408',{completed:true})],now);assert.equal(b.mainDone,true);assert.equal(b.key,'english');});
test('yesterday completion never clears today mission',()=>{assert.equal(S.missionBoard(S.defaults(),[entry('math',{completed:true},'2026-10-31T09:00:00Z')],now).key,'math');});
test('review requires older independent evidence and later matching proof clears it',()=>{const old=entry('math',{stage:'independent',ids:'book 3'},'2026-10-30T09:00:00Z');assert.ok(S.missionBoard(S.defaults(),[old],now).review);const reviewed=entry('math',{stage:'nextday',ids:'book 3'});assert.equal(S.missionBoard(S.defaults(),[reviewed,old],now).review,undefined);});

test('optional challenges offer subject-specific transfer without time or queue mutation',()=>{assert.match(S.challenge('math'),/变式题/);assert.match(S.challenge('cs408'),/预测结果/);assert.match(S.challenge('english'),/遮住原文/);const settings=S.defaults(),before=JSON.stringify(settings);S.challenge('math');assert.equal(JSON.stringify(settings),before);});
