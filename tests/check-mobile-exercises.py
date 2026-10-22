"""Exercise the trainer using mobile layout, native scroll and actual taps."""
import json
from playwright.sync_api import sync_playwright
from system_browser_support import configure, launch

options, url, out = configure()
report = {'browser': options.browser, 'errors': [], 'viewports': []}


def state(page):
    return page.evaluate('ExercisesView.getState()')


def scroll_to(page, selector):
    # A wheel event scrolls the real containing block. Locator auto-scroll
    # alone also moves overflow:hidden parents and would mask this regression.
    element = page.locator(selector).first
    main = page.locator('#main')
    for _ in range(30):
        rect = element.bounding_box()
        area = main.bounding_box()
        top = max(area['y'], 0) + 2
        bottom = min(area['y'] + area['height'], page.viewport_size['height']) - 2
        if rect and top <= rect['y'] and rect['y'] + rect['height'] <= bottom:
            return element
        dy = 420 if rect and rect['y'] > top else -420
        if options.browser == 'webkit':
            # Playwright cannot synthesize a wheel in mobile WebKit. Scroll
            # only main, never the clipped outer wrapper (as auto-scroll does).
            main.evaluate('(e,dy)=>e.scrollBy(0,dy)', dy)
        else:
            page.mouse.move(area['x'] + 3, min(top + 80, bottom - 3))
            page.mouse.wheel(0, dy)
        page.wait_for_timeout(70)
    raise AssertionError({'unreachable': selector, 'element': element.bounding_box(),
                          'main': main.bounding_box(), 'viewport': page.viewport_size,
                          'scrollTop': main.evaluate('(e)=>e.scrollTop')})


def tap(page, selector):
    element = scroll_to(page, selector)
    element.tap()
    return element


def assert_scroll_container(page):
    dimensions = page.locator('#main').evaluate('''e => {
      const r=e.getBoundingClientRect();
      return {bottom:r.bottom, height:r.height, viewport:innerHeight,
        scrollHeight:e.scrollHeight, clientHeight:e.clientHeight,
        overflow:document.documentElement.scrollWidth>innerWidth};
    }''')
    assert dimensions['bottom'] <= dimensions['viewport'] + 2, dimensions
    assert dimensions['scrollHeight'] > dimensions['clientHeight'] + 500, dimensions
    assert not dimensions['overflow'], dimensions


def perform_step(page):
    before = state(page)
    step = before['current']
    if step.get('checklistEvent') or step['kind'] == 'context':
        tap(page, '[data-ex-confirm]')
    elif step.get('checklist'):
        tap(page, '[data-ex-check-complete]')
    else:
        target = step['target']
        # The visible hotspot must really receive the tap; do not invoke the
        # exercise engine directly or force pointer events through overlays.
        hit = page.locator('#ex-board .hotspot[data-control="' + target + '"]').first
        hit.scroll_into_view_if_needed()
        # Some source drawings have a nonrectangular hotspot whose bounding
        # box centre is outside its clip-path (for example TO/GA).
        point = hit.evaluate('''e => {
          const r=e.getBoundingClientRect(), points=[];
          for(let x=.1;x<1;x+=.1) for(let y=.1;y<1;y+=.1) {
            const px=r.x+r.width*x, py=r.y+r.height*y;
            if(document.elementFromPoint(px,py)===e)
              points.push({x:px,y:py,d:(x-.5)**2+(y-.5)**2});
          }
          return points.sort((a,b)=>a.d-b.d)[0];
        }''')
        assert point, 'No exposed touch target: ' + target
        page.touchscreen.tap(point['x'], point['y'])
        page.locator('.ex-action-dialog').wait_for(state='visible')
        if step['kind'] == 'number':
            page.locator('#ex-number').fill(str(step['value']))
            page.locator('#ex-number-form button').tap()
        else:
            page.locator('[data-ex-answer]').filter(has_text=str(step['value'])).first.tap()
    after = state(page)
    assert after is None or after['cursor'] == before['cursor'] + 1, (before, after)


with sync_playwright() as p:
    browser = launch(p, options.browser, remote=bool(options.url))
    context = browser.new_context(viewport={'width': 390, 'height': 844},
                                  is_mobile=True, has_touch=True)
    page = context.new_page()
    page.on('pageerror', lambda error: report['errors'].append(str(error)))
    page.goto(url + '#exercises', wait_until='networkidle')
    page.wait_for_selector('.ex-card')

    if options.browser == 'chromium':
        # Use real touch input as well as phone-sized layout. Swiping in the
        # main padding must scroll the catalogue, not a hidden ancestor.
        cdp = context.new_cdp_session(page)
        area = page.locator('#main').bounding_box()
        x, y = area['x'] + 4, area['y'] + area['height'] - 50
        cdp.send('Input.dispatchTouchEvent', {'type':'touchStart',
                 'touchPoints':[{'x':x,'y':y,'id':1}]})
        for distance in range(30, 241, 30):
            cdp.send('Input.dispatchTouchEvent', {'type':'touchMove',
                     'touchPoints':[{'x':x,'y':y-distance,'id':1}]})
            page.wait_for_timeout(20)
        cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
        page.wait_for_timeout(250)
        assert page.locator('#main').evaluate('(e)=>e.scrollTop') > 100
        report['nativeTouchSwipeScrollsCatalogue'] = True
        cdp.detach()

    for width, height in [(320, 568), (390, 844), (430, 932), (844, 390), (932, 430)]:
        page.set_viewport_size({'width': width, 'height': height})
        assert_scroll_container(page)
        assert page.locator('.ex-card').count() == 27
        tap(page, '[data-ex-start="power-down"]')
        assert state(page)['current']['phase'] == 'power-down'
        assert page.locator('#main').evaluate('(e)=>e.scrollTop') < 2
        assert page.locator('.ex-run-heading').bounding_box()['y'] >= 0
        tap(page, '[data-ex-exit]')
        report['viewports'].append({'width': width, 'height': height,
                                    'lastProcedureReachable': True, 'startVisible': True})

    page.set_viewport_size({'width': 390, 'height': 844})
    tap(page, '[data-ex-start="before-takeoff"]')
    for _ in range(10):
        if state(page)['current'].get('checklist'):
            break
        perform_step(page)
    assert state(page)['current'].get('checklist')
    perform_step(page)  # Call the checklist.
    cursor = state(page)['cursor']
    tap(page, '[data-ex-check-stop]')
    assert page.locator('.ex-check-paused').is_visible()
    assert state(page)['cursor'] == cursor
    tap(page, '[data-ex-check-complete]')  # Resume without skipping the item.
    assert state(page)['cursor'] == cursor
    for _ in range(8):
        if state(page) is None:
            break
        perform_step(page)
    assert state(page) is None
    assert page.locator('.ex-complete h2').inner_text() == 'Последовательность завершена'
    report['checklistPauseResumeAndCompletion'] = True
    tap(page, '[data-ex-catalog]')

    # Read and Do remains readable even when normal flows are set to memory.
    scroll_to(page, '[data-ex-setting="mode"]').select_option('memory')
    tap(page, '[data-ex-start="power-up"]')
    assert page.locator('[data-ex-document="reference"]').count() == 1
    perform_step(page)
    assert state(page)['cursor'] == 1 and state(page)['errors'] == 0
    report['readAndDoWithRealCockpitAction'] = True
    page.reload(wait_until='networkidle')
    tap(page, '[data-ex-resume]')
    assert state(page)['cursor'] == 1
    assert page.locator('#main').evaluate('(e)=>e.scrollTop') < 2
    report['reloadAndResume'] = True
    tap(page, '[data-ex-exit]')
    tap(page, '[data-ex-start="go-around"]')
    assert state(page)['mode'] == 'memory'
    assert page.locator('[data-ex-hint]').count() == 1
    tap(page, '[data-ex-hint]')
    perform_step(page)
    assert state(page)['cursor'] == 1
    report['memoryHintAndCockpitAction'] = True
    page.screenshot(path=str(out / 'mobile-exercise.png'))
    assert not report['errors'], report
    context.close()
    browser.close()

(out / 'mobile-exercises.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(report, ensure_ascii=False))
