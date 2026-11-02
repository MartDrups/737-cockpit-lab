#!/usr/bin/env python3
"""Audit every delivered CBT file, source reference and media stream.

Output is an artifact, not another repack of the original course. A media cache
can reuse a successful full decode only when the physical SHA256 is unchanged.
"""
import argparse
import collections
import concurrent.futures
import datetime
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
import subprocess
import xml.etree.ElementTree as ET
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'public'
ap = argparse.ArgumentParser(description=__doc__)
ap.add_argument('--output', type=Path, required=True)
ap.add_argument('--media-cache', type=Path)
ap.add_argument('--workers', type=int, default=6)
args = ap.parse_args()
if not shutil.which('ffmpeg'):
    ap.error('FFmpeg is required for a complete audio/video decode; install ffmpeg first.')
args.output.mkdir(parents=True, exist_ok=True)
report = {'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'errors': [], 'unresolvedDynamicFields': [], 'untranslatedResponses': [],
          'unprovedMovies': [], 'unprovedMovieRanges': []}
manifest, lessons, media, symbols, movies = [], [], [], [], []
svgs, atlases, references = {}, {}, set()
types = collections.Counter()


def decode(path):
    raw = path.read_bytes()
    body = gzip.decompress(raw) if path.suffix == '.gz' else raw
    # This is the same lossless dictionary transport decoded by sw.js.
    magic = b'CBT-SVG-DICT-1\n'
    if body.startswith(magic):
        packet = json.loads(body[len(magic):])
        body = re.sub('\x01(\\d+)\x02', lambda m: packet['parts'][int(m[1])], packet['body']).encode()
    return raw, body


def physical(url):
    path = PUBLIC / url
    return path if path.is_file() else Path(str(path) + '.gz')


def walk(value, context, intro=False):
    if isinstance(value, list):
        for child in value:
            walk(child, context, intro)
    elif isinstance(value, dict):
        for key, val in value.items():
            if isinstance(val, str):
                if key in ['file', 'url'] and val.startswith('cbt/'):
                    references.add(val)
                elif intro and key in ['file', 'image', 'video', 'poster'] and re.match(r'^(audio|scenes|video)/', val):
                    references.add('cbt/' + val)
        if value.get('symbol') and value.get('file'):
            symbols.append((context, value['file'], value['symbol']))
        if isinstance(value.get('movie'), dict):
            movies.append((context, value['movie']))
        if value.get('sourceResponseFullyTranslated') is False:
            report['untranslatedResponses'].append({'scene': context, 'node': value.get('sourceResponseNode', value.get('sourceNode'))})
        for field in value.get('sourceDynamicFields', []):
            if field.get('status') != 'resolved-source-string':
                report['unresolvedDynamicFields'].append({'scene': context, 'actor': value.get('id'), 'variable': field.get('expression', {}).get('variable'), 'reason': field.get('reason')})
        for child in value.values():
            walk(child, context, intro)


for path in sorted((PUBLIC / 'cbt').rglob('*')):
    if not path.is_file():
        continue
    relative = path.relative_to(ROOT).as_posix()
    try:
        raw, body = decode(path)
        kind = Path(path.name.removesuffix('.gz')).suffix
        types[kind] += 1
        row = {'path': relative, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
               'decodedBytes': len(body), 'decodedSHA256': hashlib.sha256(body).hexdigest()}
        manifest.append(row)
        if kind == '.svg':
            tree = ET.fromstring(body)
            svgs[path.relative_to(PUBLIC).as_posix().removesuffix('.gz')] = {e.get('id') for e in tree.iter() if e.get('id')}
        elif kind == '.json':
            data = json.loads(body)
            if 'scenes' in data:
                lessons.append(data)
        elif kind in ['.png', '.jpg', '.jpeg']:
            image = Image.open(io.BytesIO(body))
            image.load()
        elif kind in ['.mp3', '.mp4', '.wav']:
            media.append((path, row['sha256']))
    except Exception as error:
        report['errors'].append({'path': relative, 'error': str(error)})

for data in lessons:
    intro = data['id'] == 'intro'
    for scene in data['scenes']:
        walk(scene, data['id'] + '/' + scene['id'], intro)
    if intro:
        walk(data.get('effects', {}), data['id'] + '/effects', True)
        walk(data.get('feedback', {}), data['id'] + '/feedback', True)
for context, file, symbol in symbols:
    if symbol not in svgs.get(file, set()):
        report['errors'].append({'scene': context, 'file': file, 'missingSymbol': symbol})
for context, movie in movies:
    if not movie.get('exactParameters'):
        report['unprovedMovies'].append({'scene': context, 'firstFrame': movie.get('firstFrame'), 'lastFrame': movie.get('lastFrame'), 'fps': movie.get('fps')})
    for frame in [movie.get('firstFrame'), movie.get('lastFrame')]:
        if frame is not None and not any(a['startFrame'] <= frame < a['startFrame'] + a['frameCount'] for a in movie['atlases']):
            target = report['errors'] if movie.get('exactParameters') else report['unprovedMovieRanges']
            target.append({'scene': context, 'missingMovieFrame': frame})
    for atlas in movie['atlases']:
        key = json.dumps(atlas, sort_keys=True)
        if key in atlases:
            continue
        atlases[key] = atlas
        image = Image.open(io.BytesIO(decode(physical(atlas['file']))[1]))
        if image.size != (atlas['width'], atlas['height']):
            report['errors'].append({'scene': context, 'atlas': atlas['file'], 'wrongDimensions': list(image.size)})
        if atlas['frameCount'] > atlas['columns'] * atlas['rows'] or atlas['columns'] * atlas['sourceFrameWidth'] > image.width or atlas['rows'] * atlas['sourceFrameHeight'] > image.height:
            report['errors'].append({'scene': context, 'atlas': atlas['file'], 'invalidFrameLayout': True})

cache = json.loads(args.media_cache.read_text()) if args.media_cache else {}
by_url = {r['path'].removeprefix('public/').removesuffix('.gz'): r for r in manifest}
inventory = json.loads((PUBLIC / 'offline-assets.json').read_text())['assets']
inventory += json.loads(decode(PUBLIC / 'cbt/course-packs.json.gz')[1])['assets']
checked_inventory = set()
for asset in inventory:
    if not asset['url'].startswith('cbt/'):
        continue
    row = by_url.get(asset['url'])
    if not row or row['decodedSHA256'] != asset['revision'] or row['decodedBytes'] != asset['size']:
        report['errors'].append({'inventoryMismatch': asset['url']})
    checked_inventory.add(asset['url'])
report['inventoryAssets'] = len(checked_inventory)


def media_decode(entry):
    path, sha = entry
    name = path.relative_to(ROOT).as_posix()
    old = cache.get(name, {})
    if old.get('sha256') == sha and old.get('passed') is True:
        return name, old
    row = {'sha256': sha, 'passed': False}
    try:
        result = subprocess.run(['ffmpeg', '-hide_banner', '-nostdin', '-v', 'error', '-threads', '1', '-filter_threads', '1', '-i', 'pipe:0', '-f', 'null', '-'], input=decode(path)[1], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=90)
        row['passed'] = result.returncode == 0 and not result.stderr
        if not row['passed']:
            row.update(code=result.returncode, error=result.stderr.decode(errors='replace')[:1500])
    except Exception as error:
        row['error'] = str(error)
    return name, row


media_results = {}
with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
    for name, result in pool.map(media_decode, media):
        media_results[name] = result
report.update(files=len(manifest), physicalBytes=sum(r['bytes'] for r in manifest), types=dict(types),
              lessonManifests=len(lessons), scenes=sum(len(d['scenes']) for d in lessons),
              uniqueReferences=len(references), missingReferences=sorted(r for r in references if not physical(r).is_file()),
              symbolReferences=len(symbols), svgFiles=len(svgs), movieInstances=len(movies),
              movieAtlases=len(atlases), movieFrames=sum(a['frameCount'] for a in atlases.values()),
              mediaFiles=len(media_results), mediaErrors=[{'path': n, **r} for n, r in media_results.items() if not r['passed']])
report['passedPhysicalAssets'] = not (report['errors'] or report['mediaErrors'] or report['missingReferences'])
for name, value in [('asset-audit', report), ('file-manifest', manifest), ('media-cache', media_results)]:
    (args.output / (name + '.json')).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({k: len(v) if isinstance(v, list) else v for k, v in report.items()}, ensure_ascii=False))
raise SystemExit(0 if report['passedPhysicalAssets'] else 1)
