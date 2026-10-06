// Browser layout check using the production geometry and styles, not a WeChat screenshot.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { skill } from '../tests/fixtures/player-skill.mts';
registerHooks({ resolve(s,c,next) { try { return next(s,c); } catch(e) {
  if(s.startsWith('.') && c.parentURL && existsSync(new URL(`${s}.ts`,c.parentURL)))return next(new URL(`${s}.ts`,c.parentURL).href,c);
  throw e;
} } });
const {buildSkillChart}=await import('../miniprogram/components/skill-chart/chart-model.ts');
const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const css=readFileSync('miniprogram/components/skill-chart/skill-chart.wxss','utf8').replace(/([\d.]+)rpx/g,(_,n)=>`${Number(n)/2}px`);
const cases=[{title:'完整评分示例（包含真实 0 分）',metrics:skill().metrics},
  {title:'部分样本不足示例',metrics:skill(true).metrics},
  {title:'全部样本不足示例',metrics:[]}];
const cards=cases.flatMap(example=>(['radar','bar','line'] as const).map(mode=>{
  const m=buildSkillChart(example.metrics,mode);
  const segments=(items:any[],cls:string)=>items.map(l=>`<div class="chart-line ${cls}" style="left:${l.x}%;top:${l.y}%;width:${l.width}%;transform:rotate(${l.angle}deg)"></div>`).join('');
  const contents=mode==='bar'?`<div class="bar-chart"><div class="bar-scale"><span>0 分</span><span>50</span><span>100 分</span></div>${m.metrics.map(metric=>`<div class="bar-row"><div class="bar-heading"><span>${escape(metric.label)}</span><span class="bar-value">${metric.valueText}</span></div><div class="bar-track">${metric.hasValue?`<div class="bar-fill" style="width:${metric.value}%"></div>`:''}</div></div>`).join('')}</div>`
    :`<div class="chart-square ${mode}">${segments(m.grid,'grid-line')}${segments(m.axes,'axis-line')}${segments(m.links,'data-line')}${m.points.map(p=>`<div class="chart-point" style="left:${p.x}%;top:${p.y}%"></div>`).join('')}${m.scales.map(p=>`<span class="chart-scale" style="left:${p.x}%;top:${p.y}%">${p.label}</span>`).join('')}${m.labels.map(p=>`<div class="chart-label" style="left:${p.x}%;top:${p.y}%"><span>${p.label}</span><span class="chart-value">${p.valueText}</span></div>`).join('')}</div>`;
  return `<article><h2>${example.title} · ${mode}</h2><div class="skill-chart"><div class="chart-caption">${m.caption}</div>${contents}${m.notice?`<div class="chart-notice">${m.notice}</div>`:''}</div></article>`;
})).join('');
writeFileSync('results/ability-chart-preview.html',`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>能力图表布局检查</title><style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#f4eee2;font-family:'Microsoft YaHei',sans-serif}h1{font-size:20px}p{font-size:13px;color:#766850}.cards{display:grid;grid-template-columns:repeat(3,352px);gap:18px}article{padding:16px;border:1px solid #decaab;border-radius:12px;background:#fffaf0}h2{font-size:14px;margin:0 0 14px}${css}.chart-label span{display:block}</style><h1>能力分析：雷达 / 条形 / 当前能力折线</h1><p>生产坐标与样式 · 测试样本 · 浏览器布局检查，非微信真机截图</p><div class="cards">${cards}</div></html>`);
