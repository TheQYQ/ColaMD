# -*- coding: utf-8 -*-
# Link checker for README.md and docs/i18n/*.md — verifies every relative
# link/image target exists, and same-page anchors match GitHub-style heading
# slugs. Mirrors GitHub's slugger closely enough for our headings.
import os
import re
import sys
import unicodedata

ROOT = os.path.dirname(os.path.abspath(__file__))
FILES = ['README.md'] + sorted(
    os.path.join('docs', 'i18n', f) for f in os.listdir(os.path.join(ROOT, 'docs', 'i18n'))
    if f.endswith('.md'))


def github_slug(text):
    text = text.strip().lower()
    out = []
    for ch in text:
        cat = unicodedata.category(ch)
        if ch == ' ':
            out.append('-')
        elif ch == '-' or cat.startswith('L') or cat.startswith('N') or ch == '_':
            out.append(ch)
        # everything else (punctuation/marks) dropped
    return ''.join(out)


def headings(text):
    slugs = set()
    for m in re.finditer(r'^(#{1,6})\s+(.*)$', text, re.M):
        raw = m.group(2)
        raw = re.sub(r'<[^>]+>', '', raw)          # strip html tags
        raw = re.sub(r'!?\[([^\]]*)\]\([^)]*\)', r'\1', raw)  # strip md links/imgs
        slugs.add(github_slug(raw))
    return slugs


# markdown links/images + html href/src
MD_LINK = re.compile(r'\[[^\]]*\]\(([^)\s]+)[^)]*\)')
HTML_LINK = re.compile(r'(?:href|src)="([^"]+)"')

errors = []
for rel in FILES:
    path = os.path.join(ROOT, rel)
    text = open(path, encoding='utf-8').read()
    slugs = headings(text)
    targets = []
    for m in MD_LINK.finditer(text):
        targets.append((m.group(1), m.start()))
    for m in HTML_LINK.finditer(text):
        targets.append((m.group(1), m.start()))

    for tgt, pos in targets:
        if tgt.startswith(('http://', 'https://', 'mailto:', 'x-')):
            continue
        if tgt.startswith('#'):
            # same-page anchor
            if github_slug(tgt[1:]) not in slugs:
                errors.append(f'{rel}: broken anchor "{tgt}" (line {text[:pos].count(chr(10)) + 1})')
            continue
        pure, _, fragment = tgt.partition('#')
        pure = pure.partition('?')[0]
        resolved = os.path.normpath(os.path.join(os.path.dirname(path), pure))
        if not os.path.isdir(resolved) and not os.path.exists(resolved):
            errors.append(f'{rel}: missing target "{tgt}" (line {text[:pos].count(chr(10)) + 1})')
            continue
        if fragment and not os.path.isdir(resolved):
            # `#readme` is GitHub's built-in anchor on every README page
            if fragment.lower() == 'readme' and os.path.basename(pure).lower().startswith('readme'):
                continue
            target_slugs = headings(open(resolved, encoding='utf-8').read())
            if github_slug(fragment) not in target_slugs:
                errors.append(f'{rel}: broken anchor "{tgt}" (line {text[:pos].count(chr(10)) + 1})')

if errors:
    print(f'FAILED — {len(errors)} broken references:')
    for e in errors:
        print(' ', e)
    sys.exit(1)
print(f'OK — all relative links, images and anchors in {len(FILES)} README files resolve.')
