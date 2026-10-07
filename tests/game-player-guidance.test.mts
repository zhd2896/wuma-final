import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
registerHooks({ resolve(s,c,n) { try { return n(s,c); } catch(e) { if(s.startsWith('.') && c.parentURL && (e as any).code === 'ERR_MODULE_NOT_FOUND') { const u=new URL(s+'.ts',c.parentURL); if(existsSync(u)) return n(u.href,c); } throw e; } } });
const { createInitialGameState } = await import('../miniprogram/domain/index.ts');
const { mapGameStateToView } = await import('../miniprogram/pages/game/game-state-mapper.ts');
test('shared and seated views name players and explain selection without point codes', () => {
 const s=createInitialGameState();
 const local=mapGameStateToView(s);
 assert.deepEqual(local.playerNames,{A:'黑方',B:'红方'});
 assert.equal(local.turnTitle,'黑方回合');
 for(const seat of ['A','B'] as const) {
  const v=mapGameStateToView(s,{selectedNode:'P01',legalTargets:['P02'],lastMove:null},seat);
  assert.equal(v.playerNames[seat],'你');
  assert.equal(v.playerNames[seat==='A'?'B':'A'],'对手');
  assert.equal(v.turnTitle,seat==='A'?'你的回合':'对手回合');
  if(seat==='A') { assert.match(v.guidanceText,/1 个可走位置/); assert.doesNotMatch(v.guidanceText,/P01/); }
  else assert.match(v.guidanceText,/等待对手/);
 }
 const noTarget=mapGameStateToView(s,{selectedNode:'P01',legalTargets:[],lastMove:null});
 assert.match(noTarget.guidanceText,/换一枚/);
 const ended=mapGameStateToView({...s,game_status:'FINISHED',winner:'B',winner_reason:'RESIGN'});
 assert.equal(ended.turnTitle,'红方获胜');
});
test('capture summary distinguishes attacker, replacement and failed capture without inventing actions',()=>{
 const s=createInitialGameState();
 const capture={patterns:[],captured_nodes:['P05'],replacement_nodes:['P05'],required_reserve:1,reserve_used:1,was_applied:true,failure_reason:'NONE'} as const;
 const v=mapGameStateToView(s,{selectedNode:null,legalTargets:[],lastMove:{from:'P02',to:'P01'},lastCapture:capture},'B');
 assert.match(v.captureText,/对手.*吃掉你的 1 枚/);
 assert.match(v.captureText,/换入.*1 枚/);
 assert.equal(v.board.nodes.find(n=>n.id==='P05')?.replacement,true);
 const failed=mapGameStateToView(s,{selectedNode:null,legalTargets:[],lastMove:null,lastCapture:{...capture,was_applied:false,failure_reason:'INSUFFICIENT_RESERVE'}});
 assert.match(failed.captureText,/备用棋不足.*未生效/);
 assert.equal(failed.board.nodes.some(n=>n.captured),false);
 assert.equal(mapGameStateToView(s).captureText,'');
});
test('turn instructions precede boards and shared board supports opt-in text markers',()=>{
 for(const path of ['game/game','online/online']) {
  const source=readFileSync('miniprogram/pages/'+path+'.wxml','utf8');
  assert.ok(source.indexOf('class="turn-status') < source.indexOf('<chess-board'));
  assert.doesNotMatch(source,/玩家 A|玩家 B|黑方 A|红方 B/);
  assert.match(source,/show-guidance="\{\{true\}\}"/);
  assert.match(source,/辅助操作/);
 }
 const board=readFileSync('miniprogram/components/chess-board/chess-board.wxml','utf8');
 assert.match(board,/showGuidance[\s\S]*item.legalTarget/);
 assert.match(board,/可走/);
 assert.match(board,/换入/);
});

test('local real capture remains visible during selection, honors settings and clears on undo',async()=>{
 const { NODE_IDS }=await import('../miniprogram/domain/index.ts');
 const {createLocalGameSession,tapLocalGameNode,getLocalBoardView,undoLocalGame}=await import('../miniprogram/pages/game/local-game.ts');
 const base=createLocalGameSession();
 const occupancy={...base.gameState.board.occupancy};
 for(const id of NODE_IDS) occupancy[id]=null;
 Object.assign(occupancy,{P01:'A',P02:'B',P04:'A',P29:'B'});
 const session={...base,gameState:{...base.gameState,board:{occupancy}}};
 const played=tapLocalGameNode(tapLocalGameNode(session,'P04').session,'P03');
 assert.equal(played.session.lastCapture?.was_applied,true);
 assert.equal(getLocalBoardView(played.session).nodes.find(n=>n.id==='P02')?.replacement,true);
 assert.equal(getLocalBoardView(played.session,true,false).nodes.some(n=>n.captured),false);
 assert.match(mapGameStateToView(played.session.gameState,{selectedNode:null,legalTargets:[],lastMove:played.session.lastMove,lastCapture:played.session.lastCapture}).captureText,/黑方完成夹吃.*1 枚/);
 const selected=tapLocalGameNode(played.session,'P29').session;
 assert.equal(selected.lastCapture,played.session.lastCapture);
 assert.equal(getLocalBoardView(undoLocalGame(played.session)).nodes.some(n=>n.replacement),false);
});

test('actual online page preserves seat labels and prioritizes paused or uncertain operations',async()=>{
 let definition:any;
 (globalThis as any).Page=(d:any)=>definition=d;
 const storage=new Map();
 (globalThis as any).wx={getStorageSync:(k:string)=>storage.get(k)??'',setStorageSync:(k:string,v:any)=>storage.set(k,v),removeStorageSync:(k:string)=>storage.delete(k)};
 await import('../miniprogram/pages/online/online.ts');
 const page:any={...definition,data:{...definition.data},setData(p:any){Object.assign(this.data,p)}};
 const state=createInitialGameState();
 const room={game_id:'labels-real',seat:'B',state,room_status:'PLAYING',ply_count:0};
 const snapshot={room,selectedNode:null,legalTargets:[],lastMove:null,lastCapture:null,busy:false,isOperating:false,pendingMove:false,pendingOperation:false,successfulAction:0,canRequestUndo:false,canResign:true};
 page.render(snapshot);
 assert.deepEqual(page.data.view.playerNames,{A:'对手',B:'你'});
 assert.match(page.data.turnGuidance,/等待对手/);
 page.render({...snapshot,room:{...room,seat:'A'},selectedNode:'P01',legalTargets:['P02']});
 assert.equal(page.data.turnLabel,'你的回合');
 assert.match(page.data.turnGuidance,/1 个可走位置/);
 page.render({...snapshot,room:{...room,pending_undo:{responder:'B'}}});
 assert.match(page.data.turnLabel,/暂停/);
 page.render({...snapshot,pendingMove:true});
 assert.match(page.data.turnGuidance,/尚未确认/);
 page.render({...snapshot,busy:true,pendingMove:true});
 assert.match(page.data.turnGuidance,/正在处理/);
 page.render({...snapshot,room:null});
 assert.equal(page.data.turnGuidance,'');
 assert.equal(page.data.view,null);
});
test('terminal explanation identifies the losing side from either seat',()=>{
 const state={...createInitialGameState(),game_status:'FINISHED',winner:'A',winner_reason:'CAPTURE_ALL'} as const;
 assert.match(mapGameStateToView(state).winnerMessage,/红方棋子/);
 assert.match(mapGameStateToView(state,undefined,'B').winnerMessage,/你的棋子/);
 assert.match(mapGameStateToView(state,undefined,'A').winnerMessage,/对手的棋子/);
});
