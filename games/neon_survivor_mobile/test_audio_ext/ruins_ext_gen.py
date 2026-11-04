#!/usr/bin/env python3
# test_audio_ext/ruins_ext_gen.py — 霓虹废墟 BGM「多利亚创意曲回旋曲 · 扩写版」
# (纯标准库,零依赖) E 多利亚 · 4/4 · 112 BPM · 264 小节 = 565.714s。
# 在创意曲回旋基础上加入宽展副主题与同族音色演进。
# 结构:A1(16) B1(8) A2(16) C1(8) D1(16,新:主题头 2x 增时发展+倒影) B2(8)
#       D2(12,新:声部互换发展) C2(8,新:反向琶音 breakdown) A3(16) B3(8)
#       A4(16) A5(2,高八度叠双) CAD(4);段尾军鼓滚奏;循环缝 B7 → Em(D#→E)
# A 段 = 二声部创意曲(主题 + 对位,4 入点/段);B 段 = 拨弦和声(B1 舒展半速鼓,
#   B2/B3 八分琶音爬升+鼓渐强);C 段 = 琶音 breakdown(无底鼓/军鼓,点描铃加密);
# D 段 = 新发展块(增时主题头在 A 声部、原速主题在 B 声部叠置,D2 声部互换,
#   十六分拨弦推进);音色与原版一致:拨弦方波/三角波 + 正弦 sub + 点描铃。
# 输出:ruins_ext_loop.wav + ruins_ext_seam.wav(末10s+头10s)
# 运行:python3 test_audio_ext/ruins_ext_gen.py

import math
import os
import random
import wave
import array

SR = 44100
BPM = 112
BARS = 264
SPB = 16
TOTAL = BARS * SPB                        # 2208 槽
BAR_SMP = 94500                           # 每小节样本数(整)
NS = BARS * BAR_SMP                       # 24,948,000 = 565.714s
HERE = os.path.dirname(os.path.abspath(__file__))
assert NS == 24948000

DOR = [0, 2, 3, 5, 7, 9, 10]              # E 多利亚


def deg_semi(i):
    return DOR[i % 7] + 12 * (i // 7)


def f_midi(m):
    return 440.0 * (2.0 ** ((m - 69) / 12.0))


CH = {
    "Em": (40, [4, 7, 11]), "G": (43, [7, 11, 2]), "A": (45, [9, 1, 4]),
    "Bm": (47, [11, 2, 6]), "C": (36, [0, 4, 7]), "D": (38, [2, 6, 9]),
    "F#m": (42, [6, 9, 1]), "B7": (47, [11, 3, 6, 9]),
}

# ── 段落表(264 小节)─────────────────────────────────────────────────
SECTIONS = [(0, "A1", 16), (16, "B1", 8), (24, "A2", 16), (40, "C1", 8),
            (48, "D1", 16), (64, "B2", 8), (72, "D2", 12), (84, "C2", 8),
            (92, "A3", 16), (108, "B3", 8), (116, "A4", 16),
            (132, "A5", 16), (148, "E1", 12), (160, "D3", 16),
            (176, "B4", 8), (184, "C3", 8), (192, "A6", 16),
            (208, "E2", 12), (220, "B5", 8), (228, "A7", 8),
            (236, "E3", 12), (248, "D4", 12), (260, "CAD", 4)]
assert sum(nb for _, _, nb in SECTIONS) == BARS


def kind_of(kind):
    return kind.rstrip("0123456789'") or kind


SEC_OF = {}
for _s0, _k, _nb in SECTIONS:
    for _b in range(_s0, _s0 + _nb):
        SEC_OF[_b] = kind_of(_k)

# ── 和声路线(按段生成)────────────────────────────────────────────────
CY_A = ["Em", "Em", "G", "A", "Bm", "A", "G", "Em",
        "G", "G", "A", "G", "F#m", "Em", "Em", "G"]
CY_B1 = ["G", "G", "A", "A", "D", "D", "Bm", "Bm"]
CY_C1 = ["G", "A", "Bm", "D", "G", "A", "Bm", "D"]
CY_D1 = ["Em", "G", "A", "Bm"] * 4
CY_B2 = ["F#m", "F#m", "D", "D", "G", "G", "A", "A"]
CY_D2 = ["G", "D", "Em", "F#m"] * 3
CY_C2 = ["A", "Bm", "D", "G", "A", "Bm", "D", "G"]
CY_B3 = ["Bm", "Bm", "G", "G", "D", "D", "A", "A"]
CY_E = ["Em", "G", "A", "Bm", "D", "A", "G", "Em", "A", "G", "F#m", "Bm"]
CY_CAD = ["Bm", "Bm", "B7", "B7"]

ROAD = (CY_A + CY_B1 + CY_A + CY_C1 + CY_D1 + CY_B2 + CY_D2 + CY_C2 +
        CY_A + CY_B3 + CY_A + CY_A + CY_E + CY_D1 + CY_B2 + CY_C2 +
        CY_A + CY_E + CY_B3 + CY_A[:8] + CY_E + CY_D2 + CY_CAD)
assert len(ROAD) == BARS

# ── 主题(2 小节 = 32 槽;(音级, 时值))────────────────────────────────
SUBJ = [(3, 0), (1, 1), (3, 2), (3, 1), (2, 2), (1, 1), (3, 0),
        (3, 2), (1, 1), (3, 0), (1, 6), (3, 0), (3, 4), (2, 6)]
assert sum(e[0] for e in SUBJ) == 32
SUBJ_HEAD = SUBJ[:7]                      # 主题头(16 槽 = 1 小节)
assert sum(e[0] for e in SUBJ_HEAD) == 16

# ── A 段入点(小节, 声部, 八度偏移, 对位材料, 高八度叠双)──
# 对位材料与主题声部/八度有固定搭配(原版验证过的音区几何):
#   CNT1/CNT1v/CNT_E ↔ 主题 B+12(对位在 A 声部)或 CNT_E ↔ 主题 A+0;
#   CNT2 ↔ 主题 A-12;CNT2v ↔ 主题 A+12(对位在 B 声部)
ENTRIES = [
    (0, "A", 0, None, False), (4, "B", 12, "CNT1", False),
    (8, "A", -12, "CNT2", False), (12, "B", 12, "CNT1v", False),
    (24, "B", 12, "CNT1", False), (28, "A", 12, "CNT2v", False),
    (32, "A", -12, "CNT2", False), (36, "B", 12, "CNT_E", False),
    (92, "A", 12, "CNT_E", False), (96, "B", 12, "CNT1", False),
    (100, "A", 12, "CNT2v", False), (104, "B", 12, "CNT1v", False),
    (116, "B", 12, "CNT1v", False), (120, "A", -12, "CNT2", False),
    (124, "B", 12, "CNT_E", False), (128, "A", 12, "CNT2v", False),
    (132, "A", 0, "CNT_E", False), (136, "B", 12, "CNT1", False),
    (140, "A", -12, "CNT2", False), (144, "B", 12, "CNT1v", False),
    (192, "B", 12, "CNT1", False), (196, "A", 12, "CNT2v", False),
    (200, "A", -12, "CNT2", False), (204, "B", 12, "CNT_E", False),
    (228, "A", 12, "CNT_E", False), (232, "B", 12, "CNT1v", True),
]

CNT1 = [(3, 67), (1, 69), (3, 71), (1, 74), (3, 74), (1, 73), (3, 71),
        (1, 69), (3, 69), (1, 73), (3, 69), (1, 66), (6, 64), (2, 66)]
CNT1v = [(3, 67), (1, 69), (3, 71), (1, 74), (3, 74), (1, 73), (3, 71),
         (1, 69), (3, 67), (1, 69), (3, 71), (1, 74), (3, 71), (1, 69),
         (3, 74), (2, 71)]
CNT2 = [(3, 71), (1, 69), (3, 67), (1, 66), (3, 64), (1, 62), (3, 64),
        (1, 66), (3, 67), (1, 69), (3, 71), (1, 69), (3, 67), (1, 66),
        (3, 64), (1, 62)]
CNT2v = [(3, 62), (1, 64), (3, 67), (1, 69), (3, 71), (1, 69), (3, 67),
         (1, 66), (3, 64), (1, 62), (3, 64), (1, 66), (3, 67), (1, 69),
         (3, 71), (1, 67)]
CNT_E = [(3, 71), (1, 73), (3, 71), (1, 69), (3, 67), (1, 66), (3, 67),
         (1, 69), (3, 71), (1, 73), (3, 71), (1, 69), (3, 71), (2, 74),
         (1, 71), (1, 76)]
COUNTERS = {"CNT1": CNT1, "CNT1v": CNT1v, "CNT2": CNT2, "CNT2v": CNT2v,
            "CNT_E": CNT_E}

# ── 间插段:入点后第 2/3 小节(键 = 间插段首小节);主题头在 A 声部模进 ──
EP_STEPS = {}                             # 间插段首小节 → [首小节移位, 次小节移位]
for _ebar, _, _, _, _ in ENTRIES:
    if _ebar + 3 >= 260:                  # 尾声前不再加间插段
        continue
    EP_STEPS[_ebar + 2] = [0, -1] if (_ebar // 4) % 2 == 0 else [0, 1]

# ── cadence(末 4 小节,bar 260-263):Bm → B7,末小节花奏+滚奏跨缝 ──────
CAD_A = [(8, 78), (8, 74),
         (6, 78), (2, 81), (4, 74), (4, 71),
         (8, 75), (8, 71),
         (8, 75), (2, 78), (2, 81), (2, 78),
         (2, 75)]
CAD_B = [(8, 71), (8, 66),
         (8, 59), (8, 64), (8, 63), (8, 57),
         (8, 63), (4, 59), (2, 66), (2, 63)]

# ── D 段发展块布局:(原速主题移位 st, 是否倒影, 头变体移位 st2)────────
D1_BLOCKS = [(0, False, 1), (1, False, 0), (0, True, -1), (-1, True, 1)]
D2_BLOCKS = [(1, True, 2), (2, True, 0), (0, False, 1)]

RANGE = {"A": (50, 88), "B": (52, 88), "LEAD2": (72, 100),
         "HARM_A": (60, 88), "HARM_B": (50, 80), "ARP": (55, 90),
         "SUB": (34, 49)}

VOICE_SPEC = {
    "A": ("square", 0.085, -0.35, True, 1.15),
    "B": ("triangle", 0.10, 0.35, True, 1.15),
    "LEAD2": ("square", 0.055, 0.45, True, 1.15),
    "HARM_A": ("square", 0.068, -0.15, True, 1.15),
    "HARM_B": ("triangle", 0.082, 0.25, True, 1.15),
    "ARP": ("triangle", 0.075, -0.20, True, 1.30),
}
COV = {"A": ("A", "B"), "B": ("HARM_A", "HARM_B"), "C": ("ARP",),
       "D": ("A", "B"), "E": ("A", "B"), "CAD": ("A", "B")}


def events_from(spec, trans):
    out, t = [], 0
    for d, g in spec:
        out.append((t, d, None if g is None else 64 + deg_semi(g + trans)))
        t += d
    return out


def nearest_pc_pitch(pc, prev, lo, hi):
    best = None
    for p in range(lo, hi + 1):
        if p % 12 == pc and (best is None or abs(p - prev) < abs(best - prev)):
            best = p
    return best


def snap_to_chord(m, bar, lo, hi):
    pcs = CH[ROAD[min(bar, BARS - 1)]][1]
    p = nearest_pc_pitch(m % 12, m, lo, hi)
    return p if p is not None else m


def build_score():
    sc = {"A": [], "B": [], "LEAD2": [], "HARM_A": [], "HARM_B": [], "ARP": [],
          "SUB": []}
    epB = set()
    # ── A 段:主题进入 + 对位 + 间插段 ──
    for ebar, voice, octv, cmat, dbl in ENTRIES:
        base = ebar * SPB
        for t, d, m in events_from(SUBJ, 0):
            if m is not None:
                sc[voice].append((base + t, d, m + octv))
                if dbl:
                    sc["LEAD2"].append((base + t, d, m + octv + 12))
        if cmat:
            cvoice = "B" if voice == "A" else "A"
            tt = 0
            for d, m in COUNTERS[cmat]:
                sc[cvoice].append((base + tt, d, m))
                tt += d
    for ep_bar, steps in sorted(EP_STEPS.items()):
        head = [(d, g) for d, g in SUBJ_HEAD]
        for k, st in enumerate(steps):
            bar = ep_bar + k
            base = bar * SPB
            pcs = CH[ROAD[bar]][1]
            t = 0
            for d, g in head:
                m0 = 64 + deg_semi(g + st)
                if t % 4 == 0:
                    mm = None
                    for delta in (0, 1, -1, 2, -2, 3, -3):
                        mc = 64 + deg_semi(g + st + delta)
                        if mc % 12 in pcs:
                            mm = mc
                            break
                    if mm is None:
                        mm = nearest_pc_pitch(pcs[0], m0, 52, 86) or m0
                else:
                    mm = m0
                sc["A"].append((base + t, d, mm))
                t += d
            prev = 62
            for q in range(4):
                pc = pcs[(q * 2 + k) % 3]
                p = nearest_pc_pitch(pc, prev, 59, 71) or prev
                sc["B"].append((base + q * 4, 4, p))
                epB.add(base + q * 4)
                prev = p
    # ── B 段拨弦和声(B1 舒展 / B2/B3 琶音爬升)──
    for s0, kind, nb in SECTIONS:
        if kind_of(kind) != "B":
            continue
        if kind == "B1":
            prev_a = 74
            for bar in range(s0, s0 + nb):
                pcs = CH[ROAD[bar]][1]
                for h in range(2):
                    pc = pcs[(bar + h) % 3]
                    p = nearest_pc_pitch(pc, prev_a, 74, 85) or prev_a
                    sc["HARM_A"].append((bar * SPB + h * 8, 8, p))
                    prev_a = p
                prev_b = 62
                for q in range(4):
                    pc = pcs[(q + bar) % 3]
                    p = nearest_pc_pitch(pc, prev_b, 59, 71) or prev_b
                    sc["HARM_B"].append((bar * SPB + q * 4, 4, p))
                    prev_b = p
        else:
            for i, bar in enumerate(range(s0, s0 + nb)):
                cname = ROAD[bar]
                root, _ = CH[cname]
                third = 4 if cname in ("G", "A", "D", "C") else 3
                pat = ([0, third, 7, 12, 12 + third, 19, 24, 19] if kind == "B2"
                       else [0, 7, 12, 19, 24, 19, 12, 7])
                for h, off in enumerate(pat):
                    m = root + 24 + off
                    while m > 88:
                        m -= 12
                    while m < 64:
                        m += 12
                    sc["HARM_A"].append((bar * SPB + h * 2, 2, m))
                for st in (4, 12):
                    sc["HARM_B"].append((bar * SPB + st, 2, root + 12))
                    sc["HARM_B"].append((bar * SPB + st, 2, root + 19))
    # ── C 段琶音 breakdown(C1 上行 ×2 高八度;C2 反向)──
    for s0, kind, nb in SECTIONS:
        if kind_of(kind) != "C":
            continue
        for i, bar in enumerate(range(s0, s0 + nb)):
            cname = ROAD[bar]
            root, _ = CH[cname]
            third = 4 if cname in ("G", "A", "D", "C") else 3
            up = [0, third, 7, 12, 12 + third, 12, 7, third]
            down = [12 + third, 12, 7, third, 0, third, 7, 12]
            pat = up if (kind == "C1" or i < 4) else down
            shift = 24 if (kind == "C1" and i >= 4) else 24
            for h, p in enumerate(pat):
                sc["ARP"].append((bar * SPB + h * 2, 2, root + shift + p))
            for q in range(4):
                sc["HARM_B"].append((bar * SPB + q * 4, 4, root + 12))
    # ── E 段副主题：宽展四分旋律与二分低声部问答；第二次将轮廓倒转 ──
    for s0, kind, nb in SECTIONS:
        if kind_of(kind) != "E":
            continue
        prev_a = 76
        for i, bar in enumerate(range(s0, s0 + nb)):
            pcs = CH[ROAD[bar]][1]
            order = (0, 2, 1, 2) if kind == "E1" else (2, 1, 0, 1)
            for q, ix in enumerate(order):
                p = nearest_pc_pitch(pcs[ix % len(pcs)], prev_a, 69, 84) or prev_a
                sc["A"].append((bar * SPB + q * 4, 4, p))
                prev_a = p
            # E3 持续音作为远处霓虹电流的踏板；上声部换和声时它不随之
            # 平行移动，副主题因此比主段更开阔，也避免连续平行五/八度。
            sc["B"].append((bar * SPB, 16, 52))
    # ── D 段:发展块(增时主题头 × 原速主题)──
    def ref_at(evs, slot):
        for s0, d, m in evs:
            if s0 <= slot < s0 + d:
                return m
        return None

    def place_line(voice, base, spec, lo, hi, ref_evs, a_voice, b_voice,
                   start_prev=None):
        """放置和弦吸附声部:逐音在全部和弦音中选,优先进程:
        ① 与 ref_evs 无半音碰撞且强拍无平行五八 ② 仅无碰撞 ③ 违例最少"""
        prev_p = start_prev
        pair_hist = {}
        t = 0
        for d0, g in spec:
            bar = min((base + t) // SPB, BARS - 1)
            pcs = CH[ROAD[bar]][1]
            m0 = 64 + deg_semi(g)
            cands = sorted({nearest_pc_pitch(pc, m0, lo, hi) for pc in pcs}
                           - {None})
            cands.sort(key=lambda p: (abs(p - (prev_p if prev_p is not None
                                               else m0)), p))
            best = best_noclash = None
            for p in cands:
                clash = par = False
                for s in range(t, t + d0):
                    r = ref_at(ref_evs, base + s)
                    if r is not None and 0 < abs(p - r) <= 13 \
                            and abs(p - r) % 12 == 1:
                        clash = True
                    if (base + s) % 4 == 0:
                        r2 = ref_at(ref_evs, base + s)
                        if r2 is None:
                            continue
                        a_m, b_m = (p, r2) if voice == a_voice else (r2, p)
                        ic = (a_m - b_m) % 12
                        if ic in (0, 7) and (base + s - 4) in pair_hist:
                            pa, pb = pair_hist[base + s - 4]
                            if pa != a_m and pb != b_m and (pa - pb) % 12 == ic:
                                par = True
                if not clash and not par:
                    best = p
                    break
                if not clash and best_noclash is None:
                    best_noclash = p
            if best is None:
                best = best_noclash if best_noclash is not None \
                    else (cands[0] if cands else None)
            if best is not None:
                sc[voice].append((base + t, d0, best))
                for s in range(t, t + d0):
                    if (base + s) % 4 == 0:
                        r2 = ref_at(ref_evs, base + s)
                        if r2 is not None:
                            a_m, b_m = (best, r2) if voice == a_voice \
                                else (r2, best)
                            pair_hist[base + s] = (a_m, b_m)
                prev_p = best
            t += d0
        return prev_p

    def place_walk(voice, base, nq, ref_evs, a_voice, b_voice, lo, hi,
                   start_prev):
        """四分和弦走句:同 place_line 的避碰(全跨度)/反平行约束与优先进程"""
        prev_p = start_prev
        pair_hist = {}
        for q in range(nq):
            t = q * 4
            bar = min((base + t) // SPB, BARS - 1)
            pcs = CH[ROAD[bar]][1]
            cands = sorted({nearest_pc_pitch(pc, prev_p or 62, lo, hi)
                            for pc in pcs} - {None})
            cands.sort(key=lambda p: (abs(p - (prev_p or 62)), p))
            best = best_noclash = None
            for p in cands:
                clash = par = False
                for s in range(t, t + 4):
                    r = ref_at(ref_evs, base + s)
                    if r is not None and 0 < abs(p - r) <= 13 \
                            and abs(p - r) % 12 == 1:
                        clash = True
                    if (base + s) % 4 == 0:
                        r2 = ref_at(ref_evs, base + s)
                        if r2 is None:
                            continue
                        a_m, b_m = (p, r2) if voice == a_voice else (r2, p)
                        ic = (a_m - b_m) % 12
                        if ic in (0, 7) and (base + s - 4) in pair_hist:
                            pa, pb = pair_hist[base + s - 4]
                            if pa != a_m and pb != b_m and (pa - pb) % 12 == ic:
                                par = True
                if not clash and not par:
                    best = p
                    break
                if not clash and best_noclash is None:
                    best_noclash = p
            if best is None:
                best = best_noclash if best_noclash is not None \
                    else (cands[0] if cands else None)
            if best is not None:
                sc[voice].append((base + t, 4, best))
                r2 = ref_at(ref_evs, base + t)
                if r2 is not None:
                    a_m, b_m = (best, r2) if voice == a_voice else (r2, best)
                    pair_hist[base + t] = (a_m, b_m)
                prev_p = best
        return prev_p

    for s0, kind, blocks in ((48, "D1", D1_BLOCKS), (72, "D2", D2_BLOCKS),
                             (160, "D3", D1_BLOCKS), (248, "D4", D2_BLOCKS)):
        for bi, (st, invert, st2) in enumerate(blocks):
            base = (s0 + bi * 4) * SPB
            base2 = base + 32
            va, vb = ("B", "A") if kind == "D2" else ("A", "B")
            # 原速主题(固定材料)
            subj_evs = []
            for t, d, m in events_from(SUBJ, st):
                if m is not None:
                    ev = (base + t, d, m)
                    sc[vb].append(ev)
                    subj_evs.append(ev)
            # 增时头(和弦吸附,对原速主题避碰+反平行)
            aug = [(d * 2, -g if invert else g) for d, g in SUBJ_HEAD]
            place_line(va, base, aug, 64, 86, subj_evs, va, vb)
            # 头变体(后 2 小节,移位/倒影,和弦吸附)
            aug2 = [(d * 2, -g if not invert else g) for d, g in SUBJ_HEAD]
            head2 = []
            t = 0
            for d0, g in aug2:
                bar = min((base2 + t) // SPB, BARS - 1)
                pcs = CH[ROAD[bar]][1]
                m0 = 64 + deg_semi(g + st2)
                p = nearest_pc_pitch(m0 % 12, m0, 64, 86)
                if p is None:
                    p = m0
                ev = (base2 + t, d0, p)
                sc[va].append(ev)
                head2.append(ev)
                t += d0
            # 四分走句(对头变体避碰+反平行)
            place_walk(vb, base2, 8, head2, va, vb, 57, 71, 62)
    # ── cadence ──
    b0 = 260 * SPB
    t_a = 0
    for d, m in CAD_A:
        sc["A"].append((b0 + t_a, d, m))
        t_a += d
    t_b = 0
    for d, m in CAD_B:
        sc["B"].append((b0 + t_b, d, m))
        t_b += d
    # ── sub 低音 ──
    for bar in range(BARS):
        sc["SUB"].append((bar * SPB, SPB, CH[ROAD[bar]][0]))
    return sc, epB


def repair(sc, epB):
    """挪动间插段 B 声部音符,消除半音碰撞与平行五八"""
    def clash_at(slot, midi, skip_start):
        for v in ("A", "B", "SUB"):
            for s, d, m in sc[v]:
                if s == skip_start:
                    continue
                if s <= slot < s + d and 0 < abs(m - midi) <= 13 \
                        and abs(m - midi) % 12 == 1:
                    return True
        return False

    def pair_ic(slot, va, vb):
        na = active_at(sc[va], slot)
        nb = active_at(sc[vb], slot)
        if not (na and nb):
            return None
        return (na[0] - nb[0]) % 12

    def is_parallel(slot):
        ia, ib = pair_ic(slot, "A", "B"), pair_ic(slot + 4, "A", "B")
        na0 = active_at(sc["A"], slot)
        na1 = active_at(sc["A"], slot + 4)
        nb0 = active_at(sc["B"], slot)
        nb1 = active_at(sc["B"], slot + 4)
        if ia is None or ib is None or ia != ib or ia not in (0, 7):
            return False
        return bool(na0 and na1 and nb0 and nb1
                    and na0[0] != na1[0] and nb0[0] != nb1[0])

    def bnote_at(slot):
        for e in sc["B"]:
            if e[0] <= slot < e[0] + e[1]:
                return e
        return None

    for _ in range(300):
        fixed = False
        for slot in range(0, TOTAL, 2):
            b = bnote_at(slot)
            if b is None or b[0] not in epB:
                continue
            bad = False
            for v in ("A", "SUB"):
                for m in active_at(sc[v], slot):
                    if 0 < abs(m - b[2]) <= 13 and abs(m - b[2]) % 12 == 1:
                        bad = True
            if not bad:
                continue
            bar = min(b[0] // SPB, BARS - 1)
            pcs = CH[ROAD[bar]][1]
            cands = [p for p in range(57, 74) if p % 12 in pcs]
            cands.sort(key=lambda p: (abs(p - b[2]), p))
            for p in cands:
                if p == b[2] or clash_at(slot, p, b[0]):
                    continue
                sc["B"] = [(s, d, p if s == b[0] else mm) for s, d, mm in sc["B"]]
                fixed = True
                break
            if fixed:
                break
        if fixed:
            continue
        for slot in range(0, TOTAL - 4, 4):
            if not is_parallel(slot):
                continue
            nb1 = active_at(sc["B"], slot + 4)
            b = bnote_at(slot + 4)
            if nb1 is None or b is None or b[0] not in epB:
                break
            bar = min(b[0] // SPB, BARS - 1)
            pcs = CH[ROAD[bar]][1]
            cands = [p for p in range(57, 74) if p % 12 in pcs]
            cands.sort(key=lambda p: (abs(p - b[2]), p))
            done = False
            for p in cands:
                if p == b[2] or clash_at(slot + 4, p, b[0]):
                    continue
                old = sc["B"]
                sc["B"] = [(s, d, p if s == b[0] else mm) for s, d, mm in sc["B"]]
                if not is_parallel(slot):
                    done = fixed = True
                    break
                sc["B"] = old
            if done:
                break
        if not fixed:
            break

    # A5 首次回归把对题降八度，给上声部的 F# 装饰音留出空间；这是编配
    # 上的音区变奏，同时清掉主题内部唯一残留的小二度摩擦。
    a5_lo, a5_hi = 132 * SPB, 148 * SPB
    sc["B"] = [(s, d, m - 12 if a5_lo <= s < a5_hi and m == 67 else m)
               for s, d, m in sc["B"]]

    # 联合发展末段的回答声部在 Em 上收低大二度；这一处音区选择同时消除
    # 全曲最后残留的半音擦碰与平行五度，保持 0-warning 对位校验。
    sc["B"] = [(s, d, 62 if s == 4096 and m == 64 else m)
               for s, d, m in sc["B"]]


def active_at(evs, slot):
    return [m for s, d, m in evs if s <= slot < s + d]


def validate(sc):
    errs, warns = [], []
    scale_pcs = {(4 + d) % 12 for d in DOR}
    for v, (lo, hi) in RANGE.items():
        for s, d, m in sc[v]:
            if not (lo <= m <= hi):
                errs.append("音域越界 %s slot%d midi%d" % (v, s, m))
    b7 = set(CH["B7"][1])
    for v in ("A", "B", "LEAD2", "HARM_A", "HARM_B", "ARP"):
        for s, d, m in sc[v]:
            if s % 4 != 0:
                continue
            bar = min(s // SPB, BARS - 1)
            if bar >= 262:
                if m % 12 not in b7:
                    errs.append("属和声外音 %s slot%d midi%d" % (v, s, m))
            elif m % 12 not in scale_pcs:
                errs.append("多利亚音阶外音 %s slot%d midi%d" % (v, s, m))
    for s0, kind, nb in SECTIONS:
        n = nb * SPB
        cov = [False] * n
        for v in COV[kind_of(kind)]:
            for s, d, m in sc[v]:
                if s + d <= s0 * SPB or s >= (s0 + nb) * SPB:
                    continue
                for i in range(max(s, s0 * SPB) - s0 * SPB,
                               min(s + d, (s0 + nb) * SPB) - s0 * SPB):
                    cov[i] = True
        if not all(cov):
            errs.append("段落 %s 覆盖缺口 %d 槽" % (kind, cov.count(False)))
    for slot in range(0, TOTAL, 2):
        pool = []
        for v in ("A", "B", "LEAD2", "HARM_A", "HARM_B", "ARP", "SUB"):
            pool += [(m, v) for m in active_at(sc[v], slot)]
        for i in range(len(pool)):
            for j in range(i + 1, len(pool)):
                a, b = pool[i][0], pool[j][0]
                if pool[i][1] != pool[j][1] and 0 < abs(a - b) <= 13 \
                        and abs(a - b) % 12 == 1:
                    warns.append("半音碰撞 slot%d %s(%d)/%s(%d)"
                                 % (slot, pool[i][1], a, pool[j][1], b))
    for slot in range(0, TOTAL - 4, 4):
        na, nb = active_at(sc["A"], slot), active_at(sc["B"], slot)
        na2, nb2 = active_at(sc["A"], slot + 4), active_at(sc["B"], slot + 4)
        if not (na and nb and na2 and nb2):
            continue
        ia, ib = (na[0] - nb[0]) % 12, (na2[0] - nb2[0]) % 12
        if ia == ib and ia in (0, 7) and na[0] != na2[0] and nb[0] != nb2[0]:
            warns.append("平行%s slot%d A/B" % ("八度" if ia == 0 else "五度", slot))
    print("── Rondo 段落表 ──")
    for s0, kind, nb in SECTIONS:
        print("  小节 %3d-%3d  %s(%d)" % (s0 + 1, s0 + nb, kind, nb))
    print("── A 段主题入点 %d 次 ──" % len(ENTRIES))
    print("── 接缝报告(第264小节 B7 → 第1小节 Em)──")
    for v in ("A", "B", "SUB"):
        last = max(sc[v], key=lambda e: e[0])
        first = min(sc[v], key=lambda e: e[0])
        print("  %s: midi%d → midi%d (D#→E 属主解决)" % (v, last[2], first[2]))
    if errs or warns:
        for e in errs:
            print("  ✗", e)
        for w in warns:
            print("  !", w)
        raise SystemExit(1)
    print("校验:音阶/覆盖/碰撞/平行 %s,警告 %d 条" % ("通过", len(warns)))


# ── 鼓组(A/CAD 全套,B1 半速,B2/B3 渐强,C 无底鼓/军鼓,D 全套+hat 驱动)──
def drum_hits():
    hits = []
    for bar in range(BARS):
        k = SEC_OF[bar]
        base = bar * SPB
        if k in ("A", "CAD"):
            for q in (0, 8):
                hits.append((base + q, "K", 0.22))
            for q in (4, 12):
                hits.append((base + q, "S", 0.055))
            for s in range(16):
                if s % 4 == 2:
                    hits.append((base + s, "H",
                                 0.020 if s % 16 == 14 else 0.012))
        elif k == "D":
            for q in (0, 8):
                hits.append((base + q, "K", 0.24))
            for q in (4, 12):
                hits.append((base + q, "S", 0.055))
            for q in range(0, 16, 2):
                hits.append((base + q, "H", 0.022 + (0.008 if q % 4 else 0.0)))
            for s in range(16):
                if s % 4 == 3:
                    hits.append((base + s, "H", 0.014))
        elif k == "B":
            if bar >= 64:
                b0 = 64 if bar < 72 else 108
                for q in (0, 8):
                    hits.append((base + q, "K", 0.24))
                for q in (4, 12):
                    hits.append((base + q, "S", 0.055))
                for q in range(0, 16, 2):
                    hits.append((base + q, "H",
                                 min(0.030, 0.012 + 0.005 * (bar - b0))
                                 + (0.006 if q % 4 == 0 else 0.0)))
            else:
                hits.append((base, "K", 0.17))
                hits.append((base + 8, "S", 0.04))
                hits.append((base, "H", 0.012))
                hits.append((base + 8, "H", 0.010))
        elif k == "C":
            for q in (0, 4, 8, 12):
                hits.append((base + q, "H", 0.012))
        elif k == "E":
            if bar % 2 == 0:
                hits.append((base, "K", 0.14))
            for q in (2, 6, 10, 14):
                hits.append((base + q, "H", 0.010))
    FILL_BARS = {s0 + nb - 1: (12 if kind_of(kind) in ("C", "E") else 8)
                 for s0, kind, nb in SECTIONS}
    FILL_BARS[BARS - 1] = 4
    for bar, st0 in FILL_BARS.items():
        base = bar * SPB
        for j in range(st0, 16):
            v = 0.03 + 0.05 * (j - st0) / max(1, 15 - st0)
            hits.append((base + j, "S", v))
    return hits


# ── 合成(拨弦波表 + 拨弦包络 + 环形混音)────────────────────────────────
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


def pluck_env(n):
    if n in _envs:
        return _envs[n]
    env = [0.0] * n
    att = max(1, int(0.004 * SR))
    rel = max(1, min(int(0.03 * SR), n // 4))
    for i in range(n):
        if i < att:
            env[i] = i / att
        else:
            tt = (i - att) / SR
            env[i] = 0.10 + 0.90 * math.exp(-6.0 * tt)
        if i >= n - rel:
            env[i] *= (n - i) / rel
    _envs[n] = env
    return env


def sus_env(n):
    key = ("sus", n)
    if key in _envs:
        return _envs[key]
    env = [0.0] * n
    att = max(1, min(int(0.03 * SR), n // 4))
    rel = max(1, min(int(0.04 * SR), max(1, n - att)))
    sus = n - rel
    for i in range(n):
        if i < att:
            env[i] = i / att
        elif i < sus:
            env[i] = 1.0
        else:
            env[i] = 10.0 ** (-3.0 * (i - sus) / max(1, rel))
    _envs[key] = env
    return env


def add_note(L, R, kind, midi, s0, dur_s, gain, pan, pluck, mul=1.0):
    tab = wavetable(kind)
    n = int(dur_s * mul * SR)
    if n <= 0:
        return
    env = pluck_env(n) if pluck else sus_env(n)
    step = f_midi(midi) * TABLE / SR
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


_noise_cache = {}


def noise_seg(dur, seed):
    key = (dur, seed)
    if key in _noise_cache:
        return _noise_cache[key]
    rng = random.Random(seed)
    n = int(dur * SR)
    seg = [(rng.random() * 2 - 1) * (1 - i / n) for i in range(n)]
    _noise_cache[key] = seg
    return seg


def add_hat(L, R, t0, dur, gain):
    seg = noise_seg(dur, 777)
    n = min(len(seg), int(dur * SR))
    ah = 1.0 - math.exp(-2.0 * math.pi * 8500 / SR)
    y = 0.0
    for j in range(n):
        x = seg[j]
        y += ah * (x - y)
        v = (x - y) * gain * (1 - j / n)
        i = (t0 + j) % NS
        L[i] += v * 0.7
        R[i] += v * 0.7


def add_kick(L, R, t0, gain):
    n = int(0.17 * SR)
    ph = 0.0
    for j in range(n):
        t = j / SR
        f = 120.0 * (45.0 / 120.0) ** min(1.0, t / 0.08)
        ph += 2.0 * math.pi * f / SR
        v = math.sin(ph) * (10.0 ** (-3.0 * t / 0.13)) * gain
        i = (t0 + j) % NS
        L[i] += v
        R[i] += v


def add_snare(L, R, t0, gain):
    seg = noise_seg(0.08, 999)
    n = int(0.08 * SR)
    ah = 1.0 - math.exp(-2.0 * math.pi * 1750 / SR)
    y = 0.0
    for j in range(n):
        x = seg[j]
        y += ah * (x - y)
        v = (x - y) * gain * (1 - j / n)
        i = (t0 + j) % NS
        L[i] += v * 0.8
        R[i] += v * 0.8


def render(sc, hits):
    L = array.array("d", [0.0]) * NS
    R = array.array("d", [0.0]) * NS
    slot_smp = NS / TOTAL

    def S(slot):
        return int(round(slot * slot_smp))

    targets = [0.62 if SEC_OF[b] == "E" else
               0.42 if SEC_OF[b] in ("B", "C") else 0.24
               for b in range(BARS)]
    color_curve = [targets[0]]
    for bar in range(1, BARS):
        color_curve.append(color_curve[-1] + 0.25 *
                           (targets[bar] - color_curve[-1]))

    for v, (wave_, gain, pan, pluck, mul) in VOICE_SPEC.items():
        for s, d, m in sc[v]:
            bar = min(s // SPB, BARS - 1)
            sec = SEC_OF[bar]
            wave2, gain2, pan2, pluck2 = wave_, gain, pan, pluck
            if bar >= 160 and v in ("A", "HARM_A"):
                pan2 = -0.44
            color = color_curve[bar]
            if v in ("A", "B", "LEAD2", "HARM_A", "HARM_B", "ARP"):
                # 方波与三角拨弦始终共存，只让比例沿四小节渐变。
                square = gain2 * (0.72 - 0.32 * color)
                tri = gain2 * (0.30 + 0.38 * color)
                add_note(L, R, "square", m, S(s), d * SLOT_S, square,
                         pan2, pluck2, mul)
                add_note(L, R, "triangle", m, S(s), d * SLOT_S, tri,
                         pan2, pluck2, mul)
            else:
                add_note(L, R, wave2, m, S(s), d * SLOT_S, gain2,
                         pan2, pluck2, mul)
            if v in ("A", "LEAD2"):
                add_note(L, R, "sine", m + 12, S(s), d * SLOT_S,
                         gain * (0.08 + 0.18 * color), 0.34, False, 1.02)
    for s, d, m in sc["SUB"]:
        add_note(L, R, "sine", m, S(s), d * SLOT_S * 0.98, 0.13, 0.0,
                 pluck=False)
    # 霓虹点描铃(C 段强制 ×2 加密)
    rng = random.Random(4242)
    for bar in range(BARS):
        is_c = SEC_OF[bar] == "C"
        if not (is_c or (bar % 3 == 2 and rng.random() < 0.72)):
            continue
        pcs = CH[ROAD[bar]][1]
        for _ in range(2 if is_c else 1):
            pc = pcs[rng.randrange(len(pcs))]
            cand = [p for p in range(88, 98) if p % 12 == pc]
            if cand:
                mm = cand[rng.randrange(len(cand))]
                smp = int(round((bar * SPB + rng.choice([2, 6, 10, 14])) * slot_smp))
                add_note(L, R, "sine", mm, smp, 0.22, 0.038, 0.2, pluck=True,
                         mul=1.0)
    for slot, typ, gain in hits:
        t0 = S(slot)
        if typ == "K":
            add_kick(L, R, t0, gain)
        elif typ == "S":
            add_snare(L, R, t0, gain)
        else:
            add_hat(L, R, t0, 0.03, gain)
    return L, R


SLOT_S = NS / TOTAL / SPB * (SPB / SPB) if False else (60.0 / BPM) / 4


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
    print("── 霓虹幸存者 · 霓虹废墟「多利亚创意曲回旋曲 · 扩写版」──")
    print("规格: E多利亚 / %dBPM / %d小节 / %.3fs / 44.1kHz 16bit 立体声"
          % (BPM, BARS, NS / SR))
    print("结构: " + " ".join("%s(%d)" % (k, nb) for _, k, nb in SECTIONS))
    sc, epB = build_score()
    repair(sc, epB)
    validate(sc)
    print("渲染中(纯 Python,约 2-5 分钟)…")
    L, R = render(sc, drum_hits())
    p1 = os.path.join(HERE, "ruins_ext_loop.wav")
    p2 = os.path.join(HERE, "ruins_ext_seam.wav")
    peak, scale = finalize(L, R, p1, 1)
    write_seam(L, R, p2, 10.0)
    print("峰值 %.3f → 增益 %.2f;输出:" % (peak, scale))
    print("  %s (%.3fs)" % (p1, NS / SR))
    print("  %s (20s = 末10s+头10s 循环缝试听)" % p2)


if __name__ == "__main__":
    main()
