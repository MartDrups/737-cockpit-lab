"""Проверить разворачивание CBT с управлением и текстом без Fullscreen API."""
import argparse
import functools
import gzip
import http.server
import json
import threading
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = '/737-cockpit-lab/'
ap = argparse.ArgumentParser()
ap.add_argument('--browser', choices=['chromium', 'webkit'], required=True)
ap.add_argument('--origin')
ap.add_argument('--expect-bug', action='store_true')
ap.add_argument('--out', type=Path, default=ROOT / 'artifacts/cbt-fullscreen')
args = ap.parse_args()
args.out.mkdir(parents=True, exist_ok=True)


class Static(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *values, **kw):
        super().__init__(*values, directory=str(ROOT / 'public'), **kw)

    def translate_path(self, path):
        parsed = urlsplit(path).path
        if parsed.startswith(BASE):
            parsed = '/' + parsed[len(BASE):]
        target = super().translate_path(parsed)
        if not Path(target).is_file() and Path(target + '.html').is_file():
            return target + '.html'
        return target

    def log_message(self, *values):
        pass


server = None
if args.origin:
    origin = args.origin.rstrip('/') + '/'
else:
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Static)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = 'http://127.0.0.1:' + str(server.server_port) + BASE

report = {'browser': args.browser, 'origin': origin, 'errors': [], 'checks': []}
expected_version = json.loads((ROOT / 'public/offline-assets.json').read_text())['version']


def watch(page):
    page.on('pageerror', lambda error: report['errors'].append(str(error)))


def open_lesson(page, intro=False):
    page.locator('#cbt-search').fill('' if intro else 'Electrical System Overview')
    lesson = 'intro' if intro else page.evaluate("CBT_COURSE.topics.find(t=>t.title==='Electrical System Overview').id")
    page.locator('[data-cbt-open="' + lesson + '"]').click()
    iframe = page.locator('.cbt-player-shell iframe')
    frame = iframe.element_handle().content_frame()
    frame.locator('#start-lesson').click(timeout=90000)
    engine = 'CBTNative' if intro else 'CBTCourseNative'
    frame.wait_for_function('name=>window[name]?.current', arg=engine, timeout=60000)
    if not intro:
        frame.evaluate('CBTCourseNative.goTo(CBTCourseNative.lesson.scenes[3].id)')
    if not frame.evaluate('name=>window[name].state.paused', engine):
        frame.locator('#pause').click()
    frame.evaluate("window.__fullscreenIdentity='same-lesson-document'")
    return iframe, frame, engine


def full_bounds(page, iframe):
    box = iframe.bounding_box()
    view = page.viewport_size
    assert abs(box['x']) <= 2 and abs(box['y']) <= 2, box
    assert abs(box['width'] - view['width']) <= 2, (box, view)
    assert abs(box['height'] - view['height']) <= 2, (box, view)


def visible_controls(frame):
    sizes = frame.evaluate("""() => {
      const rect = e => {const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
      return {viewport:{width:innerWidth,height:innerHeight},
        toolbar:rect(document.querySelector('.player-toolbar')),
        controls:rect(document.querySelector('.lesson-controls')),
        text:rect(document.querySelector('.scene-info')),
        caption:rect(document.querySelector('#caption')),
        screen:rect(document.querySelector('#screen-scroll')),
        overflow:document.documentElement.scrollWidth>innerWidth};
    }""")
    assert sizes['toolbar']['y'] >= -1 and sizes['toolbar']['bottom'] < sizes['viewport']['height'], sizes
    assert sizes['controls']['bottom'] < sizes['viewport']['height'], sizes
    assert sizes['text']['width'] > 150 and sizes['text']['height'] > 40, sizes
    assert sizes['text']['y'] < sizes['viewport']['height'], sizes
    assert sizes['caption']['y'] < sizes['viewport']['height'], sizes
    assert sizes['screen']['width'] > 100 and sizes['screen']['height'] > 40, sizes
    assert not sizes['overflow'], sizes
    frame.locator('#pause').wait_for(state='visible')
    frame.locator('#text-toggle').wait_for(state='visible')
    frame.locator('#caption').wait_for(state='visible')
    return sizes


def same_lesson(frame, engine, before):
    assert frame.evaluate('window.__fullscreenIdentity') == 'same-lesson-document'
    after = frame.evaluate('name=>({current:window[name].current,index:window[name].state.index})', engine)
    assert after == before, (before, after)


with sync_playwright() as p:
    browser = getattr(p, args.browser).launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1180, 'height': 820},
                              is_mobile=True, has_touch=True, device_scale_factor=1,
                              ignore_https_errors=False)
    ctx.add_init_script("""(() => {
      Object.defineProperty(Element.prototype,'requestFullscreen',{configurable:true,value:undefined});
      Object.defineProperty(Element.prototype,'webkitRequestFullscreen',{configurable:true,value:undefined});
    })()""")
    page = ctx.new_page()
    watch(page)
    try:
        page.goto(origin + '#cbt', wait_until='commit')
        page.locator('#cbt-search').wait_for(timeout=120000)
        expected = page.evaluate("window.CBTQuestionBanks?CBT_COURSE.groups.flatMap(g=>CBTQuestionBanks.entries(CBT_COURSE,g)).length:CBT_COURSE.topics.length")
        assert page.locator('.cbt-topic').count() == expected
        iframe, frame, engine = open_lesson(page)
        before = frame.evaluate('name=>({current:window[name].current,index:window[name].state.index})', engine)
        old_box = iframe.bounding_box()
        frame.locator('#fullscreen').tap()
        if args.expect_bug:
            page.wait_for_timeout(500)
            current = iframe.bounding_box()
            assert abs(current['width'] - old_box['width']) < 2
            assert current['width'] < page.viewport_size['width'] - 80
            report['regressionReproduced'] = True
            page.screenshot(path=str(args.out / 'before-webkit.png'))
        else:
            page.wait_for_function("document.documentElement.classList.contains('cbt-fullscreen')")
            frame.wait_for_function("document.documentElement.classList.contains('player-expanded')")
            page.wait_for_timeout(200)
            full_bounds(page, iframe)
            assert frame.locator('#fullscreen').get_attribute('aria-pressed') == 'true'
            assert frame.locator('#fullscreen').inner_text() == 'Свернуть'
            visible_controls(frame)
            same_lesson(frame, engine, before)
            assert iframe.bounding_box()['width'] > old_box['width'] + 100
            page.screenshot(path=str(args.out / (args.browser + '-ipad-landscape.png')))
            report['checks'].append('iPad landscape: entire viewport, upper controls and text, same live lesson')

            frame.locator('#options-open').tap()
            frame.locator('#options-dialog').wait_for(state='visible')
            frame.locator('#options-dialog [data-close-dialog]').first.press('Escape')
            frame.locator('#options-dialog').wait_for(state='hidden')
            assert page.locator('html').evaluate("e=>e.classList.contains('cbt-fullscreen')")
            frame.locator('#text-toggle').tap()
            assert frame.locator('#text-toggle').get_attribute('aria-pressed') == 'false'
            frame.locator('#text-toggle').tap()
            assert frame.locator('#text-toggle').get_attribute('aria-pressed') == 'true'
            report['checks'].append('Settings and text controls remain usable; closing a dialog keeps fullscreen')

            for width, height in [(820, 1180), (390, 844), (1180, 820)]:
                page.set_viewport_size({'width': width, 'height': height})
                page.wait_for_timeout(250)
                full_bounds(page, iframe)
                visible_controls(frame)
                same_lesson(frame, engine, before)
                page.screenshot(path=str(args.out / (args.browser + '-' + str(width) + 'x' + str(height) + '.png')))
            report['checks'].append('Orientation and phone resizing retain graphics, text and controls')

            frame.locator('#fullscreen').press('Escape')
            page.wait_for_function("!document.documentElement.classList.contains('cbt-fullscreen')")
            frame.locator('#fullscreen').tap()
            page.wait_for_function("document.documentElement.classList.contains('cbt-fullscreen')")
            frame.locator('#fullscreen').tap()
            page.wait_for_function("!document.documentElement.classList.contains('cbt-fullscreen')")
            same_lesson(frame, engine, before)
            report['checks'].append('Escape and repeated button toggles restore the lesson without resetting it')

            ctx.set_offline(True)
            frame.locator('#fullscreen').tap()
            page.wait_for_function("document.documentElement.classList.contains('cbt-fullscreen')")
            full_bounds(page, iframe)
            frame.locator('#fullscreen').tap()
            page.wait_for_function("!document.documentElement.classList.contains('cbt-fullscreen')")
            ctx.set_offline(False)
            report['checks'].append('Fullscreen works without a network connection')

            page.locator('[data-cbt-back]').tap()
            iframe, frame, engine = open_lesson(page, intro=True)
            before = frame.evaluate('name=>({current:window[name].current,index:window[name].state.index})', engine)
            frame.locator('#fullscreen').tap()
            page.wait_for_function("document.documentElement.classList.contains('cbt-fullscreen')")
            full_bounds(page, iframe)
            visible_controls(frame)
            same_lesson(frame, engine, before)
            page.screenshot(path=str(args.out / (args.browser + '-intro-fullscreen.png')))
            page.evaluate("""document.querySelector('#primary-nav [data-view="systems"]').click()""")
            page.wait_for_function("!document.documentElement.classList.contains('cbt-fullscreen')")
            report['checks'].append('Intro player expands too; leaving CBT removes the fullscreen lock')

            standalone = ctx.new_page()
            watch(standalone)
            standalone.goto(origin + 'cbt/course-player.html?lesson=301e17i', wait_until='commit')
            standalone.locator('#start-lesson').click(timeout=90000)
            standalone.locator('#fullscreen').tap()
            standalone.wait_for_function("document.documentElement.classList.contains('player-expanded')")
            visible_controls(standalone)
            standalone.locator('#fullscreen').press('Escape')
            standalone.wait_for_function("!document.documentElement.classList.contains('player-expanded')")
            standalone.close()
            report['checks'].append('Direct player link supports the same controls without the browser Fullscreen API')
            version = page.evaluate("""async () => {
              const r=await navigator.serviceWorker.ready;
              return await new Promise((resolve,reject)=>{
                const c=new MessageChannel(),t=setTimeout(()=>reject(Error('worker status timeout')),15000);
                c.port1.onmessage=e=>{clearTimeout(t);resolve(e.data.status.version)};
                r.active.postMessage({type:'GET_STATUS'},[c.port2]);
              });
            }""")
            assert version == expected_version, (version, expected_version)
            report['version'] = version
            assert not report['errors'], report['errors']
    except Exception:
        page.screenshot(path=str(args.out / (args.browser + '-failure.png')), full_page=True)
        raise
    finally:
        (args.out / (('baseline-' if args.expect_bug else '') + args.browser + '.json')).write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps(report, ensure_ascii=False), flush=True)
        ctx.close()
        browser.close()
        if server:
            server.shutdown()
