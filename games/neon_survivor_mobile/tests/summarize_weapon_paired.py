#!/usr/bin/env python3
"""Summarize paired live runs; keep the raw seed-level NDJSON as evidence."""
import collections
import json
import statistics
import sys
from pathlib import Path

root = Path(__file__).resolve().parent
files = [root / f"paired_{i}.ndjson" for i in range(4)]
rows = [json.loads(line) for file in files for line in file.read_text().splitlines() if line]
groups = collections.defaultdict(dict)
for row in rows:
    key = (row['id'], row['level'], row['minute'], row['deck'], row['seed'])
    groups[key][row['variant']] = row

def med(xs):
    return statistics.median(xs) if xs else 0

def fmt(xs, digits=1):
    return f"{med(xs):.{digits}f}"

output = []
for id, level, minute in sorted({(r['id'], r['level'], r['minute']) for r in rows}):
    deck_metrics = []
    for deck in (0, 1):
        pairs = [v for (i, l, m, d, _), v in groups.items()
                 if (i, l, m, d) == (id, level, minute, deck)]
        if len(pairs) != 5 or any('current' not in p or 'empty' not in p for p in pairs):
            raise RuntimeError(f'incomplete pairs: {id} L{level} deck {deck}')
        cur = [p['current'] for p in pairs]
        empty = [p['empty'] for p in pairs]
        comparator = 'previous' if 'previous' in pairs[0] else 'source' if 'source' in pairs[0] else 'sources' if 'sources' in pairs[0] else None
        ctrl = [p[comparator] for p in pairs] if comparator else []
        dps = [r['damage'] / max(1, r['seconds']) for r in cur]
        cdps = [r['damage'] / max(1, r['seconds']) for r in ctrl]
        damage_delta = med([a-b for a,b in zip(dps, cdps)]) if ctrl and comparator == 'previous' else None
        deck_metrics.append({
            'companions': ','.join(cur[0]['companions']),
            'seeds': ','.join(hex(p['current']['seed']) for p in pairs),
            'dps': fmt(dps),
            'kill_add': fmt([a['kills']-b['kills'] for a,b in zip(cur,empty)]),
            'survival': fmt([r['seconds'] for r in cur]),
            'taken': fmt([r['taken'] for r in cur]),
            'nearest': fmt([r['meanNearest'] or 0 for r in cur]),
            'peak': max(r['peak'] for r in cur),
            'freeze': fmt([r['freezeTime'] for r in cur]),
            'sheep': fmt([r['sheepTime'] for r in cur]),
            'knock': fmt([r['knockFrames'] for r in cur], 0),
            'intercept': fmt([r['intercepted'] for r in cur], 0),
            'freeze_add': fmt([a['freezeTime']-b['freezeTime'] for a,b in zip(cur,empty)]),
            'sheep_add': fmt([a['sheepTime']-b['sheepTime'] for a,b in zip(cur,empty)]),
            'intercept_add': fmt([a['intercepted']-b['intercepted'] for a,b in zip(cur,empty)], 0),
            'compare': comparator or 'none',
            'dps_delta': f'{damage_delta:.1f}' if damage_delta is not None else '',
            'kill_vs_compare': fmt([a['kills']-b['kills'] for a,b in zip(cur,ctrl)]) if ctrl else '',
            'survival_vs_compare': fmt([a['seconds']-b['seconds'] for a,b in zip(cur,ctrl)]) if ctrl else '',
            'taken_vs_compare': fmt([a['taken']-b['taken'] for a,b in zip(cur,ctrl)]) if ctrl else ''
        })
    status = '保留'
    reason = '同种子配对未见两套配装重复的明确等级倒退'
    if all(d['compare'] == 'previous' and d['dps_delta'] and float(d['dps_delta']) < -10 and
           float(d['kill_vs_compare']) < -5 and
           (float(d['survival_vs_compare']) < -3 or float(d['taken_vs_compare']) > 30)
           for d in deck_metrics):
        status = '需调整'
        reason = '两套配装均出现同条件等级倒退；需检查命中与触发机制'
    if status == '保留':
        if 'polymorph' in id: role = '变羊控制'
        elif 'timestop' in id or 'frost' in id: role = '冻结控制'
        elif 'sentry' in id: role = '炮塔拦弹'
        elif 'aura' in id or 'poison' in id: role = '近身持续伤害'
        elif 'missile' in id or 'railgun' in id: role = '远程定向伤害'
        elif 'lance' in id or 'chain' in id: role = '持续光束/连锁'
        elif 'grenade' in id or 'meteor' in id: role = '延时范围伤害'
        else: role = '范围/定向输出'
        reason = (f'{role}；空槽击杀差 A/B {deck_metrics[0]["kill_add"]}/'
                  f'{deck_metrics[1]["kill_add"]}，最近敌距 {deck_metrics[0]["nearest"]}/'
                  f'{deck_metrics[1]["nearest"]}。配对数据未支持改数值')
    output.append((id, level, minute, status, reason, deck_metrics))

with (root / 'weapon_balance_paired_summary.tsv').open('w') as f:
    f.write('id\tlevel\tminute\tstatus\treason\tdeck\tcompanions\tseeds\tdps\tkill_add_vs_empty\tsurvival\ttaken\tnearest\tpeak\tfreeze\tsheep\tknock\tintercept\tfreeze_add\tsheep_add\tintercept_add\tcompare\tdps_delta\tkill_vs_compare\tsurvival_vs_compare\ttaken_vs_compare\n')
    for id, level, minute, status, reason, decks in output:
        for n, d in enumerate(decks):
            f.write('\t'.join(map(str, [id,level,minute,status,reason,n,*d.values()]))+'\n')

with (root / 'weapon_balance_conclusions.md').open('w') as f:
    f.write('# 全武器实战复核\n\n')
    f.write('困难模式、霓虹废墟、全能者；两套固定配装、每套五个种子、每组最多 60 秒。'
            '原始种子记录见 `paired_0.ndjson` 至 `paired_3.ndjson`，逐配装指标见 `weapon_balance_paired_summary.tsv`。'
            'DPS 是存活期间的该武器伤害；击杀增量与空槽对照。\n\n')
    f.write('| 武器 | 等级/形态 | 结论 | 配装 A DPS / 击杀增量 | 配装 B DPS / 击杀增量 | 相邻级或材料击杀差 A/B | 定位依据 |\n')
    f.write('|---|---:|---|---:|---:|---:|---|\n')
    for id, level, minute, status, reason, d in output:
        f.write(f'| {id} | {level} | {status} | {d[0]["dps"]} / {d[0]["kill_add"]} | '
                f'{d[1]["dps"]} / {d[1]["kill_add"]} | '
                f'{d[0]["kill_vs_compare"] or "—"} / {d[1]["kill_vs_compare"] or "—"} | {reason} |\n')
    f.write('\n所有数值保留原值；本轮修复哨塔共用炮塔状态。冻结、变羊、击退与拦弹计数及空槽增量见 TSV。'
            '全能者与高等级被动使多数样本存活满 60 秒，生存判断还参考承伤与敌距；击杀差受刷怪与走位的反馈影响，不能单独定性。\n')
    f.write('\n## 候选项复核\n\n'
            '- 变羊进化：A/B 比空槽多出约 943/878 敌秒变羊，单武器伤害高于基础 L8；击杀落后有敌人暂时无法接触玩家、死亡时间后移的机制解释，承伤没有两套一致恶化，保留控制定位。\n'
            '- 时停进化：A/B 比空槽多出约 294/277 敌秒冻结，伤害高于基础 L8；击杀与承伤的差异不在两套配装一致，保留。\n'
            '- 雷霆光轨：相对两把材料击杀差约 -18/-23，但配装 B 承伤下降且融合释放一个武器槽；未见两套配装同时出现生存倒退，保留。\n'
            '- 天火母弹：相对两把材料击杀差约 -40/-37，承伤两套都下降；融合释放一个武器槽，配装 B 有生存波动，证据不足以单改伤害。\n'
            '- 光环与导弹：基础升级直接伤害单调增长；进化后伤害提高，击杀变化受拉近敌人与刷怪反馈影响，按距离和承伤保留原定位。\n'
            '- 剧毒黑洞：相对双材料击杀差约 -117/+12，方向不同；强拉近敌人的同时融合空出一个槽位，保留。\n')

print(f'{len(rows)} runs; {len(output)} weapon forms; '
      f'{sum(x[3] == "需调整" for x in output)} flagged')
