"""Apply the reviewed FCOM additions without accumulating text on rebuilds."""
import json


def parse_assignment(body):
    return json.loads(body.decode().split('=', 1)[1].strip().removesuffix(';'))


def source_pages(read_delivery):
    pages = parse_assignment(read_delivery('fcom-pages.js'))
    supplement = read_delivery('system-pages.js').decode()
    pages.update(json.loads(supplement.split(', ', 1)[1].strip().removesuffix(');')))
    return pages


def normalize(text):
    return ' '.join(text.replace('–', '-').replace('—', '-').split())


def apply_additions(reference, extra, source, read_delivery):
    base = json.loads((source / 'base-text.json').read_text())
    review = json.loads((source / 'text-additions.json').read_text())
    pages = source_pages(read_delivery)
    assert set(base['systems']) == set(reference['systems'])
    assert set(review['sections']) == set(reference['systems'])
    assert set(review['unchanged']) == set(reference['systems'])
    originals, additions, reviewed = 0, 0, 0
    section_lookup = {}
    for sid, system in reference['systems'].items():
        baseline = base['systems'][sid]
        assert set(baseline['sections']) == {s['id'] for s in system['sections']}
        added = review['sections'][sid]
        unchanged = review['unchanged'][sid]
        assert not set(added).intersection(unchanged)
        assert set(added).union(unchanged) == set(baseline['sections'])
        assert len(unchanged) == len(set(unchanged))
        system['intro'] = baseline['intro']
        for section in system['sections']:
            ident = section['id']
            original = baseline['sections'][ident]
            section['body'] = list(original['body'])
            section['refs'] = list(original['refs'])
            originals += len(' '.join(original['body']).split())
            reviewed += 1
            if ident in added:
                entry = added[ident]
                assert entry['paragraph'].strip() and entry['sources']
                assert entry['paragraph'] not in section['body']
                for evidence in entry['sources']:
                    ref = evidence['ref']
                    assert normalize(evidence['quote']) in normalize(pages[ref]['text']), (sid, ident, ref)
                    if ref not in section['refs']:
                        section['refs'].append(ref)
                section['body'].append(entry['paragraph'])
                additions += len(entry['paragraph'].split())
            section_lookup[sid, ident] = section

    # The original diagram cards use copies of subsection prose, with a few
    # specific introductory paragraphs. Preserve those prefixes exactly.
    prefixes_seen = set()
    original_nodes = 0
    for did, diagram in reference['diagrams'].items():
        sid = next(sid for sid, s in reference['systems'].items() if did in s['diagrams'])
        for node in diagram['nodes']:
            section = section_lookup[sid, node['section']]
            key = did + '/' + node['id']
            prefix = base['nodePrefixes'].get(key, [])
            if prefix:
                prefixes_seen.add(key)
            node['body'] = list(prefix) + section['body']
            # Retain node-specific source references and add new evidence.
            node['refs'] = list(base['nodeRefs'][key])
            for ref in section['refs']:
                if ref not in node['refs']:
                    node['refs'].append(ref)
            original_nodes += 1
    assert prefixes_seen == set(base['nodePrefixes'])
    assert original_nodes == len(base['nodeRefs'])

    cloned_nodes = 0
    concise_nodes = 0
    for entry in extra.values():
        sid = entry['system']
        for node in entry['diagram']['nodes']:
            original = base['systems'][sid]['sections'][node['section']]['body']
            if node['body'][-len(original):] == original:
                prefix = node['body'][:-len(original)]
                section = section_lookup[sid, node['section']]
                node['body'] = prefix + section['body']
                for ref in section['refs']:
                    if ref not in node['refs']:
                        node['refs'].append(ref)
                cloned_nodes += 1
            else:
                # These deliberately concise, node-specific explanations
                # were reviewed and are already sufficient.
                concise_nodes += 1
    assert reviewed == review['scope']['sectionsReviewed'] == 148
    return {
        'revision': review['revision'], 'systemsReviewed': len(reference['systems']),
        'sectionsReviewed': reviewed,
        'sectionsExpanded': sum(len(s) for s in review['sections'].values()),
        'sectionsUnchanged': sum(len(s) for s in review['unchanged'].values()),
        'originalWords': originals, 'addedWords': additions,
        'growthPercent': round(100 * additions / originals, 1),
        'originalNodeCardsSynchronized': original_nodes,
        'extraNodeCardsSynchronized': cloned_nodes,
        'conciseExtraNodeCardsReviewed': concise_nodes,
    }
