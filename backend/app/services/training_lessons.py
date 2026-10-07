"""Immutable v2 teaching content; solutions remain private canonical Engine facts."""
from dataclasses import dataclass
from hashlib import md5


@dataclass(frozen=True)
class CatalogLesson:
    key: str
    title: str
    pieces: dict[str, str]
    difficulty: str
    theme: str
    goal: str
    explanation: str
    player: str = 'A'
    version: int = 2

    @property
    def id(self) -> str:
        return md5(f'wuma-curated-v{self.version}-{self.key}'.encode()).hexdigest()


LESSONS = (
    CatalogLesson('clamp', '入门吃子：完成夹吃',
        {'P11':'A','P08':'A','P12':'B','P05':'B','P20':'B','P25':'B'}, 'EASY', 'CAPTURE',
        '找出能与己方棋子配合夹住一枚对方棋子的走法。',
        'P08 → P13 后，与 P11 形成黑—红—黑，夹吃 P12。夹吃消耗一枚备用棋；还要确认整条直线没有多余棋子。'),
    CatalogLesson('carry', '入门吃子：完成挑吃',
        {'P08':'A','P21':'A','P12':'B','P14':'B','P05':'B','P25':'B'}, 'EASY', 'CAPTURE',
        '寻找能走到两枚对方棋子中间的空位，完成挑吃。',
        'P08 → P13 后形成红—黑—红，挑吃 P12、P14，消耗两枚备用棋。对方还不止两子，满足挑吃条件。'),
    CatalogLesson('clamp-edge', '进阶吃子：转换夹击方向',
        {'P01':'A','P09':'A','P02':'B','P21':'B','P25':'B'}, 'NORMAL', 'CAPTURE',
        '同时观察斜线移动和横线夹击，找出评分最佳的吃子机会。',
        'P09 沿斜线到 P03，与 P01 夹吃 P02。移动所在直线与形成吃子的位置可以不同；吃完还应检查对手的反击。'),
    CatalogLesson('carry-edge', '进阶吃子：看清边线挑吃',
        {'P08':'A','P25':'A','P02':'B','P04':'B','P21':'B'}, 'NORMAL', 'CAPTURE',
        '观察边线的两侧棋子与中央通路，比较吃子后的局面。',
        'P08 → P03 后，横线上的 P02、P04 被挑吃。先检查通路和备用棋，再比较吃子后是否留给对手反击机会。'),
    CatalogLesson('defense-top', '入门防守：撤离夹击线',
        {'P01':'B','P02':'A','P04':'B','P25':'A','P29':'B'}, 'EASY', 'VULNERABILITY',
        '识别对方下一手的夹吃威胁，先移动受威胁的己方棋子。',
        '对方可从 P04 到 P03 夹吃 P02。最佳示例 P02 → P22，先离开危险横线。评分还比较活动空间与对手下一手，其他安全退路不一定同分；本题同分最佳走法均按正确处理。'),
    CatalogLesson('defense-left', '入门防守：保护侧翼棋子',
        {'P01':'B','P06':'A','P16':'B','P25':'A','P29':'B'}, 'EASY', 'VULNERABILITY',
        '从纵线识别夹吃威胁，保护受威胁的棋子。',
        '对方可从 P16 到 P11 夹吃 P06。最佳示例 P06 → P10，先移离危险纵线。评分还比较活动空间与对手下一手，其他安全退路不一定同分；同分最佳走法也可得分。'),
    CatalogLesson('defense-clamp', '进阶防守：保子并打开空间',
        {'P11':'B','P08':'B','P12':'A','P25':'A','P01':'B'}, 'NORMAL', 'VULNERABILITY',
        '比较多个撤退点，选择防住夹吃且保留活动空间的走法。',
        '对方 P08 → P13 可夹吃 P12。P12 → P15 既移出夹击线，又保留后续调度空间；不相关的调子可能遭到更强反击。'),
    CatalogLesson('defense-carry', '进阶防守：拆开挑吃目标',
        {'P12':'A','P14':'A','P25':'A','P08':'B','P21':'B','P01':'B'}, 'NORMAL', 'VULNERABILITY',
        '两枚己方棋子可能同时被挑吃，移动其中一枚拆开威胁。',
        '对方 P08 → P13 可挑吃 P12、P14。P14 → P09 拆开挑吃结构，并兼顾后续位置；只看眼前活动范围容易漏掉双子损失。'),
    CatalogLesson('lone-temple', '入门孤棋：寻找庙区出口',
        {'P29':'A','P26':'B','P03':'B'}, 'EASY', 'LONE_PIECE_RISK',
        '己方只剩一子，比较庙区两个合法落点的后续空间。',
        'P29 → P27 比移到侧翼保留更多活动机会。孤棋不能被普通夹吃，但没有合法走法仍会输；应优先检查出口。'),
    CatalogLesson('lone-wing', '入门孤棋：避开封锁边翼',
        {'P28':'A','P29':'B','P03':'B'}, 'EASY', 'LONE_PIECE_RISK',
        '比较庙区侧翼的两个去向，保留脱困通路。',
        'P28 → P27 保留了更多后续通路，比移到另一侧翼更好。最后一子仍需遵守直线与路径畅通规则。'),
    CatalogLesson('lone-approach', '进阶孤棋：扩大可用通路',
        {'P03':'A','P21':'B','P24':'B','P25':'B'}, 'NORMAL', 'LONE_PIECE_RISK',
        '比较多条直线的落点，避免只看当前一步的自由。',
        'P03 → P13 进入交叉点，在固定深度评分下最佳。评估孤棋应同时看自己的通路与对手下一手能封住哪些出口。'),
    CatalogLesson('lone-center', '进阶孤棋：选择撤退方向',
        {'P13':'A','P01':'B','P05':'B','P21':'B','P25':'B'}, 'NORMAL', 'LONE_PIECE_RISK',
        '四角都有对方棋子时，比较退路与对手下一步的封锁。',
        'P13 → P03 在当前两层搜索下评分最佳。孤棋走到交叉点不一定总是安全，要比较对方能接近的方向和保留下来的通路。'),
)
LESSONS_BY_ID = {lesson.id: lesson for lesson in LESSONS}


def lesson_for(training_id: str) -> CatalogLesson | None:
    return LESSONS_BY_ID.get(training_id)
