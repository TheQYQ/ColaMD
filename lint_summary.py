# -*- coding: utf-8 -*-
# Summarize lint-full.log: files x rules.
import re

log = open('lint-full.log', encoding='utf-8', errors='replace').read()
files = {}
cur = None
for line in log.splitlines():
    m = re.match(r'^[A-Z]:.*?(packages[/\\].*\.(?:ts|vue|js))\s*$', line)
    if m:
        cur = m.group(1).replace('\\', '/')
        files.setdefault(cur, {})
        continue
    em = re.match(r'^\s+(\d+:\d+)\s+(error|warning)\s+(.*)\s{2}([a-zA-Z@/-]+)\s*$', line)
    if em and cur:
        files[cur][em.group(4)] = files[cur].get(em.group(4), 0) + 1

rule_total = {}
err_rules = {}
for f, rules in files.items():
    for r, n in rules.items():
        rule_total[r] = rule_total.get(r, 0) + n
print('files with issues:', len(files))
for r, n in sorted(rule_total.items(), key=lambda x: -x[1]):
    print(f'{n:5}  {r}')
print()
for f in sorted(files):
    errs = {r: n for r, n in files[f].items()}
    print(f, errs)
