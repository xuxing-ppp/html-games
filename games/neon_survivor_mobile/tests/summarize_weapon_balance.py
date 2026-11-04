"""Summarize ignored local JSONL reports from weapon_balance.js.
Usage: python3 tests/summarize_weapon_balance.py tests/weapon_balance_live.ndjson
"""
import collections
import json
import statistics
import sys

rows = [json.loads(line) for line in open(sys.argv[1]) if line.strip()]
groups = collections.defaultdict(list)
for row in rows:
    groups[(row['id'], row['level'], row['minute'])].append(row)
print('id\tlevel\tminute\truns\tsurvived60\tmedian_dps_alive\tmedian_kills\tmedian_taken\tmedian_nearest\tmedian_close_pct\tmax_peak')
for (wid, level, minute), samples in groups.items():
    med = statistics.median
    cols = [wid, level, minute, len(samples), sum(r['seconds'] >= 60 for r in samples),
            round(med(r['damage'] / max(1, r['seconds']) for r in samples), 1),
            round(med(r['kills'] for r in samples), 1),
            round(med(r['taken'] for r in samples), 1),
            round(med(r['meanNearest'] for r in samples if r['meanNearest'] is not None), 1),
            round(med(r['closePct'] for r in samples), 1),
            max(r['peak'] for r in samples)]
    print('\t'.join(map(str, cols)))
