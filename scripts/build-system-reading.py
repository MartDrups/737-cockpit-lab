#!/usr/bin/env python3
"""Build only the changed reading modules; retain the existing gzip delivery."""
import gzip
import hashlib
import json
import re
from pathlib import Path
from system_text import apply_additions, parse_assignment

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'public'
SOURCE = ROOT / 'src/system-reading'


def digest(body):
    return hashlib.sha256(body).hexdigest()


def read_delivery(url):
    direct = PUBLIC / url
    if direct.is_file():
        return direct.read_bytes()
    return gzip.decompress((PUBLIC / (url + '.gz')).read_bytes())


def replace_once(text, before, after):
    if text.count(before) != 1:
        raise ValueError('Unexpected source format: ' + before[:90])
    return text.replace(before, after, 1)


plans = json.loads((SOURCE / 'sections.json').read_text())
aliases = json.loads((SOURCE / 'aliases.json').read_text())
extra = json.loads((SOURCE / 'extra-diagrams.json').read_text())
reference = parse_assignment(read_delivery('system-data.js'))
text_report = apply_additions(reference, extra, SOURCE, read_delivery)
diagrams = dict(reference['diagrams'])
for id, entry in extra.items():
    assert id not in diagrams, id
    assert id == entry['diagram']['id']
    assert entry['system'] in reference['systems']
    diagrams[id] = entry['diagram']
    assert (PUBLIC / (entry['diagram']['image'] + '.gz')).is_file()
    node_ids = set()
    for node in entry['diagram']['nodes']:
        assert node['id'] not in node_ids, node['id']
        node_ids.add(node['id'])
        assert node['body'] and node['hits'] and node['refs']
        for x, y, width, height in node['hits']:
            left, top, clip_width, clip_height = entry['diagram']['clip']
            assert width > 0 and height > 0
            assert x >= left-1 and y >= top-1, (id, node['id'])
            assert x+width <= left+clip_width+1 and y+height <= top+clip_height+1, (id, node['id'])
for system, sections in plans.items():
    existing = {s['id'] for s in reference['systems'][system]['sections']}
    for section, ids in sections.items():
        assert section in existing, (system, section)
        assert ids and len(ids) == len(set(ids))
        for id in ids:
            assert id in diagrams, id
            assert id in reference['systems'][system]['diagrams'] or extra[id]['system'] == system

view = (SOURCE / 'view.js').read_text()
for marker, value in [('section-diagrams', plans), ('node-aliases', aliases), ('extra-diagrams', extra)]:
    view = replace_once(view, f'/* @{marker} */ {{}}', json.dumps(value, ensure_ascii=False, separators=(',', ':')))
changed = {
    'system-view.js': view.encode(),
    'system-style.css': (SOURCE / 'style.css').read_bytes(),
    'system-data.js': ('window.FCOM_SYSTEM_REFERENCE = ' + json.dumps(reference, ensure_ascii=False, separators=(',', ':')) + ';\n').encode(),
}
app = read_delivery('app.js').decode()
if "document.body.classList.toggle('system-reference-reading'" not in app:
    app = replace_once(app, 'function render(){const p=', 'function render(){window.SystemReferenceView.dispose();const p=')
    app = replace_once(app, "document.body.classList.toggle('cbt-view',cbt);", "document.body.classList.toggle('system-reference-reading',view==='systems'&&!!selectedSystem&&!query);document.body.classList.toggle('cbt-view',cbt);")
changed['app.js'] = app.encode()
tag = 'systems-reading-' + digest(changed['system-view.js'] + changed['system-style.css'] + changed['system-data.js'])[:12]
index = (PUBLIC / 'index.html').read_text()
for url in ['system-view.js', 'system-style.css', 'system-data.js', 'app.js']:
    index, count = re.subn(r'(' + re.escape(url) + r'\?v=)[^"\s]+', lambda m: m[1]+tag, index)
    assert count == 1, url
changed['index.html'] = index.encode()
for url, body in changed.items():
    target = PUBLIC / (url if url == 'index.html' else url + '.gz')
    target.write_bytes(body if url == 'index.html' else gzip.compress(body, compresslevel=9, mtime=0))

inventory = json.loads((PUBLIC / 'offline-assets.json').read_text())
for row in inventory['assets']:
    if row['url'] in changed:
        body = changed[row['url']]
        row.update(size=len(body), revision=digest(body))
inventory['totalBytes'] = sum(row['size'] for row in inventory['assets'])
inventory['version'] = 'github-systems-' + digest(json.dumps(inventory['assets'], sort_keys=True).encode())[:20]
worker = (PUBLIC / 'sw.js').read_text()
for key, value in [('VERSION', inventory['version']), ('ASSETS', inventory['assets'])]:
    worker, count = re.subn(r'^const '+key+r' = .*;$', lambda _: 'const '+key+' = '+json.dumps(value,separators=(',', ':'))+';', worker, count=1, flags=re.M)
    assert count == 1
(PUBLIC / 'sw.js').write_text(worker)
(PUBLIC / 'offline-assets.json').write_text(json.dumps(inventory,ensure_ascii=False,indent=2)+'\n')
files = sorted(p for p in PUBLIC.rglob('*') if p.is_file())
(ROOT / 'PUBLIC_SHA256SUMS').write_text(''.join(f'{digest(p.read_bytes())}  {p.relative_to(ROOT).as_posix()}\n' for p in files))
print(json.dumps({'version':inventory['version'],'files':len(files),'bytes':sum(p.stat().st_size for p in files),
                  'illustratedSections':sum(map(len,plans.values())),'newDiagrams':len(extra),
                  'newElements':sum(len(x['diagram']['nodes']) for x in extra.values()),
                  'systemText':text_report},ensure_ascii=False))
