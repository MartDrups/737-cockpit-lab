#!/usr/bin/env python3
"""Собрать плееры CBT и обновить метаданные офлайн-версии."""
import gzip
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'public'
SOURCE = ROOT / 'src/cbt'


def digest(body):
    return hashlib.sha256(body).hexdigest()


modules = {'cbt-library.js': 'library.js', 'cbt-style.css': 'style.css',
           'cbt/player-layout.js': 'player-layout.js', 'cbt/player.css': 'player.css',
           'cbt/player.js': 'player.js', 'cbt/course-player.js': 'course-player.js'}
changed = {url: (SOURCE / name).read_bytes() for url, name in modules.items()}
tag = 'cbt-fullscreen-' + digest(b''.join(changed.values()))[:12]
index = (PUBLIC / 'index.html').read_text()
for url in ['cbt-library.js', 'cbt-style.css']:
    index, count = re.subn(r'(' + re.escape(url) + r')(?:\?v=[^"\s]+)?(?=")',
                           lambda m: m[1] + '?v=' + tag, index)
    assert count == 1, url
changed['index.html'] = index.encode()
for player, urls in [('player.html', ['player.css', 'player-layout.js', 'player.js']),
                     ('course-player.html', ['player.css', 'player-layout.js', 'course-player.js'])]:
    html = (PUBLIC / 'cbt' / player).read_text()
    for url in urls:
        html, count = re.subn(r'(' + re.escape(url) + r')(?:\?v=[^"\s]+)?(?=")',
                              lambda m: m[1] + '?v=' + tag, html)
        assert count == 1, (player, url)
    changed['cbt/' + player] = html.encode()
for url, body in changed.items():
    target = PUBLIC / (url if url.endswith('.html') else url + '.gz')
    target.write_bytes(body if url.endswith('.html') else gzip.compress(body, compresslevel=9, mtime=0))

inventory = json.loads((PUBLIC / 'offline-assets.json').read_text())
seen = set()
for row in inventory['assets']:
    if row['url'] in changed:
        body = changed[row['url']]
        row.update(size=len(body), revision=digest(body))
        seen.add(row['url'])
assert seen == set(changed)
inventory['totalBytes'] = sum(row['size'] for row in inventory['assets'])
inventory['version'] = 'github-cbt-fullscreen-' + digest(json.dumps(inventory['assets'], sort_keys=True).encode())[:20]
worker = (PUBLIC / 'sw.js').read_text()
for key, value in [('VERSION', inventory['version']), ('ASSETS', inventory['assets'])]:
    worker, count = re.subn(r'^const ' + key + r' = .*;$',
                           lambda _: 'const ' + key + ' = ' + json.dumps(value, separators=(',', ':')) + ';',
                           worker, count=1, flags=re.M)
    assert count == 1
(PUBLIC / 'sw.js').write_text(worker)
(PUBLIC / 'offline-assets.json').write_text(json.dumps(inventory, ensure_ascii=False, indent=2) + '\n')
files = sorted(p for p in PUBLIC.rglob('*') if p.is_file())
(ROOT / 'PUBLIC_SHA256SUMS').write_text(''.join(f'{digest(p.read_bytes())}  {p.relative_to(ROOT).as_posix()}\n' for p in files))
print(json.dumps({'version': inventory['version'], 'files': len(files),
                  'bytes': sum(p.stat().st_size for p in files)}))
