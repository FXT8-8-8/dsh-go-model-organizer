#!/usr/bin/env python3
"""按写前备份恢复模型渠道（llm-pi-ai 或动态发现的 providers 入口）的模型清单。

用法:
  restore-models.py --list                         列出所有可用备份
  restore-models.py --diff  <备份>                 对比备份与当前配置的差异
  restore-models.py --restore <备份> [--provider PID] [--apply]
                                                   默认只预演；加 --apply 才写盘
"""
import sys, os, glob, json, time, shutil, yaml

# 不写死本机路径：DSH_HOME 环境变量优先，缺省 ~/.dsh。
# 配置 patch 文件在 <DSH_HOME>/profiles/web/cordis.patch.yml；备份在 <DSH_HOME>/dsh-go/backups。
DSH_HOME = os.environ.get('DSH_HOME') or os.path.expanduser('~/.dsh')
CFG = os.path.join(DSH_HOME, 'profiles', 'web', 'cordis.patch.yml')
BACKUP_DIR = os.path.join(DSH_HOME, 'dsh-go', 'backups')
# 官方插件包名 + 兜底 id；两者都匹配不到时找任何带 providers 配置的入口
PLUGIN_NAMES = ['@deepseek-ai/dsh-llm-pi-ai']
ENTRY = 'llm-pi-ai'

def entry_matches(e):
    if not isinstance(e, dict): return False
    ident = e.get('id') or ''
    name = e.get('name') or ''
    if ident == ENTRY or name in PLUGIN_NAMES: return True
    cfg = e.get('config')
    if isinstance(cfg, dict) and isinstance(cfg.get('providers'), dict): return True
    return False

def candidates():
    out = []
    out += glob.glob(os.path.join(BACKUP_DIR, 'model-sync-*.json'))
    out += glob.glob(CFG + '.bak-*')
    out += glob.glob('/tmp/model-sync-backup-*.json')   # 旧遗留也认
    return sorted(set(out), key=os.path.getmtime)

def load_providers(path):
    if path.endswith('.json'):
        d = json.load(open(path))
        return d if isinstance(d, dict) else {}
    d = yaml.safe_load(open(path)) or []
    for e in d:
        if entry_matches(e):
            return (e.get('config') or {}).get('providers') or {}
    return {}

def load_current_doc():
    return yaml.safe_load(open(CFG)) or []

def count(providers):
    return sum(len(v.get('models') or []) for v in providers.values() if isinstance(v, dict))

def do_list():
    for p in candidates():
        try:
            pr = load_providers(p); n = count(pr)
        except Exception as ex:
            pr, n = {}, f'读取失败: {ex}'
        t = time.strftime('%m-%d %H:%M:%S', time.localtime(os.path.getmtime(p)))
        print(f'{t}  渠道 {len(pr):2d}  模型 {n}  {p}')

def do_diff(path):
    bak, cur = load_providers(path), load_providers_cur()
    print(f'备份 {path}')
    print(f'合计  备份 {count(bak)} / 当前 {count(cur)}')
    for pid in sorted(set(bak) | set(cur)):
        b = [m if isinstance(m, str) else m.get('id') for m in (bak.get(pid, {}).get('models') or [])]
        c = [m if isinstance(m, str) else m.get('id') for m in (cur.get(pid, {}).get('models') or [])]
        if b == c: continue
        print(f'\n[{pid}] 备份 {len(b)} / 当前 {len(c)}')
        for x in [x for x in b if x not in c]: print(f'  - 丢失 {x}')
        for x in [x for x in c if x not in b]: print(f'  + 多出 {x}')

def load_providers_cur():
    for e in load_current_doc():
        if entry_matches(e):
            return (e.get('config') or {}).get('providers') or {}
    return {}

def do_restore(path, only_pid, apply):
    bak = load_providers(path)
    if not bak: sys.exit(f'备份里没有 {ENTRY} 的 providers：{path}')
    doc = load_current_doc(); target = None
    for e in doc:
        if entry_matches(e): target = e; break
    if target is None: sys.exit(f'当前配置里找不到 {ENTRY}')
    cur = (target.get('config') or {}).get('providers') or {}
    plan = []
    for pid, prof in bak.items():
        if only_pid and pid != only_pid: continue
        if not isinstance(prof, dict): continue
        old = prof.get('models') or []
        if not old: continue
        now = (cur.get(pid) or {}).get('models') or []
        now_ids = {m if isinstance(m, str) else m.get('id') for m in now}
        miss = [m for m in old if (m if isinstance(m, str) else m.get('id')) not in now_ids]
        if not miss: continue
        plan.append((pid, old, now, miss))
    if not plan:
        print('无需恢复：备份里的模型当前都在。'); return
    print('恢复计划：')
    for pid, old, now, miss in plan:
        print(f'  {pid}: {len(now)} → {len(old)}（补回 {len(miss)}）')
    if not apply:
        print('\n预演结束。确认无误后加 --apply 写盘。'); return
    stamp = time.strftime('%Y%m%d-%H%M%S')
    keep = CFG + f'.bak-{stamp}'
    shutil.copy2(CFG, keep); print(f'\n已备份当前配置：{keep}')
    for pid, old, now, miss in plan:
        cur[pid] = {**(cur.get(pid) or bak[pid]), 'models': old}
    target['config']['providers'] = cur
    yaml.safe_dump(doc, open(CFG, 'w'), allow_unicode=True, sort_keys=False)
    print(f'已写回：合计模型 {count(cur)} 条。重启引擎后 App 生效。')

if __name__ == '__main__':
    a = sys.argv[1:]
    if not a or a[0] in ('-h', '--help'):
        print(__doc__); sys.exit(0)
    if a[0] == '--list': do_list()
    elif a[0] == '--diff' and len(a) > 1: do_diff(a[1])
    elif a[0] == '--restore' and len(a) > 1:
        pid = a[a.index('--provider') + 1] if '--provider' in a else None
        do_restore(a[1], pid, '--apply' in a)
    else:
        print(__doc__); sys.exit(2)
