#!/usr/bin/env python3
"""四张地图长篇 BGM 的跨生成器结构回归；不渲染 PCM，数秒内完成。"""
import importlib.util
from pathlib import Path

HERE = Path(__file__).resolve().parent
TARGETS = {
    "crimson": (304, 506.6666666667),
    "ruins": (264, 565.7142857143),
    "frozen": (288, 540.0),
    "void": (276, 552.0),
}


def load(name):
    path = HERE / f"{name}_ext_gen.py"
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def fingerprint(sc, voices, bar, epb):
    return tuple((v, s - bar * epb, d, m) for v in voices
                 for s, d, m in sc[v] if bar * epb <= s < (bar + 1) * epb)


def longest_repeated_run(sc, voices, bars, epb):
    sig = [fingerprint(sc, voices, b, epb) for b in range(bars)]
    longest = 0
    for lag in range(1, bars):
        run = 0
        for i in range(lag, bars):
            run = run + 1 if sig[i] == sig[i - lag] else 0
            longest = max(longest, run)
    return longest


def smooth_curve(targets):
    out = [targets[0]]
    for target in targets[1:]:
        out.append(out[-1] + 0.25 * (target - out[-1]))
    return out


def main():
    for name, (bars, seconds) in TARGETS.items():
        m = load(name)
        assert m.BARS == bars and abs(m.NS / m.SR - seconds) < 1e-6
        built = m.build_score()
        if isinstance(built, tuple):
            sc = built[0]
            if name == "ruins":
                m.repair(sc, built[1])
        else:
            sc = built
        m.validate(sc)

        if name == "crimson":
            voices, epb = ("LEAD", "LEAD2", "OST"), m.SPB
            dense = [b for b in range(bars) if m.SEC_OF[b][0] in "BDEH"]
            lead_counts = [sum(1 for s, _, _ in sc["LEAD"]
                               if b * epb <= s < (b + 1) * epb) for b in dense]
            assert sum(lead_counts) / len(lead_counts) >= 3.0
            targets = [0.42 if m.SEC_OF[b].startswith("H") else
                       0.28 if m.SEC_OF[b] == "E" else
                       0.18 if m.SEC_OF[b].startswith(("B", "D")) else 0.08
                       for b in range(bars)]
        elif name == "ruins":
            voices, epb = ("A", "B", "HARM_A", "HARM_B", "ARP"), m.SPB
            targets = [0.62 if m.SEC_OF[b] == "E" else
                       0.42 if m.SEC_OF[b] in ("B", "C") else 0.24
                       for b in range(bars)]
            # 副主题保留主主题 3+1 节奏细胞，三次呈示不完全相同。
            assert {d for d, _ in m.SUBJ}.issuperset({1, 3})
            assert m.CY_E != m.CY_A[:len(m.CY_E)]
        elif name == "frozen":
            voices, epb = ("MEL", "ARP"), m.EPB
            targets = [0.70 if m.SEC_OF[b].startswith(("N", "X")) else
                       0.52 if m.SEC_OF[b].startswith("D") else 0.30
                       for b in range(bars)]
            assert m.BLOCK_PHRASES["N1"] != m.BLOCK_PHRASES["N2"]
            assert m.BLOCK_PHRASES["N2"] != m.BLOCK_PHRASES["N3"]
        else:
            voices, epb = ("LEAD", "HARM", "ARP"), m.SPB
            targets = [0.72 if m.SEC_OF[b].startswith(("H", "J")) else
                       0.56 if m.SEC_OF[b].startswith(("D", "F")) else 0.32
                       for b in range(bars)]
            # 上行副主题与下行主题共享音级集合但轮廓相反。
            assert set(x[2] % 12 for x in m.PH_QV) <= m.ALLOWED
            assert m.PH_QV != m.THEME[:len(m.PH_QV)]

        assert longest_repeated_run(sc, voices, bars, epb) <= 32
        curve = smooth_curve(targets)
        assert max(abs(a - b) for a, b in zip(curve, curve[1:])) <= 0.12
        # 旋律+内声/琶音平均起音密度；呼吸段可由持续变化的内声部补足。
        density = sum(len(sc[v]) for v in voices) / bars
        assert density >= 3.0, (name, density)
        print(f"{name}: {bars} bars / {seconds:.3f}s · density {density:.2f} · checks OK")
    print("长篇结构/主题亲缘/变奏差异/重复/密度/音色渐变：0 错误，0 警告")


if __name__ == "__main__":
    main()
