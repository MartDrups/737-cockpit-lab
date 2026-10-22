import json
from pathlib import Path
from playwright.sync_api import sync_playwright

from system_browser_support import configure, launch
options, url, out = configure()
report = {'errors': [], 'systems': []}
with sync_playwright() as p:
    browser = launch(p, options.browser)
    context = browser.new_context(viewport={'width':1280,'height':900})
    page = context.new_page()
    page.on('pageerror', lambda error: report['errors'].append(str(error)))
    page.goto(url+'#systems/hydraulics',wait_until='networkidle')
    page.wait_for_function('window.CockpitLab && document.querySelector(".system-reading-section")',timeout=60000)
    page.screenshot(path=str(out/'desktop-initial.png'))
    for system in page.evaluate('Object.keys(FCOM_SYSTEM_REFERENCE.systems)'):
        page.evaluate('(id)=>CockpitLab.showSystem(id)',system)
        result=page.evaluate('''() => {
          const id = location.hash.split('/')[1], source = FCOM_SYSTEM_REFERENCE.systems[id];
          const badText = source.sections.filter(s => {
            const actual = [...document.querySelectorAll('#system-section-'+s.id+' .system-section-text>p')].map(p=>p.textContent);
            return JSON.stringify(actual)!==JSON.stringify(s.body);
          }).map(s=>s.id);
          const badLinks = [...document.querySelectorAll('[data-system-term]')].filter(a=>{
            const diagram=FCOM_SYSTEM_REFERENCE.diagrams[a.dataset.targetDiagram];
            return !diagram || !a.dataset.targetNodes.split('|').every(id=>diagram.nodes.some(n=>n.id===id));
          }).map(a=>a.textContent);
          return {id,sections:source.sections.length,figures:document.querySelectorAll('[data-section-figure]').length,
            links:document.querySelectorAll('[data-system-term]').length,badText,badLinks,
            overflow:document.documentElement.scrollWidth>innerWidth};
        }''')
        assert not result['badText'] and not result['badLinks'] and not result['overflow'],result
        report['systems'].append(result)
    page.evaluate("CockpitLab.showSystem('hydraulics')")
    term=page.locator('#system-section-pumps [data-system-term]').filter(has_text='ENG 2').first
    term.scroll_into_view_if_needed()
    before=page.locator('#main').evaluate('(e)=>e.scrollTop')
    term.click()
    assert not page.locator('.system-figure-dialog').evaluate('(e)=>e.open')
    assert page.locator('#system-figure-pumps [data-system-node="pump-b-edp"]').first.get_attribute('aria-pressed')=='true'
    assert abs(page.locator('#main').evaluate('(e)=>e.scrollTop')-before)<2
    assert page.locator('#system-figure-pumps .reading-node-explanation').inner_text()
    page.screenshot(path=str(out/'desktop-pumps.png'))
    report['desktopTermPreservesReadingPosition']=True
    page.set_viewport_size({'width':390,'height':844})
    term.scroll_into_view_if_needed()
    before=page.locator('#main').evaluate('(e)=>e.scrollTop')
    term.click()
    assert page.locator('.system-figure-dialog').evaluate('(e)=>e.open')
    assert page.locator('.system-figure-dialog [data-system-node="pump-b-edp"]').first.get_attribute('aria-pressed')=='true'
    page.screenshot(path=str(out/'mobile-selected.png'))
    page.keyboard.press('Escape')
    assert not page.locator('.system-figure-dialog').evaluate('(e)=>e.open')
    assert abs(page.locator('#main').evaluate('(e)=>e.scrollTop')-before)<2
    assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
    report['mobileModalAndReturn']=True
    page.set_viewport_size({'width':1024,'height':768})
    page.evaluate("CockpitLab.showSystem('electric')")
    page.locator('#system-section-monitoring').scroll_into_view_if_needed()
    page.wait_for_timeout(200)
    page.screenshot(path=str(out/'tablet-monitoring.png'))
    page.locator('#system-section-monitoring [data-expand-system-figure]').click()
    page.locator('.system-figure-dialog [data-system-node="drive-light"]').first.click()
    assert 'низкое давление масла' in page.locator('.system-figure-dialog .reading-node-explanation').inner_text()
    page.screenshot(path=str(out/'tablet-drive.png'))
    page.keyboard.press('Escape')
    report['newFigureDirectClickExplained']=True
    assert not report['errors'],report['errors']
    context.close()
    browser.close()
(out/'reading-checks.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False))
