import json
from pathlib import Path
from playwright.sync_api import sync_playwright

from system_browser_support import configure, launch
options, url, out = configure()
repo=Path(__file__).resolve().parents[1]
extras=json.loads((repo/'src/system-reading/extra-diagrams.json').read_text())
plans=json.loads((repo/'src/system-reading/sections.json').read_text())
report={'figures':[],'errors':[]}
with sync_playwright() as p:
    browser=launch(p,options.browser,remote=bool(options.url))
    context=browser.new_context(viewport={'width':1280,'height':1000})
    page=context.new_page()
    page.on('pageerror',lambda e:report['errors'].append(str(e)))
    page.goto(url+'#systems/hydraulics',wait_until='networkidle')
    page.wait_for_function('window.CockpitLab')
    for did,extra in extras.items():
        system=extra['system']
        section=next(s for s,ds in plans[system].items() if did in ds)
        page.evaluate('(id)=>CockpitLab.showSystem(id)',system)
        figure=page.locator('#system-figure-'+section)
        figure.scroll_into_view_if_needed()
        figure.locator('[data-expand-system-figure]').click()
        dialog=page.locator('.system-figure-dialog')
        select=dialog.locator('[data-diagram-select]')
        if select.count():select.select_option(did)
        image=dialog.locator('.system-original')
        image.evaluate('(img)=>img.decode()')
        row={'id':did,'checked':[],'unclickable':[]}
        for node in extra['diagram']['nodes']:
            dialog.locator('[data-system-zoom="fit"]').click()
            page.wait_for_timeout(30)
            point=page.evaluate('''(id)=>{
              const viewport=document.querySelector('.system-figure-dialog .system-viewport').getBoundingClientRect();
              const buttons=[...document.querySelectorAll('.system-figure-dialog .system-node')].filter(b=>b.dataset.systemNode===id);
              for(const button of buttons){
                const r=button.getBoundingClientRect();
                for(const fx of [.5,.2,.8])for(const fy of [.5,.2,.8]){
                  const x=r.x+r.width*fx,y=r.y+r.height*fy;
                  if(x<viewport.left||x>viewport.right||y<viewport.top||y>viewport.bottom)continue;
                  if(document.elementFromPoint(x,y)?.closest('[data-system-node]')?.dataset.systemNode===id)return {x,y};
                }
              }
              return null;
            }''',node['id'])
            if not point:
                row['unclickable'].append(node['id'])
                continue
            page.mouse.click(point['x'],point['y'])
            assert node['name'] in dialog.locator('.reading-node-selection>strong').inner_text(),(did,node['id'])
            assert node['body'][0] in dialog.locator('.reading-node-explanation').inner_text(),(did,node['id'])
            row['checked'].append(node['id'])
        page.screenshot(path=str(out/('new-'+did+'.png')))
        page.keyboard.press('Escape')
        report['figures'].append(row)
    browser.close()
(out/'new-node-checks.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False))
assert not report['errors']
assert all(not row['unclickable'] for row in report['figures'])
