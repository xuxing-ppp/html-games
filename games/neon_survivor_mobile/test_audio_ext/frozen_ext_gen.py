#!/usr/bin/env python3
# test_audio_ext/frozen_ext_gen.py — 冰封核心 BGM「12/8 夜曲 · 扩写版」生成器
# (纯标准库,零依赖) 借鉴 frozen_gen 的宽琶音/如歌旋律/玻璃铃/寒风音色体系:
# F# 自然小调 · 12/8 · 附点四分 = 96 BPM · 288 小节 = 540.000s;无鼓。
# 后半加入三次冰晶副主题及玻璃弓弦/冰雾正弦的同族音色交替。
# 结构(12 小节乐句块):A A2 | C(24,新:发展,低音半小节脉冲+琶音波浪) |
#   D(12,新:静默段,全音符长线+稀琶音+风涌) | B2(12,新:B 变奏 3+3+3 加密) |
#   C2(24,新:发展再现) | A3(12,变体) | A4(12,变体+E6 收束句) | CODA(24,新:
#   12 收束句 + 12 属和声钟声渐隐,末小节导音 E# 悬置跨缝)
# 循环缝:末小节 C#(V) → 第 1 小节 F#m(i) 属主解决(与原版同法)
# 输出:frozen_ext_loop.wav + frozen_ext_seam.wav(末10s+头10s)
# 运行:python3 test_audio_ext/frozen_ext_gen.py

import math
import os
import wave
import array

SR = 44100
BPM = 96                                  # 附点四分
BARS = 288
EPB = 12                                  # 每小节八分音符数(12/8)
TOTAL = BARS * EPB                        # 1872 槽
SLOT_S = (60.0 / BPM) / 4                 # 0.15625s(二进制精确)
NS = 23814000                             # 540.000s(288 小节精确)
HERE = os.path.dirname(os.path.abspath(__file__))
assert abs(TOTAL * SLOT_S * SR - NS) < 0.5

NMIN = [0, 2, 3, 5, 7, 8, 10]             # 自然小调音级(F# 起)


def f_midi(m):
    return 440.0 * (2.0 ** ((m - 69) / 12.0))


CH = {
    "F#m": (42, [6, 9, 1], 3), "D": (38, [2, 6, 9], 4),
    "A": (45, [9, 1, 4], 4), "E": (40, [4, 8, 11], 4),
    "Bm": (47, [11, 2, 6], 3), "C#": (37, [1, 5, 8], 4),
}
SEC_A = ["F#m"] * 4 + ["D"] * 2 + ["A"] * 2 + ["E"] * 2 + ["C#"] * 2
SEC_A2 = ["F#m"] * 4 + ["D"] * 2 + ["A"] * 2 + ["Bm"] * 2 + ["C#"] * 2
SEC_B = ["D"] * 4 + ["A"] * 4 + ["Bm"] * 2 + ["C#"] * 2
SEC_C1 = ["D"] * 2 + ["A"] * 2 + ["Bm"] * 2 + ["E"] * 2 + ["D"] * 2 + ["C#"] * 2
SEC_C2 = ["F#m"] * 2 + ["D"] * 2 + ["A"] * 2 + ["E"] * 2 + ["Bm"] * 2 + ["C#"] * 2
SEC_D = ["D"] * 4 + ["A"] * 4 + ["Bm"] * 2 + ["C#"] * 2
SEC_B2 = ["D"] * 4 + ["A"] * 2 + ["Bm"] * 2 + ["E"] * 2 + ["C#"] * 2
SEC_N = ["D"] * 2 + ["A"] * 2 + ["E"] * 2 + ["F#m"] * 2 + ["Bm"] * 2 + ["C#"] * 2
SEC_CODA = ["D"] * 4 + ["A"] * 4 + ["Bm"] * 4 + ["E"] * 4 + ["C#"] * 8

BLOCKS = [(0, "A", SEC_A), (12, "A2", SEC_A2), (24, "B", SEC_B),
          (36, "C1", SEC_C1), (48, "C2", SEC_C2), (60, "D", SEC_D),
          (72, "B2", SEC_B2), (84, "C1b", SEC_C1), (96, "C2b", SEC_C2),
          (108, "A3", SEC_A), (120, "A4", SEC_A2),
          (132, "N1", SEC_N), (144, "C1c", SEC_C1), (156, "N2", SEC_N),
          (168, "D2", SEC_D), (180, "B3", SEC_B2), (192, "C2c", SEC_C2),
          (204, "A5", SEC_A), (216, "N3", SEC_N), (228, "A6", SEC_A2),
          (240, "X1", SEC_C1), (252, "X2", SEC_C2),
          (264, "CODA", SEC_CODA)]
assert sum(len(ch) for _, _, ch in BLOCKS) == BARS

SEC_OF = {}
for _s0, _k, _ch in BLOCKS:
    for _b in range(_s0, _s0 + len(_ch)):
        SEC_OF[_b] = _k


def chord_at(bar):
    for s0, k, ch in BLOCKS:
        if s0 <= bar < s0 + len(ch):
            return ch[bar - s0]
    return "F#m"


def kind_at(bar):
    k = SEC_OF[bar]
    return k if k == "CODA" else k[0]


# ── 旋律(每小节 (起点, 时值, midi);锚点 = 槽 0/3/6/9 须和弦音)─────────
PH_A = [
    [(0, 6, 73), (6, 6, 78)], [(0, 6, 81), (6, 6, 78)],
    [(0, 6, 73), (6, 6, 69)], [(0, 6, 69), (6, 6, 73)],
    [(0, 6, 74), (6, 6, 78)], [(0, 6, 81), (6, 6, 78)],
    [(0, 6, 81), (6, 6, 76)], [(0, 6, 73), (6, 6, 76)],
    [(0, 6, 76), (6, 6, 80)], [(0, 6, 83), (6, 6, 80)],
    [(0, 6, 80), (6, 6, 77)], [(0, 6, 73), (6, 6, 80)],
]
PH_A2 = [
    [(0, 6, 73), (6, 6, 78)], [(0, 6, 81), (6, 3, 78), (9, 3, 73)],
    [(0, 6, 73), (6, 6, 69)], [(0, 6, 69), (6, 6, 73)],
    [(0, 6, 74), (6, 3, 78), (9, 3, 81)], [(0, 6, 81), (6, 6, 78)],
    [(0, 6, 81), (6, 6, 76)], [(0, 6, 73), (6, 6, 76)],
    [(0, 6, 74), (6, 6, 78)], [(0, 6, 71), (6, 6, 74)],
    [(0, 6, 80), (6, 6, 77)], [(0, 6, 73), (6, 6, 80)],
]
PH_B = [
    [(0, 6, 86), (6, 3, 81), (9, 3, 78)], [(0, 6, 81), (6, 6, 78)],
    [(0, 3, 81), (3, 3, 78), (6, 6, 74)], [(0, 6, 78), (6, 6, 74)],
    [(0, 6, 81), (6, 3, 76), (9, 3, 73)], [(0, 6, 76), (6, 6, 81)],
    [(0, 3, 81), (3, 3, 76), (6, 6, 73)], [(0, 6, 76), (6, 6, 73)],
    [(0, 6, 83), (6, 3, 78), (9, 3, 74)], [(0, 6, 78), (6, 6, 86)],
    [(0, 6, 85), (6, 3, 80), (9, 3, 77)], [(0, 12, 85)],
]
# ── 新段旋律 ──────────────────────────────────────────────────────────
PH_C1 = [
    [(0, 6, 74), (6, 6, 78)], [(0, 3, 78), (3, 3, 81), (6, 6, 78)],
    [(0, 6, 81), (6, 6, 76)], [(0, 6, 76), (6, 6, 81)],
    [(0, 6, 78), (6, 6, 83)], [(0, 6, 83), (6, 6, 78)],
    [(0, 6, 80), (6, 6, 76)], [(0, 6, 76), (6, 6, 83)],
    [(0, 6, 81), (6, 6, 78)], [(0, 6, 78), (6, 6, 74)],
    [(0, 6, 80), (6, 6, 77)], [(0, 12, 80)],
]
PH_C2 = [
    [(0, 6, 85), (6, 6, 81)], [(0, 3, 81), (3, 3, 78), (6, 6, 81)],
    [(0, 6, 78), (6, 6, 74)], [(0, 6, 74), (6, 6, 78)],
    [(0, 6, 81), (6, 6, 76)], [(0, 6, 76), (6, 6, 81)],
    [(0, 6, 80), (6, 6, 76)], [(0, 6, 76), (6, 6, 83)],
    [(0, 6, 83), (6, 6, 78)], [(0, 6, 78), (6, 6, 83)],
    [(0, 6, 80), (6, 6, 77)], [(0, 12, 80)],
]
PH_D = [
    [(0, 12, 74)], [(0, 12, 78)], [(0, 12, 81)], [(0, 12, 78)],
    [(0, 12, 81)], [(0, 12, 76)], [(0, 12, 81)], [(0, 12, 85)],
    [(0, 12, 83)], [(0, 12, 78)], [(0, 12, 80)], [(0, 12, 77)],
]
PH_B2 = [
    [(0, 3, 86), (3, 3, 81), (6, 3, 78), (9, 3, 81)], [(0, 6, 78), (6, 6, 81)],
    [(0, 3, 81), (3, 3, 78), (6, 6, 74)], [(0, 6, 74), (6, 6, 78)],
    [(0, 3, 81), (3, 3, 76), (6, 6, 81)], [(0, 6, 76), (6, 6, 81)],
    [(0, 3, 83), (3, 3, 78), (6, 6, 83)], [(0, 6, 78), (6, 6, 83)],
    [(0, 3, 80), (3, 3, 76), (6, 6, 80)], [(0, 6, 76), (6, 6, 80)],
    [(0, 6, 80), (6, 6, 77)], [(0, 6, 77), (6, 3, 80), (9, 3, 77)],
]
PH_A3 = [
    [(0, 6, 73), (6, 6, 78)], [(0, 6, 81), (6, 6, 78)],
    [(0, 6, 73), (6, 6, 69)], [(0, 6, 69), (6, 6, 73)],
    [(0, 6, 74), (6, 6, 78)], [(0, 6, 81), (6, 6, 78)],
    [(0, 6, 81), (6, 6, 76)], [(0, 6, 73), (6, 6, 76)],
    [(0, 6, 83), (6, 6, 80)], [(0, 6, 80), (6, 6, 76)],
    [(0, 6, 80), (6, 6, 77)], [(0, 6, 77), (6, 6, 80)],
]
PH_A4 = [
    [(0, 6, 73), (6, 6, 78)], [(0, 6, 81), (6, 3, 78), (9, 3, 73)],
    [(0, 6, 73), (6, 6, 69)], [(0, 6, 69), (6, 6, 73)],
    [(0, 6, 74), (6, 3, 78), (9, 3, 81)], [(0, 6, 81), (6, 6, 78)],
    [(0, 6, 81), (6, 6, 76)], [(0, 6, 73), (6, 6, 76)],
    [(0, 6, 83), (6, 6, 86)], [(0, 3, 86), (3, 3, 83), (6, 6, 78)],
    [(0, 6, 80), (6, 3, 77), (9, 3, 73)], [(0, 6, 77), (6, 3, 80), (9, 3, 77)],
]
PH_CODA = [
    [(0, 6, 81), (6, 6, 78)], [(0, 12, 74)],
    [(0, 6, 78), (6, 6, 81)], [(0, 12, 81)],
    [(0, 6, 76), (6, 6, 81)], [(0, 12, 85)],
    [(0, 6, 81), (6, 6, 76)], [(0, 12, 76)],
    [(0, 6, 83), (6, 6, 78)], [(0, 12, 78)],
    [(0, 6, 78), (6, 6, 83)], [(0, 12, 83)],
    [(0, 6, 80), (6, 6, 76)], [(0, 12, 76)],
    [(0, 6, 83), (6, 6, 80)], [(0, 12, 80)],
    [(0, 12, 80)], [(0, 12, 77)], [(0, 6, 80), (6, 6, 77)], [(0, 12, 77)],
    [(0, 12, 80)], [(0, 12, 77)],
    [(0, 6, 77), (6, 6, 80)], [(0, 12, 77)],
]

def resplit(ph):
    """节奏重排变奏:6+6 → 3+3+6(后音先现);6+3+3 → 3+3+3+3。
    音高全部来自原锚点位置,和弦归属不变。"""
    out = []
    for evs in ph:
        if len(evs) == 2 and evs[0][1] == 6 and evs[1][1] == 6:
            a, b = evs[0][2], evs[1][2]
            out.append([(0, 3, b), (3, 3, a), (6, 6, b)])
        elif len(evs) == 3 and evs[0][1] == 6 and evs[1][1] == 3 \
                and evs[2][1] == 3:
            a, b, c = evs[0][2], evs[1][2], evs[2][2]
            out.append([(0, 3, c), (3, 3, a), (6, 3, b), (9, 3, c)])
        else:
            out.append(list(evs))
    return out


def secondary_phrase(chords, variant):
    """冰晶副主题：仍只取当前和弦音，但用更宽的 6+3+3 呼吸句区别于 A。"""
    out = []
    for i, cname in enumerate(chords):
        pcs = CH[cname][1]
        pitches = [m for m in range(73, 89) if m % 12 in pcs]
        a = pitches[(i + variant) % len(pitches)]
        b = pitches[(i + 1 + variant) % len(pitches)]
        c = pitches[(i + 2 + variant) % len(pitches)]
        if variant == 1 and i % 2:
            out.append([(0, 3, c), (3, 3, b), (6, 6, a)])
        elif variant == 2:
            out.append([(0, 6, b), (6, 3, a), (9, 3, c)])
        else:
            out.append([(0, 6, a), (6, 3, b), (9, 3, c)])
    return out


BLOCK_PHRASES = {
    "A": PH_A, "A2": PH_A2, "A3": PH_A3, "A4": PH_A4,
    "A5": PH_A3, "A6": PH_A4, "B": PH_B, "B2": PH_B2,
    "B3": resplit(PH_B2), "D": PH_D, "D2": PH_D,
    "N1": secondary_phrase(SEC_N, 0), "N2": secondary_phrase(SEC_N, 1),
    "N3": secondary_phrase(SEC_N, 2), "X1": secondary_phrase(SEC_C1, 2),
    "X2": secondary_phrase(SEC_C2, 1), "CODA": PH_CODA,
    "C1": PH_C1, "C1b": resplit(PH_C1), "C1c": resplit(PH_C1),
    "C2": PH_C2, "C2b": resplit(PH_C2), "C2c": resplit(PH_C2),
}


def build_score():
    sc = {"MEL": [], "ARP": [], "SUB": []}
    # 旋律:各块套用乐句(C1b/C2b 为节奏重排变奏)
    for s0, kind, chords in BLOCKS:
        ph = BLOCK_PHRASES[kind]
        for bi, evs in enumerate(ph):
            bar = s0 + bi
            base = bar * EPB
            for st, d, m in evs:
                sc["MEL"].append((base + st, d, m))
    # 琶音:每小节 12 八分音;按块选形
    for bar in range(BARS):
        base = bar * EPB
        root, pcs, th = CH[chord_at(bar)]
        r = root + 12
        k = kind_at(bar)
        if bar == 131:                          # A4 末小节:上行跑句推向 CODA
            offs = [0, th, 7, 12, 12 + th, 19, 24, 24 + th, 31, 19, 24, 31]
        elif k == "D":
            offs = [0, 7, 12, 7, 0, 7, 12, 7, 0, 7, 12, 7]
        elif k == "CODA":
            offs = [0, 7, 12, 19, 12, 7, 0, 7, 12, 19, 12, 7]
        elif k in ("B", "C"):
            offs = [0, 12, 7, 12 + th, 12, 19, 12 + th, 12, 7, 12, 0, 7]
        else:
            offs = ([0, 7, 12, 12 + th, 19, 12 + th, 12, 7, 0, 7, 12, 12 + th]
                    if bar % 2 == 0 else
                    [0, 12, 7, 12 + th, 12, 19, 12 + th, 12, 7, 12, 0, 7])
        for j, off in enumerate(offs):
            sc["ARP"].append((base + j, 1, r + off))
        # sub:发展/对比块半小节脉冲,其余整小节长音
        if k in ("B", "C"):
            sc["SUB"].append((base, EPB // 2, root))
            sc["SUB"].append((base + EPB // 2, EPB // 2, root))
        else:
            sc["SUB"].append((base, EPB, root))
    # 玻璃铃:每 4 小节末回声最近 3 旋律音(+12);B/C 块每 2 小节
    bells = []
    mel_sorted = sorted(sc["MEL"])
    bell_bars = []
    for bar in range(3, BARS, 4):
        k = kind_at(bar)
        bell_bars.append(bar)
    dense = []
    for s0, name, chords in BLOCKS:
        if name[0] in ("B", "C", "N"):
            dense.extend(range(s0 + 1, s0 + len(chords), 2))
    bell_bars = sorted(set(bell_bars + dense))
    for b4 in bell_bars:
        win = [m for s, d, m in mel_sorted
               if b4 * EPB - EPB <= s < b4 * EPB]
        take = win[-3:] if len(win) >= 3 else win
        for k, m in enumerate(take):
            bells.append((b4 * EPB + k * 4, 4, m + 12))
    return sc, bells


RANGE = {"MEL": (62, 89), "ARP": (48, 80), "SUB": (30, 50), "BELL": (76, 96)}


def active_at(evs, slot):
    return [m for s, d, m in evs if s <= slot < s + d]


def validate(sc):
    errs, warns = [], []
    for v, lo, hi in (("MEL", 62, 89), ("ARP", 48, 80), ("SUB", 30, 50)):
        for s, d, m in sc[v]:
            if not (lo <= m <= hi):
                errs.append("音域越界 %s slot%d midi%d" % (v, s, m))
    # 旋律节拍锚点(槽 %3==0)须为和弦音
    for s, d, m in sc["MEL"]:
        if s % 3 != 0:
            continue
        bar = min(s // EPB, BARS - 1)
        if m % 12 not in CH[chord_at(bar)][1]:
            errs.append("锚点失协 MEL slot%d midi%d 和弦%s"
                        % (s, m, chord_at(bar)))
    # 旋律铺砌:每小节精确铺满
    for bar in range(BARS):
        evs = sorted((s, d) for s, d, m in sc["MEL"]
                     if bar * EPB <= s < (bar + 1) * EPB)
        t = bar * EPB
        ok = True
        for s, d in evs:
            if s != t:
                ok = False
                break
            t += d
        if not ok or t != (bar + 1) * EPB:
            errs.append("旋律铺砌异常 小节%d(重叠或空隙)" % (bar + 1))
    # 琶音覆盖与和弦归属
    for s, d, m in sc["ARP"]:
        bar = min(s // EPB, BARS - 1)
        if m % 12 not in CH[chord_at(bar)][1]:
            errs.append("琶音外音 ARP slot%d midi%d" % (s, m))
    cov = [False] * TOTAL
    for s, d, m in sc["ARP"]:
        cov[s] = True
    if not all(cov):
        errs.append("琶音覆盖缺口 %d" % cov.count(False))
    # 半音碰撞 MEL vs ARP
    for slot in range(0, TOTAL, 2):
        ms = active_at(sc["MEL"], slot)
        as_ = active_at(sc["ARP"], slot)
        for m in ms:
            for a in as_:
                if 0 < abs(m - a) <= 13 and abs(m - a) % 12 == 1:
                    warns.append("半音碰撞 slot%d MEL(%d)/ARP(%d)"
                                 % (slot, m, a))
    print("── 曲式块(12 小节/块)──")
    for s0, kind, ch in BLOCKS:
        print("  小节 %3d-%3d  %s(%d)" % (s0 + 1, s0 + len(ch), kind,
                                           len(ch)))
    print("── 接缝报告(第288小节 C# → 第1小节 F#m,末音 E# 悬置)──")
    for v in ("MEL", "SUB"):
        last = max(sc[v], key=lambda e: e[0])
        first = min(sc[v], key=lambda e: e[0])
        print("  %s: midi%d → midi%d (V→i 属主解决)" % (v, last[2], first[2]))
    if errs or warns:
        for e in errs:
            print("  ✗", e)
        for w in warns:
            print("  !", w)
        raise SystemExit(1)
    print("校验:锚点/铺砌/琶音/碰撞 %s,警告 %d 条" % ("通过", len(warns)))


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
    if kind == "bell":
        att = max(1, int(0.006 * SR))
        for i in range(n):
            if i < att:
                env[i] = i / att
            else:
                env[i] = math.exp(-4.5 * (i - att) / SR)
    else:
        att = max(1, min(int(0.08 * SR), n // 3))
        rel = max(1, min(int(0.05 * SR), max(1, n - att)))
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


def add_note(L, R, kind, midi, s0, dur_s, gain, pan, ekind="sus", mul=1.05,
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


def add_wind(L, R, t0, dur_s, gain):
    """寒风:窄带噪声(带通 ~700Hz)+ sin² 包络"""
    n = int(dur_s * SR)
    ah = 1.0 - math.exp(-2.0 * math.pi * 480 / SR)
    al = 1.0 - math.exp(-2.0 * math.pi * 1100 / SR)
    hp = lp = 0.0
    st = (t0 * 7919) % 100000
    for j in range(n):
        x = ((st + j * 48271) % 2147483648) / 1073741824.0 - 1.0
        hp += ah * (x - hp)
        y = x - hp
        lp += al * (y - lp)
        env = math.sin(math.pi * j / n) ** 2
        v = lp * env * gain
        i = (t0 + j) % NS
        L[i] += v * 0.85
        R[i] += v * 1.15


def gmul(bar):
    """分段增益:静默段与 CODA 收敛"""
    k = kind_at(bar)
    if k == "D":
        return 0.72
    if k == "CODA":
        return 0.85
    return 1.0


def render(sc, bells):
    L = array.array("d", [0.0]) * NS
    R = array.array("d", [0.0]) * NS
    slot_smp = NS / TOTAL

    def S(slot):
        return int(round(slot * slot_smp))
    targets = [0.70 if SEC_OF[b].startswith(("N", "X")) else
               0.52 if SEC_OF[b].startswith("D") else 0.30
               for b in range(BARS)]
    glass_curve = [targets[0]]
    for bar in range(1, BARS):
        glass_curve.append(glass_curve[-1] + 0.25 *
                           (targets[bar] - glass_curve[-1]))
    # 冰雾正弦、玻璃泛音与三角弓弦始终共存，比例按四小节惯性渐变。
    for s, d, m in sc["MEL"]:
        bar = s // EPB
        g = 0.105 * gmul(bar)
        glass = glass_curve[bar]
        pan = -0.24 if bar >= 144 else -0.15
        for ratio in (0.9977, 1.0023):
            add_note(L, R, "sine", m, S(s), d * SLOT_S,
                     g * (0.82 - 0.28 * glass), pan, "sus", 1.06, ratio)
        add_note(L, R, "triangle", m, S(s), d * SLOT_S,
                 g * (0.18 + 0.58 * glass), -0.28, "sus", 1.07, 0.9988)
        add_note(L, R, "sine", m + 12, S(s), d * SLOT_S,
                 g * (0.10 + 0.28 * glass), 0.26, "sus", 1.05, 1.0012)
    # 琶音:三角波
    for s, d, m in sc["ARP"]:
        bar = s // EPB
        glass = glass_curve[bar]
        gain = 0.085 * gmul(bar)
        pan = 0.28 if bar >= 144 else 0.20
        add_note(L, R, "triangle", m, S(s), d * SLOT_S,
                 gain * (0.82 - 0.30 * glass), pan, "sus", 1.12)
        add_note(L, R, "sine", m, S(s), d * SLOT_S,
                 gain * (0.18 + 0.30 * glass), pan, "sus", 1.12)
    # sub:正弦
    for s, d, m in sc["SUB"]:
        add_note(L, R, "sine", m, S(s), d * SLOT_S, 0.120 * gmul(s // EPB),
                 0.0, "sus", 1.0)
    # 玻璃铃
    for s, d, m in bells:
        add_note(L, R, "sine", m, S(s), d * SLOT_S, 0.040, 0.35, "bell", 1.0)
    # 寒风:每 8 小节一次 2 小节涌
    for bar in range(0, BARS, 8):
        add_wind(L, R, S(bar * EPB), 2 * EPB * SLOT_S, 0.016)
    return L, R


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
    print("── 霓虹幸存者 · 冰封核心「12/8 夜曲 · 扩写版」──")
    print("规格: F#自然小调 / 附点四分=%dBPM / %d小节 / %.3fs / 44.1kHz 16bit 立体声"
          % (BPM, BARS, NS / SR))
    sc, bells = build_score()
    validate(sc)
    print("渲染中(纯 Python,约 2-5 分钟)…")
    L, R = render(sc, bells)
    p1 = os.path.join(HERE, "frozen_ext_loop.wav")
    p2 = os.path.join(HERE, "frozen_ext_seam.wav")
    peak, scale = finalize(L, R, p1, 1)
    write_seam(L, R, p2, 10.0)
    print("峰值 %.3f → 增益 %.2f;输出:" % (peak, scale))
    print("  %s (%.3fs)" % (p1, NS / SR))
    print("  %s (20s = 末10s+头10s 循环缝试听)" % p2)


if __name__ == "__main__":
    main()
