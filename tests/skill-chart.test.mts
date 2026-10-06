import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { skill } from './fixtures/player-skill.mts';
registerHooks({ resolve(s,c,next) { try { return next(s,c); } catch(e) {
  if(s.startsWith('.') && c.parentURL && existsSync(new URL(`${s}.ts`,c.parentURL))) return next(new URL(`${s}.ts`,c.parentURL).href,c);
  throw e;
} } });

test('radar uses the same six scores with honest zero, fixed scale and immutable input', async()=>{
  const {buildSkillChart}=await import('../miniprogram/components/skill-chart/chart-model.ts');
  const input=skill().metrics, before=JSON.stringify(input);
  const radar=buildSkillChart(input,'radar');
  assert.equal(radar.points.length,6);assert.equal(radar.links.length,6);
  assert.equal(radar.grid.length,30);assert.equal(radar.axes.length,6);
  assert.deepEqual(radar.points[0],{key:'performance',x:50,y:50});
  assert.equal(radar.labels[0].valueText,'0 分');assert.equal(radar.labels[1].valueText,'100 分');
  assert.equal(radar.missingCount,0);assert.equal(JSON.stringify(input),before);
  for(const point of radar.points)assert.ok(point.x>=0 && point.x<=100 && point.y>=0 && point.y<=100);
});

test('missing samples produce no zero point or interpolated links in radar or comparison line',async()=>{
  const {buildSkillChart}=await import('../miniprogram/components/skill-chart/chart-model.ts');
  const partial=skill(true).metrics;
  const radar=buildSkillChart(partial,'radar'),line=buildSkillChart(partial,'line');
  assert.equal(radar.points.length,2);assert.equal(radar.links.length,1,'only real adjacent axes 5 and 0 connect');
  assert.equal(line.points.length,2);assert.equal(line.links.length,0,'line must not bridge four missing metrics');
  assert.equal(radar.labels[1].valueText,'待评估');assert.equal(radar.missingCount,4);
  assert.equal(line.points[0].y,80,'true zero stays on zero baseline');
  assert.match(line.caption,/非时间趋势/);
  const empty=buildSkillChart([], 'line');
  assert.equal(empty.points.length,0);assert.equal(empty.links.length,0);assert.equal(empty.missingCount,6);
  assert.match(empty.notice,/样本不足/);
});

test('bar and line use consistent 0–100 scores and reject unsupported modes',async()=>{
  const {buildSkillChart,isSkillChartMode}=await import('../miniprogram/components/skill-chart/chart-model.ts');
  const input=skill().metrics;
  const bar=buildSkillChart(input,'bar'),line=buildSkillChart(input,'line');
  assert.deepEqual(bar.metrics.map(m=>m.value),[0,100,75,60,70,80]);
  assert.equal(line.points[1].y,20);assert.equal(line.links.length,5);
  assert.equal(isSkillChartMode('pie'),false);assert.equal(isSkillChartMode('line'),true);
  assert.equal(buildSkillChart(input,'bad' as any).mode,'radar');
  const invalid=input.map((m,i)=>({...m,value:i===0?NaN:i===1?101:m.value}));
  assert.equal(buildSkillChart(invalid,'bar').missingCount,2);
});

test('component observers rebuild geometry on mode/account changes and WXML binds real values',async()=>{
  let definition:any;(globalThis as any).Component=(d:any)=>definition=d;
  await import('../miniprogram/components/skill-chart/skill-chart.ts');
  const instance={data:{...definition.data},setData(v:any){this.data={...this.data,...v};}};
  const observe=definition.observers['metrics, mode'];
  observe.call(instance,skill().metrics,'radar');assert.equal(instance.data.chart.links.length,6);
  observe.call(instance,skill(true).metrics,'line');assert.equal(instance.data.chart.links.length,0);
  observe.call(instance,[],'bar');assert.equal(instance.data.chart.points.length,0);
  assert.equal(instance.data.chart.metrics.every((m:any)=>m.value===null),true);
  const wxml=readFileSync('miniprogram/components/skill-chart/skill-chart.wxml','utf8');
  assert.match(wxml,/item\.hasValue/);assert.match(wxml,/item\.valueText/);assert.match(wxml,/chart\.caption/);
});
