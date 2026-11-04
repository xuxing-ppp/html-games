#!/usr/bin/env python3
# test_audio_ext/void_ext_gen.py — 虚空深渊 BGM「7/8 玻璃脉冲 · 扩写版」生成器
# (纯标准库,零依赖) D 多利亚 · 7/8 · 105 BPM · 276 小节 = 552.000s。
# tick/拨弦低音在 2+2+3、3+2+2、2+3+2 间换组，漂浮段让固定脉冲退场；
# 后半加入开放四度副主题与金属脉冲音色。
# 结构:A 主题(即进) | A2 +和声/鼓 | B 对比+琶音 | D(新:halftime 稀疏呼吸) |
#   C1(12,发展碎片) | E(新:2+2+3 重音琶音强化) | A3 再现 | B2 变奏 |
#   C2(12) | E2 | F(新:静默段,高音区孤线) | A4 | C3(12) | G(新:高潮) |
#   C4(12) | A5 终再现(结尾悬置) | OUT(4,收束句 D 主音+A4 长悬卷回)
# 和声:每 2 小节一换根音窗口,铺底只用根音+五度开放五度和声(永不出阶),
#   多利亚色彩全靠旋律的 B/C 音。玻璃主奏(三角+正弦+倍频叠层,颤音+双失谐)。
# 输出:void_ext_loop.wav + void_ext_seam.wav(末10s+头10s)
# 运行:python3 test_audio_ext/void_ext_gen.py

import math
import os
import wave
import array

SR = 44100
BPM = 105
BARS = 276
SPB = 7                                   # 每小节八分音符数(7/8)
TOTAL = BARS * SPB                        # 1036 槽
SLOT_S = (60.0 / BPM) / 2                 # 2/7 s
NS = 24343200                             # 552.000s(276 × 88200)
SPS = NS // TOTAL                         # 12,600 样本/槽(整除)
HERE = os.path.dirname(os.path.abspath(__file__))
assert SPS * TOTAL == NS and TOTAL * SLOT_S == BARS * 2.0

SCALE = [0, 2, 3, 5, 7, 9, 10]            # 多利亚(D 起)
PC_D = 2
ALLOWED = {(PC_D + s) % 12 for s in SCALE}


def f_midi(m):
    return 440.0 * (2.0 ** ((m - 69) / 12.0))


# ── 作曲材料 ────────────────────────────────────────────────────────────
# 主题(8 小节 56 槽;绝对 midi)
THEME = [
    (0, 2, 69), (2, 2, 67), (4, 3, 65),
    (7, 1, 64), (8, 2, 65), (10, 3, 62),
    (14, 2, 62), (16, 1, 64), (17, 1, 65), (18, 2, 67),
    (20, 1, 69),
    (21, 3, 71), (24, 2, 69), (26, 2, 67),
    (28, 2, 69), (30, 2, 67), (32, 3, 65),
    (35, 1, 64), (36, 2, 67), (38, 3, 65),
    (42, 2, 64), (44, 1, 62), (45, 1, 64), (46, 2, 65),
    (48, 1, 67),
    (49, 3, 74), (52, 2, 69), (54, 2, 62),
]
# A5 终再现改结尾:D5→C5→A(悬置,让位收束句)
ENDING2 = [(49, 3, 74), (52, 2, 72), (54, 2, 69)]
# B 段对比乐句(8 小节)
BPHRASE = [
    (0, 2, 65), (2, 2, 62), (4, 3, 69),
    (7, 2, 67), (9, 2, 65), (11, 3, 64),
    (14, 2, 65), (16, 2, 67), (18, 3, 69),
    (21, 2, 72), (23, 2, 69), (25, 3, 67),
    (28, 3, 74), (31, 2, 72),
    (33, 2, 69), (35, 2, 67), (37, 2, 69),
    (39, 3, 71), (42, 2, 72),
    (44, 2, 74), (46, 3, 69),
]
# B2 变奏:前 4 小节原样 + 后 4 小节新尾
BPHRASE2 = BPHRASE[:10] + [
    (28, 2, 71), (30, 2, 72), (32, 3, 74), (35, 2, 72), (37, 2, 69),
    (39, 3, 71), (42, 2, 72), (44, 3, 74), (47, 2, 72),
]
# C 块发展碎片(12 小节 84 槽;碎片+留白)
CP_C1 = [
    (0, 2, 69), (2, 2, 67), (4, 3, 65),
    (7, 1, 64), (8, 2, 65), (10, 3, 62),
    (21, 4, 67), (25, 3, 65),
    (28, 2, 64), (30, 2, 65), (32, 3, 67),
    (35, 2, 69), (37, 2, 71), (39, 3, 72),
    (42, 4, 74), (46, 3, 72),
    (49, 2, 71), (51, 3, 69),
    (56, 2, 67), (58, 2, 65), (60, 3, 64),
    (63, 2, 62), (65, 5, 69),
    (70, 2, 74), (72, 3, 72), (75, 2, 69),
    (77, 3, 67), (80, 4, 74),
]
CP_C2 = [
    (0, 3, 74), (3, 2, 72), (5, 2, 69),
    (7, 3, 67), (10, 4, 65),
    (14, 2, 64), (16, 2, 65), (18, 3, 67),
    (21, 4, 69), (25, 3, 71),
    (35, 2, 72), (37, 2, 71), (39, 3, 69),
    (42, 2, 67), (44, 3, 65),
    (49, 2, 64), (51, 3, 65), (54, 2, 67),
    (56, 2, 69), (58, 2, 71), (60, 3, 72),
    (63, 2, 74), (65, 5, 71),
    (70, 2, 69), (72, 3, 67),
    (77, 2, 65), (79, 5, 74),
]
CP_C3 = [
    (0, 2, 69), (2, 2, 71), (4, 3, 72),
    (7, 2, 74), (9, 3, 71),
    (14, 2, 69), (16, 3, 67),
    (21, 3, 65), (24, 4, 67),
    (28, 2, 64), (30, 2, 65), (32, 3, 67),
    (35, 2, 69), (37, 3, 71),
    (42, 4, 74), (46, 3, 76),
    (49, 2, 74), (51, 3, 72),
    (56, 2, 71), (58, 2, 69), (60, 3, 67),
    (63, 2, 65), (65, 5, 69),
    (70, 3, 74), (73, 2, 72),
    (77, 2, 71), (79, 5, 69),
]
CP_C4 = [
    (0, 2, 67), (2, 2, 69), (4, 3, 71),
    (7, 2, 72), (9, 3, 74),
    (21, 3, 72), (24, 4, 71),
    (28, 2, 69), (30, 3, 67),
    (42, 2, 65), (44, 3, 67),
    (49, 2, 69), (51, 3, 71),
    (56, 2, 72), (58, 2, 74), (60, 3, 72),
    (63, 2, 71), (65, 5, 69),
    (70, 2, 67), (72, 3, 65),
    (77, 2, 64), (79, 5, 69),
]
# D 段 halftime 稀疏长音(8 小节 56 槽)
PH_DV = [
    (0, 6, 74), (6, 8, 69),
    (14, 6, 67), (20, 8, 65),
    (28, 6, 74), (34, 8, 72),
    (42, 6, 71), (48, 8, 69),
]
# E 段稀碎片(让位琶音)
PH_EV = [
    (0, 3, 74), (3, 3, 72),
    (7, 3, 69), (10, 4, 65),
    (14, 3, 67), (17, 4, 65),
    (21, 3, 69), (24, 3, 67),
    (28, 3, 74), (31, 4, 72),
    (35, 3, 71), (38, 4, 69),
    (49, 3, 72), (52, 4, 69),
]
# F 段静默高音区孤线
PH_FV = [
    (0, 6, 81), (6, 8, 77),
    (14, 6, 74), (20, 8, 77),
    (28, 6, 81), (34, 8, 84),
    (42, 6, 81), (48, 8, 77),
]
# G 段高潮
PH_GV = [
    (0, 3, 74), (3, 3, 76), (6, 2, 77),
    (8, 3, 81), (11, 2, 79), (13, 2, 76),
    (15, 3, 77), (18, 3, 81),
    (21, 3, 84), (24, 3, 83), (27, 2, 81),
    (29, 3, 77), (32, 3, 76),
    (35, 3, 81), (38, 3, 77),
    (42, 3, 74), (45, 3, 76), (48, 2, 72),
    (50, 3, 74), (53, 3, 69),
]
# 新副主题：开放四度起句、长短句交替，突出 B 自然音的多利亚光泽。
# 8 小节版本可在长段中平移复用，保持主题可辨而不机械照抄主旋律。
PH_QV = [
    (0, 3, 62), (3, 2, 67), (5, 2, 69),
    (7, 4, 71), (11, 3, 69),
    (14, 2, 65), (16, 3, 69), (19, 2, 72),
    (21, 5, 74), (26, 2, 71),
    (28, 3, 69), (31, 2, 64), (33, 2, 67),
    (35, 4, 65), (39, 3, 62),
    (42, 2, 64), (44, 2, 67), (46, 3, 71),
    (49, 3, 74), (52, 2, 72), (54, 2, 69),
]
# 收束句(4 小节 28 槽;末音 A4 长悬卷回循环头 = 主题首音)
OUTRO = [
    (0, 4, 74), (4, 2, 72), (6, 1, 69),
    (7, 2, 67), (9, 1, 65), (10, 2, 64),
    (12, 2, 62), (14, 5, 69),
    (19, 2, 67), (21, 3, 65),
    (24, 4, 69),
]

# ── 段落表(块起始 bar, 名称, 小节数, 主题素材)────────────────────────
SECTIONS = [
    (0, "A", 8, "T"), (8, "A2", 8, "T"), (16, "B", 8, "B"),
    (24, "D", 8, "DV"), (32, "C1", 12, "C1"), (44, "E", 8, "EV"),
    (52, "A3", 8, "T"), (60, "B2", 8, "B2"), (68, "C2", 12, "C2"),
    (80, "E2", 8, "EV"), (88, "F", 8, "FV"), (96, "A4", 8, "TE"),
    (104, "C3", 12, "C3"), (116, "G", 8, "GV"), (124, "C4", 12, "C4"),
    (136, "A5", 8, "TE"), (144, "H1", 8, "Q"),
    (152, "C5", 12, "C1"), (164, "A6", 8, "T"),
    (172, "D2", 8, "DV"), (180, "H2", 8, "Q2"),
    (188, "E3", 8, "EV"), (196, "C6", 12, "C3"),
    (208, "F2", 8, "FV"), (216, "G2", 8, "GV"),
    (224, "A7", 8, "TE"), (232, "H3", 16, "Q3"),
    (248, "J", 24, "Q4"), (272, "OUT", 4, "O"),
]
assert sum(nb for _, _, nb, _ in SECTIONS) == BARS

SEC_OF = {}
SEC_STARTS = set()
for _s0, _k, _nb, _mat in SECTIONS:
    SEC_STARTS.add(_s0)
    for _b in range(_s0, _s0 + _nb):
        SEC_OF[_b] = _k


def sec_of_bar(bar):
    for s0, k, nb, _ in SECTIONS:
        if s0 <= bar < s0 + nb:
            return (s0, k, nb)
    return SECTIONS[0]


# ── 根音窗口((base, root, 宽槽);每窗口跨 2 小节,OUT 为 1 小节)────────
WIN_A = [(0, 38), (14, 36), (28, 41), (42, 38)]


def shifted(base):
    return [(b + base, r, 14) for b, r in WIN_A]


def win4(base, roots, w=14):
    return [(base + w * i, r, w) for i, r in enumerate(roots)]


def win6(base):
    return win4(base, (38, 41, 43, 45)) + win4(base + 56, (38, 36))


WINDOWS = []
for s0, k, nb, _ in SECTIONS:
    if k.startswith("A"):
        WINDOWS += shifted(s0 * SPB)
    elif k == "B":
        WINDOWS += win4(s0 * SPB, (38, 41, 43, 45))
    elif k == "B2":
        WINDOWS += win4(s0 * SPB, (41, 43, 45, 38))
    elif k.startswith("D"):
        WINDOWS += win4(s0 * SPB, (38, 38, 41, 41))
    elif k.startswith("C"):
        WINDOWS += win6(s0 * SPB)
    elif k.startswith("E"):
        WINDOWS += win4(s0 * SPB, (38, 41, 43, 45))
    elif k.startswith("F"):
        WINDOWS += win4(s0 * SPB, (38, 41, 45, 43))
    elif k.startswith("G"):
        WINDOWS += win4(s0 * SPB, (38, 41, 38, 45))
    elif k.startswith(("H", "J")):
        roots = (38, 43, 41, 45) * (nb // 8)
        WINDOWS += win4(s0 * SPB, roots)
    elif k == "OUT":
        WINDOWS += win4(s0 * SPB, (43, 38, 38, 38), w=7)
WINDOWS.sort(key=lambda w: w[0])
# 校验窗口无缝全覆盖
_pos = 0
for b, r, w in WINDOWS:
    assert b == _pos, (b, _pos)
    _pos += w
assert _pos == TOTAL, _pos


def window_root(slot):
    lo, hi = 0, len(WINDOWS) - 1
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if WINDOWS[mid][0] <= slot:
            lo = mid
        else:
            hi = mid - 1
    return WINDOWS[lo][1]


def third_below(m):
    """旋律音的三度下方(取在阶内者)"""
    for d in (4, 3):
        if (m - d) % 12 in ALLOWED:
            return m - d
    raise ValueError(m)


def scale_step(midi, steps):
    """在 D 多利亚音阶内移动，供长音切片生成邻音回声。"""
    notes = [m for m in range(48, 87) if m % 12 in ALLOWED]
    i = min(range(len(notes)), key=lambda n: abs(notes[n] - midi))
    return notes[max(0, min(len(notes) - 1, i + steps))]


def reshape_melody(events, start_bar):
    """压低刺耳高音，并把 4 槽以上长音发展成 2+2(+...) 的短句。"""
    out = []
    for o, d, midi in events:
        m = midi - 12 if midi > 79 else midi
        if start_bar < 16 or d < 4:
            out.append((o, d, m))
            continue
        pos, left, k = o, d, 0
        contour = (0, -1, 0, 1)
        while left:
            take = min(2, left)
            out.append((pos, take, scale_step(m, contour[k % 4])))
            pos += take
            left -= take
            k += 1
    return out


ARP_WINS = []                             # 琶音窗口(B/B2/E/E2/G/A5 后半)
for s0, k, nb, _ in SECTIONS:
    if k == "B":
        ARP_WINS += win4(s0 * SPB, (38, 41, 43, 45))
    elif k == "B2":
        ARP_WINS += win4(s0 * SPB, (41, 43, 45, 38))
    elif k.startswith("E"):
        ARP_WINS += win4(s0 * SPB, (38, 41, 43, 45))
    elif k.startswith("G"):
        ARP_WINS += win4(s0 * SPB, (38, 41, 38, 45))
    elif k in ("A5", "A7"):
        ARP_WINS += [(s0 * SPB + 28, 41, 14), (s0 * SPB + 42, 38, 14)]
    elif k.startswith(("H", "J")):
        roots = (38, 43, 41, 45) * (nb // 8)
        ARP_WINS += win4(s0 * SPB, roots)

PAD_WINS = [w for w in WINDOWS if w[0] >= 8 * SPB]


def build_score():
    sc = {"LEAD": [], "HARM": [], "PULSE": [], "BASS": [], "SUB": [],
          "PAD": [], "ARP": []}
    # 旋律:主题各块 + B/C/D/E/F/G/OUT 素材
    for s0, k, nb, mat in SECTIONS:
        base = s0 * SPB
        if mat == "T":
            evs = THEME
        elif mat == "TE":
            evs = [(o, d, m) for o, d, m in THEME if o < 49] + ENDING2
        elif mat == "B":
            evs = BPHRASE
        elif mat == "B2":
            evs = BPHRASE2
        elif mat == "DV":
            evs = PH_DV
        elif mat == "EV":
            evs = PH_EV
        elif mat == "FV":
            evs = PH_FV
        elif mat == "GV":
            evs = PH_GV
        elif mat.startswith("Q"):
            shift = 0 if mat == "Q" else (12 if mat == "Q2" else 0)
            evs = [(o, d, m + shift) for o, d, m in PH_QV]
            if mat == "Q3":
                evs += [(o + 56, d, m + (12 if o < 28 else 0))
                        for o, d, m in PH_QV]
            elif mat == "Q4":
                # 24 小节联合发展：副主题原形、节奏错位、与主主题切片交错。
                evs = ([(o, d, m) for o, d, m in PH_QV] +
                       [(o + 56, d, m + (12 if o % 14 < 7 else 0))
                        for o, d, m in PH_QV] +
                       [(o + 112, d, m + (12 if i % 2 else 0))
                        for i, (o, d, m) in enumerate(PH_QV)])
        elif mat == "O":
            evs = OUTRO
        else:
            evs = {"C1": CP_C1, "C2": CP_C2, "C3": CP_C3, "C4": CP_C4}[mat]
        evs = reshape_melody(evs, s0)
        for o, d, m in evs:
            sc["LEAD"].append((base + o, d, m))
    # A2 后半程低三度和声(阶内)
    for o, d, m in THEME:
        if o >= 28:
            sc["HARM"].append((8 * SPB + o, d, third_below(m)))
    # 拨弦低音保持每小节四次起音，但在三种 7/8 分组间轮换；D/F 呼吸段
    # 仍保留音高骨架，却由渲染层显著收低，从而真正让固定脉冲暂时退场。
    for base, root, w in WINDOWS:
        for k in range(w // SPB):
            bar0 = base + k * SPB
            sec = SEC_OF[bar0 // SPB]
            pick = root + (12 if (bar0 // SPB) % 2 == 0 else 7)
            if sec.startswith(("E", "G")):
                pat = ((0, 3, 0), (3, 2, 7), (5, 1, 0), (6, 1, None))
            elif sec.startswith(("H", "C5", "C6")):
                pat = ((0, 2, 0), (2, 3, 7), (5, 1, 0), (6, 1, None))
            else:
                pat = ((0, 2, 0), (2, 2, 7), (4, 2, 0), (6, 1, None))
            for o, d, off in pat:
                sc["BASS"].append((bar0 + o, d, pick if off is None else root + off))
    # 中音区节奏支柱：明确标出 2+2+3 / 3+2+2 / 2+3+2，不再只剩主奏与低音。
    for bar in range(16, BARS - 4):
        sec = SEC_OF[bar]
        if sec.startswith(("D", "F")):
            positions = (0, 2, 5)            # 2+3+2，呼吸段较轻
        elif sec.startswith(("E", "G")):
            positions = (0, 3, 5)            # 3+2+2
        else:
            positions = (0, 2, 4)            # 2+2+3
        root = window_root(bar * SPB)
        tone = root + (19 if bar % 2 else 24)
        while tone > 69:
            tone -= 12
        for pos in positions:
            sc["PULSE"].append((bar * SPB + pos, 1, tone))
    # 正弦 sub:每小节槽 0 根音
    for base, root, w in WINDOWS:
        for k in range(w // SPB):
            bar0 = base + k * SPB
            sc["SUB"].append((bar0, 2, root))
    # 软铺底(开放五度 根+12/+19/+24):A 块之外全部窗口
    for base, root, w in PAD_WINS:
        for off in (12, 19, 24):
            sc["PAD"].append((base, 14, root + off))
    # 琶音:正弦直八分;E/E2/G 重音贴 2+2+3
    for base, root, w in ARP_WINS:
        for q in range(SPB * 2):
            off = (12, 19, 24, 19)[q % 4]
            sc["ARP"].append((base + q, 1, root + off))
    return sc


# ── 校验 ────────────────────────────────────────────────────────────────
RANGE = {"LEAD": (50, 86), "HARM": (47, 74), "PULSE": (48, 69), "BASS": (33, 57),
         "SUB": (33, 45), "PAD": (45, 70), "ARP": (50, 70)}
TONAL = ("LEAD", "HARM", "PULSE", "BASS", "SUB", "PAD", "ARP")


def validate(sc):
    errs = []
    for v, (lo, hi) in RANGE.items():
        for s, d, m in sc[v]:
            if not (lo <= m <= hi):
                errs.append("音域越界 %s slot%d midi%d" % (v, s, m))
    for v in TONAL:
        for s, d, m in sc[v]:
            if m % 12 not in ALLOWED:
                errs.append("多利亚阶外音 %s slot%d midi%d" % (v, s, m))
    evs = sorted(sc["LEAD"])
    for a, b in zip(evs, evs[1:]):
        if a[0] + a[1] > b[0]:
            errs.append("LEAD 重叠 slot%d/%d" % (a[0], b[0]))
    for bar in range(BARS):
        n = sum(1 for s, _, _ in sc["BASS"] if bar * SPB <= s < (bar + 1) * SPB)
        if n != 4:
            errs.append("小节 %d 低音起音 %d≠4" % (bar + 1, n))
    for bar in range(BARS):
        n = sum(1 for s, _, _ in sc["SUB"] if bar * SPB <= s < (bar + 1) * SPB)
        if n != 1:
            errs.append("小节 %d sub 起音 %d≠1" % (bar + 1, n))
    n_theme = sum(1 for s, _, _ in sc["LEAD"] if s < 56)
    if n_theme != len(THEME):
        errs.append("主题呈示事件数异常 %d" % n_theme)
    print("── D 多利亚 7/8 · %dBPM · %d 小节 = %.3fs 精确循环 ──"
          % (BPM, BARS, NS / SR))
    print("── 结构:" + " ".join("%s(%d)" % (k, nb) for _, k, nb, _ in SECTIONS)
          + " ──")
    print("── 骨架: tick/低音在 2+2+3、3+2+2、2+3+2 间换组，漂浮段退场 ──")
    if errs:
        for e in errs:
            print("  ✗", e)
        raise SystemExit(1)
    print("校验: 音域/音阶/单声部/低音覆盖/sub 全部通过")


# ── 合成 ────────────────────────────────────────────────────────────────
TABLE = 2048
_tables = {}


def wavetable(kind):
    if kind in _tables:
        return _tables[kind]
    t = [0.0] * TABLE
    for i in range(TABLE):
        ph = 2.0 * math.pi * i / TABLE
        v = 0.0
        if kind == "sine":
            v = math.sin(ph)
        elif kind == "saw":
            for k in range(1, 41):
                v += (1.0 if k % 2 else -1.0) * math.sin(k * ph) / k
        elif kind == "triangle":
            for k in range(1, 41):
                if k % 2 == 1:
                    v += (1.0 if (k // 2) % 2 == 0 else -1.0) \
                        * math.sin(k * ph) / (k * k)
        t[i] = v
    peak = max(abs(x) for x in t) or 1.0
    t = [x / peak for x in t]
    _tables[kind] = t
    return t


_envs = {}


def env_of(kind, n):
    key = (kind, n)
    if key in _envs:
        return _envs[key]
    env = [0.0] * n
    if kind == "pluck":
        att = max(1, int(0.003 * SR))
        rel = max(1, min(int(0.015 * SR), n // 4))
        for i in range(n):
            if i < att:
                env[i] = i / att
            else:
                env[i] = math.exp(-(i - att) / (0.20 * SR))
            if i >= n - rel:
                env[i] *= (n - i) / rel
    elif kind == "vox":
        att = max(1, int(0.045 * SR))
        rel = max(1, min(int(0.10 * SR), max(1, n - att)))
        sus = n - rel
        for i in range(n):
            if i < att:
                env[i] = 0.5 - 0.5 * math.cos(math.pi * i / att)
            else:
                base = 1.0 - 0.18 * (i - att) / max(1, sus - att)
                if i >= sus:
                    base *= max(0.0, 1.0 - (i - sus) / rel)
                env[i] = base
    elif kind == "pad":
        att = max(1, int(0.50 * SR))
        rel = max(1, int(0.80 * SR))
        sus = max(0, n - rel)
        for i in range(n):
            if i < att:
                env[i] = 0.5 - 0.5 * math.cos(math.pi * i / att)
            elif i < sus:
                env[i] = 1.0
            else:
                env[i] = 1.0 - (i - sus) / rel
    else:
        att = max(1, int(0.005 * SR))
        rel = max(1, min(int(0.02 * SR), n // 3))
        for i in range(n):
            if i < att:
                env[i] = i / att
            else:
                env[i] = math.exp(-(i - att) / (0.10 * SR))
            if i >= n - rel:
                env[i] *= (n - i) / rel
    _envs[key] = env
    return env


def add_note(L, R, kind, midi, s0, dur_s, gain, pan, ekind, mul=1.0,
             ratio=1.0, vib=0.0, vhz=5.2, vdel=0.0):
    tab = wavetable(kind)
    n = int(dur_s * mul * SR)
    if n <= 0:
        return
    env = env_of(ekind, n)
    base = f_midi(midi) * ratio * TABLE / SR
    gl = gain * math.sqrt((1.0 - pan) / 2.0)
    gr = gain * math.sqrt((1.0 + pan) / 2.0)
    vd = int(vdel * SR)
    i, j = s0, 0
    ph = 0.0
    while j < n:
        if i >= NS:
            i -= NS
        end = NS if i + (n - j) >= NS else i + (n - j)
        while i < end:
            if vib and j > vd:
                ph += base * (1.0 + vib * math.sin(2.0 * math.pi * vhz * j / SR))
            else:
                ph += base
            L[i] += tab[int(ph) % TABLE] * env[j] * gl
            R[i] += tab[int(ph) % TABLE] * env[j] * gr
            i += 1
            j += 1


def add_glass(L, R, midi, s0, dur_s, gain, pan, ekind, mul=1.0, ratio=1.0,
              vib=0.0, vdel=0.0):
    add_note(L, R, "triangle", midi, s0, dur_s, gain * 0.55, pan, ekind, mul,
             ratio, vib, 5.2, vdel)
    add_note(L, R, "sine", midi, s0, dur_s, gain * 0.45, pan, ekind, mul,
             ratio, vib, 5.2, vdel)
    add_note(L, R, "sine", midi + 12, s0, dur_s, gain * 0.30, pan, ekind, mul,
             ratio, vib, 5.2, vdel)


def _lcg(t0):
    st = (t0 * 2654435761 + 12345) % 2147483648
    while True:
        st = (st * 1103515245 + 12345) % 2147483648
        yield st / 1073741824.0 - 1.0


def add_tick(L, R, t0, gain, hi):
    n = int(0.16 * SR)
    f0 = f_midi(64) if hi else f_midi(59)
    w1 = 2.0 * math.pi * f0 / SR
    w2 = 2.0 * math.pi * f0 * 1.006 / SR
    lp_a = 1.0 - math.exp(-2.0 * math.pi * 2200.0 / SR)
    fade = max(1, int(0.012 * SR))
    ph1 = ph2 = 0.0
    lp = 0.0
    for j in range(n):
        t = j / SR
        ph1 += w1
        ph2 += w2
        s = math.sin(ph1) + 0.55 * math.sin(ph2)
        d = math.tanh(4.0 * s)
        lp += lp_a * (d - lp)
        v = lp * math.exp(-t / 0.060)
        if j >= n - fade:
            v *= (n - j) / fade
        i = (t0 + j) % NS
        L[i] += v * gain
        R[i] += v * gain


def add_kick(L, R, t0, gain):
    n = int(0.15 * SR)
    ph = 0.0
    for j in range(n):
        t = j / SR
        f = 120.0 * (42.0 / 120.0) ** min(1.0, t / 0.055)
        ph += 2.0 * math.pi * f / SR
        v = math.sin(ph) * (10.0 ** (-3.0 * t / 0.10)) * gain
        i = (t0 + j) % NS
        L[i] += v
        R[i] += v


def add_snare(L, R, t0, gain):
    n = int(0.09 * SR)
    ah = 1.0 - math.exp(-2.0 * math.pi * 1900 / SR)
    y = 0.0
    nz = _lcg(t0)
    ph = 0.0
    for j in range(n):
        t = j / SR
        x = next(nz)
        y += ah * (x - y)
        ph += 2.0 * math.pi * 190.0 / SR
        v = ((x - y) * 0.85 + 0.35 * math.sin(ph)) * gain \
            * math.exp(-t / 0.030)
        i = (t0 + j) % NS
        L[i] += v * 0.8
        R[i] += v * 0.8


def add_shaker(L, R, t0, gain):
    n = int(0.035 * SR)
    ah = 1.0 - math.exp(-2.0 * math.pi * 6200 / SR)
    y = 0.0
    nz = _lcg(t0)
    for j in range(n):
        t = j / SR
        x = next(nz)
        y += ah * (x - y)
        v = y * gain * math.exp(-t / 0.010)
        i = (t0 + j) % NS
        L[i] += v * 0.6
        R[i] += v * 0.6


def add_tom(L, R, t0, gain):
    n = int(0.22 * SR)
    ph = 0.0
    for j in range(n):
        t = j / SR
        f = 160.0 * (95.0 / 160.0) ** min(1.0, t / 0.10)
        ph += 2.0 * math.pi * f / SR
        v = math.sin(ph) * (10.0 ** (-3.0 * t / 0.15)) * gain
        i = (t0 + j) % NS
        L[i] += v
        R[i] += v


def mel_gain_mul(slot):
    k = SEC_OF[min(slot // SPB, BARS - 1)]
    if k.startswith(("D", "F")):
        return 0.78
    if k == "OUT":
        return 0.9
    return 1.0


def render(sc):
    L = array.array("d", [0.0]) * NS
    R = array.array("d", [0.0]) * NS

    def S(slot):
        return slot * SPS

    arp_slots = set(s for s, d, m in sc["ARP"])

    targets = [0.72 if SEC_OF[b].startswith(("H", "J")) else
               0.56 if SEC_OF[b].startswith(("D", "F")) else 0.32
               for b in range(BARS)]
    color_curve = [targets[0]]
    for bar in range(1, BARS):
        color_curve.append(color_curve[-1] + 0.25 *
                           (targets[bar] - color_curve[-1]))

    for s, d, m in sc["LEAD"]:
        g = 0.145 * mel_gain_mul(s)
        bar = min(s // SPB, BARS - 1)
        color = color_curve[bar]
        pan = -0.12 - 0.10 * color
        if d <= 2:
            for ratio in (0.9975, 1.0025):
                add_glass(L, R, m, S(s), d * SLOT_S, g, pan,
                          "pluck", 1.8, ratio)
        else:
            for ratio in (0.9975, 1.0025):
                add_glass(L, R, m, S(s), d * SLOT_S, g + 0.01, pan,
                          "vox", 1.02, ratio, vib=0.0035, vdel=0.25)
    for s, d, m in sc["HARM"]:
        if d <= 2:
            add_glass(L, R, m, S(s), d * SLOT_S, 0.055, 0.30, "pluck", 1.8)
        else:
            add_glass(L, R, m, S(s), d * SLOT_S, 0.060, 0.30, "vox", 1.02)
    for s, d, m in sc["PULSE"]:
        sec = SEC_OF[s // SPB]
        gain = 0.038 if sec.startswith(("D", "F")) else 0.052
        add_note(L, R, "triangle", m, S(s), d * SLOT_S, gain, 0.28,
                 "pluck", 1.35)
        add_note(L, R, "sine", m + 12, S(s), d * SLOT_S, gain * 0.22,
                 -0.22, "pluck", 1.20)
    for s, d, m in sc["BASS"]:
        sec = SEC_OF[min(s // SPB, BARS - 1)]
        mul = 0.34 if sec.startswith(("D", "F")) else \
            (0.72 if sec.startswith(("H", "J")) else 1.0)
        # 低音只调暗增益；波形保持同一锯齿家族，避免段界换乐器。
        add_note(L, R, "saw", m, S(s), d * SLOT_S, 0.082 * mul, 0.0,
                 "pluck", 1.15)
    for s, d, m in sc["SUB"]:
        add_note(L, R, "sine", m, S(s), d * SLOT_S, 0.075, 0.0, "sub", 1.3)
    for s, d, m in sc["PAD"]:
        add_note(L, R, "triangle", m, S(s), d * SLOT_S, 0.030, -0.05,
                 "pad", 1.0, 0.9985)
        add_note(L, R, "triangle", m, S(s), d * SLOT_S, 0.030, 0.05,
                 "pad", 1.0, 1.0015)
        add_note(L, R, "sine", m, S(s), d * SLOT_S, 0.026, 0.0, "pad", 1.0)
    for s, d, m in sc["ARP"]:
        k = SEC_OF[min(s // SPB, BARS - 1)]
        if k in ("E", "E2", "G"):
            g = 0.055 * (1.35 if s % 7 in (0, 3, 4) else 0.75)
        else:
            g = 0.055
        add_note(L, R, "sine", m, S(s), d * SLOT_S, g, 0.20, "arp", 1.2)

    # 鼓组：tick 随 2+2+3 / 3+2+2 / 2+3+2 分组移动；漂浮段只留隔小节
    # 的一个远脉冲，打破旧版五分钟从头到尾 0/3 不变的问题。
    for bar in range(BARS):
        s0 = bar * SPB
        k = SEC_OF[bar]
        groups = ((0, 2, 5) if k.startswith(("D", "F")) else
                  (0, 3, 5) if k.startswith(("E", "G")) else
                  (0, 2, 4))
        base_gain = 0.045 if k.startswith(("D", "F")) else 0.070
        for gi, pos in enumerate(groups):
            add_tick(L, R, S(s0 + pos), base_gain * (1.0 if gi == 0 else 0.72),
                     gi == 2)
        # kick
        if k in ("A", "A2", "A3", "A4", "A5", "OUT"):
            add_kick(L, R, S(s0), 0.28)
        elif k in ("B", "B2") or k.startswith(("E", "G", "H", "J")):
            add_kick(L, R, S(s0), 0.28)
            add_kick(L, R, S(s0 + 5), 0.22)
        elif k.startswith("C"):
            if bar % 2 == 0:
                add_kick(L, R, S(s0), 0.24)
        elif k.startswith("D"):
            if bar % 2 == 0:
                add_kick(L, R, S(s0), 0.20)
        # snare(槽 4)
        if k in ("A2", "B", "B2", "A4", "A5", "A7") or \
                k.startswith(("E", "G", "H", "J")):
            add_snare(L, R, S(s0 + 4), 0.088)
        elif k.startswith("C"):
            if bar % 2 == 0:
                add_snare(L, R, S(s0 + 4), 0.088)
        # shaker(直八分,轻)
        if k in ("A2", "B", "B2", "A5", "A7") or \
                k.startswith(("E", "G", "H", "J")):
            for q in range(SPB):
                add_shaker(L, R, S(s0 + q), 0.013)
        # 段头 tom
        if bar in SEC_STARTS:
            add_tom(L, R, S(s0), 0.12)
        # 段尾小滚奏(最后 2 槽)
        if bar + 1 in SEC_STARTS and bar + 1 != BARS:
            add_tom(L, R, S(s0 + 5), 0.11)
            add_tick(L, R, S(s0 + 6), 0.060, True)
        if bar == BARS - 1:                 # 末小节滚入循环头
            add_tom(L, R, S(s0 + 4), 0.11)
            add_tom(L, R, S(s0 + 5), 0.12)
            add_tick(L, R, S(s0 + 6), 0.065, True)
    return L, R


def _peak(L, R):
    peak = 0.0
    for i in range(NS):
        a = L[i] if L[i] > 0 else -L[i]
        b = R[i] if R[i] > 0 else -R[i]
        if a > peak:
            peak = a
        if b > peak:
            peak = b
    return peak


MASTER = 0.92


def write_seam(L, R, path, sec=10.0):
    peak = _peak(L, R)
    scale = MASTER / max(peak, 1e-9)
    k = 2.6
    inv = 1.0 / math.tanh(k)
    n = int(sec * SR)
    frames = array.array("h")
    for i in list(range(NS - n, NS)) + list(range(n)):
        x = math.tanh(k * L[i] * scale) * inv
        y = math.tanh(k * R[i] * scale) * inv
        frames.append(int(max(-1.0, min(1.0, x)) * 32767))
        frames.append(int(max(-1.0, min(1.0, y)) * 32767))
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(frames.tobytes())


def finalize(L, R, path, reps):
    peak = _peak(L, R)
    scale = MASTER / max(peak, 1e-9)
    k = 2.6
    inv = 1.0 / math.tanh(k)
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        for _ in range(reps):
            for start in range(0, NS, 262144):
                frames = array.array("h")
                for i in range(start, min(NS, start + 262144)):
                    x = math.tanh(k * L[i] * scale) * inv
                    y = math.tanh(k * R[i] * scale) * inv
                    frames.append(int(max(-1.0, min(1.0, x)) * 32767))
                    frames.append(int(max(-1.0, min(1.0, y)) * 32767))
                w.writeframesraw(frames.tobytes())
    return peak, scale


def main():
    print("── 霓虹幸存者 · 虚空深渊「7/8 玻璃脉冲 · 扩写版」──")
    print("规格: D 多利亚 / %dBPM / %d 小节 / %.3fs / 44.1kHz 16bit 立体声"
          % (BPM, BARS, NS / SR))
    sc = build_score()
    validate(sc)
    print("渲染中(纯 Python,约 2-5 分钟)…")
    L, R = render(sc)
    p1 = os.path.join(HERE, "void_ext_loop.wav")
    p2 = os.path.join(HERE, "void_ext_seam.wav")
    peak, scale = finalize(L, R, p1, 1)
    write_seam(L, R, p2, 10.0)
    print("峰值 %.3f → 增益 %.2f;输出:" % (peak, scale))
    print("  %s (%.3fs)" % (p1, NS / SR))
    print("  %s (20s = 末10s+头10s 循环缝试听)" % p2)
    print("── 接缝报告 ──")
    print("  tick: 末段滚奏跨缝接回主题 2+2+3 重音")
    print("  BASS/SUB: OUT 窗口 G→D 根音律动 → 循环头 A 段 D 根音律动,同型衔接")
    print("  LEAD: 收束句末音 A4 长悬卷回,与循环头主题首音 A4 咬合")
    print("  鼓组: 末小节 tom+tick 滚奏接循环头段首 tom+全套律动")


if __name__ == "__main__":
    main()
