"""Exercise original CBT movement operations through the delivered course player."""
import gzip
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
from system_browser_support import configure, launch

ROOT = Path(__file__).resolve().parents[1]
args, origin, out = configure()
lessons = {}
for path in (ROOT / 'public/cbt/course/lessons').glob('*.json.gz'):
    data = json.loads(gzip.decompress(path.read_bytes()))
    lessons[data['id']] = data
source = lessons['222c17i']
scenes = {s['id']: s for s in source['scenes']}
actor = scenes['F-3.3']['sourceSequence'][0]['actor']
moves = [next(op for op in scenes[id]['sourceSequence'] if op['kind'] == 'move' and op['id'] == actor['id'])
         for id in ['F-3.3', 'F-3.5', 'F-3.6']]
# User gates replace waits so assertions can inspect exact animation boundaries.
# Geometry, paths and durations are untouched source operations.
fixture = dict(scenes['F-3.3'], id='motion-proof', layers=[], audio=[], exercise=None,
               sourceSequence=[{'kind': 'draw', 'actor': actor}, moves[0],
                               {'kind': 'gate', 'gate': 'manual'}, moves[1],
                               {'kind': 'gate', 'gate': 'manual'}, moves[2],
                               {'kind': 'gate', 'gate': 'manual'}])
report = {'browser': args.browser, 'checks': [], 'errors': []}
motion_cases, missing_actors = [], []


def collect(value, actors, operations):
    if isinstance(value, list):
        for child in value:
            collect(child, actors, operations)
    elif isinstance(value, dict):
        if value.get('rect') and 'id' in value and any(k in value for k in ['file', 'movie', 'composition']):
            actors[value['id']] = value
        if value.get('kind') == 'move':
            operations.append(value)
        for child in value.values():
            collect(child, actors, operations)


for data in lessons.values():
    all_actors = {}
    collect(data, all_actors, [])
    for s in data['scenes']:
        actors, operations = {}, []
        collect(s, actors, operations)
        for op in operations:
            a = actors.get(op['id'], all_actors.get(op['id']))
            if a:
                motion_cases.append({'source': data['id'] + '/' + s['id'], 'actor': a, 'operation': op})
            else:
                missing_actors.append({'scene': data['id'] + '/' + s['id'], 'actor': op['id']})

with sync_playwright() as p:
    browser = launch(p, args.browser, remote=bool(args.url))
    context = browser.new_context(viewport={'width': 1200, 'height': 900})
    page = context.new_page()
    page.on('pageerror', lambda error: report['errors'].append(str(error)))
    page.goto(origin + 'cbt/course-player.html?lesson=222c17i', wait_until='commit')
    page.locator('#start-lesson').wait_for(state='visible', timeout=90000)
    page.wait_for_function('window.CBTCourseNative?.lesson')
    page.evaluate('s=>{CBTCourseNative.lesson.scenes=[s];CBTCourseNative.lesson.sections=[]}', fixture)
    page.locator('#start-lesson').click()
    selector = '#scene-layers [data-actor="' + actor['id'] + '"]'
    def position():
        return page.locator(selector).evaluate('(e)=>{const s=getComputedStyle(e);return {x:parseFloat(s.left),y:parseFloat(s.top)}}')
    def first_keyframe():
        return page.locator(selector).evaluate('(e)=>{const k=e.getAnimations().at(-1).effect.getKeyframes()[0];return {x:parseFloat(k.left),y:parseFloat(k.top)}}')
    def close(a, b, label):
        assert abs(a['x']-b['x']) < 0.1 and abs(a['y']-b['y']) < 0.1, (label, a, b)
    close(first_keyframe(), actor['rect'], 'original start')
    page.locator(selector).evaluate('(e)=>e.getAnimations().at(-1).finish()')
    page.wait_for_timeout(40)
    close(position(), moves[0]['destination'], 'first endpoint')
    page.locator('#next').click()
    close(first_keyframe(), moves[0]['destination'], 'second movement starts at previous endpoint')
    report['checks'].append('VOR LOC arrow carries its completed position into the next movement')
    page.locator(selector).evaluate('(e)=>{const a=e.getAnimations().at(-1);a.pause();a.currentTime=500}')
    page.locator(selector).evaluate('(e)=>Promise.all(e.getAnimations().map(a=>a.ready))')
    interrupted = position()
    page.locator('#next').click()
    close(first_keyframe(), interrupted, 'interrupted movement starts at current position')
    report['checks'].append('interrupting a movement preserves its displayed position')
    page.locator('#pause').click()
    page.locator(selector).evaluate('(e)=>Promise.all(e.getAnimations().map(a=>a.ready))')
    stopped = position()
    page.wait_for_timeout(150)
    close(position(), stopped, 'paused coordinates')
    page.locator('#pause').click()
    page.wait_for_function('''() => {
      const e=document.querySelector('#scene-layers [data-actor="508"]');
      return Math.abs(parseFloat(getComputedStyle(e).left)-773)<.1;
    }''', timeout=5000)
    close(position(), moves[2]['destination'], 'third endpoint')
    page.wait_for_function("document.querySelector('#scene-layers [data-actor=\"508\"]').getAnimations().length===0")
    assert page.locator(selector).evaluate('(e)=>e.getAnimations().length') == 0
    report['checks'].append('pause freezes motion; resume reaches exact source endpoint without accumulating animations')
    page.locator('#repeat').click()
    close(first_keyframe(), actor['rect'], 'replay restores original start')
    report['checks'].append('replay restores source geometry')
    report['allMovements'] = page.evaluate('''cases=>{
      const failures=[];
      for(const [i,c]of cases.entries()){
        const s={id:'motion-'+i,layers:[],text:'',audio:[],transition:{kind:'manual',delay:0},
          sourceSequence:[{kind:'draw',actor:c.actor},c.operation,{kind:'gate',gate:'manual'}]};
        CBTCourseNative.lesson.scenes=[s];CBTCourseNative.goTo(s.id);
        const e=document.querySelector('#scene-layers [data-actor="'+c.actor.id+'"]'),a=e?.getAnimations().at(-1);
        if(!a){failures.push({source:c.source,actor:c.actor.id,missingAnimation:true});continue}
        const points=c.operation.path?.length?c.operation.path:[c.actor.rect,c.operation.destination];
        const keys=a.effect.getKeyframes(),last=points.at(-1);
        if(keys.length!==points.length||keys.some((k,n)=>Math.abs(parseFloat(k.left)-points[n].x)>.01||Math.abs(parseFloat(k.top)-points[n].y)>.01))failures.push({source:c.source,actor:c.actor.id,wrongPath:true});
        if(Math.abs(a.effect.getTiming().duration-c.operation.duration*1000)>.001)failures.push({source:c.source,wrongDuration:true});
        a.finish();const actual=getComputedStyle(e);
        if(Math.abs(parseFloat(actual.left)-last.x)>.01||Math.abs(parseFloat(actual.top)-last.y)>.01)failures.push({source:c.source,actor:c.actor.id,wrongEndpoint:true});
      }
      return {checked:cases.length,failures};
    }''', motion_cases)
    report['missingSourceActors'] = missing_actors
    assert not report['allMovements']['failures'], report['allMovements']['failures'][:5]
    assert not report['errors'], report['errors']
    page.screenshot(path=str(out / 'motion.png'))
    context.close()
    browser.close()
(out / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(report, ensure_ascii=False))
