#!/usr/bin/env python3
# test_audio_ext/crimson_ext_gen.py — 血色荒原 BGM「动力轮舞 · 扩写版」生成器
# (纯标准库,零依赖) A 和声小调 · 4/4 · 144 BPM · 304 小节 = 506.667s。
# 高速轮舞加入长线副主题、音色对比与第二轮大规模发展。
# 结构:Rondo 叠句 A(8) 与新段交替 —
#   A B A C | D(16,新:半速重拍慢riff) A B' C'(10,新riff) | D'(12,新变奏) A
#   E(16,新:breakdown-build 长线) | C''(10,新riff) A B''(8,新琶音) |
#   F(20,新:终段发展 = D风8 + C风8 + build4) | G(12,新:半音上行总build) A A(末段叠双)
# 循环缝:末段 A 末小节 E7 → 第 1 小节 Am 属主解决 + 军鼓滚奏跨缝。
# 音色沿用:双失谐锯齿主奏/锯齿低音音型/方波戳/三角 pad/正弦 sub + 全套鼓。
# 输出:crimson_ext_loop.wav + crimson_ext_seam.wav(末10s+头10s)
# 运行:python3 test_audio_ext/crimson_ext_gen.py

import math
import os
import wave
import array

SR = 44100
BPM = 144
BARS = 304
SPB = 16
TOTAL = BARS * SPB                        # 2912 槽
BAR_SMP = 73500                           # 每小节样本数(整)
NS = BARS * BAR_SMP                       # 22,344,000 = 506.667s
HERE = os.path.dirname(os.path.abspath(__file__))
assert NS == 22344000

SEC_A = ["Am", "Am", "Dm", "E7", "Am", "Am", "F", "E7"]
SEC_B = ["F", "F", "G", "G", "E", "E"]
SEC_C = ["Am", "G#o", "G", "G", "D/F#", "F", "F", "E", "E", "E"]
SEC_D = ["Am", "Am", "G", "G", "F", "F", "E", "E"] * 2
SEC_C2 = ["Dm", "E7", "Am", "G#o", "G", "G", "D/F#", "F", "E", "E"]
SEC_D2 = ["Dm", "Dm", "F", "F", "Am", "Am", "E", "E", "Dm", "F", "E7", "E7"]
SEC_E = ["F", "G", "Am", "Am", "F", "G", "Am", "Am",
         "F", "G", "Am", "Am", "Dm", "Dm", "E7", "E7"]
SEC_C3 = ["Am", "G#o", "G", "G", "D/F#", "F", "F", "E", "E", "E"]
SEC_B2 = ["F", "G", "E7", "E7", "F", "G", "E7", "E7"]
SEC_F = (["Am", "Am", "G", "G", "F", "F", "E", "E"] +
         ["Am", "G#o", "G", "G", "D/F#", "F", "E", "E"] +
         ["Dm", "Dm", "E7", "E7"])
SEC_G = ["F", "F", "G", "G", "Am", "Am", "E7", "E7", "Dm", "Dm", "E7", "E7"]
SEC_H = ["Am", "Am", "F", "F", "G", "G", "Dm", "E7",
         "Am", "G", "F", "E7", "Dm", "F", "E7", "E7"]

SECTIONS = [(0, "A", SEC_A), (8, "B", SEC_B), (14, "A", SEC_A),
            (22, "C", SEC_C), (32, "D", SEC_D), (48, "A", SEC_A),
            (56, "B2", SEC_B), (62, "C2", SEC_C2), (72, "D2", SEC_D2),
            (84, "A", SEC_A), (92, "E", SEC_E), (108, "C3", SEC_C3),
            (118, "A", SEC_A), (126, "B3", SEC_B2), (134, "F", SEC_F),
            (154, "G", SEC_G), (166, "A", SEC_A), (174, "A", SEC_A),
            (182, "H1", SEC_H), (198, "C4", SEC_C3), (208, "D3", SEC_D),
            (224, "A", SEC_A), (232, "B4", SEC_B2), (240, "H2", SEC_H),
            (256, "F", SEC_F), (276, "G", SEC_G), (288, "A", SEC_A),
            (296, "A", SEC_A)]
assert sum(len(ch) for _, _, ch in SECTIONS) == BARS

CH = {
    "Am": (45, [9, 0, 4]), "Dm": (38, [2, 5, 9]), "E7": (40, [4, 8, 11, 2]),
    "F": (41, [5, 9, 0]), "G": (43, [7, 11, 2]), "G#o": (44, [8, 11, 2]),
    "D/F#": (42, [2, 6, 9]), "E": (40, [4, 8, 11]),
    "C": (36, [0, 4, 7]),
}

SEC_OF = {}
for _s0, _k, _ch in SECTIONS:
    for _b in range(_s0, _s0 + len(_ch)):
        SEC_OF[_b] = _k


def chord_at(bar):
    for s0, k, ch in SECTIONS:
        if s0 <= bar < s0 + len(ch):
            return ch[bar - s0]
    return "Am"


def f_midi(m):
    return 440.0 * (2.0 ** ((m - 69) / 12.0))


# ── A 段叠句 riff(原版 8 小节,轮回身份)───────────────────────────────
RIFF = {
    0: [(0, 2, 69), (4, 1, 72), (5, 1, 74), (6, 2, 72), (8, 4, 76),
        (12, 2, 72), (14, 2, 69)],
    1: [(0, 2, 81), (2, 2, 80), (4, 4, 81), (8, 2, 76), (10, 2, 72),
        (12, 4, 69)],
    2: [(0, 2, 74), (4, 1, 77), (5, 1, 76), (6, 2, 74), (8, 4, 81),
        (12, 2, 77), (14, 2, 74)],
    3: [(0, 2, 80), (2, 2, 76), (4, 4, 71), (8, 2, 74), (10, 2, 71),
        (12, 4, 68)],
    4: [(0, 4, 76), (4, 2, 72), (6, 2, 74), (8, 2, 76), (10, 2, 72),
        (12, 4, 69)],
    5: [(0, 2, 84), (2, 2, 81), (4, 4, 81), (8, 2, 76), (10, 2, 72),
        (12, 4, 72)],
    6: [(0, 2, 77), (4, 2, 81), (6, 2, 84), (8, 4, 81), (12, 2, 77),
        (14, 2, 74)],
    7: [(0, 2, 80), (2, 2, 76), (4, 4, 71), (8, 2, 74), (10, 2, 71),
        (12, 4, 68)],
}
LEAD_B = [
    [(0, 8, 81), (8, 8, 77)], [(0, 8, 84), (8, 8, 81)],
    [(0, 8, 79), (8, 8, 74)], [(0, 8, 71), (8, 8, 74)],
    [(0, 8, 76), (8, 8, 80)], [(0, 4, 71), (4, 4, 74), (8, 2, 76),
                               (10, 2, 77), (12, 4, 80)],
]
LEAD_C = [
    [(0, 4, 81), (4, 2, 80), (6, 2, 81), (8, 4, 84), (12, 2, 81), (14, 2, 80)],
    [(0, 4, 80), (4, 2, 83), (6, 2, 80), (8, 4, 86), (12, 2, 83), (14, 2, 80)],
    [(0, 4, 83), (4, 2, 81), (6, 2, 79), (8, 4, 79), (12, 2, 78), (14, 2, 79)],
    [(0, 4, 86), (4, 2, 83), (6, 2, 79), (8, 4, 83), (12, 2, 79), (14, 2, 78)],
    [(0, 4, 78), (4, 2, 81), (6, 2, 86), (8, 4, 81), (12, 2, 78), (14, 2, 81)],
    [(0, 4, 77), (4, 2, 81), (6, 2, 84), (8, 4, 81), (12, 2, 77), (14, 2, 72)],
    [(0, 4, 84), (4, 2, 81), (6, 2, 77), (8, 4, 84), (12, 2, 81), (14, 2, 77)],
    [(0, 4, 80), (4, 2, 76), (6, 2, 71), (8, 4, 76), (12, 2, 80), (14, 2, 76)],
    [(0, 4, 83), (4, 2, 80), (6, 2, 76), (8, 4, 71), (12, 2, 68), (14, 2, 64)],
    [(0, 8, 64), (8, 8, 68)],
]

# ── 新段素材 ──────────────────────────────────────────────────────────
# D 段慢 riff(16 小节,二分/四分长值,半速重拍)
LEAD_D = [
    [(0, 8, 69), (8, 4, 72), (12, 4, 74)],
    [(0, 8, 76), (8, 8, 74)],
    [(0, 8, 74), (8, 4, 71), (12, 4, 67)],
    [(0, 8, 71), (8, 8, 74)],
    [(0, 8, 72), (8, 4, 69), (12, 4, 65)],
    [(0, 8, 69), (8, 8, 65)],
    [(0, 12, 68), (12, 4, 71)],
    [(0, 16, 64)],
    [(0, 8, 69), (8, 4, 72), (12, 4, 74)],
    [(0, 8, 76), (8, 8, 74)],
    [(0, 8, 74), (8, 4, 71), (12, 4, 67)],
    [(0, 8, 71), (8, 8, 74)],
    [(0, 8, 69), (8, 8, 72)],
    [(0, 8, 72), (8, 8, 69)],
    [(0, 8, 76), (8, 4, 74), (12, 4, 71)],
    [(0, 16, 68)],
]
# D' 变奏(12 小节,新和声 Dm F Am E)
LEAD_D2 = [
    [(0, 8, 65), (8, 4, 69), (12, 4, 72)],
    [(0, 8, 74), (8, 8, 72)],
    [(0, 8, 72), (8, 4, 69), (12, 4, 65)],
    [(0, 8, 69), (8, 8, 72)],
    [(0, 8, 69), (8, 4, 72), (12, 4, 76)],
    [(0, 8, 74), (8, 8, 72)],
    [(0, 12, 68), (12, 4, 71)],
    [(0, 16, 71)],
    [(0, 8, 65), (8, 8, 69)],
    [(0, 8, 72), (8, 8, 69)],
    [(0, 8, 68), (8, 4, 71), (12, 4, 74)],
    [(0, 16, 76)],
]
# C' 新 riff(10 小节,和声 Dm E7 Am G#o G G D/F# F E E)
LEAD_C2 = [
    [(0, 4, 74), (4, 2, 77), (6, 2, 74), (8, 4, 81), (12, 2, 77), (14, 2, 74)],
    [(0, 4, 80), (4, 2, 86), (6, 2, 80), (8, 4, 83), (12, 2, 80), (14, 2, 86)],
    [(0, 4, 81), (4, 2, 84), (6, 2, 81), (8, 4, 88), (12, 2, 84), (14, 2, 81)],
    [(0, 4, 80), (4, 2, 83), (6, 2, 80), (8, 4, 86), (12, 2, 83), (14, 2, 80)],
    [(0, 4, 79), (4, 2, 83), (6, 2, 79), (8, 4, 74), (12, 2, 79), (14, 2, 74)],
    [(0, 4, 74), (4, 2, 79), (6, 2, 83), (8, 4, 79), (12, 2, 74), (14, 2, 71)],
    [(0, 4, 78), (4, 2, 81), (6, 2, 86), (8, 4, 81), (12, 2, 78), (14, 2, 81)],
    [(0, 4, 77), (4, 2, 81), (6, 2, 84), (8, 4, 81), (12, 2, 77), (14, 2, 72)],
    [(0, 4, 76), (4, 2, 80), (6, 2, 83), (8, 4, 80), (12, 2, 76), (14, 2, 71)],
    [(0, 8, 80), (8, 8, 76)],
]
# C'' 新 riff(10 小节)
LEAD_C3 = [
    [(0, 4, 84), (4, 2, 81), (6, 2, 72), (8, 4, 84), (12, 2, 81), (14, 2, 72)],
    [(0, 4, 83), (4, 2, 80), (6, 2, 86), (8, 4, 83), (12, 2, 80), (14, 2, 86)],
    [(0, 4, 86), (4, 2, 83), (6, 2, 79), (8, 4, 83), (12, 2, 79), (14, 2, 74)],
    [(0, 4, 79), (4, 2, 74), (6, 2, 71), (8, 4, 79), (12, 2, 74), (14, 2, 79)],
    [(0, 4, 78), (4, 2, 81), (6, 2, 86), (8, 4, 81), (12, 2, 78), (14, 2, 86)],
    [(0, 4, 81), (4, 2, 77), (6, 2, 72), (8, 4, 77), (12, 2, 81), (14, 2, 84)],
    [(0, 4, 77), (4, 2, 72), (6, 2, 69), (8, 4, 77), (12, 2, 72), (14, 2, 77)],
    [(0, 4, 76), (4, 2, 71), (6, 2, 68), (8, 4, 76), (12, 2, 71), (14, 2, 68)],
    [(0, 4, 68), (4, 2, 71), (6, 2, 76), (8, 4, 80), (12, 2, 83), (14, 2, 80)],
    [(0, 8, 76), (8, 8, 80)],
]
# E 段长线(16 小节,breakdown-build)
LEAD_E = [
    [(0, 8, 77), (8, 8, 81)], [(0, 8, 79), (8, 8, 83)],
    [(0, 8, 81), (8, 8, 84)], [(0, 8, 84), (8, 8, 81)],
    [(0, 8, 81), (8, 8, 77)], [(0, 8, 79), (8, 8, 83)],
    [(0, 8, 81), (8, 8, 84)], [(0, 4, 84), (4, 4, 81), (8, 4, 79), (12, 4, 76)],
    [(0, 8, 77), (8, 8, 81)], [(0, 8, 79), (8, 8, 83)],
    [(0, 8, 81), (8, 8, 84)], [(0, 4, 84), (4, 4, 81), (8, 4, 76), (12, 4, 72)],
    [(0, 8, 77), (8, 8, 74)], [(0, 8, 74), (8, 8, 77)],
    [(0, 8, 68), (8, 8, 71)],
    [(0, 4, 71), (4, 4, 74), (8, 4, 76), (12, 4, 80)],
]
# F 段中 8(C 风格新句)+ 后 4(build 长音)
LEAD_F2 = [
    [(0, 4, 81), (4, 2, 80), (6, 2, 81), (8, 4, 84), (12, 2, 81), (14, 2, 80)],
    [(0, 4, 80), (4, 2, 83), (6, 2, 80), (8, 4, 86), (12, 2, 83), (14, 2, 80)],
    [(0, 4, 79), (4, 2, 83), (6, 2, 79), (8, 4, 74), (12, 2, 79), (14, 2, 74)],
    [(0, 4, 74), (4, 2, 79), (6, 2, 83), (8, 4, 79), (12, 2, 74), (14, 2, 71)],
    [(0, 4, 78), (4, 2, 81), (6, 2, 78), (8, 4, 81), (12, 2, 78), (14, 2, 86)],
    [(0, 4, 77), (4, 2, 81), (6, 2, 84), (8, 4, 81), (12, 2, 77), (14, 2, 72)],
    [(0, 4, 76), (4, 2, 80), (6, 2, 83), (8, 4, 80), (12, 2, 76), (14, 2, 71)],
    [(0, 8, 80), (8, 8, 76)],
]
LEAD_F3 = [
    [(0, 16, 77)], [(0, 8, 77), (8, 8, 74)],
    [(0, 16, 68)], [(0, 8, 68), (8, 4, 71), (12, 4, 74)],
]
# G 段半音上行总 build(12 小节)
LEAD_G = [
    [(0, 4, 77), (4, 2, 81), (6, 2, 84)], [(0, 8, 84), (8, 4, 81), (12, 4, 77)],
    [(0, 4, 79), (4, 2, 83), (6, 2, 86)], [(0, 8, 86), (8, 4, 83), (12, 4, 79)],
    [(0, 4, 81), (4, 2, 84), (6, 2, 88)], [(0, 8, 88), (8, 4, 84), (12, 4, 81)],
    [(0, 4, 80), (4, 2, 83), (6, 2, 86)], [(0, 8, 86), (8, 4, 83), (12, 4, 80)],
    [(0, 4, 77), (4, 2, 81), (6, 2, 86)], [(0, 8, 86), (8, 4, 81), (12, 4, 77)],
    [(0, 4, 80), (4, 2, 83), (6, 2, 88)], [(0, 8, 88), (8, 4, 86), (12, 4, 83)],
]

RANGE = {"LEAD": (60, 88), "LEAD2": (72, 100), "OST": (36, 66),
         "STAB": (45, 78), "SWELL": (48, 70), "BASS": (38, 50),
         "SUB": (26, 40)}


def third_of(cname):
    return 4 if cname in ("F", "G", "C", "E", "D/F#", "E7") else 3


def bass_alt(root, i):
    """D/F 段二分低音第二拍:根音或五度,越界降八度"""
    m = root + (0 if i % 2 else 7)
    if m > 50:
        m -= 12
    return m


def develop_rhythm(events, section):
    """把 riff 的短短长细胞投影到长线段；只切分时值，不更换主题音高。"""
    cells = {"B": (3, 1), "D": (2, 2), "E": (1, 3), "H": (3, 1)}
    out = []
    for s, d, m in events:
        left, pos = d, s
        cell = cells.get(section[0], (4,))
        ci = (s // SPB) % len(cell)
        while left > 4:
            take = min(left, cell[ci % len(cell)])
            mm = m
            if pos != s and pos % 4 == 0:
                pcs = CH[chord_at(min(pos // SPB, BARS - 1))][1]
                cand = [p for p in range(60, 89) if p % 12 in pcs]
                mm = min(cand, key=lambda p: abs(p - m))
            out.append((pos, take, mm))
            pos += take
            left -= take
            ci += 1
        if left:
            mm = m
            if pos != s and pos % 4 == 0:
                pcs = CH[chord_at(min(pos // SPB, BARS - 1))][1]
                cand = [p for p in range(60, 89) if p % 12 in pcs]
                mm = min(cand, key=lambda p: abs(p - m))
            out.append((pos, left, mm))
    return out


def build_score():
    sc = {"LEAD": [], "LEAD2": [], "OST": [], "STAB": [], "SWELL": [],
          "BASS": [], "SUB": []}
    for s0, kind, chords in SECTIONS:
        for i, cname in enumerate(chords):
            bar = s0 + i
            base = bar * SPB
            root, pcs = CH[cname]
            th = third_of(cname)
            if kind == "A":
                # 十六分低音音型 + 和弦戳 + 叠句 riff(末段 A 高八度叠双)
                b7 = 10 if cname == "E7" else 12
                pat = [0, 12, 0, 12, 7, 12, 0, 12, 0, 12, th, 12,
                       0, 12, 7, b7]
                for j, off in enumerate(pat):
                    sc["OST"].append((base + j, 1, root + off))
                for st in (4, 12):
                    sc["STAB"].append((base + st, 2, root + 12))
                    sc["STAB"].append((base + st, 2, root + 19))
                last = (bar >= 296)
                for st, d, m in RIFF[i]:
                    # 每次 A 回归用不同的装饰切分，核心音高与轮廓保持不变。
                    variant = (s0 // 8) % 4
                    split = s0 >= 84 and d >= 2 and (i + st + variant) % 3 == 0
                    parts = ((d // 2, d - d // 2) if split else (d,))
                    pos = base + st
                    for part in parts:
                        sc["LEAD"].append((pos, part, m))
                        if last:
                            sc["LEAD2"].append((pos, part, m + 12))
                        pos += part
            elif kind.startswith("B"):
                # 半速:全音符低音 + 2 小节涌动 pad + 长线/琶音
                if i % 2 == 0:
                    sc["BASS"].append((base, 32, root))
                    sc["SWELL"].append((base, 32, root + 12))
                    sc["SWELL"].append((base, 32, root + 12 + th))
                    sc["SWELL"].append((base, 32, root + 19))
                if kind == "B":
                    for st, d, m in LEAD_B[i]:
                        sc["LEAD"].append((base + st, d, m))
                else:
                    pat = [0, th, 7, 12, 12 + th, 12, 7, th]
                    for h, off in enumerate(pat):
                        sc["LEAD"].append((base + h * 2, 2, root + 24 + off))
            elif kind.startswith("C"):
                # 半音下行 riff 序列:根音四分推进 + 切分和弦戳
                sc["BASS"].append((base, 16, root))
                for st in (3, 6, 11, 14):
                    sc["STAB"].append((base + st, 2, root + 12))
                    sc["STAB"].append((base + st, 2, root + 19))
                mat = (LEAD_C if kind == "C" else
                       LEAD_C2 if kind == "C2" else LEAD_C3)[i]
                for st, d, m in mat:
                    sc["LEAD"].append((base + st, d, m))
            elif kind.startswith("D"):
                # 半速重拍:二分根五交替 + pad + 慢 riff
                sc["BASS"].append((base, 8, root))
                sc["BASS"].append((base + 8, 8, bass_alt(root, i)))
                if i % 2 == 0:
                    sc["SWELL"].append((base, 16, root + 12))
                    sc["SWELL"].append((base, 16, root + 12 + th))
                    sc["SWELL"].append((base, 16, root + 19))
                mat = LEAD_D2[i] if kind == "D2" else LEAD_D[i]
                for st, d, m in mat:
                    sc["LEAD"].append((base + st, d, m))
            elif kind == "E":
                # breakdown:pad + 长线,无低音音型
                if i % 2 == 0:
                    sc["SWELL"].append((base, 32, root + 12))
                    sc["SWELL"].append((base, 32, root + 12 + th))
                    sc["SWELL"].append((base, 32, root + 19))
                for st, d, m in LEAD_E[i]:
                    sc["LEAD"].append((base + st, d, m))
            elif kind.startswith("H"):
                # 长线副主题：和弦内的根/三/五度构成两小节问答，第二次出现
                # 调换句尾方向；稀疏低音给旋律留出明显的新音色空间。
                if i % 2 == 0:
                    sc["BASS"].append((base, 32, root))
                    for off in (12, 12 + th, 19):
                        sc["SWELL"].append((base, 32, root + off))
                picks = [root + 24, root + 24 + th, root + 31]
                while max(picks) > 88:
                    picks = [m - 12 for m in picks]
                a, b, c = picks
                if kind == "H2" and i % 2:
                    a, c = c, a
                sc["LEAD"].append((base, 8, a))
                sc["LEAD"].append((base + 8, 4, b))
                sc["LEAD"].append((base + 12, 4, c))
            elif kind == "F":
                if i < 8:                       # D 风
                    sc["BASS"].append((base, 8, root))
                    sc["BASS"].append((base + 8, 8, bass_alt(root, i)))
                    if i % 2 == 0:
                        sc["SWELL"].append((base, 16, root + 12))
                        sc["SWELL"].append((base, 16, root + 12 + th))
                        sc["SWELL"].append((base, 16, root + 19))
                    for st, d, m in LEAD_D[8 + i]:
                        sc["LEAD"].append((base + st, d, m))
                elif i < 16:                    # C 风
                    sc["BASS"].append((base, 16, root))
                    for st in (3, 6, 11, 14):
                        sc["STAB"].append((base + st, 2, root + 12))
                        sc["STAB"].append((base + st, 2, root + 19))
                    for st, d, m in LEAD_F2[i - 8]:
                        sc["LEAD"].append((base + st, d, m))
                else:                           # build 4
                    sc["BASS"].append((base, 16, root))
                    sc["SWELL"].append((base, 16, root + 12))
                    sc["SWELL"].append((base, 16, root + 12 + th))
                    for st, d, m in LEAD_F3[i - 16]:
                        sc["LEAD"].append((base + st, d, m))
            elif kind == "G":
                # 总 build:根音四分 + 切分戳 + 上行 riff
                sc["BASS"].append((base, 16, root))
                for st in (3, 6, 11, 14):
                    sc["STAB"].append((base + st, 2, root + 12))
                    sc["STAB"].append((base + st, 2, root + 19))
                for st, d, m in LEAD_G[i]:
                    sc["LEAD"].append((base + st, d, m))
            # sub 低音(每小节)
            sc["SUB"].append((base, 16, root - 12))
    # B/D/E/H 全由原 riff 的短短长节奏细胞发展，消除旧版逐小节长音。
    dense = []
    for ev in sc["LEAD"]:
        sec = SEC_OF[min(ev[0] // SPB, BARS - 1)]
        if sec[0] in "BDEH":
            dense.extend(develop_rhythm([ev], sec))
        elif ev[0] // SPB >= 256 and sec in ("F", "G") and ev[1] >= 2 \
                and (ev[0] + ev[2]) % 3 == 0:
            a = ev[1] // 2
            pos2 = ev[0] + a
            m2 = ev[2]
            if pos2 % 4 == 0:
                pcs = CH[chord_at(min(pos2 // SPB, BARS - 1))][1]
                cand = [p for p in range(60, 89) if p % 12 in pcs]
                m2 = min(cand, key=lambda p: abs(p - ev[2]))
            dense.extend([(ev[0], a, ev[2]), (pos2, ev[1] - a, m2)])
        else:
            dense.append(ev)
    sc["LEAD"] = dense
    return sc


# 所有段尾自动生成滚奏；末小节从第 6 槽起，跨缝推回开头 Am。
FILL_BARS = {s0 + len(ch) - 1: (12 if len(ch) >= 12 else 8)
             for s0, _, ch in SECTIONS}
FILL_BARS[BARS - 1] = 6


def drum_hits():
    hits = []
    kick_a = [0, 6, 8, 14]
    for s0, kind, chords in SECTIONS:
        for i, cname in enumerate(chords):
            bar = s0 + i
            base = bar * SPB
            if kind == "A":
                for k in kick_a:
                    hits.append((base + k, "K", 0.30))
                hits.append((base + 4, "S", 0.09))
                hits.append((base + 12, "S", 0.09))
                for j in range(16):
                    hits.append((base + j, "H", 0.030 if j % 4 == 0 else 0.018))
            elif kind.startswith("B"):
                hits.append((base, "K", 0.30))
                if kind == "B3":
                    hits.append((base + 10, "K", 0.24))
                    hits.append((base + 12, "S", 0.08))
                for j in (0, 4, 8, 12):
                    hits.append((base + j, "H", 0.020))
            elif kind.startswith("C"):
                hits.append((base, "K", 0.30))
                hits.append((base + 8, "K", 0.26))
                hits.append((base + 4, "S", 0.09))
                hits.append((base + 12, "S", 0.09))
                for j in range(16):
                    hits.append((base + j, "H", 0.030 if j % 4 == 0 else 0.016))
            elif kind.startswith("D"):
                hits.append((base, "K", 0.30))
                hits.append((base + 12, "S", 0.085))
                for j in (0, 4, 8, 12):
                    hits.append((base + j, "H", 0.024))
                if kind == "D2":
                    hits.append((base + 10, "K", 0.22))
            elif kind.startswith("H"):
                if i % 2 == 0:
                    hits.append((base, "K", 0.24))
                hits.append((base + 12, "S", 0.065))
                for j in (0, 4, 8, 12):
                    hits.append((base + j, "H", 0.014))
            elif kind == "E":
                for j in range(16):
                    hits.append((base + j, "H", 0.014 if j % 4 else 0.020))
                if i >= 14:
                    hits.append((base + 12, "K", 0.26))
                    hits.append((base, "K", 0.26))
            elif kind == "F":
                if i < 8:
                    hits.append((base, "K", 0.30))
                    hits.append((base + 12, "S", 0.085))
                    for j in (0, 4, 8, 12):
                        hits.append((base + j, "H", 0.024))
                elif i < 16:
                    hits.append((base, "K", 0.30))
                    hits.append((base + 8, "K", 0.26))
                    hits.append((base + 4, "S", 0.09))
                    hits.append((base + 12, "S", 0.09))
                    for j in range(16):
                        hits.append((base + j, "H",
                                     0.030 if j % 4 == 0 else 0.016))
                else:
                    hits.append((base, "K", 0.28))
                    hits.append((base + 8, "K", 0.28))
                    hits.append((base + 4, "S", 0.09))
                    hits.append((base + 12, "S", 0.09))
                    for j in range(16):
                        hits.append((base + j, "H",
                                     0.030 if j % 4 == 0 else 0.018))
            elif kind == "G":
                hits.append((base, "K", 0.30))
                hits.append((base + 8, "K", 0.26))
                hits.append((base + 4, "S", 0.09))
                hits.append((base + 12, "S", 0.09))
                g = 0.016 + 0.012 * (i / 11.0)
                for j in range(16):
                    hits.append((base + j, "H",
                                 g + (0.008 if j % 4 == 0 else 0.0)))
    for bar, st0 in FILL_BARS.items():
        base = bar * SPB
        for j in range(st0, 16):
            v = 0.03 + 0.05 * (j - st0) / max(1, 15 - st0)
            hits.append((base + j, "S", v))
    return hits


def active_at(evs, slot):
    return [m for s, d, m in evs if s <= slot < s + d]


def validate(sc):
    errs, warns = [], []
    for v, lo, hi in (("LEAD", 60, 88), ("LEAD2", 72, 100),
                      ("OST", 36, 66), ("STAB", 45, 78), ("SWELL", 48, 70),
                      ("BASS", 38, 50), ("SUB", 26, 40)):
        for s, d, m in sc[v]:
            if not (lo <= m <= hi):
                errs.append("音域越界 %s slot%d midi%d" % (v, s, m))

    def chord_of(slot):
        return CH[chord_at(min(slot // SPB, BARS - 1))][1]

    for v in ("LEAD", "OST", "STAB"):
        for s, d, m in sc[v]:
            if s % 4 != 0:
                continue
            if m % 12 not in chord_of(s):
                ok = False
                for w in (s - 4, s + 4):
                    for m2 in active_at(sc[v], max(0, w)):
                        if m2 % 12 in chord_of(s) and abs(m2 - m) <= 2:
                            ok = True
                if not ok:
                    warns.append("强拍外音 %s slot%d midi%d" % (v, s, m))
    for slot in range(0, TOTAL, 2):
        pool = []
        for v in ("LEAD", "STAB", "SWELL"):
            pool += [(m, v) for m in active_at(sc[v], slot)]
        for i in range(len(pool)):
            for j in range(i + 1, len(pool)):
                a, b = pool[i][0], pool[j][0]
                if pool[i][1] != pool[j][1] and 0 < abs(a - b) <= 13 \
                        and abs(a - b) % 12 == 1:
                    warns.append("半音碰撞 slot%d %s(%d)/%s(%d)"
                                 % (slot, pool[i][1], a, pool[j][1], b))
    # 音型覆盖:OST 在 A 段每小节 16 音全满
    a_slots = set()
    for s0, kind, chords in SECTIONS:
        if kind == "A":
            for i in range(len(chords)):
                for j in range(16):
                    a_slots.add((s0 + i) * SPB + j)
    got = set(s for s, d, m in sc["OST"])
    if a_slots - got:
        errs.append("OST 音型缺音 %d 个" % len(a_slots - got))
    print("── Rondo 段落表 ──")
    for s0, kind, chords in SECTIONS:
        print("  小节 %3d-%3d  %s(%d)" % (s0 + 1, s0 + len(chords), kind,
                                           len(chords)))
    print("── 接缝报告(第304小节 E7 → 第1小节 Am)──")
    for v in ("LEAD", "OST", "SUB"):
        last = max(sc[v], key=lambda e: e[0])
        first = min(sc[v], key=lambda e: e[0])
        print("  %s: midi%d → midi%d (G# 导音回 A)" % (v, last[2], first[2]))
    if errs or warns:
        for e in errs:
            print("  ✗", e)
        for w in warns:
            print("  !", w)
        raise SystemExit(1)
    print("校验:音域/强拍/碰撞/覆盖 %s,警告 %d 条" % ("通过", len(warns)))


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
        for k in range(1, 41):
            if kind == "sine":
                if k == 1:
                    v += math.sin(ph)
                break
            if kind == "square" and k % 2 == 1:
                v += math.sin(k * ph) / k
            elif kind == "saw":
                v += (1.0 if k % 2 else -1.0) * math.sin(k * ph) / k
            elif kind == "triangle" and k % 2 == 1:
                v += (1.0 if (k // 2) % 2 == 0 else -1.0) * math.sin(k * ph) / (k * k)
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
    if kind == "sus":
        att = max(1, min(int(0.02 * SR), n // 4))
        rel = max(1, min(int(0.03 * SR), max(1, n - att)))
        sus = n - rel
        for i in range(n):
            if i < att:
                env[i] = i / att
            elif i < sus:
                env[i] = 1.0
            else:
                env[i] = 10.0 ** (-3.0 * (i - sus) / max(1, rel))
    elif kind == "pad":
        att = max(1, min(int(0.4 * SR), n // 2))
        rel = max(1, min(int(0.08 * SR), max(1, n - att)))
        sus = n - rel
        for i in range(n):
            if i < att:
                env[i] = 0.5 - 0.5 * math.cos(math.pi * i / att)
            elif i < sus:
                env[i] = 1.0
            else:
                env[i] = 10.0 ** (-3.0 * (i - sus) / max(1, rel))
    _envs[key] = env
    return env


def add_note(L, R, kind, midi, s0, dur_s, gain, pan, ekind="sus", mul=1.0,
             ratio=1.0):
    tab = wavetable(kind)
    n = int(dur_s * mul * SR)
    if n <= 0:
        return
    env = env_of(ekind, n)
    step = f_midi(midi) * ratio * TABLE / SR
    gl = gain * math.sqrt((1.0 - pan) / 2.0)
    gr = gain * math.sqrt((1.0 + pan) / 2.0)
    i, j = s0, 0
    while j < n:
        if i >= NS:
            i -= NS
        end = NS if i + (n - j) >= NS else i + (n - j)
        while i < end:
            v = tab[int(j * step) % TABLE] * env[j]
            L[i] += v * gl
            R[i] += v * gr
            i += 1
            j += 1


def add_kick(L, R, t0, gain):
    n = int(0.18 * SR)
    ph = 0.0
    for j in range(n):
        t = j / SR
        f = 130.0 * (45.0 / 130.0) ** min(1.0, t / 0.09)
        ph += 2.0 * math.pi * f / SR
        v = math.sin(ph) * (10.0 ** (-3.0 * t / 0.14)) * gain
        i = (t0 + j) % NS
        L[i] += v
        R[i] += v


def add_snare(L, R, t0, gain):
    n = int(0.09 * SR)
    ah = 1.0 - math.exp(-2.0 * math.pi * 1800 / SR)
    y = 0.0
    st = (t0 * 2654435761) % 100000
    for j in range(n):
        x = ((st + j * 1103515245) % 2147483648) / 1073741824.0 - 1.0
        y += ah * (x - y)
        v = (x - y) * gain * (1 - j / n)
        i = (t0 + j) % NS
        L[i] += v * 0.8
        R[i] += v * 0.8


def add_hat(L, R, t0, gain):
    n = int(0.03 * SR)
    ah = 1.0 - math.exp(-2.0 * math.pi * 8200 / SR)
    y = 0.0
    st = (t0 * 40503) % 100000
    for j in range(n):
        x = ((st + j * 22695477) % 2147483648) / 1073741824.0 - 1.0
        y += ah * (x - y)
        v = (x - y) * gain * (1 - j / n)
        i = (t0 + j) % NS
        L[i] += v * 0.6
        R[i] += v * 0.6


def render(sc, hits):
    L = array.array("d", [0.0]) * NS
    R = array.array("d", [0.0]) * NS
    slot_smp = NS / TOTAL

    def S(slot):
        return int(round(slot * slot_smp))

    # 同一锯齿家族内的四小节惯性渐变；相邻小节参数变化严格受限。
    targets = []
    for bar in range(BARS):
        sec = SEC_OF[bar]
        targets.append(0.42 if sec.startswith("H") else
                       0.28 if sec == "E" else
                       0.18 if sec.startswith(("B", "D")) else 0.08)
    soft_curve = [targets[0]]
    for bar in range(1, BARS):
        soft_curve.append(soft_curve[-1] + 0.25 * (targets[bar] - soft_curve[-1]))

    for v, wave_, gain, pan in (("LEAD", "saw", 0.052, -0.25),
                                ("OST", "saw", 0.130, 0.10),
                                ("STAB", "square", 0.055, -0.10),
                                ("SWELL", "triangle", 0.050, 0.30),
                                ("BASS", "saw", 0.120, 0.0),
                                ("SUB", "sine", 0.140, 0.0)):
        ekind = "pad" if v == "SWELL" else "sus"
        mul = 1.02 if v in ("LEAD", "OST") else 1.0
        for s, d, m in sc[v]:
            sec = SEC_OF[min(s // SPB, BARS - 1)]
            wave2, gain2, pan2 = wave_, gain, pan
            if v == "LEAD" and s // SPB >= 198:
                pan2 = -0.34
            if v == "LEAD":  # 双失谐锯齿
                soft = soft_curve[min(s // SPB, BARS - 1)]
                add_note(L, R, "saw", m, S(s), d * SLOT_S,
                         gain2 * (1.0 - 0.28 * soft), pan2,
                         ekind, mul, 0.9975)
                add_note(L, R, "saw", m, S(s), d * SLOT_S,
                         gain2 * (1.0 - 0.28 * soft), pan2,
                         ekind, mul, 1.0025)
                add_note(L, R, "sine", m + 12, S(s), d * SLOT_S,
                         gain * (0.08 + 0.48 * soft), 0.28, ekind, mul, 1.0)
            else:
                add_note(L, R, wave2, m, S(s), d * SLOT_S, gain2, pan2,
                         ekind, mul)
        if v == "LEAD":
            for s, d, m in sc["LEAD2"]:
                add_note(L, R, wave_, m, S(s), d * SLOT_S, gain * 0.6, pan,
                         ekind, mul, 1.0)
    for slot, typ, gain in hits:
        t0 = S(slot)
        if typ == "K":
            add_kick(L, R, t0, gain)
        elif typ == "S":
            add_snare(L, R, t0, gain)
        else:
            add_hat(L, R, t0, gain)
    return L, R


SLOT_S = (60.0 / BPM) / 4


def write_seam(L, R, path, sec=10.0):
    peak = 0.0
    for i in range(NS):
        a = L[i] if L[i] > 0 else -L[i]
        b = R[i] if R[i] > 0 else -R[i]
        if a > peak:
            peak = a
        if b > peak:
            peak = b
    scale = 0.85 / max(peak, 1e-9)
    k = 1.3
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
    peak = 0.0
    for i in range(NS):
        a = L[i] if L[i] > 0 else -L[i]
        b = R[i] if R[i] > 0 else -R[i]
        if a > peak:
            peak = a
        if b > peak:
            peak = b
    scale = 0.85 / max(peak, 1e-9)
    k = 1.3
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
    print("── 霓虹幸存者 · 血色荒原「动力轮舞 · 扩写版」──")
    print("规格: A和声小调 / %dBPM / %d小节 / %.3fs / 44.1kHz 16bit 立体声"
          % (BPM, BARS, NS / SR))
    sc = build_score()
    validate(sc)
    print("渲染中(纯 Python,约 2-5 分钟)…")
    L, R = render(sc, drum_hits())
    p1 = os.path.join(HERE, "crimson_ext_loop.wav")
    p2 = os.path.join(HERE, "crimson_ext_seam.wav")
    peak, scale = finalize(L, R, p1, 1)
    write_seam(L, R, p2, 10.0)
    print("峰值 %.3f → 增益 %.2f;输出:" % (peak, scale))
    print("  %s (%.3fs)" % (p1, NS / SR))
    print("  %s (20s = 末10s+头10s 循环缝试听)" % p2)


if __name__ == "__main__":
    main()
