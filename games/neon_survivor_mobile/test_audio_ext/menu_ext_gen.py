#!/usr/bin/env python3
# test_audio_ext/menu_ext_gen.py — 主界面 BGM「永续赋格 · 扩写版」生成器(纯标准库,零依赖)
# A 小调三声部合成器赋格的 3 分钟主界面版：96 小节 × 128BPM，
# 24 次主题入点；呈示→发展→密接→倒影→自由间插→短再现→属持续锁。
# 音色与原版一致:S 高声部锯齿 / M 中声部方波 / B 低声部空心三角;±0.45 宽声场;
#   拨弦式包络;sub 增厚。主题/答题/对题材料沿用(赋格主题即身份),间插段轮廓一半
#   为新写 CONTOURS2,倒影段与密接和应为全新赋格手法(原 90s 版没有)。
# 输出:menu_ext_loop.wav(180s)+ menu_ext_seam.wav(末10s+头10s 循环缝试听段)
# 运行:python3 test_audio_ext/menu_ext_gen.py

import math
import os
import random
import wave
import array

# ── 常量 ──────────────────────────────────────────────────────────────
SR = 44100
BPM = 128
BARS = 164
EPB = 8                                  # 每小节八分音符数
TOTAL_8 = BARS * EPB                     # 1312
EIGHTH = 60.0 / BPM / 2                  # 0.234375s(二进制精确)
NS = int(TOTAL_8 * EIGHTH * SR)          # 下方紧凑曲式会重设为 7,938,000
HERE = os.path.dirname(os.path.abspath(__file__))
assert NS == 13560750, NS

MINOR = [0, 2, 3, 5, 7, 8, 11]           # 和声小调
MAJOR = [0, 2, 4, 5, 7, 9, 11]
RANGE = {"S": (59, 84), "M": (59, 81), "B": (45, 67)}
VOICE_WAVE = {"S": "saw", "M": "square", "B": "triangle"}
VOICE_PAN = {"S": -0.45, "M": 0.45, "B": 0.0}
VOICE_GAIN = {"theme": 0.17, "cs": 0.15, "free": 0.13,
              "inv": 0.16, "stretto": 0.145}
DURMUL = 0.92
SUB_GAIN = 0.20
KICK_GAIN, SNARE_GAIN, HAT_GAIN = 0.46, 0.17, 0.08
KICK_OFFS = (0, 2, 4, 6)
HAT16 = True
EXTRA_VOICE_GAIN = {}

LOCK_BARS = (160, 161, 162, 163)


def semi(mode, i):
    return mode[i % 7] + 12 * (i // 7)


def f_midi(m):
    return 440.0 * (2.0 ** ((m - 69) / 12.0))


# ── 主题材料(沿用原版;赋格主题即曲目身份)────────────────────────────
SUBJ = [(0, 2), (2, 1), (1, 1), (4, 2), (3, 1), (2, 1), (1, 1),
        (0, 1), (-1, 1), (0, 1), (2, 1), (1, 1), (0, 1), (4, 1)]


def theme_events(root_midi, mode, start_slot, invert=False):
    evs, t = [], start_slot
    for idx, d in SUBJ:
        evs.append((t, d, root_midi + semi(mode, -idx if invert else idx)))
        t += d
    return evs


CS_A_OFF = [(7, 2), (3, 1), (5, 1), (12, 1), (10, 1), (8, 1), (7, 1),
            (11, 1), (7, 1), (7, 1), (3, 1), (7, 1), (10, 1), (7, 1), (12, 1)]
CS_A_LOW_OFF = [(7, 2), (3, 1), (5, 1), (0, 1), (10, 1), (8, 1), (7, 1),
                (-1, 1), (7, 1), (7, 1), (3, 1), (7, 1), (10, 1), (7, 1), (0, 1)]
CS_E = [(71, 2), (71, 1), (69, 1), (79, 1), (78, 1), (76, 1), (71, 1),
        (75, 1), (71, 1), (71, 1), (69, 1), (71, 1), (69, 1), (71, 1), (78, 1)]
CS_E_LOW = [(59, 2), (64, 1), (64, 1), (67, 1), (64, 1), (64, 1), (59, 1),
            (63, 1), (59, 1), (59, 1), (57, 1), (59, 1), (63, 1), (59, 1), (66, 1)]
CS_C = [(64, 2), (67, 1), (65, 1), (60, 1), (59, 1), (60, 1), (59, 1),
        (65, 1), (64, 1), (62, 1), (64, 1), (67, 1), (65, 1), (64, 1), (71, 1)]
CS_F = [(60, 2), (60, 1), (64, 1), (64, 1), (67, 1), (62, 1), (60, 1),
        (62, 1), (69, 1), (67, 1), (69, 1), (72, 1), (70, 1), (69, 1), (64, 1)]
CS_C_LOW = [(m - 12, d) for m, d in CS_C]
CS_F_LOW = [(m - 12, d) for m, d in CS_F]


def off_events(offsets, base, start_slot):
    evs, t = [], start_slot
    for o, d in offsets:
        evs.append((t, d, base + o))
        t += d
    return evs


def abs_events(notes, start_slot):
    evs, t = [], start_slot
    for m, d in notes:
        evs.append((t, d, m))
        t += d
    return evs


# ── 和弦表 ────────────────────────────────────────────────────────────
CH = {
    "Am": (9, [9, 0, 4], 45), "E": (4, [4, 8, 11], 40),
    "C": (0, [0, 4, 7], 36), "Bd": (11, [11, 2, 5], 47),
    "Em": (4, [4, 7, 11], 40), "B7": (11, [11, 3, 6, 9], 47),
    "G": (7, [7, 11, 2], 43), "G7": (7, [7, 11, 2, 5], 43),
    "F": (5, [5, 9, 0], 41), "Dm": (2, [2, 5, 9], 38),
}

# ── 4 小节和弦周期(按入点根音选用)───────────────────────────────────
CY_A1 = ["Am", "E", "C", "Bd"]
CY_A2 = ["Am", "E", "F", "Bd"]
CY_A3 = ["Am", "E", "Dm", "E"]
CY_E1 = ["Em", "B7", "G", "E"]
CY_E2 = ["Em", "B7", "G", "G7"]
CY_E3 = ["Em", "B7", "Dm", "E"]
CY_C = ["C", "G", "Am", "B7"]
CY_F = ["F", "C", "Dm", "E"]

# ── 41 次入点(bar, 声部, 主音 midi, 调式, 种类 n=普通/s=密接/i=倒影)──
ENTRIES = [
    (0, "S", 69, MINOR, "n"), (4, "M", 64, MINOR, "n"),
    (8, "B", 57, MINOR, "n"), (12, "S", 64, MINOR, "n"),
    (16, "M", 72, MAJOR, "n"), (20, "B", 52, MINOR, "n"),
    (24, "S", 69, MINOR, "n"), (28, "M", 64, MINOR, "n"),
    (32, "B", 53, MAJOR, "n"), (36, "S", 69, MINOR, "n"),
    (40, "M", 64, MINOR, "n"), (44, "B", 57, MINOR, "n"),
    (48, "S", 69, MINOR, "s"), (50, "M", 64, MINOR, "s"),
    (52, "B", 57, MINOR, "s"), (54, "S", 69, MINOR, "s"),
    (56, "M", 64, MINOR, "s"), (58, "B", 57, MINOR, "s"),
    (60, "S", 64, MINOR, "s"), (62, "M", 69, MINOR, "s"),
    (64, "M", 69, MINOR, "i"), (68, "S", 76, MINOR, "i"),
    (72, "B", 57, MINOR, "i"),
    (88, "S", 69, MINOR, "n"), (92, "M", 72, MAJOR, "n"),
    (96, "B", 52, MINOR, "n"), (100, "S", 64, MINOR, "n"),
    (104, "M", 69, MINOR, "n"), (108, "B", 53, MAJOR, "n"),
    (112, "S", 69, MINOR, "n"), (116, "M", 64, MINOR, "n"),
    (120, "B", 57, MINOR, "n"), (124, "S", 72, MAJOR, "n"),
    (128, "M", 69, MINOR, "n"), (132, "B", 57, MINOR, "n"),
    (136, "S", 64, MINOR, "n"), (140, "M", 69, MINOR, "n"),
    (144, "S", 69, MINOR, "n"), (148, "M", 64, MINOR, "n"),
    (152, "B", 53, MAJOR, "n"), (156, "B", 57, MINOR, "n"),
]

# 每个普通入点周期(4 小节)的和弦周期选择
ENTRY_CYCLE = {
    0: CY_A1, 4: CY_E1, 8: CY_A2, 12: CY_E2,
    16: CY_C, 20: ["Am", "B7", "Dm", "E"], 24: CY_A2, 28: CY_E2,
    32: CY_F, 36: CY_A2, 40: CY_E3, 44: CY_A1,
    64: ["Dm", "Dm", "Am", "E"], 68: ["Am", "Am", "B7", "E"],
    72: ["Dm", "Dm", "Am", "E"],
    88: CY_A2, 92: CY_C, 96: ["Em", "B7", "Dm", "E"], 100: CY_E1,
    104: CY_A2, 108: CY_F,
    112: CY_A1, 116: CY_E1, 120: CY_A2, 124: CY_C, 128: CY_A3, 132: CY_A2,
    136: CY_E3, 140: CY_A1,
    144: CY_A2, 148: CY_E1, 152: CY_F, 156: CY_A3,
}
# 密接和应段(48-63):每 2 小节一换,按入点根音对齐;自由间插部(76-87):F 周期 ×3
STRETTO_CHORDS = ["Am", "Em", "Am", "Am", "Em", "Am", "Em", "Am"]
INTERLUDE_CHORDS = CY_F * 3


def build_road():
    road = ["?"] * BARS
    for bar0, cyc in ENTRY_CYCLE.items():
        for i, c in enumerate(cyc):
            road[bar0 + i] = c
    for i, c in enumerate(STRETTO_CHORDS):
        road[48 + 2 * i] = road[49 + 2 * i] = c
    for i in range(12):
        road[76 + i] = INTERLUDE_CHORDS[i]
    for i in range(4):
        road[160 + i] = "E"
    assert "?" not in road
    return road


ROAD = build_road()

# ── 属持续音锁(末 4 小节;末小节收在导音/E 和弦音,跨缝解决到 Am)──────
LOCK = {
    "S": [[76, 79, 76, 71, 76, 79, 83, 79],
          [80, 76, 80, 76, 75, 72, 76, 72],
          [77, 71, 77, 71, 74, 71, 76, 71],
          [68, 71, 68, 71, 69, 68, 71, 68]],
    "M": [[64, 67, 71, 67, 68, 71, 76, 71],
          [67, 71, 67, 71, 67, 71, 67, 71],
          [64, 68, 71, 68, 64, 68, 71, 68],
          [64, 68, 64, 68, 63, 64, 68, 64]],
    "B": [[52, 47, 52, 47, 52, 47, 52, 56],
          [56, 59, 64, 59, 56, 63, 64, 64],
          [52, 47, 56, 47, 52, 47, 56, 47],
          [52, 47, 56, 47, 52, 47, 56, 47]],
}

# ── 间插段轮廓(原版 4 条 + 扩写新增 4 条)────────────────────────────
CONTOURS = [[0, 2, 1, 2, 0, 2, 1, 2], [0, 1, 2, 1, 0, 1, 2, 1],
            [2, 1, 2, 0, 1, 2, 1, 0], [0, 2, 0, 1, 2, 1, 2, 1]]
CONTOURS2 = [[0, 1, 0, 2, 1, 2, 0, 1], [2, 0, 1, 0, 2, 1, 0, 2],
             [1, 2, 0, 1, 2, 0, 1, 2], [0, 2, 2, 0, 1, 1, 0, 2]]

SECTIONS = [(0, "呈示部", 16), (16, "发展部", 32), (48, "密接和应", 16),
            (64, "倒影段", 12), (76, "自由间插", 12), (88, "短再现", 4),
            (92, "属持续锁", 4)]

# 主界面无需承载一整局的时间尺度。保留原扩写版前半最有辨识度的赋格发展，
# 把 5 分钟大曲式压缩成精确 3 分钟；最后四小节沿用原属持续锁，仍可无缝回 Am。
BARS = 96
TOTAL_8 = BARS * EPB
NS = int(TOTAL_8 * EIGHTH * SR)
LOCK_BARS = (92, 93, 94, 95)
ENTRIES = [e for e in ENTRIES if e[0] < 92]
ROAD = ROAD[:92] + ["E"] * 4
assert NS == 7938000 and len(ROAD) == BARS


def nearest_pitch(pc, prev, lo, hi):
    best = None
    for p in range(lo, hi + 1):
        if p % 12 == pc:
            if best is None or abs(p - prev) < abs(best - prev):
                best = p
    return best


def fig_bar(pcs, contour, prev, lo, hi, step, avoid_at=None):
    evs = []
    for i in range(EPB // step):
        pc = pcs[contour[(i * step) % EPB] % len(pcs)]
        p = nearest_pitch(pc, prev, lo, hi)
        if p is None:
            p = prev
        elif avoid_at:
            bad = avoid_at(i * step)
            if bad and any((abs(p - q) % 12) == 0 for q in bad):
                alt = None
                for cand in range(p - 12, p + 13, 12):
                    if lo <= cand <= hi and cand % 12 == pc and \
                            not any((abs(cand - q) % 12) == 0 for q in bad):
                        if alt is None or abs(cand - prev) < abs(alt - prev):
                            alt = cand
                if alt is None:
                    for cand in range(lo, hi + 1):
                        if cand % 12 in pcs and \
                                not any((abs(cand - q) % 12) == 0 for q in bad):
                            if alt is None or abs(cand - p) < abs(alt - p):
                                alt = cand
                if alt is not None:
                    p = alt
        evs.append((p, step))
        prev = p
    return evs, prev


def free_halves(pcs, prev, lo, hi, others_at):
    evs = []
    first_pc = None
    for rel in (0, 4):
        win = [[] for _ in range(4)]
        for i in range(4):
            win[i] = others_at(rel + i)
        best, best_cost = None, None
        for p in range(lo, hi + 1):
            if p % 12 not in pcs:
                continue
            cost = abs(p - prev)
            if rel == 4 and first_pc is not None and p % 12 == first_pc:
                cost += 15
            for i in range(4):
                for q in win[i]:
                    d = abs(p - q)
                    if d <= 13 and d % 12 == 1:
                        cost += 60 if i == 0 else 15
                    elif (p - q) % 12 == 0:
                        if p == q:
                            cost += 35 if i == 0 else 6
                        else:
                            cost += 8 if i == 0 else 2
            if best_cost is None or cost < best_cost:
                best, best_cost = p, cost
        p = best if best is not None else prev
        if rel == 0:
            first_pc = p % 12
        evs.append((p, 4))
        prev = p
    return evs, prev


def pick_cs(k, cs_voice):
    pc = ENTRIES[k][2] % 12
    if pc == 9:
        if cs_voice == "B":
            return off_events(CS_A_LOW_OFF, 57, 0)
        if cs_voice == "S":
            return off_events(CS_A_OFF, 69, 0)
        return off_events(CS_A_OFF, 57, 0)
    if pc == 4:
        if cs_voice == "B":
            return abs_events(CS_E_LOW, 0)
        return abs_events(CS_E, 0)
    if pc == 0:
        if cs_voice == "B":
            return abs_events(CS_C_LOW, 0)
        return abs_events(CS_C, 0)
    if cs_voice == "B":
        return abs_events(CS_F_LOW, 0)
    return abs_events(CS_F, 0)


def cs_of(k):
    """入点 k 的对题声部;密接/倒影无对题,对题声部与主题声部相同(连续同声部
    入点)时跳过对题,腾出两个自由声部。"""
    bar, tv, root, mode, kind = ENTRIES[k]
    if kind != "n":
        return None
    prev_v = ENTRIES[k - 1][1]
    return prev_v if prev_v != tv else None


# ── 乐谱构建 ──────────────────────────────────────────────────────────
def build_score():
    sc = {"S": [], "M": [], "B": []}
    prev = {"S": 76, "M": 69, "B": 52}
    roles = {}
    theme_bars = {}
    for k, (bar, v, root, mode, kind) in enumerate(ENTRIES):
        for b in (bar, bar + 1):
            theme_bars[b] = k

    for k, (bar, tv, root, mode, kind) in enumerate(ENTRIES):
        cs_voice = cs_of(k)
        for b in (bar, bar + 1):
            roles[(b, tv)] = ("stretto" if kind == "s" else
                              "inv" if kind == "i" else "theme")
            if cs_voice:
                roles[(b, cs_voice)] = "cs"

    for bar in range(BARS):
        b8 = bar * EPB
        pcs = CH[ROAD[bar]][1]

        if bar in LOCK_BARS:
            for v in ("S", "M", "B"):
                for i, m in enumerate(LOCK[v][bar - LOCK_BARS[0]]):
                    sc[v].append((b8 + i, 1, m))
            continue

        if bar in theme_bars:
            k = theme_bars[bar]
            ebar, tv, root, mode, kind = ENTRIES[k]
            cs_voice = cs_of(k)
            free_voices = sorted({"S", "M", "B"} - {tv} -
                                 ({cs_voice} if cs_voice else set()))
            if bar == ebar:
                inv = (kind == "i")
                evs = theme_events(root, mode, 0, invert=inv)
                sc[tv] += [(s + b8, d, m) for s, d, m in evs]
                if cs_voice:
                    sc[cs_voice] += [(s + b8, d, m)
                                     for s, d, m in pick_cs(k, cs_voice)]

            def others_at(rel, b8=b8, fvs=free_voices):
                out = []
                for v in ("S", "M", "B"):
                    if v in fvs:
                        continue
                    out += active_at(sc[v], b8 + rel)
                return out

            for fv in free_voices:
                free_range = {"S": (64, 79), "M": (62, 76), "B": (45, 64)}[fv]
                evs, prev[fv] = free_halves(pcs, prev[fv], *free_range,
                                            others_at)
                sc[fv] += [(b8 + i * 4, 4, m) for i, (m, _) in enumerate(evs)]
        else:
            # 间插段小节:自由声部轮廓走句 + 低音根音
            ci = bar % 8
            r5 = CH[ROAD[bar]][0]
            root_p = nearest_pitch(r5, 50, 45, 62) or 50
            sc["B"] += [(b8, 8, root_p)]
            prev["B"] = root_p

            breathing = 76 <= bar < 92
            step = 2 if breathing else 1
            cont = CONTOURS[ci % 4] if (bar // 8) % 2 == 0 else CONTOURS2[ci % 4]
            evs, prev["S"] = fig_bar(pcs, cont, prev["S"], 64, 79, step)
            sc["S"] += [(b8 + i * step, step, m) for i, (m, _) in enumerate(evs)]

            def savoid(slot, b8=b8):
                return active_at(sc["S"], b8 + slot) + \
                    active_at(sc["B"], b8 + slot)

            mc = CONTOURS2[(ci + 1) % 4] if (bar // 8) % 2 == 0 \
                else CONTOURS[(ci + 1) % 4]
            m_cont = mc[2:] + mc[:2]
            evs, prev["M"] = fig_bar(pcs, m_cont, prev["M"], 62, 76, step,
                                     savoid)
            sc["M"] += [(b8 + i * step, step, m) for i, (m, _) in enumerate(evs)]

    sub = []
    for bar in range(BARS):
        sub.append((bar * EPB, 4, CH[ROAD[bar]][2]))
        sub.append((bar * EPB + 4, 4, CH[ROAD[bar]][2]))
    return sc, sub, roles


# ── 平行五八度自动修复(只动自由/间插段声部)──────────────────────────
def find_parallels(sc):
    out = []
    voices = ("S", "M", "B")
    for a in range(3):
        for b in range(a + 1, 3):
            va, vb = voices[a], voices[b]
            pma = pmb = pia = None
            for slot in range(0, TOTAL_8, 2):
                na = active_at(sc[va], slot)
                nb = active_at(sc[vb], slot)
                if not na or not nb:
                    continue
                ma, mb = na[0], nb[0]
                ia = (ma - mb) % 12
                if pia is not None and pia == ia and ia in (0, 7) \
                        and ma != pma and mb != pmb:
                    out.append((slot, va, vb))
                pma, pmb, pia = ma, mb, ia
    return out


def repair_parallels(sc):
    fixed_spans = set()
    for k, (bar, tv, root, mode, kind) in enumerate(ENTRIES):
        cv = cs_of(k)
        for s in range(bar * EPB, bar * EPB + 16):
            fixed_spans.add((s, tv))
            if cv:
                fixed_spans.add((s, cv))
    for s in range(160 * EPB, 164 * EPB):
        for v in ("S", "M", "B"):
            fixed_spans.add((s, v))

    def clean_pitch(v, s0, d, p):
        for i in range(d):
            for w in ("S", "M", "B"):
                if w == v:
                    continue
                for q in active_at(sc[w], s0 + i):
                    if abs(p - q) <= 13 and abs(p - q) % 12 == 1:
                        return False
        return True

    unfixable = set()
    seen = {}
    for _ in range(400):
        flags = [f for f in find_parallels(sc) if f not in unfixable]
        if not flags:
            break
        slot, va, vb = flags[0]
        key = (slot, va, vb)
        seen[key] = seen.get(key, 0) + 1
        if seen[key] > 2:
            unfixable.add(key)
            continue
        attempts = []
        for pos in (slot, slot - 2):
            if pos < 0:
                continue
            for v in (va, vb):
                ev = next((e for e in sc[v] if e[0] <= pos < e[0] + e[1]), None)
                if ev is None:
                    continue
                s0, d, m = ev
                if (s0, v) in fixed_spans:
                    continue
                attempts.append((v, s0, d, m))
        resolved = False
        for v, s0, d, m in attempts:
            pcs = CH[ROAD[s0 // EPB]][1]
            cands = []
            for alt in pcs:
                for p in range(RANGE[v][0], RANGE[v][1] + 1):
                    if p % 12 == alt and p != m:
                        cands.append(p)
            cands.sort(key=lambda p: (abs(p - m), p))
            for p in cands:
                if not clean_pitch(v, s0, d, p):
                    continue
                sc[v] = [(s, dd, p if (s, dd) == (s0, d) else mm)
                         for s, dd, mm in sc[v]]
                ps = find_parallels(sc)
                if (slot, va, vb) not in ps and \
                        not [1 for f in ps if f[0] == slot]:
                    resolved = True
                    break
                sc[v] = [(s, dd, m if (s, dd) == (s0, d) else mm)
                         for s, dd, mm in sc[v]]
            if resolved:
                break
        if not resolved:
            unfixable.add((slot, va, vb))
    return len(find_parallels(sc))


def active_at(evs, slot):
    out = []
    for s, d, m in evs:
        if s <= slot < s + d:
            out.append(m)
    return out


# ── 校验器 ────────────────────────────────────────────────────────────
def midi_name(m):
    return _NAMES[m % 12] + str(m // 12 - 1)


_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def validate(sc):
    errs, warns = [], []
    for v in ("S", "M", "B"):
        lo, hi = RANGE[v]
        cov = [False] * TOTAL_8
        for s, d, m in sc[v]:
            if not (lo <= m <= hi):
                errs.append("音域越界 %s slot%d midi%d" % (v, s, m))
            for i in range(s, s + d):
                cov[i] = True
        if not all(cov):
            errs.append("声部 %s 存在空隙: %d 处" % (v, cov.count(False)))

    for v in ("S", "M", "B"):
        evs = sorted(sc[v])
        for i, (s, d, m) in enumerate(evs):
            if s % 2 == 1 or s // EPB in LOCK_BARS:
                continue
            pcs = CH[ROAD[s // EPB]][1]
            if m % 12 in pcs:
                continue
            ok = False
            for j in (i - 1, i + 1):
                if 0 <= j < len(evs) and abs(evs[j][2] - m) <= 2:
                    ok = True
            if not ok:
                warns.append("强拍和弦外音 %s slot%d: %s(和弦%s)"
                             % (v, s, midi_name(m), ROAD[s // EPB]))
    for slot in range(0, TOTAL_8, 2):
        for a in ("S", "M", "B"):
            for b in ("S", "M", "B"):
                if a >= b:
                    continue
                for ma in active_at(sc[a], slot):
                    for mb in active_at(sc[b], slot):
                        if 0 < abs(ma - mb) <= 12 and abs(ma - mb) % 12 == 1:
                            warns.append("半音碰撞 slot%d: %s(%s) vs %s(%s)"
                                         % (slot, midi_name(min(ma, mb)), a,
                                            midi_name(max(ma, mb)), b))

    for slot, va, vb in find_parallels(sc):
        na = active_at(sc[va], slot)[0]
        nb = active_at(sc[vb], slot)[0]
        ia = (na - nb) % 12
        warns.append("平行%s %s-%s slot%d" % ("八度" if ia == 0 else "五度",
                                              va, vb, slot))

    print("── 结构表 ──")
    for s0, name, nb in SECTIONS:
        print("  小节 %3d-%3d  %s" % (s0 + 1, s0 + nb, name))
    kinds = {}
    for _, _, _, _, k in ENTRIES:
        kinds[k] = kinds.get(k, 0) + 1
    print("── 主题入点 %d 次(普通 %d / 密接 %d / 倒影 %d)──"
          % (len(ENTRIES), kinds.get("n", 0), kinds.get("s", 0),
             kinds.get("i", 0)))
    print("── 接缝报告(第96小节 E 属持续 → 第1小节 Am,V→I 跨缝解决)──")
    for v in ("S", "M", "B"):
        first = [m for s, d, m in sc[v] if s == 0][0]
        last_ev = max((s for s, d, m in sc[v]), key=lambda s: s)
        last = [m for s, d, m in sc[v] if s == last_ev][0]
        iv = (first - last) % 12
        print("  %s: %s → %s  音程类=%d" % (v, midi_name(last),
                                            midi_name(first), iv))

    if warns:
        print("── 对位警告 %d 条 ──" % len(warns))
        for w in warns:
            print("  !", w)
    if errs:
        print("── 错误 %d 条 ──" % len(errs))
        for e in errs:
            print("  ✗", e)
        raise SystemExit(1)
    print("校验:音域/覆盖/强拍协和 %s,警告 %d 条"
          % ("通过" if not warns else "见上", len(warns)))


# ── 合成(带限傅里叶波表 + 拨弦包络 + 环形混音)─────────────────────────
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


def envelope(n):
    if n in _envs:
        return _envs[n]
    env = [0.0] * n
    att = max(1, int(0.004 * SR))
    rel = max(1, min(int(0.02 * SR), n // 4))
    tau = 0.55 if n > SR else 0.20
    for i in range(n):
        if i < att:
            env[i] = i / att
        else:
            env[i] = 0.10 + 0.90 * math.exp(-(i - att) / (tau * SR))
        if i >= n - rel:
            env[i] *= (n - i) / rel
    _envs[n] = env
    return env


def add_note(L, R, kind, midi, start_smp, dur_s, gain, pan):
    tab = wavetable(kind)
    n = int(dur_s * SR)
    if n <= 0:
        return
    env = envelope(n)
    step = f_midi(midi) * TABLE / SR
    gl = gain * math.sqrt((1.0 - pan) / 2.0)
    gr = gain * math.sqrt((1.0 + pan) / 2.0)
    j = 0
    i = start_smp
    while j < n:
        end = NS if i + (n - j) >= NS else i + (n - j)
        while i < end:
            v = tab[int(j * step) % TABLE] * env[j]
            L[i] += v * gl
            R[i] += v * gr
            i += 1
            j += 1
        i = 0
    return


def add_kick(L, R, t0, gain):
    n = int(0.24 * SR)
    ph = 0.0
    for j in range(n):
        t = j / SR
        f = 130.0 * (42.0 / 130.0) ** min(1.0, t / 0.12)
        ph += 2.0 * math.pi * f / SR
        v = math.sin(ph) * (10.0 ** (-3.0 * t / 0.20)) * gain
        i = (t0 + j) % NS
        L[i] += v
        R[i] += v


def add_noise(L, R, t0, dur, hp_fc, lp_fc, gain, rng):
    n = int(dur * SR)
    ah = 1.0 - math.exp(-2.0 * math.pi * hp_fc / SR)
    al = 1.0 - math.exp(-2.0 * math.pi * lp_fc / SR)
    hp = lp = 0.0
    for j in range(n):
        x = rng.random() * 2.0 - 1.0
        hp += ah * (x - hp)
        y = x - hp
        lp += al * (y - lp)
        v = lp * (10.0 ** (-3.0 * (j / SR) / dur)) * gain
        i = (t0 + j) % NS
        L[i] += v
        R[i] += v


def bar_drum(bar):
    """分段鼓组:密接和应微提亮;自由间插+呼吸段 底鼓减半/16分hat停;
    终部 hat ×1.1;其余默认律动。"""
    if 48 <= bar < 64:
        return {"hat_gain": 1.15}
    if 76 <= bar < 112:
        return {"kick": (0, 4), "snare": (5,), "hats": (1, 3, 5, 7),
                "hat16": False, "hat_gain": 0.8}
    if 144 <= bar < 160:
        return {"hat_gain": 1.1}
    return {}


# ── 渲染主流程 ────────────────────────────────────────────────────────
def render(sc, sub, roles):
    L = array.array("d", [0.0]) * NS
    R = array.array("d", [0.0]) * NS

    for v in ("S", "M", "B"):
        for s, d, m in sc[v]:
            role = roles.get((s // EPB, v), "free")
            add_note(L, R, VOICE_WAVE[v], m, int(s * EIGHTH * SR),
                     d * EIGHTH * DURMUL, VOICE_GAIN[role], VOICE_PAN[v])

    for s, d, m in sub:
        add_note(L, R, "sine", m, int(s * EIGHTH * SR), d * EIGHTH * 1.05,
                 SUB_GAIN, 0.0)

    for v in sc:
        if v in ("S", "M", "B"):
            continue
        wave_ = VOICE_WAVE.get(v, "square")
        pan = VOICE_PAN.get(v, 0.0)
        g = EXTRA_VOICE_GAIN.get(v, VOICE_GAIN["theme"] * 0.6)
        for s, d, m in sc[v]:
            add_note(L, R, wave_, m, int(s * EIGHTH * SR),
                     d * EIGHTH * DURMUL, g, pan)

    rng = random.Random(20260903)
    for bar in range(BARS):
        spec = bar_drum(bar)
        kicks = spec.get("kick", KICK_OFFS)
        snares = spec.get("snare", (5,))
        hats = spec.get("hats", (1, 3, 5, 7))
        hat16 = spec.get("hat16", HAT16)
        hg = HAT_GAIN * spec.get("hat_gain", 1.0)
        b = int(bar * EPB * EIGHTH * SR)
        for off in kicks:
            add_kick(L, R, b + int(off * EIGHTH * SR), KICK_GAIN)
        for off in snares:
            add_noise(L, R, b + int(off * EIGHTH * SR), 0.09, 900, 3400,
                      SNARE_GAIN, rng)
        for off in hats:
            add_noise(L, R, b + int(off * EIGHTH * SR), 0.035, 7500, 14000,
                      hg, rng)
        if hat16:
            for off in range(8):
                add_noise(L, R, b + int((off + 0.5) * EIGHTH * SR), 0.02,
                          8000, 15000, hg * 0.55, rng)
    return L, R


def apply_layers(sc):
    """末入点(第157小节,B 声部)主题高八度叠双层 S2"""
    bar, tv, root, mode, kind = ENTRIES[-1]
    sc["S2"] = [(s + bar * EPB, d, m + 12)
                for s, d, m in theme_events(root, mode, 0)]
    EXTRA_VOICE_GAIN["S2"] = VOICE_GAIN["theme"] * 0.6
    VOICE_PAN["S2"] = 0.45


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
        a = abs(L[i])
        b = abs(R[i])
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
    print("── 霓虹幸存者 · 主界面「永续赋格 · 扩写版」──")
    print("作曲: A小调三声部赋格 %d小节 128BPM = %.1fs;紧凑七段结构"
          % (BARS, NS / SR))
    print("新段: 密接和应(每2小节叠入) / 主题倒影 / 自由间插部;末4小节属持续锁")
    sc, sub, roles = build_score()
    apply_layers(sc)
    left = repair_parallels(sc)
    print("平行修复: %s" % ("全部消除" if left == 0 else "剩余 %d 条" % left))
    validate(sc)
    print("渲染中(纯 Python,约 2-4 分钟)…")
    L, R = render(sc, sub, roles)
    p1 = os.path.join(HERE, "menu_ext_loop.wav")
    p2 = os.path.join(HERE, "menu_ext_seam.wav")
    peak, scale = finalize(L, R, p1, 1)
    write_seam(L, R, p2, 10.0)
    print("峰值 %.3f → 增益 %.2f;输出:" % (peak, scale))
    print("  %s (%.3fs)" % (p1, NS / SR))
    print("  %s (20s = 末10s+头10s 循环缝试听)" % p2)


if __name__ == "__main__":
    main()
