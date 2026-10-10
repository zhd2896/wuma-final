import type { CaptureType, Move, NodeId, Player } from '../domain/index';

interface TutorialLesson {
  readonly title: string;
  readonly instruction: string;
  readonly explanation: string;
  readonly move?: Move;
  readonly captureType: CaptureType | null;
  readonly pieces?: Partial<Record<NodeId, Player>>;
  readonly reserve?: number;
  readonly goal?: 'INSUFFICIENT_RESERVE' | 'PARTIAL_BLOCKADE' | 'TEMPLE_TRAP' | 'ALL_PIECES_IMMOBILIZED';
  readonly independent?: boolean;
}

export const TUTORIAL_LESSONS: readonly TutorialLesson[] = [
  { title: '走出第一步', instruction: '先点黑棋 P11，再点空位 P12。沿直线走棋，途中不能越过其他棋子。',
    explanation: '走对了！棋子沿棋盘直线移动到空位，途中没有其他棋子。正式对局中，接下来轮到对方。',
    move: { from: 'P11', to: 'P12' }, captureType: null },
  { title: '完成一次夹吃', instruction: '先点黑棋 P08，再点空位 P13，与 P11 的黑棋一起夹住 P12 的红棋。',
    explanation: '夹吃成功！同一直线上形成「黑—红—黑」，吃掉中间一枚红棋，消耗一枚备用黑棋替换它。整条直线上不能有其他棋子，备用棋也要足够；对方最后一子不能夹吃。',
    move: { from: 'P08', to: 'P13' }, captureType: 'CLAMP',
    pieces: { P11: 'A', P08: 'A', P12: 'B', P05: 'B', P20: 'B', P25: 'B' } },
  { title: '完成一次挑吃', instruction: '先点黑棋 P08，再点空位 P13，走到 P12、P14 两枚红棋中间。',
    explanation: '挑吃成功！同一直线上形成「红—黑—红」，吃掉两侧两枚红棋，消耗两枚备用黑棋替换它们。整条直线上不能有其他棋子，备用棋要足够；对方只剩两子时不能挑吃。',
    move: { from: 'P08', to: 'P13' }, captureType: 'CARRY',
    pieces: { P08: 'A', P21: 'A', P12: 'B', P14: 'B', P05: 'B', P25: 'B' } },
  { title: '备用棋不足会怎样', instruction: '本关只有一枚备用黑棋。点 P08，再走到 P13，试一试需要两枚备用棋的挑吃。',
    explanation: '走棋成功，但挑吃没有生效：需要两枚备用黑棋，现在只有一枚。两枚红棋留在原位，备用棋不消耗；正常换手，红方仍可走棋。',
    move: { from: 'P08', to: 'P13' }, captureType: null, reserve: 1, goal: 'INSUFFICIENT_RESERVE',
    pieces: { P08: 'A', P21: 'A', P12: 'B', P14: 'B', P05: 'B', P25: 'B' } },
  { title: '堵住一枚，还没有赢', instruction: 'P26 红棋在庙内，P25 还有一枚红棋。点黑棋 P07，再走到 P03，封住庙内红棋最后的出口。',
    explanation: 'P26 已无路可走，但 P25 红棋还有合法走法，所以对局继续。围堵获胜要求换手后，对方所有在场棋子都无合法走法。下方列出红方仍能走的路线。',
    move: { from: 'P07', to: 'P03' }, captureType: null, goal: 'PARTIAL_BLOCKADE',
    pieces: { P07: 'A', P27: 'A', P29: 'A', P26: 'B', P25: 'B' } },
  { title: '围堵庙内最后一子', instruction: '红方只剩庙内 P26 一子，仍可从 P26 走到入口 P03。点黑棋 P07，再走到 P03，封住最后出口。进入庙内本身不会判负。',
    explanation: '换手后，红方最后一子没有任何合法走法，黑方获胜。最后一子不能夹吃，要靠围堵；庙外孤棋无路可走也会判负。',
    move: { from: 'P07', to: 'P03' }, captureType: null, goal: 'TEMPLE_TRAP',
    pieces: { P07: 'A', P27: 'A', P29: 'A', P26: 'B' } },
  { title: '独立练习：让红方全无路可走', instruction: '红方还剩两枚棋子。自行选择一枚黑棋并走一步，让红方换手后所有棋子都没有合法走法。选棋后只显示合法落点；这关不提示答案。',
    explanation: '你找到了获胜走法！真实规则确认：换手后，两枚红棋都没有合法走法，黑方获胜。围堵不限于孤棋；关键是对方所有在场棋子都不能走。',
    captureType: null, goal: 'ALL_PIECES_IMMOBILIZED', independent: true,
    pieces: { P07: 'A', P09: 'A', P27: 'A', P28: 'A', P26: 'B', P29: 'B' } },
];
