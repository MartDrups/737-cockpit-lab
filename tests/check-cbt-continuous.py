"""Check continuous navigation inside a CBT system using the real delivered players."""
import gzip
import json
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from system_browser_support import configure, launch

ROOT = Path(__file__).resolve().parents[1]
args, origin, out = configure()
source = gzip.decompress((ROOT / 'public/cbt-course-data.js.gz').read_bytes()).decode()
course = json.loads(source[source.index('=') + 1:].strip().rstrip(';'))
topics = {t['id']: t for t in course['topics']}

def entries(group):
    result, combined = [], False
    for id in group['topics']:
        item = topics[id]
        if item['status'] != 'ready':
            continue
        if item.get('sourceMode') == 'test':
            if not combined:
                result.append({'id': 'quiz-' + group['id']})
                combined = True
        else:
            result.append(item)
    return result

group = next(g for g in course['groups'] if g['id'] == '24101')
system = entries(group)
first, second = system[:2]

def lesson(id):
    return json.loads(gzip.decompress((ROOT / 'public' / (topics[id]['manifest'] + '.gz')).read_bytes()))

def saved(data, index=0):
    return {'index': index, 'visited': [data['scenes'][index]['id']], 'completed': [],
            'settings': {'audio': False, 'text': False, 'speed': 'fast'}, 'finished': False,
            'comments': {data['scenes'][index]['id']: 'Continuous navigation note'}}

def store(page, id, value):
    page.evaluate('({id,value})=>localStorage.setItem("737-cbt-course-"+id,JSON.stringify(value))', {'id': id, 'value': value})

def frame_for(page):
    return page.locator('.cbt-player-shell iframe').element_handle().content_frame()

def wait_lesson(frame, id, auto=False):
    if not auto:
        frame.locator('#start-lesson').click(timeout=90000)
    frame.wait_for_function('id=>window.CBTCourseNative?.lesson.id===id&&CBTCourseNative.current', arg=id, timeout=90000)
    frame.locator('#lesson').wait_for(state='visible')
    if not frame.evaluate('CBTCourseNative.state.paused'):
        frame.locator('#pause').click()
    return frame.evaluate('CBTCourseNative.state')

def open_item(page, item):
    page.locator('#cbt-search').fill(item['title'])
    page.locator('[data-cbt-open="'+item['id']+'"]').click()
    return frame_for(page)

def overflow(page, frame):
    assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
    assert not frame.evaluate('document.documentElement.scrollWidth>innerWidth')

report = {'browser': args.browser, 'origin': origin, 'checks': [], 'errors': []}
with sync_playwright() as p:
    browser = launch(p, args.browser, remote=bool(args.url))
    context = browser.new_context(viewport={'width': 1180, 'height': 820}, has_touch=True, is_mobile=True)
    page = context.new_page()
    page.on('pageerror', lambda e: report['errors'].append(str(e)))
    try:
        page.goto(origin+'#cbt', wait_until='commit')
        page.locator('#cbt-search').wait_for(timeout=120000)
        first_data, second_data = lesson(first['id']), lesson(second['id'])
        initial = saved(first_data, min(2, len(first_data['scenes'])-1))
        next_saved = saved(second_data, min(3, len(second_data['scenes'])-1))
        next_saved['settings'] = {'audio': True, 'text': True, 'speed': 'slow'}
        next_saved['finished'] = True
        next_saved['visited'] = [s['id'] for s in second_data['scenes']]
        next_saved['completed'] = [s['id'] for s in second_data['scenes'] if (s.get('exercise') or {}).get('supported')]
        store(page, first['id'], initial)
        store(page, second['id'], next_saved)
        frame = open_item(page, first)
        before = wait_lesson(frame, first['id'])
        assert frame.locator('#previous-lesson').is_disabled()
        page.evaluate('window.__continuousFrame=document.querySelector(".cbt-player-shell iframe")')
        frame.locator('#fullscreen').click()
        page.wait_for_function('document.documentElement.classList.contains("cbt-fullscreen")')
        frame.locator('#next-lesson').click()
        state = wait_lesson(frame, second['id'], True)
        assert state['index'] == next_saved['index'], state
        assert state['finished'], 'Navigation must retain completion of an already completed lesson'
        assert state['settings'] == initial['settings'], state
        assert page.evaluate('window.__continuousFrame===document.querySelector(".cbt-player-shell iframe")')
        assert page.evaluate('document.documentElement.classList.contains("cbt-fullscreen")')
        assert frame.locator('#loading').is_hidden()
        old = page.evaluate('id=>JSON.parse(localStorage.getItem("737-cbt-course-"+id))', first['id'])
        assert old['index'] == before['index'] and old['comments'] == initial['comments'], old
        assert not old['finished'] and not old['completed'], old
        report['checks'].append('Next lesson autostarts in the same iframe and fullscreen; settings, old progress and notes survive without false completion')
        frame.locator('#previous-lesson').click()
        returned = wait_lesson(frame, first['id'], True)
        assert returned['index'] == old['index'], returned
        report['checks'].append('Previous lesson resumes its own saved scene')
        page.set_viewport_size({'width': 390, 'height': 844})
        frame.locator('#next-lesson').evaluate('(b)=>{b.click();b.click()}')
        wait_lesson(frame, second['id'], True)
        overflow(page, frame)
        assert page.evaluate('window.__continuousFrame===document.querySelector(".cbt-player-shell iframe")')
        page.screenshot(path=str(out/'continuous-phone.png'))
        report['checks'].append('Phone navigation stays inside the player; double tap cannot skip two lessons')
        frame.locator('#fullscreen').click()
        page.locator('[data-cbt-back]').click()

        short = topics['721f17i']
        short_data = lesson(short['id'])
        complete = saved(short_data, len(short_data['scenes'])-1)
        complete['settings']['text'] = True
        complete['visited'] = [s['id'] for s in short_data['scenes']]
        complete['completed'] = [s['id'] for s in short_data['scenes'] if (s.get('exercise') or {}).get('supported')]
        store(page, short['id'], complete)
        frame = open_item(page, short)
        frame.locator('#start-lesson').click(timeout=90000)
        deadline = time.monotonic()+30
        while time.monotonic()<deadline and not frame.locator('#lesson-completion-dialog').is_visible():
            if frame.locator('#next').is_enabled():
                frame.locator('#next').click()
            frame.wait_for_timeout(100)
        modal = frame.locator('#lesson-completion-dialog')
        modal.wait_for(state='visible', timeout=15000)
        next_id = frame.evaluate('CBTNavigation.state(CBT_COURSE,CBTCourseNative.lesson.id).next?.id')
        assert next_id, 'The short source lesson must have a following item in its own system'
        frame.locator('[data-completion-next]').click()
        wait_lesson(frame, next_id, True)
        assert page.locator('#cbt-search').count() == 0
        report['checks'].append('Real lesson completion opens the next item with one click, including a grouped question bank')
        page.locator('[data-cbt-back]').click()

        last = system[-1]['id']
        page.evaluate('id=>CBTView.open(id)', last)
        frame = frame_for(page)
        frame.locator('#lesson-sequence').wait_for(timeout=90000)
        assert frame.locator('#next-lesson').is_disabled()
        report['checks'].append('The last item never crosses into another system')
        page.locator('[data-cbt-back]').click()

        standalone = context.new_page()
        standalone.on('pageerror', lambda e: report['errors'].append(str(e)))
        standalone.goto(origin+'cbt/course-player.html?lesson='+first['id'], wait_until='commit')
        standalone.locator('#start-lesson').click(timeout=90000)
        standalone.locator('#fullscreen').click()
        standalone.locator('#next-lesson').click()
        wait_lesson(standalone, second['id'], True)
        assert standalone.evaluate('document.documentElement.classList.contains("player-expanded")')
        report['checks'].append('Direct player links also retain expanded mode when moving to the next lesson')
        standalone.close()
        page.bring_to_front()

        page.locator('#cbt-search').fill(group['title'])
        for item in [first, second]:
            page.locator('[data-cbt-download="'+item['id']+'"]').click()
            page.wait_for_function("""async id=>{
              const r=await navigator.serviceWorker.ready;
              const data=await new Promise(resolve=>{const c=new MessageChannel();c.port1.onmessage=e=>resolve(e.data);r.active.postMessage({type:'CBT_STATUS'},[c.port2])});
              return data.lessons[id]?.ready;
            }""", arg=item['id'], timeout=240000)
            expect(page.locator('[data-cbt-download="'+item['id']+'"]')).to_be_enabled(timeout=30000)
        frame = open_item(page, first)
        wait_lesson(frame, first['id'])
        if not args.url:
            args.preview_server.shutdown()
            args.preview_server.server_close()
        context.set_offline(True)
        frame.locator('#next-lesson').click()
        wait_lesson(frame, second['id'], True)
        assert frame.locator('#media-error').is_hidden()
        frame.locator('#previous-lesson').click()
        wait_lesson(frame, first['id'], True)
        assert frame.locator('#media-error').is_hidden()
        report['offlineSimulation'] = 'Browser context offline; server remains public' if args.url else 'Local origin server stopped before navigation in both browsers'
        report['checks'].append('Next and previous saved lessons autostart offline')
        assert not report['errors'], report['errors']
    except Exception:
        page.screenshot(path=str(out/'failure.png'))
        try:
            print('FAILURE STATE', page.url, frame.evaluate("""()=>({url:location.href,current:window.CBTCourseNative?.current,state:window.CBTCourseNative?.state,error:document.querySelector('#load-error')?.textContent,media:document.querySelector('#media-error')?.textContent,body:document.body.innerText.slice(0,1800)})"""), flush=True)
        except Exception:
            pass
        raise
    finally:
        (out/'continuous.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
        print(json.dumps(report, ensure_ascii=False), flush=True)
        context.close()
        browser.close()
