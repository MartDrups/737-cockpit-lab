"""Compare every lossless course movie frame with its source atlas in-browser."""
import gzip
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
from system_browser_support import configure, launch

ROOT = Path(__file__).resolve().parents[1]
args, origin, out = configure()
movies = {}


def walk(value):
    if isinstance(value, list):
        for child in value:
            walk(child)
    elif isinstance(value, dict):
        if isinstance(value.get('movie'), dict):
            movies[json.dumps(value['movie'], sort_keys=True)] = value['movie']
        for child in value.values():
            walk(child)


for path in (ROOT / 'public/cbt/course/lessons').glob('*.json.gz'):
    walk(json.loads(gzip.decompress(path.read_bytes())))

with sync_playwright() as p:
    browser = launch(p, args.browser, remote=bool(args.url))
    page = browser.new_page()
    page.goto(origin + 'cbt/course-player.html?lesson=222c17i', wait_until='commit')
    page.wait_for_function('window.CBTMovie', timeout=90000)
    report = page.evaluate('''async ({movies,origin}) => {
      const images=new Map(),atlases=new Map(),failures=[];
      for(const m of movies)for(const a of m.atlases)atlases.set(JSON.stringify(a),a);
      for(const a of atlases.values())if(!images.has(a.file)){
        const image=new Image();image.src=new URL(a.file,origin);
        await image.decode();images.set(a.file,image);
      }
      const NativeImage=Image,loading=[];
      window.Image=class extends NativeImage {
        constructor(){super();loading.push(new Promise((resolve,reject)=>{
          this.addEventListener('load',resolve,{once:true});
          this.addEventListener('error',reject,{once:true});
        }))}
      };
      const now=performance.now.bind(performance);
      // Keep source frame selection exact even for the original 1000-fps icons.
      performance.now=()=>100000;
      let frames=0,playbackChecks=0;
      const url=file=>new URL(file,origin).href;
      async function verify(movie,initial,expected,label){
        const canvas=document.createElement('canvas');
        let failed=false;
        const c=CBTMovie.create(canvas,movie,url,()=>{failed=true},initial);c.pause();
        await Promise.all(loading.splice(0));await new Promise(resolve=>setTimeout(resolve,0));
        if(failed||c.frame!==expected){failures.push({label,expected,actual:c.frame,loadFailed:failed});c.stop();return}
        const reference=document.createElement('canvas');reference.width=movie.width;reference.height=movie.height;
        const ctx=reference.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingEnabled=false;
        if(expected>=0){
          const a=movie.atlases.find(a=>expected>=a.startFrame&&expected<a.startFrame+a.frameCount);
          if(!a){failures.push({label,missingFrame:expected});c.stop();return}
          const offset=expected-a.startFrame;
          ctx.drawImage(images.get(a.file),offset%a.columns*a.sourceFrameWidth,Math.floor(offset/a.columns)*a.sourceFrameHeight,
            a.sourceFrameWidth,a.sourceFrameHeight,0,0,movie.width,movie.height);
        }
        const got=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,movie.width,movie.height).data;
        const want=ctx.getImageData(0,0,movie.width,movie.height).data;
        for(let i=0;i<got.length;i++)if(got[i]!==want[i]){failures.push({label,byte:i,actual:got[i],expected:want[i]});break}
        c.stop();
      }
      try{
        for(const a of atlases.values())for(let index=a.startFrame;index<a.startFrame+a.frameCount;index++){
          const m={width:a.sourceFrameWidth,height:a.sourceFrameHeight,atlases:[a],firstFrame:index,lastFrame:index,fps:1,loopCount:1,exactParameters:true};
          await verify(m,undefined,index,a.file+'#'+index);frames++;
        }
        for(const [n,m]of movies.entries()){
          if(!m.exactParameters){await verify(m,undefined,m.firstFrame??-1,'unproved-'+n);playbackChecks++;continue}
          const count=Math.abs(m.lastFrame-m.firstFrame)+1,direction=m.lastFrame>=m.firstFrame?1:-1;
          const end=m.loopCount>0?count*m.loopCount:count*3;
          for(const step of new Set([0,Math.floor(count/2),count-1,count,end,end+1])){
            const expected=m.loopCount>0&&step>=end?m.lastFrame:m.firstFrame+direction*(step%count);
            await verify(m,{elapsed:(step+.125)/m.fps*1000},expected,'playback-'+n+'@'+step);playbackChecks++;
          }
        }
      }finally{window.Image=NativeImage;performance.now=now}
      return {movieDefinitions:movies.length,atlasLayouts:atlases.size,frames,playbackChecks,failures};
    }''', {'movies': list(movies.values()), 'origin': origin})
    report['browser'] = args.browser
    (out / 'movie-frames.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({**report, 'failures': len(report['failures']), 'firstFailures': report['failures'][:3]}, ensure_ascii=False))
    browser.close()
    assert not report['failures'], report['failures'][:10]
