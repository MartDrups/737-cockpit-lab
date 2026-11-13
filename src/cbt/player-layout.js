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
  if(parent===window&&new URLSearchParams(location.search).get('expanded')==='1')expandedState(true);
  let navigationState=null,navigationBar=null;
  function navigateLesson(direction){
    const destination=navigationState?.[direction];
    if(!destination)return;
    const engine=window.CBTCourseNative||window.CBTNative;
    window.CBTNavigation.handoff(destination.id,engine?.state.settings);
    if(parent!==window)parent.postMessage({type:'CBT_NAVIGATE_LESSON',direction,currentId:navigationState.currentId},location.origin);
    else{
      const nextURL=new URL('../'+window.CBTNavigation.playerURL(destination.id,true),location.href);
      if(expanded)nextURL.searchParams.set('expanded','1');
      location.assign(nextURL);
    }
  }
  function navigation(state){
    navigationState=state;
    if(!state){if(navigationBar)navigationBar.hidden=true;return}
    if(!navigationBar){
      navigationBar=document.createElement('nav');navigationBar.id='lesson-sequence';navigationBar.className='lesson-sequence';
      navigationBar.setAttribute('aria-label','Уроки текущей системы');
      navigationBar.innerHTML='<p data-sequence-position></p><button id="previous-lesson">← Предыдущий урок</button><button id="next-lesson">Следующий урок →</button>';
      document.querySelector('.player-toolbar').after(navigationBar);observer.observe(navigationBar);
      navigationBar.querySelector('#previous-lesson').onclick=()=>navigateLesson('previous');
      navigationBar.querySelector('#next-lesson').onclick=()=>navigateLesson('next');
    }
    navigationBar.hidden=false;
    navigationBar.querySelector('[data-sequence-position]').textContent=state.groupTitle+' · '+state.index+' / '+state.total;
    for(const [id,direction,label]of [['previous-lesson','previous','Предыдущий урок'],['next-lesson','next','Следующий урок']]){
      const button=navigationBar.querySelector('#'+id),item=state[direction];
      button.disabled=!item;button.title=item?item.title:direction==='next'?'Последний урок этой системы':'Первый урок этой системы';
      button.setAttribute('aria-label',item?label+': '+item.title:button.title);
      button.textContent=item?(direction==='next'?'Далее: '+item.title+' →':'← Предыдущий урок'):direction==='next'?'Последний урок системы':'Первый урок системы';
    }
    updateCompletionNext();schedule();
  }
  if(parent!==window){
    addEventListener('message',event=>{
      if(event.origin===location.origin&&event.source===parent&&event.data?.type==='CBT_SEQUENCE_STATE')navigation(event.data.state);
    });
    parent.postMessage({type:'CBT_SEQUENCE_READY'},location.origin);
  }
  let completionDialog;
  function updateCompletionNext(){
    const button=completionDialog?.querySelector('[data-completion-next]');if(!button)return;
    button.hidden=!navigationState?.next;
    button.textContent=navigationState?.next?'Следующий урок: '+navigationState.next.title+' →':'Следующий урок';
    button.onclick=()=>{dismissCompletion();navigateLesson('next')};
  }
  function dismissCompletion(){if(completionDialog?.open)completionDialog.close()}
  function complete({title,detail,repeat,resume}){
    if(!completionDialog){
      completionDialog=document.createElement('dialog');
      completionDialog.id='lesson-completion-dialog';completionDialog.className='lesson-completion-dialog';
      completionDialog.setAttribute('aria-labelledby','lesson-completion-title');
      completionDialog.innerHTML='<p class="lesson-completion-mark" aria-hidden="true">✓</p><h2 id="lesson-completion-title"></h2><p data-completion-detail></p><div class="dialog-actions"><button data-completion-resume class="primary">Продолжить</button><button data-completion-next class="primary" hidden>Следующий урок →</button><button data-completion-catalog class="primary">К урокам</button><button data-completion-repeat>Повторить</button></div>';
      document.body.append(completionDialog);
    }
    completionDialog.querySelector('h2').textContent=title;
    completionDialog.querySelector('[data-completion-detail]').textContent=detail;
    completionDialog.querySelector('.lesson-completion-mark').textContent=resume?'…':'✓';
    const next=completionDialog.querySelector('[data-completion-resume]');next.hidden=!resume;
    next.onclick=()=>{dismissCompletion();resume?.()};
    completionDialog.querySelector('[data-completion-repeat]').onclick=()=>{dismissCompletion();repeat()};
    completionDialog.querySelector('[data-completion-catalog]').onclick=()=>{
      dismissCompletion();
      if(parent!==window)parent.postMessage({type:'CBT_RETURN_TO_CATALOG'},location.origin);
      else location.assign(new URL('../',location.href).href+'#cbt');
    };
    updateCompletionNext();
    if(!completionDialog.open)completionDialog.showModal();
  }
  window.CBTPlayerLayout={fit,fullscreen,complete,dismissCompletion,navigation};
})();
