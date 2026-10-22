#!/usr/bin/env python3
"""Check the reviewed prose, FCOM evidence, node copies and delivered hashes."""
import gzip
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from system_text import normalize, parse_assignment, source_pages

PUBLIC = ROOT / 'public'
SOURCE = ROOT / 'src/system-reading'


def read_delivery(url):
    direct = PUBLIC / url
    return direct.read_bytes() if direct.is_file() else gzip.decompress((PUBLIC / (url + '.gz')).read_bytes())


base = json.loads((SOURCE / 'base-text.json').read_text())
review = json.loads((SOURCE / 'text-additions.json').read_text())
actual = parse_assignment(read_delivery('system-data.js'))
pages = source_pages(read_delivery)
seen = changed = old_words = new_words = 0
sections = {}
for sid, system in actual['systems'].items():
    original_system = base['systems'][sid]
    assert system['intro'] == original_system['intro'], sid
    assert {s['id'] for s in system['sections']} == set(original_system['sections'])
    additions = review['sections'][sid]
    unchanged = review['unchanged'][sid]
    assert not set(additions).intersection(unchanged)
    assert set(additions).union(unchanged) == set(original_system['sections'])
    for section in system['sections']:
        ident = section['id']
        original = original_system['sections'][ident]
        assert section['body'][:len(original['body'])] == original['body'], (sid, ident)
        old_words += len(' '.join(original['body']).split())
        new_words += len(' '.join(section['body']).split())
        seen += 1
        sections[sid, ident] = section
        if ident in additions:
            entry = additions[ident]
            assert section['body'][len(original['body']):] == [entry['paragraph']]
            assert len(entry['paragraph'].split()) > 0
            for evidence in entry['sources']:
                assert evidence['ref'] in section['refs']
                assert normalize(evidence['quote']) in normalize(pages[evidence['ref']]['text'])
            changed += 1
        else:
            assert section['body'] == original['body'] and section['refs'] == original['refs']
        assert set(section['refs']).issubset(pages), (sid, ident)

cards = 0
for did, diagram in actual['diagrams'].items():
    sid = next(sid for sid, system in actual['systems'].items() if did in system['diagrams'])
    for node in diagram['nodes']:
        key = did + '/' + node['id']
        section = sections[sid, node['section']]
        assert node['body'] == base['nodePrefixes'].get(key, []) + section['body'], key
        assert set(base['nodeRefs'][key]).issubset(node['refs'])
        assert set(section['refs']).issubset(node['refs'])
        cards += 1

bundled = read_delivery('system-view.js').decode()
match = re.search(r'const extraDiagrams = (\{.*\});', bundled)
assert match, 'Extra diagrams must remain available'
# The JSON marker is followed by a semicolon before the rest of the module.
extra = json.JSONDecoder().raw_decode(match[1])[0]
extra_source = json.loads((SOURCE / 'extra-diagrams.json').read_text())
cloned = concise = 0
for did, entry in extra_source.items():
    sid = entry['system']
    for original_node, node in zip(entry['diagram']['nodes'], extra[did]['diagram']['nodes'], strict=True):
        assert original_node['id'] == node['id']
        original = base['systems'][sid]['sections'][node['section']]['body']
        if original_node['body'][-len(original):] == original:
            prefix = original_node['body'][:-len(original)]
            assert node['body'] == prefix + sections[sid, node['section']]['body']
            cloned += 1
        else:
            assert original_node == node
            concise += 1

inventory = json.loads((PUBLIC / 'offline-assets.json').read_text())
assets = {row['url']: row for row in inventory['assets']}
for url in ['system-data.js', 'system-view.js', 'index.html', 'app.js', 'system-style.css']:
    body = read_delivery(url)
    assert assets[url]['size'] == len(body), url
    assert assets[url]['revision'] == hashlib.sha256(body).hexdigest(), url
worker = (PUBLIC / 'sw.js').read_text()
assert json.loads(re.search(r'^const VERSION = (.*);$', worker, re.M)[1]) == inventory['version']
assert json.loads(re.search(r'^const ASSETS = (.*);$', worker, re.M)[1]) == inventory['assets']
assert inventory['totalBytes'] == sum(row['size'] for row in inventory['assets'])
assert seen == 148 and len(actual['systems']) == 15
assert cards == 705 and cloned + concise == 96
print(json.dumps({'sectionsReviewed': seen, 'sectionsExpanded': changed, 'sectionsUnchanged': seen-changed,
                  'originalWords': old_words, 'addedWords': new_words-old_words,
                  'growthPercent': round(100*(new_words/old_words-1), 1),
                  'nodeCardsSynchronized': cards+cloned, 'conciseCardsReviewed': concise,
                  'version': inventory['version']}, ensure_ascii=False))
