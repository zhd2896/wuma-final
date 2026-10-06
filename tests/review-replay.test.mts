import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { createInitialGameState, executeTurn } from '../miniprogram/domain/index.ts';
registerHooks({ resolve(s,c,n) { try { return n(s,c); } catch(e) {
  if(s.startsWith('.') && c.parentURL && (e as any).code === 'ERR_MODULE_NOT_FOUND') {
    const u=new URL(`${s}.ts`,c.parentURL); if(existsSync(u)) return n(u.href,c);
  } throw e;
} } });

const initial = createInitialGameState();
const turns = [executeTurn(initial, {from:'P01',to:'P02'})];
turns.push(executeTurn(turns[0].state, {from:'P05',to:'P04'}));
const terminal = {...turns[1].state, game_status:'FINISHED',winner:'B',winner_reason:'RESIGN'};
function fixture(mode='LOCAL', ai='B', zero=false) {
  const before = zero ? initial : turns[1].state;
  const final = zero ? {...initial,game_status:'FINISHED',winner:'B',winner_reason:'RESIGN'} : terminal;
  const game = {game_id:'g1',mode,version:zero?1:3,ply_count:zero?0:2,state:final,
    human_player:mode==='AI'?(ai==='A'?'B':'A'):null,ai_player:mode==='AI'?ai:null,ai_level:mode==='AI'?'STANDARD':null};
  const replay = {game_id:'g1',version:game.version,ply_count:game.ply_count,initial_state:initial,
    steps:[...(zero?[]:turns.map((turn,i)=>({kind:'MOVE',ply:i+1,version:i+1,game_move_id:i+1,
      player:turn.before_state.current_player,move:turn.move,capture:turn.capture,state:turn.state}))),
      {kind:'RESIGN',ply:zero?0:2,version:game.version,game_move_id:null,player:before.current_player,move:null,capture:null,state:final}]};
  const review = (p:string) => ({id:`r-${p}`,gameId:'g1',reviewedPlayer:p,winner:'B',winnerReason:'RESIGN',
    goodMoves:p==='A'?1:0,normalMoves:0,mistakes:p==='B'?1:0,blunders:0,bestMoveRate:p==='A'?1:0,turningPoints:[],
    moveReviews: zero?[]:turns.map((t,i)=>({turn:i+1,gameMoveId:i+1,player:t.before_state.current_player,
      actualMove:t.move,bestMove:t.move,stateBefore:t.before_state,category:t.before_state.current_player==='A'?'GOOD':'MISTAKE',
      scoreLoss:0,engineExplanation:`engine ${t.before_state.current_player}`}))});
  return {game,replay,review};
}
async function harness(config:{mode?:string;ai?:string;seat?:string;zero?:boolean;handle?:(o:any,u:URL,answer:(data:any)=>void)=>boolean}={}) {
  const f=fixture(config.mode,config.ai,config.zero); const requests:any[]=[]; const routes:string[]=[]; let definition:any;
  (globalThis as any).Page=(v:any)=>{definition=v;};
  (globalThis as any).wx={getAccountInfoSync:()=>({miniProgram:{envVersion:'develop'}}),
    getStorageSync:(k:string)=>k.startsWith('wuma:wechat-session:')?{token:'a'.repeat(64),expiresAt:'2099-01-01T00:00:00Z'}:k.startsWith('wuma:online:seat:')?'seat-token':'',
    setStorageSync(){},removeStorageSync(){},navigateTo:({url}:any)=>routes.push(url),pageScrollTo(){},
    request(o:any) { const u=new URL(o.url); requests.push({o,u}); const answer=(data:any)=>o.success({statusCode:200,data:{code:0,data}});
      if(config.handle?.(o,u,answer)) return;
      if(u.pathname.endsWith('/replay')) return answer(f.replay);
      if(u.pathname.endsWith('/explain')) {const p=o.data?.reviewed_player||u.searchParams.get('reviewed_player')||'A'; return answer({review:f.review(p),explanation:{gameReviewId:`r-${p}`,gameExplanation:{overall_summary:`summary ${p}`},moveExplanations:[]}});}
      if(u.pathname.endsWith('/training')) return answer({items:[],total:0});
      if(u.pathname.endsWith('/review')) return answer(f.review(config.mode==='REMOTE'?config.seat||'A':u.searchParams.get('reviewed_player')||o.data?.reviewed_player||f.game.human_player||'A'));
      if(config.mode==='REMOTE') return answer({game_id:'g1',seat:config.seat||'A',account_bound:true,version:f.game.version,ply_count:f.game.ply_count,
        state:f.game.state,room_status:'FINISHED',pending_undo:null,token:null});
      return answer(f.game);
    }};
  await import(`../miniprogram/pages/review/review.ts?replay-${Math.random()}`);
  const page={...definition,data:structuredClone(definition.data),writes:0,setData(p:any){this.writes++;Object.assign(this.data,p);}};
  return {page,requests,routes,f};
}
const settle=async()=>{for(let i=0;i<8;i++) await new Promise(r=>setImmediate(r));};

test('real review page replays saved after states and distinct before-route, native navigation and terminal count',async()=>{
  const {page,f}=await harness(); await page.load('g1');
  assert.equal(page.data.state,'success'); assert.equal(page.data.canSelectPerspective,true);
  assert.equal(page.data.replayIndex,0); assert.equal(page.data.replayBoard.pieces.find((p:any)=>p.nodeId==='P01').side,'black');
  page.nextReplay(); assert.equal(page.data.replayIndex,1); assert.equal(page.data.replayPly,1);
  assert.ok(page.data.replayBoard.pieces.some((p:any)=>p.nodeId==='P02'&&p.state==='lastMove'));
  assert.ok(!page.data.replayBoard.pieces.some((p:any)=>p.nodeId==='P01'));
  assert.equal(page.data.replayCurrentPlayer,'B'); assert.equal(page.data.replayReserveA,turns[0].state.players.A.reserve_count);
  page.selectReviewMove({currentTarget:{dataset:{turn:1,kind:'actual'}}});
  assert.equal(page.data.boardMode,'route'); assert.ok(page.data.reviewBoard.pieces.some((p:any)=>p.nodeId==='P01'));
  page.showReplay(); assert.equal(page.data.boardMode,'replay'); assert.equal(page.data.replayIndex,1);
  page.nextReplay(); assert.match(page.data.replayExplanation,/对手走法.*没有本人评价/);
  page.endReplay(); assert.equal(page.data.replayIndex,3); assert.equal(page.data.replayPly,2); assert.match(page.data.replayStepText,/认输/);
  page.previousReplay(); assert.equal(page.data.replayIndex,2);
  page.startReplay(); assert.equal(page.data.replayIndex,0);
  page.jumpReplay({detail:{value:1}}); assert.equal(page.data.replayIndex,1);
  page.jumpReplay({detail:{value:999}}); assert.equal(page.data.replayIndex,3);
  assert.deepEqual(f.replay.initial_state,initial);
  const w=readFileSync('miniprogram/pages/review/review.wxml','utf8');
  for(const handler of ['previousReplay','nextReplay','startReplay','endReplay','jumpReplay','changePerspective']) assert.match(w,new RegExp(`bind(?:tap|change)="${handler}"`));
  assert.match(w,/走前路线对照/); assert.match(w,/<slider\b/);
});

test('local B perspective travels through review, explain, generate and training list route',async()=>{
  const {page,requests,routes}=await harness(); await page.load('g1');
  page.changePerspective({detail:{value:'1'}}); await settle();
  assert.equal(page.data.review.reviewedPlayer,'B'); assert.equal(page.data.review.mistakes,1);
  assert.equal(page.data.gameExplanation.overall_summary,'summary B');
  await page.generateTraining();
  assert.ok(requests.some(({u})=>u.pathname.endsWith('/review')&&u.searchParams.get('reviewed_player')==='B'));
  assert.ok(requests.some(({u})=>u.pathname.endsWith('/explain')&&u.searchParams.get('reviewed_player')==='B'));
  assert.equal(requests.findLast(({u})=>u.pathname.endsWith('/training')).o.data.reviewed_player,'B');
  assert.equal(routes.at(-1),'/pages/training/training?source=REVIEW&gameId=g1&player=B');
  page.nextReplay(); assert.match(page.data.replayExplanation,/对手走法/);
});

test('metadata restricts AI view and room account seat restricts REMOTE view including empty resignation',async()=>{
  for(const config of [{mode:'AI',ai:'A',zero:true},{mode:'REMOTE',seat:'B',zero:true}]) {
    const {page,requests}=await harness(config); page.onLoad({gameId:'g1',mode:config.mode==='REMOTE'?'online':'local'}); await settle();
    assert.equal(page.data.state,'success'); assert.equal(page.data.canSelectPerspective,false);
    assert.equal(page.data.review.reviewedPlayer,'B'); page.changePerspective({detail:{value:'0'}}); await settle();
    assert.equal(page.data.review.reviewedPlayer,'B'); page.endReplay();
    assert.equal(page.data.replayIndex,1); assert.equal(page.data.replayPly,0); assert.ok(page.data.replayBoard);
    if(config.mode==='REMOTE') {await page.generateTraining();page.retryExplanation();await settle();
      assert.ok(requests.every(({u})=>u.pathname.startsWith('/api/v1/remote/rooms/')));
      assert.ok(requests.some(({u,o})=>u.pathname.endsWith('/replay')&&o.header['X-Room-Token']==='seat-token'));
    }
  }
});

test('late A view cannot overwrite B, and hidden or unloaded page rejects pending results',async()=>{
  const pending:((v:any)=>void)[]=[];let hold=false;
  const {page,f}=await harness({handle:(_o,u,answer)=>{if(hold&&u.pathname.endsWith('/review')&&u.searchParams.get('reviewed_player')==='A'){pending.push(answer);return true;}return false;}});
  await page.load('g1'); hold=true; const a=page.load('g1','A'); await settle();
  page.changePerspective({detail:{value:'1'}}); await settle(); assert.equal(page.data.review.reviewedPlayer,'B');
  pending.shift()!(f.review('A')); await a; assert.equal(page.data.review.reviewedPlayer,'B');
  for(const lifecycle of ['onHide','onUnload']) {const late=page.load('g1','A');await settle();page[lifecycle]();const writes=page.writes;
    pending.shift()!(f.review('A'));await late;assert.equal(page.writes,writes); if(lifecycle==='onHide'){hold=false;page.onShow();await settle();hold=true;}}
});

test('malformed replay and forged LOCAL AI metadata fail rather than inventing frames or perspectives',async()=>{
  for(const target of ['replay','metadata']) {const {page}=await harness({handle:(_o,u,answer)=>{
    if(target==='replay'&&u.pathname.endsWith('/replay')){answer({...fixture().replay,ply_count:99});return true;}
    if(target==='metadata'&&u.pathname==='/api/v1/game/g1'){answer({...fixture('AI').game,human_player:'B'});return true;}return false;}});
    await page.load('g1');assert.equal(page.data.state,'error');assert.equal(page.data.canSelectPerspective,false);
  }
});

test('replay APIs require complete captures and allow saved active revisions preceding an undo header', async()=>{
  const {createGameApi}=await import('../miniprogram/services/game-api.ts');
  const {createOnlineApi}=await import('../miniprogram/services/online-api.ts');
  const f=fixture();const active={...f.replay,version:5,ply_count:1,steps:[f.replay.steps[0]]};
  const api=createGameApi({request:async()=>active} as any);
  assert.deepEqual(await api.getReplay('g1'),active);
  for(const broken of [{...f.replay,steps:[{...f.replay.steps[0],capture:undefined}]},
      {...f.replay,steps:[{...f.replay.steps[0],capture:{...turns[0].capture,reserve_used:undefined}}]},
      {...f.replay,initial_state:{...initial,players:{A:initial.players.A}}}]) {
    const client={request:async()=>broken} as any;
    await assert.rejects(createGameApi(client).getReplay('g1'),(e:any)=>e.code==='INVALID_GAME_RESPONSE');
    await assert.rejects(createOnlineApi(client).getReplay('g1','token'),(e:any)=>e.code==='INVALID_GAME_RESPONSE');
  }
});

test('stored capture maps replaced pieces, reserve consumption and natural terminal without extra event',async()=>{
  const {replayView}=await import('../miniprogram/pages/review/review-replay.ts');
  const occupancy={...initial.board.occupancy};for(const key of Object.keys(occupancy))occupancy[key as keyof typeof occupancy]=null;
  Object.assign(occupancy,{P11:'A',P12:'B',P08:'B',P18:'B',P19:'A'});
  const before={...initial,board:{occupancy}};const turn=executeTurn(before,{from:'P19',to:'P13'});
  const replay={game_id:'g1',version:1,ply_count:1,initial_state:before,steps:[{kind:'MOVE',version:1,ply:1,game_move_id:1,player:'A',move:turn.move,capture:turn.capture,state:turn.state}]};
  const view=replayView(replay as any,fixture().review('A') as any,1);
  assert.equal(turn.capture.was_applied,true);assert.equal(turn.state.game_status,'FINISHED');
  assert.equal(view.replayMaxIndex,1);assert.equal(view.replayPly,1);assert.equal(view.replayReserveA,turn.reserve_after.A);
  assert.match(view.replayCaptureText,/备用棋使用/);
  for(const id of turn.capture.replacement_nodes)assert.ok(view.replayBoard.pieces.some(p=>p.nodeId===id&&p.side==='black'));
  for(const id of turn.capture.captured_nodes)assert.ok(view.replayBoard.nodes.find(n=>n.id===id)?.captured);
});

test('late explanation and generation never overwrite or navigate for old or hidden views',async()=>{
  for(const kind of ['explain','training']) {
    const pending:((v:any)=>void)[]=[];let hold=false;
    const {page,f,routes}=await harness({handle:(_o,u,answer)=>{if(hold&&u.pathname.endsWith(`/${kind}`)){pending.push(answer);return true;}return false;}});
    await page.load('g1');hold=true;
    const request=kind==='explain'?page.loadExplanation((await import('../miniprogram/services/game-api.ts')).createGameApi((await import('../miniprogram/services/api-client.ts')).createApiClient()),'g1'):page.generateTraining();
    await settle();hold=false;page.changePerspective({detail:{value:'1'}});await settle();
    pending.shift()!(kind==='explain'?{review:f.review('A'),explanation:{gameReviewId:'r-A',gameExplanation:{overall_summary:'old A'},moveExplanations:[]}}:{items:[],total:0});
    await request;assert.equal(page.data.review.reviewedPlayer,'B');assert.equal(page.data.gameExplanation.overall_summary,'summary B');assert.deepEqual(routes,[]);
    hold=true;const hidden=kind==='explain'?page.loadExplanation((await import('../miniprogram/services/game-api.ts')).createGameApi((await import('../miniprogram/services/api-client.ts')).createApiClient()),'g1'):page.generateTraining();
    await settle();page.onHide();const writes=page.writes;pending.shift()!({items:[],total:0});await hidden;assert.equal(page.writes,writes);assert.deepEqual(routes,[]);
  }
});

test('B missing review and explanation are created with B bodies instead of defaulting to A',async()=>{
  const {page,requests}=await harness({handle:(o,u)=>{
    if(o.method==='GET'&&(u.pathname.endsWith('/review')||u.pathname.endsWith('/explain'))&&u.searchParams.get('reviewed_player')==='B') {
      o.success({statusCode:404,data:{code:u.pathname.endsWith('/explain')?'EXPLANATION_NOT_FOUND':'REVIEW_NOT_FOUND',data:null}});return true;
    }return false;
  }});
  await page.load('g1');page.changePerspective({detail:{value:'1'}});await settle();
  assert.equal(page.data.review.reviewedPlayer,'B');assert.equal(page.data.gameExplanation.overall_summary,'summary B');
  for(const suffix of ['/review','/explain'])assert.ok(requests.some(({u,o})=>u.pathname.endsWith(suffix)&&o.method==='POST'&&o.data.reviewed_player==='B'));
});
