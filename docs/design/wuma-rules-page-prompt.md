# 五马棋规则讲解页设计图

日期：2026-10-05

## 设计与依据

使用内置 image_gen 生成静态长页设计图，沿用项目宣纸、墨色、朱红与金色风格。内容依据 miniprogram/domain/index.ts，棋盘依据 miniprogram/mock/game.ts，参考 tests/capture-pattern.test.mts 与 tests/capture-resolution.test.mts。适用当前《弈智五马》项目规则。

棋盘 29 点，双方在场各 5 枚、备用各 4 枚。沿引擎定义的同一条空直线移动，可走多个点，不可越子拐弯。夹吃和挑吃必须是同一棋线连续三点、整条线无其他棋子、本次落子新形成有效阵形。吃子用己方备用棋替换，每个去重敌棋消耗一枚备用；备用不足时全次吃子取消而正常落子保留。对手在场剩 2 枚不能挑吃，剩 1 枚不能夹吃。换手后孤棋无路可走才判负；庙内孤棋无路可走称庙困，P03 属主盘。认输亦判负。不增加和棋、计时或多子全堵判负规则。

吃子局部示意必须注明对手另有棋子，避免与末子保护矛盾；替换结果不是空点。

## 完整生成提示词

```text
Use case: ui-mockup + scientific-educational
Create ONE exceptionally polished, high-resolution Chinese mobile mini-program static rules explanation page for the EXISTING brand “弈智五马”. This is a complete long scrolling page design, shown flat as a straight-on screenshot, no phone frame, no perspective, no desktop dashboard. Portrait roughly 1440 by 3600, generous readable typography. All sections must be visible in the long image. Design quality: restrained contemporary Chinese editorial design, warm ivory rice-paper background #f5efe3, dark ink #17242b, cinnabar #a9342a, antique gold #bd8c42. Thin gold dividers, sophisticated Chinese serif display titles and clean sans-serif body copy. Calm tactile board diagrams, lightly shaded black and red circular pieces without chess/horses/cartoon icons. Spacious warm white cards, subtle paper grain, tasteful small red seal. Diagrams communicate the game rather than decorative imagery. Large legible exact Simplified Chinese text, no gibberish or English filler.

Layout in reading order:
TOP NAV: dark ink bar, back chevron on left, centered “规则讲解”, small “弈智五马” on right.
HEADER: red small seal “入门”; large title “五马棋，一图学会”; subtitle “先看走法，再学吃子，最后掌握胜负”; underneath a slim contents ribbon “棋盘 · 走法 · 吃子 · 胜负”.

01 CARD title “认识棋盘与开局”
One large accurate board schematic on warm pale wood, thin dark lines and clearly defined nodes, not a Go board, not Xiangqi, no squares with pieces inside.
Geometry MUST be exactly 29 points: main board has a 5 by 5 array (25 intersections); ABOVE its top center is a temple with ONLY 4 extra points, forming a diamond with apex P29, left P26, center P27, right P28, and the main grid top-center P03 is the bottom entrance point of the diamond (P03 already belongs to the 25 main grid points). Edges in temple: apex to left, center, right; left to center; center to right; left, center, right each to the entrance P03. Main grid: all horizontal and vertical neighboring connections. Diagonals ONLY connect neighboring even-parity grid nodes: equivalent to a big X through the center plus the four short diagonals connecting the midpoints of the outer square sides. No extra diagonal grid, no extra temple row. EXACTLY five black pieces on leftmost main grid column, EXACTLY five red pieces on rightmost main grid column, NO pieces in temple. Four small black reserve tokens and four small red reserve tokens in separate trays below the board, label “黑方备用 4 枚” and “红方备用 4 枚”.
Small fine gold callout to diamond: “庙宇：4 个点”; to its entrance: “P03 · 入口”.
Board bottom text “棋盘共 29 点 · 双方各 5 枚在场棋 + 4 枚备用棋”.
Below “双方轮流行棋，每回合移动一枚己方棋子。”

02 CARD title “沿直线走，途中不能越子”
Left mini diagram: one black token on first of FIVE horizontal equally spaced points, all remaining points empty, an elegant green arrow goes to the fifth point, labeled “✓ 空直线可走多点”.
Right mini diagram: one black token on first point, one red blocking token at middle point, an arrow beyond blocker crosses a red X, labeled “✕ 不能越过棋子”.
Exact explanatory line “目标必须为空点；全程沿同一条棋线，不可拐弯。”

03 CARD title “两种吃子方式”
Subheading “夹吃 · 两边夹一枚”
Diagram has local BEFORE row of exactly three adjacent points, black–red–black, down arrow, AFTER black–black–black. Before center red token highlighted; after new black center has gold outline. Clearly label side black pieces as “己方”, center red as “对方”, beside outcome “消耗备用棋 1 枚”.
Subheading “挑吃 · 中间挑两枚”
Diagram BEFORE red–black–red, down arrow, AFTER black–black–black, both replaced ends have gold outline. Label “消耗备用棋 2 枚”.
Footnote under diagrams: “局部示意：对方在其他棋线上另有棋子。”
An inset pale red explanation box with exact heading “吃子成立，还要满足”
Three neatly aligned check rows:
“同一条棋线上连续的三个点”
“整条棋线除此三子外，没有其他棋子”
“本次落子新形成的有效阵形”
Next exact note “吃子后，用己方备用棋替换对方棋子；不是留下空点。”

04 CARD title “备用棋与特殊限制”
Three horizontal stacked illustrated rows with a gold number badge, concise readable labels:
“备用不足，本次吃子全部取消”
small subline “保留正常落子，备用棋不扣减。”
“对手剩 2 枚在场棋，不能挑吃”
small subline “仍可通过有效夹吃继续进攻。”
“对手剩 1 枚在场棋，不能夹吃”
small subline “需要限制孤棋的合法走法。”
Final smaller fine print “同时形成多个有效阵形时合并结算，同一枚对方棋子只替换一次。”

05 CARD title “怎样判定胜负”
Three clearly separated rows:
“对方在场棋归零”
“轮到对方时，孤棋没有合法走法”
“对方认输”
Second row gets a tiny temple diagram icon and explanatory line “孤棋困在庙宇内称为‘庙困’；进入庙宇本身不算输。”
Avoid suggesting blocking players with multiple pieces automatically wins, avoid auto-win on temple entry.

BOTTOM slim ink horizontal process card title “记住一个回合”
gold connected steps “移动 → 判吃 → 替换 → 换手判胜”
gold outlined footer button “我学会了，开始对弈”
Tiny quiet footer “按弈智五马当前项目规则整理”.
Maintain exact Chinese meanings and numbers. No claims of universal folklore rules. No invented timer/draw scoring, no conventional chess pieces, no “每次只能走一格”, no jumping captures. All diagrams and labels must be consistent. Perfect optical alignment and attractive professional UI.
```

## 校对与最终产物

- 最终设计图：docs/design/wuma-rules-page-v2.png。
- 标准棋盘参考：docs/design/wuma-board-reference.png。参考图按照项目节点与连线坐标绘制，共 29 点，并用作最终图的插入参考。
- 检查项目：主盘 25 点、庙内 4 点、P03 共用入口；左右各 5 枚在场棋、各 4 枚备用棋；完整横竖和斜线；夹吃/挑吃替换前后对应；备用消耗；末子保护的对手数量；孤棋与庙困条件。
- 交付为静态设计图，底部按钮为视觉样式。

## 迭代提示词

### 第 1 次校对

```text
Edit this existing Chinese rules explanation design. Preserve the elegant paper/ink/gold/red visual style, all layout sections and readable Chinese text, and all capture illustrations. Make these exact corrections, mandatory because this teaches actual rules:
1. MAIN BOARD in section 01: redraw its point and edge geometry accurately. The main grid is exactly 5 columns x 5 rows, 25 points. The TEMPLE entrance P03 MUST be the top row's middle point, not a separate point above the grid. In the current image there are TWO vertically adjacent points at the junction (the P03 dot above wood and a middle top-row dot). MERGE THESE INTO ONE P03 DOT which sits on the main board's top horizontal line. No intermediate point between P27 and P03. The temple ONLY has 4 points beyond the grid: P29 apex; P26 left shoulder, P27 middle shoulder, P28 right shoulder; P03 bottom diamond point coincides with top-middle main grid point. Connect P29 to P26/P27/P28, P26-P27-P28 horizontally, P26/P27/P28 to P03. Exact total 29 dots, including dots hidden behind pieces.
2. MAIN GRID CONNECTIONS: maintain every horizontal/vertical adjacent edge. Maintain the big X through grid center. ADD all FOUR short diagonal paths connecting side MIDPOINTS: top-middle → second row fourth column → middle-right; top-middle → second row second column → middle-left; middle-left → fourth row second column → bottom-middle; middle-right → fourth row fourth column → bottom-middle. Thus each grid even-parity node connects diagonally to all neighboring even-parity nodes. Avoid extra arbitrary diagonals. Black tokens remain exactly five on leftmost column and red tokens exactly five on rightmost column.
3. In section 05 first victory box keep heading “对方在场棋归零” and replace its small explanatory text “对方的 5 枚在场棋全部被替换。” with EXACT “对方在场棋全部被替换。” There is no fixed count of 5 after capture-replacements.
4. Footer tiny text must read exactly “按弈智五马当前项目规则整理”. Top-right brand must read exactly “弈智五马”.
Do not change other rule text. High resolution crisp print-quality typography. This is the final corrected complete long page.
```

### 第 2 次校对

```text
Make a surgical correction to this existing full-page Chinese rules infographic. Change ONLY the large board drawing inside section 01. Preserve ALL other artwork, all Chinese text, every layout element and all token counts.
The board currently has an erroneous extra black dot labeled P03, located immediately ABOVE the grid's top-center black dot. These two dots must become ONE dot. Delete the UPPER of those two nearly-touching dots, and move the temple's lower connections to the LOWER dot, the top-center intersection of the main grid. The lower dot stays aligned horizontally with the top-left black token, the top-right red token and the two other top-row black dots. Position the P03 label just to the right of that lower dot. Draw a clean straight line from temple apex P29 through P27 and down to the single P03 grid intersection. Draw temple left P26 and right P28 diagonal lines down to that SAME top-center grid intersection. Draw the horizontal temple shoulder line P26–P27–P28. There must be NO junction dot between P27 and the main-grid top-center intersection.
Exactly 25 main-grid points plus 4 temple points =29 total. The temple's bottom tip is the main grid's top-center intersection, integrated as one shared point. Preserve all existing correct main-grid horizontal, vertical, big X and smaller diagonal lines from the edited version. Do not add any nodes. Do not change body copy. Sharply render the corrected geometric diagram.
```

### 第 3 次校对

```text
Redesign ONLY the illustration in the upper-left “01 认识棋盘与开局” card of this full infographic. Completely ERASE the current wooden board and temple drawing, and create a FRESH FLAT VECTOR DIAGRAM on ivory, while preserving all other cards, header, footer, rules text and capture diagrams unchanged. Use simple thin ink strokes, perfectly regular black node circles, black and cinnabar tokens, NO photorealistic wooden board. Make the changed flat diagram visually obvious.

Fresh diagram specification in its own local coordinate system:
Main grid x coordinates [0,1,2,3,4], y coordinates [2,3,4,5,6]. Exactly 25 intersections. Horizontal and vertical grid lines join neighboring nodes. The four extra temple nodes are at (2,0) apex, (1,1) left, (2,1) center, (3,1) right. Temple's bottom tip is (2,2), the EXISTING TOP-CENTER GRID NODE, not an additional dot. Draw temple edges (2,0)-(1,1), (2,0)-(2,1), (2,0)-(3,1), (1,1)-(2,1), (2,1)-(3,1), (1,1)-(2,2), (2,1)-(2,2), (3,1)-(2,2). The main top row is at SAME HEIGHT y=2 as the temple bottom tip, five evenly spaced dots at (0,2),(1,2),(2,2),(3,2),(4,2). Absolutely no dot between (2,1) and (2,2).
Diagonal paths on main grid: (0,2)-(1,3)-(2,4)-(3,5)-(4,6); (4,2)-(3,3)-(2,4)-(1,5)-(0,6); (2,2)-(1,3)-(0,4); (2,2)-(3,3)-(4,4); (0,4)-(1,5)-(2,6); (4,4)-(3,5)-(2,6).
Five black tokens cover the points x=0,y=2,3,4,5,6. Five red tokens cover x=4,y=2,3,4,5,6.
Label apex “P29”, left “P26”, center “P27”, right “P28”, shared top-grid center “P03”. Diagram annotations “庙宇：4 个点” and “P03 · 入口”.
Keep four black reserves and four red reserves with labels “黑方备用 4 枚”, “红方备用 4 枚”. Keep the existing opening-board copy. No other changes. This fresh flat diagram MUST have exactly 29 points, not30.
```

### 第 4 次校对

```text
Image 1 is the full-page rules design to edit. Image 2 is the EXACT AUTHORITATIVE board diagram that must replace the large board illustration in section01.
Take the diagram from IMAGE TWO and fit it into the board area in upper-left card of IMAGE ONE. Preserve Image2's geometry EXACTLY: especially the triangle's bottom tip P03 coincides with the MAIN GRID TOP ROW CENTER intersection. There are 29 nodes, NOT30. The temple bottom point is on the same horizontal line as the two top-row end tokens. Image2 has the correct X and the four diagonal midpoint paths, use those exactly. You may recolor the reference background to match the warm ivory card and slightly style pieces to match the other illustrations, but MUST NOT change any node or line coordinates or add dots. Copy the board geometry as given. Keep labels P26,P27,P28,P29,P03 and both trays of four reserves.
Preserve all the other design sections, readable Chinese text, header, footer, capture diagrams, typography and spacing from Image1. Don't invent any additional nodes. Omit old P03 callout if it complicates the exact board. This is a diagram insertion edit, not a creative reinterpretation.
```



## 术语修正

根据用户纠正统一使用‘挑吃’，标题为‘挑吃 · 中间挑两枚’；特殊限制为‘对手剩 2 枚在场棋，不能挑吃’。最终图保存为 wuma-rules-page-v2.png，由内置 image_gen 编辑生成。
