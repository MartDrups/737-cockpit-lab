"""Проверить общие вопросы, продолжение, офлайн и завершение обоих плееров."""
import argparse
import gzip
import json
import os
from pathlib import Path
import shutil
import tempfile
import time

from playwright.sync_api import sync_playwright
from system_browser_support import configure

options, origin, output = configure()
root = Path(__file__).resolve().parents[1]
source = gzip.decompress((root / 'public/cbt-course-data.js.gz').read_bytes()).decode()
course = json.loads(source[source.index('=') + 1:].strip().rstrip(';'))
topics = {t['id']: t for t in course['topics']}
report = {'browser': options.browser, 'origin': origin, 'errors': [], 'checks': []}
bank_id = 'quiz-24101'
parts = [topics[id] for id in next(g for g in course['groups'] if g['id'] == '24101')['topics']
         if topics[id].get('sourceMode') == 'test']


def manifest(id):
    return json.loads(gzip.decompress((root / 'public' / (topics[id]['manifest'] + '.gz')).read_bytes()))


def fixture(data, index=None):
    scenes = data['scenes']
    return {'index': len(scenes) - 1 if index is None else index,
            'visited': [s['id'] for s in scenes],
            'completed': [s['id'] for s in scenes if s.get('exercise') or s.get('transition', {}).get('kind') in ['green-arrow', 'native-options-close']],
            'settings': {'audio': False, 'text': True, 'speed': 'fast'}, 'finished': True}


def watch(page):
    page.on('pageerror', lambda error: report['errors'].append(str(error)))


def open_bank(page):
    page.locator('#cbt-search').fill('Электроснабжение')
    page.locator('[data-cbt-open="' + bank_id + '"]').tap()
    frame = page.locator('.cbt-player-shell iframe').element_handle().content_frame()
    frame.locator('#start-lesson').tap(timeout=90000)
    frame.wait_for_function('window.CBTCourseNative?.current', timeout=60000)
    return frame


def scene_state(frame):
    return frame.evaluate('''() => {
      const engine=CBTCourseNative;
      return {current:engine.current,state:engine.state,scene:engine.lesson.scenes[engine.state.index]};
    }''')


def answer(frame, wrong=False):
    data = scene_state(frame)
    scene = data['scene']
    exercise = scene.get('exercise')
    if not exercise or not exercise.get('supported'):
        return
    frame.wait_for_function('CBTCourseNative.state.exerciseReady', timeout=15000)
    frame.wait_for_function("[...document.querySelectorAll('#scene-layers use')].some(e=>e.getBBox().width>0)", timeout=15000)
    targets = exercise['targets']
    if exercise['kind'] == 'choice':
        chosen = next(t for t in targets if (t['id'] not in exercise['correct']) == wrong)
        frame.locator('#hotspots [data-action="' + chosen['id'] + '"]').tap()
        frame.get_by_role('button', name='Проверить ответ', exact=True).tap()
    elif exercise['kind'] == 'matrix':
        for target in exercise['correct']:
            frame.locator('#hotspots [data-action="' + target + '"]').tap()
        frame.get_by_role('button', name='Проверить ответ', exact=True).tap()
    elif exercise['kind'] == 'multi':
        for target in targets[:exercise.get('required', len(targets))]:
            frame.locator('#hotspots [data-action="' + target['id'] + '"]').tap()
    else:
        chosen = next(t for t in targets if t.get('correct', True))
        frame.locator('#hotspots [data-action="' + chosen['id'] + '"]').tap()


def advance(frame, previous):
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if frame.locator('#lesson-completion-dialog').is_visible():
            return
        data = scene_state(frame)
        if data['current'] != previous:
            return
        if frame.locator('#next').is_enabled():
            frame.locator('#next').tap()
        frame.wait_for_timeout(80)
    raise AssertionError({'didNotAdvance': previous, 'state': scene_state(frame)})


def complete_bank(frame):
    for _ in range(30):
        if frame.locator('#lesson-completion-dialog').is_visible():
            return
        data = scene_state(frame)
        if (data['scene'].get('exercise') or {}).get('supported') and data['current'] not in data['state']['completed']:
            answer(frame)
        advance(frame, data['current'])
    raise AssertionError('Bank did not finish')


def assert_dialog(frame, title):
    modal = frame.locator('#lesson-completion-dialog')
    try:
        modal.wait_for(state='visible', timeout=30000)
    except Exception:
        print('Completion state:', frame.evaluate('''() => ({
          state:window.CBTNative?.state||window.CBTCourseNative?.state,
          status:document.querySelector('#player-state')?.textContent,
          error:document.querySelector('#media-error')?.textContent,
          video:[...document.querySelectorAll('video')].map(v=>({error:v.error?.message,ready:v.readyState,src:v.currentSrc}))
        })'''), flush=True)
        raise
    actual = modal.get_by_role('heading').inner_text()
    assert actual == title, (actual, title)
    dims = modal.evaluate('''e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,w:innerWidth,h:innerHeight}}''')
    assert dims['top'] >= 0 and dims['bottom'] <= dims['h'] + 1, dims
    assert dims['left'] >= 0 and dims['right'] <= dims['w'] + 1, dims


with tempfile.TemporaryDirectory(prefix='737-question-banks-') as profile:
    with sync_playwright() as p:
        launch = {'headless': True, 'viewport': {'width': 1180, 'height': 820},
                  'is_mobile': True, 'has_touch': True, 'ignore_https_errors': False}
        if options.browser == 'chromium':
            launch.update(executable_path=shutil.which('google-chrome') or shutil.which('chromium'), args=['--no-sandbox'])
            report['browserExecutable'] = launch['executable_path'] or 'playwright-chromium'
        if options.url and os.environ.get('HTTPS_PROXY'):
            launch['proxy'] = {'server': os.environ['HTTPS_PROXY']}
        browser_type = getattr(p, options.browser)
        context = browser_type.launch_persistent_context(profile, **launch)
        page = context.pages[0]
        watch(page)
        try:
            page.goto(origin + '#cbt', wait_until='commit')
            page.locator('#cbt-search').wait_for(timeout=120000)
            assert page.locator('.cbt-topic').count() == 419
            assert page.locator('.cbt-question-bank').count() == 54
            assert page.locator('[data-topic="241a011"]').count() == 0
            assert page.locator('[data-topic="241a01i"]').count() == 1
            assert page.locator('[data-topic="241a01a"]').count() == 1
            assert page.locator('[data-topic="fo1d01i"]').count() == 1
            report['checks'].append('54 question banks replace 267 question rows; all lessons and practice stay separate')
            legacy = fixture(manifest('241a011'))
            legacy['comments'] = {'F1.1': 'Старая заметка'}
            page.evaluate('data=>localStorage.setItem("737-cbt-course-241a011",JSON.stringify(data))', legacy)
            frame = open_bank(page)
            state = scene_state(frame)
            assert state['scene']['bankQuestion']['number'] == 2
            assert '241a011::F1.1' in state['state']['completed']
            assert frame.evaluate('localStorage.getItem("737-cbt-course-241a011")') == json.dumps(legacy, ensure_ascii=False, separators=(',', ':'))
            frame.evaluate('window.__questionBankFrame="unchanged"')
            frame.locator('#fullscreen').tap()
            page.wait_for_function('document.documentElement.classList.contains("cbt-fullscreen")')
            assert frame.locator('#scene-counter').inner_text().startswith('Вопрос 2 из 9')
            answer(frame, wrong=True)
            assert scene_state(frame)['current'] not in scene_state(frame)['state']['completed']
            answer(frame)
            advance(frame, state['current'])
            assert frame.evaluate('window.__questionBankFrame') == 'unchanged'
            assert scene_state(frame)['scene']['bankQuestion']['variant'] == 'B'
            answer(frame)
            advance(frame, scene_state(frame)['current']) if scene_state(frame)['scene']['bankQuestion']['number'] == 2 else None
            frame.wait_for_function('CBTCourseNative.lesson.scenes[CBTCourseNative.state.index].bankQuestion.number===3')
            assert frame.evaluate('window.__questionBankFrame') == 'unchanged'
            frame.wait_for_function("[...document.querySelectorAll('#scene-layers use')].some(e=>e.getBBox().width>0)", timeout=15000)
            page.screenshot(path=str(output / 'question-bank-ipad.png'))
            report['checks'].append('Old progress and notes imported; wrong answer rejected; consecutive questions keep the same iframe and fullscreen')
            frame.locator('#fullscreen').tap()
            page.wait_for_function('!document.documentElement.classList.contains("cbt-fullscreen")')
            page.locator('[data-cbt-back]').tap()
            page.reload(wait_until='commit')
            page.locator('#cbt-search').wait_for(timeout=90000)
            page.locator('#cbt-search').fill('Электроснабжение')
            page.locator('[data-cbt-open="' + bank_id + '"]').tap()
            waiting = page.locator('.cbt-player-shell iframe').element_handle().content_frame()
            waiting.locator('#start-lesson').wait_for(timeout=60000)
            page.locator('[data-cbt-back]').tap()
            frame = open_bank(page)
            assert scene_state(frame)['scene']['bankQuestion']['number'] == 3
            page.locator('[data-cbt-back]').tap()
            report['checks'].append('Reload resumes at the current question')
            print(options.browser, 'catalogue, original answers and resume passed', flush=True)

            normal = context.new_page()
            watch(normal)
            normal.goto(origin + 'cbt/course-player.html?lesson=721f17i', wait_until='commit')
            normal.locator('#fullscreen').tap()
            normal.locator('#start-lesson').tap(timeout=60000)
            for _ in range(8):
                if normal.locator('#lesson-completion-dialog').is_visible(): break
                if normal.locator('#next').is_enabled(): normal.locator('#next').tap()
                normal.wait_for_timeout(150)
            assert_dialog(normal, 'Урок завершён')
            normal.screenshot(path=str(output / 'lesson-completed.png'))
            assert normal.evaluate('CBTCourseNative.state.finished')
            normal.close()

            page.evaluate('localStorage.setItem("737-cbt-course-316e17i",JSON.stringify({index:2,settings:{audio:false,speed:"fast"}}))')
            partial = context.new_page()
            watch(partial)
            partial.goto(origin + 'cbt/course-player.html?lesson=316e17i', wait_until='commit')
            partial.locator('#start-lesson').tap(timeout=60000)
            advance(partial, 'F-1.3')
            assert_dialog(partial, 'Есть непройденные сцены')
            assert not partial.evaluate('CBTCourseNative.state.finished')
            partial.locator('[data-completion-resume]').tap()
            assert partial.evaluate('CBTCourseNative.state.index') == 0
            partial.close()
            report['checks'].append('Lesson completion is visible; skipped scenes are not falsely marked complete')

            intro_data = json.loads(gzip.decompress((root / 'public/cbt/lesson.json.gz').read_bytes()))
            saved = fixture(intro_data)
            saved['finished'] = False
            saved['visited'] = saved['visited'][:-1]
            page.evaluate('data=>localStorage.setItem("737-cbt-intro-native-v2",JSON.stringify(data))', saved)
            intro = context.new_page()
            watch(intro)
            intro.bring_to_front()
            intro.goto(origin + 'cbt/player.html', wait_until='commit')
            intro.locator('#fullscreen').tap()
            intro.locator('#start-lesson').tap(timeout=60000)
            assert_dialog(intro, 'Урок завершён')
            intro.close()
            report['checks'].append('Intro player also shows a completion dialog after the final scene')
            print(options.browser, 'both lesson completion dialogs passed', flush=True)

            page.bring_to_front()
            page.locator('#cbt-search').fill('Электроснабжение')
            page.locator('[data-cbt-download="' + bank_id + '"]').tap()
            page.wait_for_function('''async () => {
              const reg=await navigator.serviceWorker.ready;
              const status=await new Promise(resolve=>{const c=new MessageChannel();c.port1.onmessage=e=>resolve(e.data);reg.active.postMessage({type:'CBT_STATUS'},[c.port2])});
              const bank=CBTQuestionBanks.find(CBT_COURSE,'quiz-24101');
              return bank.parts.every(id=>status.lessons[id]?.ready);
            }''', timeout=180000)
            page.wait_for_function('!document.querySelector("[data-cbt-download=quiz-24101]").disabled')
            report['checks'].append('One download action saves all original question packs')
            print(options.browser, 'all question packs saved', flush=True)
            if not options.url:
                context.close()
                if options.browser == 'webkit':
                    options.preview_server.shutdown()
                    options.preview_server.server_close()
                    report['offlineSimulation'] = 'Origin server stopped before cold WebKit restart'
                context = browser_type.launch_persistent_context(profile, **launch)
                if options.browser == 'chromium':
                    context.set_offline(True)
                    report['offlineSimulation'] = 'Network disabled before cold Chromium restart'
            else:
                context.set_offline(True)
                report['offlineSimulation'] = 'Public site: network disabled in the existing browser context'
            page = context.pages[0]
            page.bring_to_front()
            watch(page)
            page.goto(origin + '#cbt', wait_until='commit')
            page.locator('#cbt-search').wait_for(timeout=90000)
            frame = open_bank(page)
            assert scene_state(frame)['scene']['bankQuestion']['number'] == 3
            frame.locator('#fullscreen').tap()
            page.wait_for_function('document.documentElement.classList.contains("cbt-fullscreen")')
            complete_bank(frame)
            assert_dialog(frame, 'Проверка завершена')
            assert frame.evaluate('CBTCourseNative.state.finished')
            page.screenshot(path=str(output / 'question-bank-completed-offline.png'))
            frame.locator('[data-completion-catalog]').tap()
            page.locator('#cbt-search').wait_for()
            assert not page.locator('html').evaluate('e=>e.classList.contains("cbt-fullscreen")')
            assert page.locator('[data-topic="quiz-24101"] .cbt-topic-state').text_content() == '✓ Завершено'
            assert page.evaluate('JSON.parse(localStorage.getItem("737-cbt-course-241a011")).comments["F1.1"]') == 'Старая заметка'
            page.screenshot(path=str(output / 'catalog-completed.png'))
            report['checks'].append(('Cold offline' if not options.url else 'Offline')+' resume, remaining real answers, completion and return to catalogue work')
            report['version'] = page.evaluate('''async () => {
              const reg=await navigator.serviceWorker.ready;
              return await new Promise(resolve=>{const c=new MessageChannel();c.port1.onmessage=e=>resolve(e.data.status.version);reg.active.postMessage({type:'GET_STATUS'},[c.port2])});
            }''')
            assert report['version'] == json.loads((root / 'public/offline-assets.json').read_text())['version']
            assert not report['errors'], report['errors']
        except Exception:
            page.screenshot(path=str(output / 'failure.png'), full_page=True)
            raise
        finally:
            (output / 'questions.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
            print(json.dumps(report, ensure_ascii=False), flush=True)
            context.close()
