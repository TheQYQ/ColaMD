"""Export the CI run records the authoritative docs cite, so the citations keep
an in-repo source of truth even after the repository they were made in is gone.

Run ids belong to a repository: the project was recreated under the same name on
2026-09-27, so the ids the docs cite live in the archived repository, not the
current one. Each id is looked up in the current repository first, then in the
archive; if neither serves it any more, the row already in the ledger is kept and
marked, so the file never loses evidence to a 404.
"""
import io
import json
import os
import re
import subprocess
import sys

CURRENT = 'TheQYQ/ColaMD'
ARCHIVE = 'TheQYQ/ColaMD-archive'
REPOS = [CURRENT, ARCHIVE]
DOC = 'docs/OPTIMIZATION_ROADMAP.md'
LEDGER = 'docs/CI_RUN_LEDGER.md'
ROW = re.compile(r'\| `(\d{11})` \| ([^|]+) \| ([^|]+) \| `([0-9a-f]{7})` \| '
                 r'([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]*)\|')


def api(path):
    """Return decoded JSON, or None when the resource does not exist."""
    out = subprocess.run(['gh', 'api', path], capture_output=True, text=True,
                         encoding='utf-8', errors='replace', timeout=120)
    if out.returncode:
        if re.search(r'(404|Not Found)', out.stderr or ''):
            return None
        raise SystemExit('gh api failed for ' + path + ': ' + (out.stderr or '')[:200])
    return json.loads(out.stdout)


def fetch(run_id):
    for repo in REPOS:
        j = api('repos/%s/actions/runs/%s' % (repo, run_id))
        if not j:
            continue
        jobs = api('repos/%s/actions/runs/%s/jobs?per_page=100' % (repo, run_id)) or {}
        return {
            'run': run_id,
            'repo': '当前库' if repo == CURRENT else '归档库',
            'workflow': j['name'],
            'head_sha': j['head_sha'][:7],
            'conclusion': j.get('conclusion') or '-',
            'created': j['created_at'][:10],
            'event': j['event'],
            'jobs': {job['name']: (job.get('conclusion') or '-') for job in jobs.get('jobs', [])},
            'stale': False,
        }
    return None


def existing_rows():
    """Parse the ledger about to be rewritten, so unreachable runs survive."""
    if not os.path.exists(LEDGER):
        return {}
    kept = {}
    for line in io.open(LEDGER, encoding='utf-8').read().splitlines():
        m = ROW.match(line)
        if not m:
            continue
        kept[m.group(1)] = {
            'run': m.group(1), 'repo': m.group(2).strip(), 'workflow': m.group(3).strip(),
            'head_sha': m.group(4), 'conclusion': m.group(5).strip(),
            'created': m.group(6).strip(), 'event': m.group(7).strip(),
            'jobs': {}, 'stale': True,
        }
    return kept


cited = sorted(set(re.findall(r'`(\d{11})`', io.open(DOC, encoding='utf-8').read())))
kept = existing_rows()
rows, unresolved = [], []
for run_id in cited:
    row = fetch(run_id) or kept.get(run_id)
    if row is None:
        unresolved.append(run_id)
        continue
    if row['stale']:
        print('kept existing row for unreachable run ' + run_id)
    rows.append(row)

totals = {r: (api('repos/%s/actions/runs?per_page=1' % r) or {}).get('total_count') for r in REPOS}

lines = [
    '# CI run ledger',
    '',
    '本文件是 `docs/OPTIMIZATION_ROADMAP.md` 与 `docs/PROJECT_GUIDE.md` 里引用的 **GitHub Actions run 记录**的仓库内副本。',
    'run 页面属于**某一个仓库**：项目在 2026-09-27 同名重建过，旧 run 号只存在于归档库 `ColaMD-archive`，'
    '而归档库一旦删除就永久 404 —— 这份文件因此是那些结论唯一的长期出处，不要按"随时能重抓"来理解它。',
    '',
    '生成方式：`python scripts/exportCiRuns.py`。脚本按文档里的 11 位号自动抓取，顺序是**当前库 → 归档库**；'
    '两边都取不到时**保留本文件里已有的那一行并标注"已不可达"**，绝不因为 404 就丢证据。',
    '',
    '- 抓取时间：2026-09-27',
    '- 当前库 `%s` 的 run 总数：**%s**；归档库 `%s`：**%s**' % (CURRENT, totals[CURRENT], ARCHIVE, totals[ARCHIVE]),
    '- `head_sha` 是 GitHub 记录的原始值，**不随分支历史重写而变**（见 `OPTIMIZATION_ROADMAP` §3 的重映射规则 ④）。',
    '',
    '| run | 库 | workflow | head_sha | 结论 | 日期 | 触发 | 各 job |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
]
for r in rows:
    jobs = ('已不可达（这是归档库删除前留下的副本）' if not r['jobs']
            else '; '.join('%s=%s' % (k, v) for k, v in sorted(r['jobs'].items())))
    lines.append('| `%s` | %s | %s | `%s` | %s | %s | %s | %s |' % (
        r['run'], r['repo'], r['workflow'], r['head_sha'], r['conclusion'],
        r['created'], r['event'], jobs))

io.open(LEDGER, 'w', encoding='utf-8', newline='\r\n').write('\n'.join(lines) + '\n')
print('wrote %s rows=%d stale=%d totals=%s' % (LEDGER, len(rows),
                                               sum(1 for r in rows if r['stale']), totals))
if unresolved:
    raise SystemExit('UNRESOLVED run ids (neither repo serves them, no existing row): '
                     + ', '.join(unresolved))
sys.exit(0)
