# -*- coding: utf-8 -*-
# Insert the autoShowToc label into every locale file:
#  - preferences.general.sidebar.autoShowToc (sidebar settings block)
#  - preferences.search.items.autoShowToc   (settings search index)
# Text-level insertion to avoid re-escaping churn in the JSON files.
import glob
import json
import re

# lang suffix -> (sidebar label, search items text)
LABELS = {
 'en': ('Automatically show table of contents when opening a file',
        'Automatically show the table of contents when opening a file.'),
 'zh-CN': ('打开文件时自动显示目录', '打开 Markdown 文件时自动显示目录。'),
 'zh-TW': ('開啟檔案時自動顯示目錄', '開啟 Markdown 檔案時自動顯示目錄。'),
 'ja': ('ファイルを開くときに目次を自動表示', 'ファイルを開くときに目次を自動的に表示します。'),
 'ko': ('파일을 열 때 목차 자동 표시', '파일을 열 때 목차를 자동으로 표시합니다.'),
 'de': ('Inhaltsverzeichnis beim Öffnen einer Datei automatisch anzeigen',
        'Zeigt das Inhaltsverzeichnis automatisch an, wenn eine Datei geöffnet wird.'),
 'es': ('Mostrar automáticamente la tabla de contenidos al abrir un archivo',
        'Muestra automáticamente la tabla de contenidos al abrir un archivo.'),
 'fr': ("Afficher automatiquement la table des matières à l'ouverture d'un fichier",
        "Affiche automatiquement la table des matières à l'ouverture d'un fichier."),
 'nl': ('Inhoudsopgave automatisch weergeven bij het openen van een bestand',
        'Geeft de inhoudsopgave automatisch weer wanneer een bestand wordt geopend.'),
 'pt': ('Mostrar automaticamente o índice ao abrir um ficheiro',
        'Mostra automaticamente o índice ao abrir um ficheiro.'),
 'tr': ('Dosya açılırken içindekiler bölümünü otomatik göster',
        'Bir dosya açılırken içindekiler bölümünü otomatik olarak gösterir.'),
}

failures = []
for path in sorted(glob.glob('packages/desktop/static/locales/*.json')):
    if path.endswith('.min.json'):
        continue
    lang = path.split('/')[-1].split('\\')[-1][:-5]
    if lang not in LABELS:
        failures.append(f'{path}: no label for lang {lang}')
        continue
    label, item_text = LABELS[lang]
    src = open(path, encoding='utf-8').read()

    # sidebar block: showOpenedFiles immediately followed by excludePatterns
    m = re.search(r'(\n(\s*)"showOpenedFiles": "[^"]*",\n)(\s*"excludePatterns":)', src)
    if not m:
        failures.append(f'{path}: sidebar anchor not found')
        continue
    indent = m.group(2)
    src = src[:m.end(1)] + f'{indent}"autoShowToc": {json.dumps(label, ensure_ascii=False)},\n' + src[m.end(1):]

    # search items: after the unique wordWrapInToc entry
    m2 = re.search(r'(\n(\s*)"wordWrapInToc": "[^"]*",\n)', src)
    if not m2:
        failures.append(f'{path}: search.items anchor not found')
        continue
    indent2 = m2.group(2)
    src = src[:m2.end(1)] + f'{indent2}"autoShowToc": {json.dumps(item_text, ensure_ascii=False)},\n' + src[m2.end(1):]

    open(path, 'w', encoding='utf-8', newline='').write(src)
    print('updated:', path)

if failures:
    print('FAILURES:')
    for f in failures:
        print(' ', f)
else:
    print('all locales updated')
