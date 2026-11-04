"""Print a reviewable audit report; raw NDJSON remains ignored and reproducible."""
import collections
import glob
import json
import statistics as st
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
catalog = json.loads(subprocess.check_output(['node', '-e', '''
const fs=require('fs'),vm=require('vm');const box={window:{SV:{}}};vm.createContext(box);
for(const f of ['util','config'])vm.runInContext(fs.readFileSync('js/'+f+'.js','utf8'),box);
const C=box.window.SV.Config;console.log(JSON.stringify(Object.fromEntries(Object.entries({...C.WEAPONS,...C.WEAPON_EVOS}).map(([id,w])=>[id,w.name]))));
'''], cwd=HERE.parent, text=True))

def read(pattern):
    return [json.loads(line) for file in sorted(glob.glob(str(HERE / pattern))) for line in Path(file).read_text().splitlines() if line]

def mean(rows, key):
    return st.mean(r[key] for r in rows)

before, final = read('audit_before_*.ndjson'), read('audit_final_*.ndjson')
assert len(before) == len(final) == 6950, 'Complete all four audit shards before publishing the report'
groups = collections.defaultdict(list)
for r in final:
    groups[r['id'], r['variant']].append(r)
assert len({r['id'] for r in final}) == 74
assert all(len({r['seed'] for r in rows}) == 5 for rows in groups.values())

print('# 后期平衡复核 · 2026-10-26\n')
print('以修改前代码快照为基线。基础、进化、融合共 74 种武器形态；基础武器覆盖 L1–L8，共 221 个等级/形态检查点。')
print('每项使用两套配装、五个固定种子、每组 60 秒；含空槽、前一级/基础满级/双材料对照及融合空槽补一把 L1 武器。修改前、最终版各 6,950 组。\n')
print('校正旧审计的三处偏差：镜头现在跟随玩家；检查点跳过已经经过的强敌波；配置计入真实前置被动、进化/融合卡和免费起手。融合比双材料多消耗一张升级卡，补 L1 武器再多一张。')
print('战斗检查点用于控制变量，不能据此断言该时间必然获得该配装。完整成长另用真实拾取、三选一升级验证。伤害列统计实际扣除的敌人生命，过量伤害另存；游戏内原有统计口径保留。\n')

print('## 确定修改\n')
print('- 回旋星环：修复刃位转速超过返航速度导致飞刃回不来的问题；去返可各命中一次。融合时重建八枚刃的运行状态，修复实际成长过程中缺少 hitIds 的崩溃。')
print('- 湮灭之轮、回旋星环、极寒刀阵：查询范围覆盖大体型目标；会触发二次网格查询的环刃循环使用独立候选列表。')
print('- 裁决阵列：基础伤害 65→72，攻击间隔 0.55→0.50 秒，固定裁决伤害 120→150；保留五击、8% 最大生命及 Boss 百分比除以五。')
print('- 其他武器保留伤害参数。连锁、贯穿和已发射弹体仍可命中屏外；初次/重新索敌统一优先可见目标。\n')

print('## 全武器配对结果\n')
print('击杀差为最终版当前形态相对对照的 A/B 均值；承伤差小于零表示承伤减少。基础武器按各级同级比较汇总，击杀受走位和刷怪反馈影响，不要求每级击杀单调。\n')
print('| 武器 | 覆盖 | 对照 | 击杀差 A / B | 承伤差 A / B | 处置 |')
print('|---|---|---|---:|---:|---|')
for wid in catalog:
    if (wid, 'current') not in groups:
        continue
    current = groups[wid, 'current']
    control = 'sources' if groups.get((wid, 'sources')) else 'source' if groups.get((wid, 'source')) else 'previous'
    source = groups[wid, control]
    levels = {r['level'] for r in source}
    deltas = []
    for deck in [0, 1]:
        a = [r for r in current if r['deck'] == deck and r['level'] in levels]
        b = [r for r in source if r['deck'] == deck]
        deltas.append((mean(a, 'kills') - mean(b, 'kills'), mean(a, 'taken') - mean(b, 'taken')))
    cover = 'L1–L8' if len({r['level'] for r in current}) == 8 else '进化' if control == 'source' else '融合'
    action = '返航/判定/融合初始化修复' if wid == 'blade_boomerang' else '小幅增强固定火力' if wid == 'sentry_hex' else '判定修复，伤害保留' if wid in ['blade_aura', 'blade_frost'] else '保留数值'
    print(f'| {catalog[wid]} `{wid}` | {cover} | {control} | {deltas[0][0]:+.1f} / {deltas[1][0]:+.1f} | {deltas[0][1]:+.1f} / {deltas[1][1]:+.1f} | {action} |')

print('\n## 异常项追加场景\n')
print('使用真实移动巨像（含其召唤物）及护盾/治疗怪群，五个相同种子，最多 30 秒；当前、双材料、补槽分别测试。为保证前置合法，被动固定 L5；不修改玩家生命或敌人参数。')
print('所有场景均使用独立的预测走位输入，结果属于可复现的压力测试，不代表人类玩家通关率。\n')
print('| 武器 / 场景 | 修复前有效伤害 | 最终有效伤害 | 最终材料有效伤害 | 判断 |')
print('|---|---:|---:|---:|---|')
old_roles, new_roles = read('role_current.ndjson'), read('role_final.ndjson') + read('role_followup.ndjson')
for wid in dict.fromkeys(r['id'] for r in new_roles):
    for scene in ['boss', 'support']:
        def damage(rows, variant):
            a = [r for r in rows if r['id'] == wid and r['scene'] == scene and r['variant'] == variant]
            return st.mean(sum(m['effective'] for m in (r.get('metrics') or {}).values()) for r in a) if a else None
        old, new, material = damage(old_roles, 'current'), damage(new_roles, 'current'), damage(new_roles, 'sources')
        old_text = f'{old:.0f}' if old is not None else '—'
        verdict = '修复后恢复稳定输出' if wid == 'blade_boomerang' else '强化执行火力，保留单体定位' if wid == 'sentry_hex' else '有明确场景收益，保留定位'
        print(f'| {catalog[wid]} / {scene} | {old_text} | {new:.0f} | {material:.0f} | {verdict} |')

print('\n## 完整成长与体验边界\n')
for version in ['before', 'final']:
    rows = [r for stage in ['ruins', 'crimson', 'frozen', 'void'] for r in read(f'progression_{stage}_{version}.ndjson')]
    assert len(rows) == 24
    print(f'- {version}：{sum(r["survived"] for r in rows)}/24 局到达 20 分钟；{sum(bool(r.get("error")) for r in rows)} 局运行异常。四地图 × 普通/困难 × 三种构筑方向，相同固定种子。')
    if version == 'final':
        assert not any(r.get('error') for r in rows)
        for d in ['normal', 'hard']:
            cases = [r for r in rows if r['difficulty'] == d]
            fodder = sorted(e['seconds'] for r in cases for e in r['engagementKills'] if e['time'] >= 600 and not e['boss'] and not e['elite'] and e['type'] in ['zombie', 'runner', 'swarmer'])
            print(f'  - {d}：{sum(r["survived"] for r in cases)}/12；峰值敌人数中位数 {st.median(r["peak"] for r in cases):.1f}；接战后小怪击杀时间 P90 {fodder[int(len(fodder)*.9)]:.2f}s。瞬杀小怪是允许的，不是强制每只怪站住承伤。')
print('- 困难废墟远程方向追加五种子：' + str(sum(r['survived'] for r in read('progression_hard_ranged_5.ndjson'))) + '/5 通关。失败发生在 11–12 分钟未充分进化、怪物积压阶段；末三秒记录显示连续接触和射击伤害，未出现同帧多来源瞬杀。')
print('- 已通关样本的前两次强敌波均在下一波前清理；部分困难样本最后一波仍有成员存活到通关，保留最后一分钟的生存压力。')
print('- 轻松/噩梦在虚空混合方向各做一局完整成长烟测，二者均可完成；0.5 秒承伤峰值为 ' + ' / '.join(f'{r["difficulty"]} {r["maxBurst"]:.1f}' for r in read('progression_extremes.ndjson')) + '。单种子结果不用于宣称难度通关率。')
print('- 手动键盘走位、危险预警、实际桌面/手机横屏画面、连续缩放、暂停、旧存档、排队 Boss 存档与无尽衔接另有真浏览器回归。最终手感仍需真人试玩反馈；这份报告不把脚本胜率包装成真人体验。')

print('\n## 复现\n')
print('```sh\nnode tests/late_balance_test.js\nnode tests/weapon_balance_paired.js --shard 0/4 --assert # 依次运行 0/4 至 3/4，保存为 audit_final_N.ndjson\nnode tests/progression_balance.js --movement tactical # 四地图、普通/困难、三构筑；可用 --seeds 5 扩展\nnode tests/weapon_role_audit.js\nnode tests/late_balance_browser.js # 使用现有 browser_helper 的 Chromium 配置\npython3 tests/summarize_late_balance.py\n```')
print('\n修改前代码必须来自独立快照，通过审计/成长脚本的 `--root` 参数读取。原始 NDJSON 不提交；本报告与脚本提交。Service Worker CACHE 未改动。')
