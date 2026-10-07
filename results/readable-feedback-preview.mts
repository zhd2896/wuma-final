// Production presentation and styles with labeled demo data; not a WeChat screenshot.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
registerHooks({ resolve(s, c, next) {
  try { return next(s, c); } catch (e) {
    if (s.startsWith('.') && c.parentURL && existsSync(new URL(`${s}.ts`, c.parentURL)))
      return next(new URL(`${s}.ts`, c.parentURL).href, c);
    throw e;
  }
} });
const { answerFeedback, reviewCategoryText, readableReason } = await import('../miniprogram/services/feedback-presentation.ts');
const a: any = { result: 'SUBOPTIMAL', submittedMove: { from: 'P08', to: 'P09' }, bestMove: { from: 'P08', to: 'P13' },
  lessonExplanation: 'P08 → P13 后，与 P11 形成黑—红—黑，夹吃 P12。夹吃消耗一枚备用棋；还要确认整条直线没有多余棋子。' };
const feedback = answerFeedback(a);
const files = ['miniprogram/pages/review/review.wxss', 'miniprogram/pages/training/training.wxss',
  'miniprogram/components/expandable-details/expandable-details.wxss'];
const css = files.map(file => readFileSync(file, 'utf8')).join('\n').replace(/(\d+(?:\.\d+)?)rpx/g, (_, n) => `${Number(n) / 2}px`);
const toggle = '<button class="details-toggle">展开技术详情 ▾</button>';
const html = `<!doctype html><meta charset="utf-8"><style>${css}
body{font-family:Arial,"Microsoft YaHei",sans-serif;background:#f3ede1;padding:24px;color:#35453d;font-size:14px}h1{font-size:21px}p{font-size:13px;color:#7c6b50}main{display:grid;grid-template-columns:repeat(3,340px);gap:20px}.card{background:#fffaf0;border:1px solid #dfd2bc;border-radius:12px}section>h2{font-size:16px}button{border:1px solid #dfd2bc;border-radius:6px;padding:8px 12px;cursor:pointer;background:#f4ede1;color:#6c5942}.board-placeholder{height:220px;border:1px dashed #a8997e;border-radius:12px;display:flex;align-items:center;justify-content:center;margin-top:20px;color:#8c8172}.details-body{border-top:1px solid #ded2bc;margin-top:8px}</style>
<h1>复盘与答题反馈：先读懂，再展开详情</h1><p>生产展示函数与样式 · 示例数据 · 浏览器布局检查，非微信真机截图</p><main>
<section><h2>复盘首层</h2><div class="match-summary card"><div class="match-title">玩家 A · 棋局复盘</div><div class="match-meta"><span>终局 · 认输</span></div></div><div class="review-key-summary card"><div class="review-key-title">关键失误</div><div class="review-key-moment"><div class="review-key-heading">第 8 手 · ${reviewCategoryText('BLUNDER')}</div><div>原因：${readableReason('错过了夹吃机会。评分损失为 200 分。','')}</div><div class="review-recommendation">推荐走法：P08 → P13</div><button>在棋盘上看推荐路线</button></div></div><div class="board-placeholder">随后查看实际棋盘与回放</div><div class="review-move card">第 8 手 · 严重失误<div class="details">${toggle}</div></div></section>
<section><h2>答题首层（详情收起）</h2><div class="training-result card"><div class="training-result-title">${feedback.title}</div><div>原因：${feedback.reason}</div><div class="training-recommendation">推荐走法：P08 → P13</div><div>你的走法：P08 → P09</div><div class="details">${toggle}</div></div><div class="board-placeholder">随后查看答题棋盘</div><div class="training-actions"><button>再试一次</button><button>下一题</button></div></section>
<section><h2>同一答题（详情展开）</h2><div class="training-result card"><div class="training-result-title">${feedback.title}</div><div>原因：${feedback.reason}</div><div class="training-recommendation">推荐走法：P08 → P13</div><div>你的走法：P08 → P09</div><div class="details"><button class="details-toggle">收起技术详情 ▴</button><div class="details-body">最佳评分：-36 · 本次评分：-200<br>评分损失：164 · 搜索深度：2<br>题库版本：2<br>评分配置版本：1</div></div></div></section></main>`;
writeFileSync('results/readable-feedback-preview.html', html);
