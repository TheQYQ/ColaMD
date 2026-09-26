"""Export the CI run records the authoritative docs cite, so the citations keep
an in-repo source of truth if the repository is ever recreated."""
import io
import json
import re
import subprocess

CITED = ['35956060123', '36244202347', '36244205143', '35729699390', '35746222480',
         '35752534189', '35753839166', '35757512852', '35759387561', '35763304319',
         '35766221736', '36240056224']

doc = io.open('docs/OPTIMIZATION_ROADMAP.md', encoding='utf-8').read()
found = sorted(set(re.findall(r'`(\d{11})`', doc)))
missing = [r for r in found if r not in CITED]


def api(path):
    out = subprocess.run(['gh', 'api', path], capture_output=True, text=True,
                         encoding='utf-8', errors='replace', timeout=120)
    if out.returncode:
        raise SystemExit('gh api failed: ' + (out.stderr or '')[:200])
    return json.loads(out.stdout)


rows = []
for run_id in found:
    j = api('repos/TheQYQ/ColaMD/actions/runs/' + run_id)
    jobs = api('repos/TheQYQ/ColaMD/actions/runs/%s/jobs?per_page=100' % run_id).get('jobs', [])
    conc = {}
    for job in jobs:
        conc[job['name']] = job.get('conclusion') or '-'
    rows.append({
        'run': run_id,
        'workflow': j['name'],
        'head_sha': j['head_sha'][:7],
        'conclusion': j.get('conclusion') or '-',
        'created': j['created_at'][:10],
        'event': j['event'],
        'jobs': conc,
    })

totals = api('repos/TheQYQ/ColaMD/actions/runs?per_page=1').get('total_count')

lines = [
    '# CI run ledger',
    '',
    '本文件是 `docs/OPTIMIZATION_ROADMAP.md` 与 `docs/PROJECT_GUIDE.md` 里引用的 **GitHub Actions run 记录**的仓库内副本。',
    'run 页面属于仓库本身：仓库若被删除或重建，这些号就 404，而文档里"某次门禁跑在哪个 sha 上"的结论必须有出处。',
    '所以凡新增被文档引用的 run，都要在这里补一行。生成方式：`python scripts/exportCiRuns.py`（脚本按文档里的 11 位号自动抓取）。',
    '',
    '- 抓取时间：2026-09-27；仓库 `TheQYQ/ColaMD` 的 run 总数：**%s**' % totals,
    '- `head_sha` 是 GitHub 记录的原始值，**不随分支历史重写而变**（见 `OPTIMIZATION_ROADMAP` §3 的重映射规则 ④）。',
    '',
    '| run | workflow | head_sha | 结论 | 日期 | 触发 | 各 job |',
    '| --- | --- | --- | --- | --- | --- | --- |',
]
for r in rows:
    jobs = '; '.join('%s=%s' % (k, v) for k, v in sorted(r['jobs'].items()))
    lines.append('| `%s` | %s | `%s` | %s | %s | %s | %s |' % (
        r['run'], r['workflow'], r['head_sha'], r['conclusion'], r['created'], r['event'], jobs))

lines += ['', '## 未收录但出现在文档里的 11 位数字', '',
          '（这些不是 run 号，列出来是为了别再把它们当提交号或 run 号统计。）', '']
for m in missing:
    lines.append('- `%s`' % m)

io.open('docs/CI_RUN_LEDGER.md', 'w', encoding='utf-8', newline='\r\n').write('\n'.join(lines) + '\n')
print('wrote docs/CI_RUN_LEDGER.md rows=%d missing-from-cited-list=%s' % (len(rows), missing))
