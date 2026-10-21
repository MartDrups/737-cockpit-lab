#!/usr/bin/env python3
import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def replace_once(text, before, after):
    if text.count(before) != 1:
        raise ValueError('Unexpected source format: ' + before[:100])
    return text.replace(before, after, 1)


def redirect_page(destination):
    return '''<!doctype html>
<html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>737 Cockpit Lab</title><script>
const target = new URL(%s, location.href);
target.search = location.search;
target.hash = location.hash;
location.replace(target.href);
</script><p>Открываем приложение…</p></html>
''' % json.dumps(destination)


parser = argparse.ArgumentParser()
parser.add_argument('--source', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--base-path', default='/737-cockpit-lab/')
parser.add_argument('--proof', required=True, type=Path)
args = parser.parse_args()
source = args.source.resolve()
output = args.output.resolve()
base = args.base_path
if not re.fullmatch(r'/(?:[a-zA-Z0-9._-]+/)*', base):
    parser.error('Base path must be an absolute directory path.')
if source == output or source in output.parents or output in source.parents:
    parser.error('Source and output must be separate, non-nested directories.')
if output.exists():
    parser.error('Output already exists.')
for filename in ['index.html', 'sw.js', 'delivery-bootstrap.js', 'offline-assets.json']:
    if not (source / filename).is_file():
        parser.error('Missing original delivery file: ' + filename)
source_files = {}
for path in sorted(source.rglob('*')):
    if path.is_symlink():
        raise ValueError('Unexpected symlink: ' + str(path))
    if path.is_file():
        source_files[path.relative_to(source).as_posix()] = sha256(path.read_bytes())
shutil.copytree(source, output)
(output / '_headers').unlink(missing_ok=True)
(output / '.nojekyll').write_text('')
for name, target in [('cbt/player', '../player.html'),
                     ('cbt/course-player', '../course-player.html'),
                     ('update', '../update.html')]:
    folder = output / name
    folder.mkdir(parents=True)
    (folder / 'index.html').write_text(redirect_page(target))
update = (output / 'update.js').read_text()
update = replace_once(update, "  const button = document.querySelector('#repair-update');",
                      "  const appRoot = new URL('.', document.currentScript.src);\n  const button = document.querySelector('#repair-update');")
update = replace_once(update, "location.replace('/#cbt')",
                      "location.replace(new URL('#cbt', appRoot).href)")
update = replace_once(update, "navigator.serviceWorker.register('/sw.js', {scope: '/', updateViaCache: 'none'})",
                      "navigator.serviceWorker.register(new URL('sw.js', appRoot), {scope: appRoot.href, updateViaCache: 'none'})")
(output / 'update.js').write_text(update)
recovery = (output / 'update.html').read_text()
recovery = replace_once(recovery, 'src="/update.js"', 'src="update.js"')
recovery = replace_once(recovery, 'href="/#cbt"', 'href="./#cbt"')
(output / 'update.html').write_text(recovery)
missing = (output / '404.html').read_text()
missing = replace_once(missing, 'href="/"', 'href="' + base + '"')
(output / '404.html').write_text(missing)
worker = (output / 'sw.js').read_text()
worker = replace_once(worker,
                      'url === playerURL ? playerCanonicalURL : url === coursePlayerURL ? coursePlayerCanonicalURL : deliveryNetworkURL(url)',
                      'deliveryNetworkURL(url)')
inventory = json.loads((output / 'offline-assets.json').read_text())
rows = inventory['assets']
row = next(item for item in rows if item['url'] == 'update.js')
row.update(size=len(update.encode()), revision=sha256(update.encode()))
inventory['totalBytes'] = sum(item['size'] for item in rows)
version_seed = json.dumps({'base': base, 'assets': rows, 'worker': sha256(worker.encode())}, sort_keys=True).encode()
version = 'github-' + sha256(version_seed)[:20]
inventory['version'] = version
worker, count = re.subn(r'^const VERSION = .*;$', 'const VERSION = ' + json.dumps(version) + ';', worker, count=1, flags=re.M)
assert count == 1
worker, count = re.subn(r'^const ASSETS = .*;$', lambda _: 'const ASSETS = ' + json.dumps(rows, separators=(',', ':')) + ';', worker, count=1, flags=re.M)
assert count == 1
(output / 'sw.js').write_text(worker)
(output / 'offline-assets.json').write_text(json.dumps(inventory, ensure_ascii=False, indent=2) + '\n')
actual = {path.relative_to(output).as_posix(): path for path in sorted(output.rglob('*')) if path.is_file()}
changed = [name for name, digest in source_files.items() if name in actual and sha256(actual[name].read_bytes()) != digest]
removed = sorted(source_files.keys() - actual.keys())
added = sorted(actual.keys() - source_files.keys())
assert set(changed) == {'404.html', 'update.html', 'update.js', 'sw.js', 'offline-assets.json'}, changed
assert removed == ['_headers'], removed
assert added == ['.nojekyll', 'cbt/course-player/index.html', 'cbt/player/index.html', 'update/index.html'], added
for name, digest in source_files.items():
    assert sha256((source / name).read_bytes()) == digest, 'Original changed: ' + name
report = {
    'source': str(source), 'output': str(output), 'basePath': base, 'version': version,
    'originalFiles': len(source_files), 'publishedFiles': len(actual),
    'unchangedFiles': len(source_files) - len(changed) - len(removed),
    'hostingChanges': changed, 'removedHostingFiles': removed, 'addedHostingFiles': added,
    'publishedBytes': sum(path.stat().st_size for path in actual.values()),
    'originalUnchanged': True,
    'originalSHA256': source_files,
    'publishedSHA256': {name: sha256(path.read_bytes()) for name, path in actual.items()},
}
args.proof.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({k: v for k, v in report.items() if k not in ['originalSHA256', 'publishedSHA256']}, ensure_ascii=False))
