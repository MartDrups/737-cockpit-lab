'use strict';
(() => {
  const screen=document.getElementById('screen-scroll'),size=document.getElementById('screen-size'),stage=document.getElementById('stage');
  const below=['caption','instruction','scene-note','exercise-actions','lesson-progress'];
  let zoom=1,queued=false;
  function outerHeight(element){
    if(!element||!element.getClientRects().length)return 0;
    const style=getComputedStyle(element);
    return element.getBoundingClientRect().height+parseFloat(style.marginTop||0)+parseFloat(style.marginBottom||0);
  }
  function fit(value=zoom){
    zoom=value;
    if(!screen.clientWidth)return;
    const viewport=window.visualViewport?.height||innerHeight;
    const layout=document.querySelector('.scene-layout'),side=getComputedStyle(layout).display==='grid';
    const footer=side?0:below.reduce((total,id)=>total+outerHeight(document.getElementById(id)),0)+outerHeight(document.querySelector('.playback-navigation'));
    const available=Math.max(48,viewport-screen.getBoundingClientRect().top-footer-8);
    layout.style.height=side?available+'px':'';
    const scale=Math.min(screen.clientWidth/1024,available/768,1)*zoom;
    screen.style.maxHeight=available+'px';
    size.style.width=1024*scale+'px';size.style.height=768*scale+'px';
    stage.style.transform=`scale(${scale})`;
  }
  function schedule(){if(!queued){queued=true;requestAnimationFrame(()=>{queued=false;fit()})}}
  const observer=new ResizeObserver(schedule);
  // Observe the controls and captions, not the scaled stage: it must not resize itself in a loop.
  for(const element of [document.body,document.querySelector('.player-toolbar'),document.querySelector('.lesson-controls'),document.querySelector('.playback-navigation'),...below.map(id=>document.getElementById(id))])if(element)observer.observe(element);
  addEventListener('resize',schedule);window.visualViewport?.addEventListener('resize',schedule);

  let expanded=false,savedScroll=[0,0];
  const fullButton=document.getElementById('fullscreen');
  function expandedState(active){
    if(active===expanded)return;
    if(active)savedScroll=[scrollX,scrollY];
    expanded=active;
    document.documentElement.classList.toggle('player-expanded',active);
    fullButton.textContent=active?'Свернуть':'На весь экран';
    fullButton.setAttribute('aria-pressed',String(active));
    if(active)scrollTo(0,0);
    schedule();
    if(!active)requestAnimationFrame(()=>scrollTo(...savedScroll));
  }
  function fullscreen(action='toggle'){
    if(parent!==window){parent.postMessage({type:'CBT_FULLSCREEN',action},location.origin);return;}
    expandedState(action==='exit'?false:!expanded);
  }
  fullButton.setAttribute('aria-pressed','false');
  addEventListener('message',event=>{
    if(event.origin===location.origin&&event.source===parent&&event.data?.type==='CBT_FULLSCREEN_STATE')expandedState(!!event.data.active);
  });
  addEventListener('keydown',event=>{
    if(event.key==='Escape'&&expanded&&!document.querySelector('dialog[open]')){
      event.preventDefault();fullscreen('exit');
    }
  });
  if(parent!==window)parent.postMessage({type:'CBT_FULLSCREEN',action:'state'},location.origin);
  window.CBTPlayerLayout={fit,fullscreen};
})();
