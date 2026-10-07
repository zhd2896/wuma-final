export function growth() {
 const dates=Array.from({length:14},(_,i)=>new Date(Date.UTC(2026,8,24+i)).toISOString().slice(0,10));
 return {version:'growth_v1',asOf:'2026-10-07',goal:2,minimumSamples:3,
  themes:[{theme:'CAPTURE',label:'吃子',attempts:3,correct:3,accuracy:100,completedThisWeek:2,remaining:0,recommendedDifficulty:'NORMAL'},
   {theme:'VULNERABILITY',label:'防守',attempts:3,correct:1,accuracy:33,completedThisWeek:0,remaining:2,recommendedDifficulty:'EASY'},
   {theme:'LONE_PIECE_RISK',label:'孤棋',attempts:0,correct:0,accuracy:null,completedThisWeek:0,remaining:2,recommendedDifficulty:'EASY'}],
  recent:{current:{start:'2026-10-01',end:'2026-10-07',completed:2,attempted:3,firstAttempts:3,firstCorrect:2,accuracy:67},
   previous:{start:'2026-09-24',end:'2026-09-30',completed:1,attempted:3,firstAttempts:3,firstCorrect:1,accuracy:33}},
  daily:dates.map((date,i)=>({date,completed:i===0?1:i===13?2:0,attempted:i===0?3:i===13?3:0}))};
}
