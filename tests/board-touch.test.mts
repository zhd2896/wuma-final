import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { boardNodes, boardLines, initialPieces } from '../miniprogram/mock/game.ts';
registerHooks({ resolve(s,c,n) { try { return n(s,c); } catch(e) {
  if(s.startsWith('.') && c.parentURL && (e as any).code === 'ERR_MODULE_NOT_FOUND') {
    const u = new URL(`${s}.ts`,c.parentURL); if(existsSync(u)) return n(u.href,c);
  } throw e;
} } });

let loadedDefinition: any;
async function harness(board: any) {
  let definition: any; const events: any[] = [];
  (globalThis as any).Component = (value: any) => { definition = value; };
  (globalThis as any).wx = { getStorageSync() { return ''; }, setStorageSync() {} };
  await import(`../miniprogram/components/chess-board/chess-board.ts?touch-${Math.random()}`);
  definition ??= loadedDefinition; loadedDefinition = definition;
  const component = { ...definition.methods, properties: { board, highContrast: false, largeText: false },
    data: { ...definition.data }, setData(patch: any) { Object.assign(this.data, patch); },
    triggerEvent(name: string, detail: any) { events.push({ name, detail }); } };
  definition.observers?.board?.call(component, board);
  return { component, definition, events };
}

function assertNoOverlap(nodes: any[]) {
  for(let i = 0; i < nodes.length; i++) for(let j = i+1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j];
    assert.ok(Math.abs(a.x-b.x) >= (a.hitWidth+b.hitWidth)/2 ||
      Math.abs(a.y-b.y) >= (a.hitHeight+b.hitHeight)/2, `${a.id} overlaps ${b.id}`);
  }
}

test('all 29 node hit areas expand at unchanged centers without overlapping', async () => {
  const board = { nodes: boardNodes, lines: boardLines, pieces: initialPieces };
  const saved = structuredClone(board); const { component } = await harness(board);
  assert.equal(component.data.hitNodes?.length, 29);
  assertNoOverlap(component.data.hitNodes);
  for(const hit of component.data.hitNodes) {
    const node = board.nodes.find(n => n.id === hit.id)!;
    assert.equal(hit.x, node.x); assert.equal(hit.y, node.y);
    assert.equal(hit.hitWidth, hit.hitHeight);
    assert.ok(hit.hitWidth > 8 && hit.hitWidth <= 12);
  }
  assert.deepEqual(board, saved);
});

test('hit geometry adapts to dense actual coordinates and excludes visual-only nodes', async () => {
  const board = { nodes: [{ id: 'P01', x: 2, y: 2 }, { id: 'P02', x: 2.1, y: 2.02 },
    { id: 'P03', x: 2.04, y: 2.1 }, { id: 'art', x: 2, y: 2, visualOnly: true }], lines: [], pieces: [] };
  const { component } = await harness(board);
  assert.equal(component.data.hitNodes?.length, 3);
  assertNoOverlap(component.data.hitNodes);
  assert.ok(component.data.hitNodes.every((n: any) => n.hitWidth > 0 && n.hitWidth < 0.1));
});

test('node accessibility explains occupation and guidance while taps emit the real node id', async () => {
  const board = { nodes: boardNodes.map(n => ({ ...n, legalTarget: n.id === 'P02' })),
    lines: boardLines, pieces: initialPieces, selectedId: 'P01', recommendedFrom: 'P01', recommendedTo: 'P02' };
  const { component, events } = await harness(board);
  assert.match(component.data.hitNodes?.find((n:any)=>n.id==='P01')?.ariaLabel ?? '', /P01.*黑方.*选中.*起点/);
  assert.match(component.data.hitNodes.find((n:any)=>n.id==='P02').ariaLabel, /空位.*可走.*终点/);
  component.onNode({ currentTarget: { dataset: { id: 'P02' } } });
  component.onNode({ currentTarget: { dataset: { id: 'wrong' } } });
  assert.deepEqual(events, [{ name: 'node', detail: { id: 'P02' } }]);
  const wxml = readFileSync('miniprogram/components/chess-board/chess-board.wxml', 'utf8');
  assert.match(wxml, /aria-role="button"/); assert.match(wxml, /aria-label="\{\{item.ariaLabel\}\}"/);
  assert.match(wxml, /board.recommendLine/); assert.match(wxml, /item.captured/);
});

test('board reads persisted accessibility preferences on attached and page show', async () => {
  const { component, definition } = await harness({ nodes: boardNodes, lines: boardLines, pieces: initialPieces });
  let enabled = true;
  (globalThis as any).wx.getStorageSync = () => ({ version: 1, settings: { showLegalTargets: true,
    showCaptureNotice: true, vibrateOnAction: false, aiFirstPlayer: 'A', highContrastBoard: enabled, largeBoardText: enabled } });
  definition.lifetimes?.attached?.call(component);
  assert.equal(component.data.storedHighContrast, true); assert.equal(component.data.storedLargeText, true);
  enabled = false; definition.pageLifetimes.show.call(component);
  assert.equal(component.data.storedHighContrast, false); assert.equal(component.data.storedLargeText, false);
});
