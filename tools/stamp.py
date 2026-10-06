#!/usr/bin/env python3
"""Проставляет версию в ссылки на app.js/style.css, чтобы браузер не держал старый код."""
import hashlib, re, datetime, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
h = hashlib.md5()
for f in ['assets/app.js', 'assets/style.css']:
    h.update((root / f).read_bytes())
ver = h.hexdigest()[:8]
built = datetime.datetime.now().strftime('%d.%m %H:%M')

p = root / 'index.html'
s = p.read_text(encoding='utf-8')
s = re.sub(r'(assets/(?:app\.js|style\.css))(\?v=[^"]*)?"', rf'\1?v={ver}"', s)
s = re.sub(r'(<span id="build">)[^<]*(</span>)', rf'\g<1>сборка {built} · {ver}\g<2>', s)
p.write_text(s, encoding='utf-8')
print(f'версия {ver}, сборка {built}')
