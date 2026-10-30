'use strict';
(() => {
 const $=id=>document.getElementById(id),audio=$('narration'),root=new URL('../',location.href);
 const banks=window.CBTQuestionBanks;
 const item=banks.find(window.CBT_COURSE,new URLSearchParams(location.search).get('lesson'));
 const spriteSession=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
 const url=path=>new URL(path,root).href,escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let lesson,scene,index=0,token=0,started=false,paused=false,blocked=false,heard=false,zoom=1,clipIndex=0,timer=null,remaining=0,timerAt=0,scheduled=null,startTime=0,pauseTime=0,dialogPaused=false;
 let saved={};const storage='737-cbt-course-'+(item?.id||'unknown');try{saved=JSON.parse(localStorage.getItem(storage)||'{}')}catch{}
 const settings={audio:true,text:true,speed:'normal',...saved.settings},visited=new Set(saved.visited||[]),completed=new Set(saved.completed||[]),comments=saved.comments||{};
 let selected=new Set(),operationTimers=[],movieControllers=new Map(),appliedOperations=new Set(),feedbackActive=false,queuedOperations=[],postStarted=false;
 let sequenceIndex=0,waitingForAudio=false,waitingForUser=false,sequenceDone=false,activeClip=null,audioActive=false,voiceTimer=null,voiceRemaining=0,voiceAt=0,exerciseReady=false,audioGateDelay=0,renderPending=false,renderResume=false;
 const state=text=>$('player-state').textContent=text;
 const persist=()=>{try{localStorage.setItem(storage,JSON.stringify({index,visited:[...visited],completed:[...completed],settings,comments,finished:!!saved.finished,movies:Object.fromEntries([...movieControllers].map(([id,m])=>[id,m.snapshot]))}))}catch{}};
 function fit(){window.CBTPlayerLayout.fit(zoom)}
 function clear(keep=new Set()){clearTimeout(timer);clearTimeout(voiceTimer);voiceTimer=null;timer=null;scheduled=null;remaining=0;operationTimers.forEach(clearTimeout);operationTimers=[];audio.pause();audioActive=false;$('effect').pause();feedbackActive=false;movieControllers.forEach((m,id)=>{if(!keep.has(id)){m.stop();movieControllers.delete(id)}});document.querySelectorAll('#scene-layers video').forEach(v=>v.pause())}
 function schedule(ms,run){clearTimeout(timer);remaining=ms;scheduled=run;timerAt=performance.now();timer=setTimeout(()=>{timer=null;if(!paused&&!blocked)run()},ms)}
 function labels(){
  $('audio-toggle').textContent=settings.audio?'Звук включён':'Звук выключен';$('audio-toggle').setAttribute('aria-pressed',String(settings.audio));$('text-toggle').textContent=settings.text?'Текст включён':'Текст выключен';$('text-toggle').setAttribute('aria-pressed',String(settings.text));
  $('caption').textContent=settings.text?scene?.text||'':'';$('source-caption').textContent=settings.text?scene?.text||'':'';$('source-caption').classList.toggle('off',!settings.text);
 }
 function error(text){blocked=true;clear();$('media-error').textContent=text;$('media-error').hidden=false;state('Материал не загружен')}
 function rect(element,r){element.style.left=r.x+'px';element.style.top=r.y+'px';element.style.width=r.w+'px';element.style.height=r.h+'px'}
 function draw(actor,carried,replace=false){
  if(carried){rect(carried,actor.rect);$('scene-layers').append(carried);return}
  const existing=$('scene-layers').querySelector('[data-actor="'+actor.id+'"]'),anchor=replace?existing?.nextSibling:null;existing?.remove();
  movieControllers.get(actor.id)?.stop();movieControllers.delete(actor.id);
  const current=token,fail=()=>{if(current===token||image?.isConnected&&$('scene-layers').querySelector('[data-actor="'+actor.id+'"]')===image)error('Не удалось открыть графику сцены. Завершите сохранение урока или повторите с интернетом.')};
  let image;
  if(actor.composition){image=document.createElement('canvas')}
  else if(actor.symbol){
   image=document.createElementNS('http://www.w3.org/2000/svg','svg');image.setAttribute('viewBox',actor.viewBox);image.setAttribute('preserveAspectRatio','none');
   const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href',url(actor.file)+(item.questionBank?'?cbt-view='+spriteSession+'-'+current:'')+'#'+actor.symbol);
   // A symbol creates its own viewport. Place that viewport at the original
   // PIG origin so the parent's viewBox does not translate artwork twice.
   const [x,y,w,h]=actor.viewBox.split(/\s+/).map(Number);for(const [key,value] of Object.entries({x,y,width:w,height:h}))use.setAttribute(key,value);image.append(use);
  }else{image=document.createElement(actor.movie?'canvas':actor.video?'video':'img');if(actor.file)image.src=url(actor.file);image.onerror=fail;image.alt=actor.label||''}
  image.classList.add('course-layer');image.dataset.actor=actor.id;rect(image,actor.rect);
  image._sourceActor=actor;
  if(actor.movie)movieControllers.set(actor.id,window.CBTMovie.create(image,actor.movie,url,fail,token===1?saved.movies?.[actor.id]:undefined));
  if(actor.video){image.muted=true;image.playsInline=true;image.loop=!!actor.loop;image.play().catch(()=>{})}
  if(anchor?.isConnected)$('scene-layers').insertBefore(image,anchor);else $('scene-layers').append(image);
  if(actor.composition){image._renderReady=window.CBTComposite.create(image,actor,url,$('scene-layers')).catch(fail);return image._renderReady}
 }
 function apply(operation){
  if(operation.kind==='draw')return draw(operation.actor);
  if(operation.kind==='graphic-update')return draw(operation.actor,null,true);
  if(operation.kind==='erase')operation.ids.forEach(id=>{movieControllers.get(id)?.stop();movieControllers.delete(id);$('scene-layers').querySelector('[data-actor="'+id+'"]')?.remove()});
  if(operation.kind==='audio')sourceVoice(operation.clip);
  if(operation.kind==='stop-audio'){audio.pause();clearTimeout(voiceTimer);voiceTimer=null;audioActive=false}
  if(operation.kind==='movie-update'){
   const element=$('scene-layers').querySelector('[data-actor="'+operation.id+'"]');if(!element)return;
   const previous=movieControllers.get(operation.id),snapshot=operation.movie.exactParameters?undefined:previous?.snapshot;previous?.stop();
   movieControllers.set(operation.id,window.CBTMovie.create(element,operation.movie,url,()=>{if(element.isConnected&&$('scene-layers').querySelector('[data-actor="'+operation.id+'"]')===element)error('Не удалось открыть исходную анимацию сцены. Завершите сохранение урока или повторите с интернетом.')},snapshot));
  }
  if(operation.kind==='move'){
   const element=$('scene-layers').querySelector('[data-actor="'+operation.id+'"]');if(!element)return;
   const points=operation.path?.length?operation.path:[{x:parseFloat(element.style.left),y:parseFloat(element.style.top)},operation.destination];
   const keyframes=operation.keyframes||points.map(p=>({left:p.x+'px',top:p.y+'px'}));
   element.animate(keyframes,{duration:operation.duration*1000,fill:'forwards',easing:'linear'});
  }
 }
 function operations(){
  operationTimers.forEach(clearTimeout);operationTimers=[];
  const elapsed=(performance.now()-startTime)/1000;
  queuedOperations.forEach((op,i)=>{if(!appliedOperations.has(i))operationTimers.push(setTimeout(()=>{if(!paused&&!blocked){appliedOperations.add(i);apply(op)}},Math.max(0,op.at-elapsed)*1000))});
 }
 function queue(events){
  const now=(performance.now()-startTime)/1000;let duration=0;
  events.forEach(op=>{const delay=op.at||0;duration=Math.max(duration,delay+(op.duration||0));const next={...op,at:now+delay};queuedOperations.push(next);if(!delay){appliedOperations.add(queuedOperations.length-1);apply(next)}});operations();return duration;
 }
 function afterNarration(){if(postStarted)return 0;postStarted=true;return queue(scene.postOperations||[])}
 function silentVoice(ms){clearTimeout(voiceTimer);voiceRemaining=ms;voiceAt=performance.now();voiceTimer=setTimeout(()=>{voiceTimer=null;voiceEnded()},ms)}
 function sourceVoice(clip){
  clearTimeout(voiceTimer);voiceTimer=null;audio.pause();activeClip=clip;audioActive=true;
  audio.src=url(clip.file);audio.currentTime=0;
  if(!settings.audio){silentVoice(clip.duration*1000);return}
  const current=token;audio.play().then(()=>{if(current===token)$('enable-audio').hidden=true}).catch(e=>{
   if(current!==token||e.name==='AbortError')return;
   if(e.name==='NotAllowedError'){$('enable-audio').hidden=false;state('Нажмите «Включить звук»')}else error('Озвучка не загружена. Завершите сохранение урока или повторите с интернетом.');
  });
 }
 function sequence(){
  if(paused||blocked||renderPending||!scene.sourceSequence)return;
  waitingForAudio=false;waitingForUser=false;
  while(sequenceIndex<scene.sourceSequence.length){
   const op=scene.sourceSequence[sequenceIndex++];
   if(op.kind==='wait'){schedule(op.duration*1000,sequence);return}
   if(op.kind==='gate'){
    if(op.gate==='audio'){
     const delay=settings.speed==='fast'?0:(op.delay||0)+(settings.speed==='slow'?7:0);
     if(audioActive){waitingForAudio=true;audioGateDelay=delay;return}
     if(delay){schedule(delay*1000,sequence);return}continue;
    }
    waitingForUser=true;heard=!audioActive;
    if(op.gate==='exercise'&&scene.exercise?.supported){exerciseReady=true;state('Выполните задание на экране');if(scene.exercise.kind==='explore')$('next').disabled=false}
    else{$('next').disabled=false;state('Нажмите «Продолжить»')}
    return;
   }
   const rendering=apply(op);if(rendering?.then){const current=token;renderPending=true;rendering.then(()=>{if(current!==token)return;renderPending=false;if(paused)renderResume=true;else if(!blocked)sequence()});return}
  }
  sequenceDone=true;heard=!audioActive;
  if(audioActive){waitingForAudio=true;audioGateDelay=0;return}
  if(scene.exercise?.supported&&!completed.has(scene.id)){exerciseReady=true;waitingForUser=true;state('Выполните задание на экране');if(scene.exercise.kind==='explore')$('next').disabled=false;return}
  const gap=settings.speed==='fast'?0:(scene.transition.delay??1);
  if(scene.transition.kind==='automatic')schedule(gap*1000,next);else{$('next').disabled=false;state('Нажмите «Продолжить»')}
 }
 function voice(){
  const clip=scene.audio?.[clipIndex];if(!clip){narrationFinished();return}
  if(!settings.audio){schedule(clip.duration*1000,voiceEnded);return}
  const current=token;audio.src=url(clip.file);audio.play().then(()=>{if(current===token)$('enable-audio').hidden=true}).catch(e=>{
   if(current!==token||e.name==='AbortError')return;
   if(e.name==='NotAllowedError'){$('enable-audio').hidden=false;state('Нажмите «Включить звук»')}else error('Озвучка не загружена. Завершите сохранение урока или повторите с интернетом.');
  });
 }
 function voiceEnded(){if(paused||blocked||feedbackActive)return;if(scene.sourceSequence){audioActive=false;heard=true;if(waitingForAudio){const delay=audioGateDelay;audioGateDelay=0;if(delay)schedule(delay*1000,sequence);else sequence()}return}clipIndex++;voice()}
 function narrationFinished(){
  if(paused||blocked||heard)return;heard=true;
  if(scene.exercise?.supported){state('Выполните задание на экране');if(scene.exercise.kind==='explore')$('next').disabled=false;return}
  const wait=afterNarration();
  if(scene.transition.kind==='automatic'){
   const gap=settings.speed==='fast'?0:(scene.transition.delay||1)+(settings.speed==='slow'?7:0);schedule((wait+gap)*1000,next);
  }else{schedule(wait*1000,()=>{$('next').disabled=false;state('Нажмите «Продолжить»')})}
 }
 function targetName(target,index){return target.label||`Показанная область ${index+1}`}
 function selections(){
  $('selections').replaceChildren();(scene.exercise?.targets||[]).filter(t=>selected.has(t.id)).forEach(t=>{const e=document.createElement('div');e.className='selection';rect(e,t.rect);$('selections').append(e)});
  $('exercise-actions').querySelectorAll('[data-action]').forEach(b=>b.setAttribute('aria-pressed',String(selected.has(b.dataset.action))));
 }
 function wrong(event){
  if(!scene.exercise?.supported||paused||scene.sourceSequence&&!exerciseReady)return;hint();state('Попробуйте ещё раз');
  if(scene.exercise.wrongTargets?.length){
   const b=$('stage').getBoundingClientRect(),x=event?(event.clientX-b.left)*1024/b.width:NaN,y=event?(event.clientY-b.top)*768/b.height:NaN;
   const t=scene.exercise.wrongTargets.find(t=>x>=t.rect.x&&x<t.rect.x+t.rect.w&&y>=t.rect.y&&y<t.rect.y+t.rect.h)||scene.exercise.wrongTargets.find(t=>t.rect.w>=1024&&t.rect.h>=650);
   if(t){queue(t.operations||[]);return}
  }
  if(scene.exercise.feedbackAudio){feedbackActive=true;audio.pause();$('effect').src=url(scene.exercise.feedbackAudio.file);$('effect').onended=()=>{feedbackActive=false;if(!paused&&!heard&&settings.audio)audio.play().catch(()=>{})};$('effect').play().catch(()=>{feedbackActive=false;if(!paused&&!heard&&settings.audio)audio.play().catch(()=>{})})}
 }
 function answer(id,submission){
  if(paused||blocked||!scene.exercise?.supported||scene.sourceSequence&&!exerciseReady)return;
  const exercise=scene.exercise,target=exercise.targets.find(t=>t.id===id);if(!target&&id!=='submit')return wrong();
  if(exercise.kind==='explore'){queue(target.operations||[]);selected.add(id);selections();state('Продолжите исследование или нажмите «Продолжить»');return}
  if(exercise.kind==='choice'){
   if(id!=='submit'){selected=new Set([id]);selections();queue(target.operations||[]);return}
   if(!selected.size||!(exercise.correct||[]).includes([...selected][0]))return wrong();
  }
  if(exercise.kind==='multi'||exercise.kind==='matrix'){
   if(id!=='submit'){if(exercise.kind==='multi'&&selected.has(id))return;selected.has(id)?selected.delete(id):selected.add(id);selections();queue(target.operations||[]);if(exercise.kind==='matrix'||selected.size<(exercise.required||exercise.targets.length))return}
   if(exercise.kind==='matrix'&&!(exercise.correct||[]).every(t=>selected.has(t))||exercise.kind==='matrix'&&selected.size!==(exercise.correct||[]).length)return wrong();
  }else if(target?.correct===false)return wrong();
  let wait=0;if(exercise.kind!=='multi'&&exercise.kind!=='matrix'&&exercise.kind!=='choice')wait=queue(target.operations||[]);
  if(id==='submit')wait=Math.max(wait,queue((exercise.submitTargets?.find(t=>t.id===submission)||exercise.submitTargets?.[0])?.operations||[]));
  completed.add(scene.id);persist();state('Верно');
  if(scene.sourceSequence){exerciseReady=false;waitingForUser=false;const now=(performance.now()-startTime)/1000;wait=Math.max(wait,...queuedOperations.filter((_,i)=>!appliedOperations.has(i)).map(op=>op.at-now+(op.duration||0)),0);schedule(wait*1000,sequence);return}
  audio.pause();heard=true;wait=Math.max(wait,afterNarration());
  const now=(performance.now()-startTime)/1000;wait=Math.max(wait,...queuedOperations.filter((_,i)=>!appliedOperations.has(i)).map(op=>op.at-now+(op.duration||0)),0);schedule((wait+.35)*1000,next);
 }
 function hint(){
  document.querySelectorAll('#hotspots button').forEach(b=>b.classList.add('hinted'));
  $('instruction').textContent=scene.exercise?.instruction||'Слушайте пояснение и продолжайте урок.';
 }
 function menu(){
  $('section-list').replaceChildren();lesson.sections.forEach(section=>{
   const b=document.createElement('button');b.textContent=section.title;b.disabled=!visited.has(section.first)&&!saved.finished;b.onclick=()=>enter(lesson.scenes.findIndex(s=>s.id===section.first));$('section-list').append(b);
  });
 }
 function enter(nextIndex){
  if(nextIndex<0||nextIndex>=lesson.scenes.length)return;
  window.CBTPlayerLayout.dismissCompletion();
  const carried=new Map(),carryAll=!!(scene?.sourceSequence&&lesson.scenes[nextIndex].sourceSequence&&lesson.scenes[nextIndex].sourceStateScope!=='independent-root'&&nextIndex===index+1);
  if(carryAll)$('scene-layers').querySelectorAll('[data-actor]').forEach(e=>carried.set(e.dataset.actor,e));
  else if(scene&&nextIndex===index+1)lesson.scenes[nextIndex].layers.forEach(a=>{if(a.movie&&movieControllers.has(a.id)){const e=$('scene-layers').querySelector('[data-actor="'+a.id+'"]');if(e)carried.set(a.id,e)}});
  token++;renderPending=false;renderResume=false;clear(new Set(carried.keys()));index=nextIndex;scene=lesson.scenes[index];blocked=false;paused=false;heard=false;selected=new Set();appliedOperations=new Set();queuedOperations=scene.sourceSequence?[]:[...(scene.operations||[])];postStarted=false;clipIndex=0;startTime=performance.now();sequenceIndex=0;waitingForAudio=false;waitingForUser=false;sequenceDone=false;activeClip=null;audioActive=false;exerciseReady=!scene.sourceSequence;
  $('media-error').hidden=true;$('enable-audio').hidden=true;$('completion').hidden=true;$('scene-layers').replaceChildren();$('hotspots').replaceChildren();$('exercise-actions').replaceChildren();$('selections').replaceChildren();
  if(carryAll)carried.forEach(e=>$('scene-layers').append(e));else scene.layers.forEach(a=>draw(a,carried.get(a.id)));
  movieControllers.forEach(m=>m.resume());labels();$('section-title').textContent=(lesson.sourceVariant?lesson.sourceVariant.label+' · ':'')+(scene.sectionTitle||item.title);
  const question=scene.bankQuestion;
  $('scene-counter').textContent=question?`Вопрос ${question.number} из ${question.total} · ${question.variant?'Вариант '+question.variant:'Экран '+question.screen+' / '+question.screens}`:`${index+1} / ${lesson.scenes.length}`;
  $('next').textContent=index+1===lesson.scenes.length?(item.questionBank?'Завершить проверку':'Завершить урок'):question&&question.screen===question.screens?'Следующий вопрос →':'Продолжить →';
  $('next').disabled=true;$('back').disabled=index===0;$('pause').textContent='Пауза';$('pause').setAttribute('aria-pressed','false');
  $('instruction').textContent=scene.exercise?.instruction||'Слушайте оригинальное пояснение.';$('scene-note').hidden=!scene.note;$('scene-note').textContent=scene.note||'';
  if(scene.exercise?.supported){
   scene.exercise.targets.forEach((t,i)=>{
    const name=targetName(t,i),hot=document.createElement('button');hot.className='hotspot';hot.dataset.action=t.id;hot.setAttribute('aria-label',name);rect(hot,t.rect);hot.onclick=e=>{e.stopPropagation();answer(t.id)};$('hotspots').append(hot);
    const button=document.createElement('button');button.dataset.action=t.id;button.textContent=name;button.onclick=()=>answer(t.id);$('exercise-actions').append(button);
   });
   (scene.exercise.submitTargets||[]).forEach(t=>{const hot=document.createElement('button');hot.className='hotspot';hot.dataset.action='submit';hot.setAttribute('aria-label','Done — проверить ответ');rect(hot,t.rect);hot.onclick=e=>{e.stopPropagation();answer('submit',t.id)};$('hotspots').append(hot)});
   if(['matrix','choice'].includes(scene.exercise.kind)){const b=document.createElement('button');b.textContent='Проверить ответ';b.onclick=()=>answer('submit');$('exercise-actions').append(b)}
  }
  visited.add(scene.id);persist();$('lesson-progress').value=visited.size;menu();fit();state('Урок открыт');
  queuedOperations.forEach((operation,i)=>{if(!operation.at){appliedOperations.add(i);apply(operation)}});operations();
  if(scene.sourceSequence)sequence();else if(scene.audio?.length){if(scene.voiceStart)schedule(scene.voiceStart*1000,voice);else voice()}else schedule(Math.max(2,scene.duration||2)*1000,narrationFinished);
 }
 function next(){
  if(scene.sourceSequence&&waitingForUser){
   if(exerciseReady&&scene.exercise?.kind!=='explore'&&!completed.has(scene.id))return;
   if(exerciseReady&&scene.exercise?.kind==='explore'){completed.add(scene.id);persist()}
   exerciseReady=false;$('next').disabled=true;sequence();return;
  }
  if(scene.exercise?.kind==='explore'){completed.add(scene.id);persist();afterNarration()}
  if(scene.exercise?.supported&&!completed.has(scene.id))return;
  if(index+1<lesson.scenes.length)enter(index+1);else finish();
 }
 function finish(){
  clear();saved.finished=visited.size===lesson.scenes.length&&lesson.scenes.filter(s=>s.exercise?.supported).every(s=>completed.has(s.id));
  const full=saved.finished,title=full?(item.questionBank?'Проверка завершена':'Урок завершён'):(item.questionBank?'Есть непройденные вопросы':'Есть непройденные сцены');
  persist();state(title);$('completion').hidden=false;$('completion').querySelector('h2').textContent=title;menu();
  const missing=lesson.scenes.findIndex(s=>!visited.has(s.id)||s.exercise?.supported&&!completed.has(s.id));
  window.CBTPlayerLayout.complete({title,
   detail:full?(item.questionBank?'Все вопросы раздела пройдены. Прогресс сохранён.':'Прогресс сохранён. Можно перейти к следующему уроку.'):'Пройдите оставшиеся сцены и задания, чтобы завершить '+(item.questionBank?'проверку.':'урок.'),
   repeat:()=>start(true),resume:full?null:()=>enter(Math.max(0,missing))});
  if(full)parent.postMessage({type:'CBT_LESSON_COMPLETE',id:item.id},location.origin);
 }
 function pause(value){
  if(!started||paused===value)return;paused=value;
  if(value){pauseTime=performance.now();remaining=timer?Math.max(0,remaining-(performance.now()-timerAt)):0;clearTimeout(timer);timer=null;if(voiceTimer){voiceRemaining=Math.max(0,voiceRemaining-(performance.now()-voiceAt));clearTimeout(voiceTimer);voiceTimer=null}operationTimers.forEach(clearTimeout);operationTimers=[];audio.pause();$('effect').pause();movieControllers.forEach(m=>m.pause());document.getAnimations().forEach(a=>a.pause());document.querySelectorAll('video').forEach(v=>v.pause())}
  else{
   startTime+=performance.now()-pauseTime;operations();movieControllers.forEach(m=>m.resume());document.getAnimations().forEach(a=>a.play());document.querySelectorAll('video').forEach(v=>v.play().catch(()=>{}));
   if(remaining>0&&scheduled)schedule(remaining,scheduled);if(scene.sourceSequence&&audioActive&&!settings.audio)silentVoice(voiceRemaining);else if((scene.sourceSequence?audioActive:!heard)&&settings.audio&&scene.audio?.length)audio.play().catch(()=>{$('enable-audio').hidden=false});
   if(renderResume){renderResume=false;sequence()}
  }
  $('pause').textContent=value?'Продолжить':'Пауза';$('pause').setAttribute('aria-pressed',String(value));state(value?'Пауза':'Урок открыт');
 }
 function dialog(id){if(!document.querySelector('dialog[open]'))dialogPaused=paused;pause(true);$('options-dialog').close();$(id).showModal()}
 $('options-open').onclick=()=>dialog('options-dialog');document.querySelectorAll('[data-close-dialog]').forEach(b=>b.onclick=()=>b.closest('dialog').close());document.querySelectorAll('dialog').forEach(d=>d.onclose=()=>{if(!document.querySelector('dialog[open]')&&!dialogPaused)pause(false)});
 function glossary(){const q=$('glossary-search').value.toLowerCase();$('glossary-results').innerHTML='<dl>'+lesson.glossary.filter(g=>(g.name+' '+g.definition).toLowerCase().includes(q)).map(g=>`<dt>${escape(g.name)}</dt><dd>${escape(g.definition)}</dd>`).join('')+'</dl>'}
 $('glossary-open').onclick=()=>{dialog('glossary-dialog');glossary()};$('glossary-search').oninput=glossary;
 $('comments-open').onclick=()=>{$('comment-text').value=comments[scene.id]||'';dialog('comments-dialog')};$('comment-save').onclick=()=>{comments[scene.id]=$('comment-text').value;persist();$('comments-dialog').close()};
 $('lesson-speed').onchange=e=>{settings.speed=e.target.value;persist()};$('pause').onclick=()=>pause(!paused);$('repeat').onclick=()=>enter(index);$('back').onclick=()=>enter(index-1);$('next').onclick=next;$('hint').onclick=hint;$('stage').onclick=wrong;
 function audioSetting(enabled){
  settings.audio=enabled;labels();
  if(scene.sourceSequence&&audioActive&&activeClip){
   if(enabled){
    const left=voiceTimer?Math.max(0,voiceRemaining-(performance.now()-voiceAt)):voiceRemaining;
    clearTimeout(voiceTimer);voiceTimer=null;audio.currentTime=Math.max(0,activeClip.duration-left/1000);
    if(!paused)audio.play().catch(()=>{$('enable-audio').hidden=false});
   }else{audio.pause();voiceRemaining=Math.max(0,(activeClip.duration-audio.currentTime))*1000;if(!paused)silentVoice(voiceRemaining)}
  }else if(!scene.sourceSequence&&!heard&&scene.audio?.length){
   if(enabled){clearTimeout(timer);const clip=scene.audio[clipIndex];if(audio.src!==url(clip.file)){audio.src=url(clip.file);audio.currentTime=0}if(!paused)audio.play().catch(()=>{$('enable-audio').hidden=false})}
   else{audio.pause();const ms=Math.max(0,(scene.audio[clipIndex].duration-audio.currentTime))*1000;if(paused){remaining=ms;scheduled=voiceEnded}else schedule(ms,voiceEnded)}
  }
  persist();
 }
 $('audio-toggle').onclick=()=>audioSetting(!settings.audio);
 $('text-toggle').onclick=()=>{settings.text=!settings.text;labels();persist()};$('enable-audio').onclick=()=>{if(!settings.audio)audioSetting(true);audio.play().then(()=>$('enable-audio').hidden=true).catch(()=>{})};
 $('zoom-in').onclick=()=>{zoom=Math.min(3,zoom+.5);fit()};$('zoom-out').onclick=()=>{zoom=Math.max(1,zoom-.5);fit()};$('zoom-fit').onclick=()=>{zoom=1;fit()};$('fullscreen').onclick=()=>window.CBTPlayerLayout.fullscreen();
 audio.onended=voiceEnded;audio.onerror=()=>{if(started&&(scene.audio?.length||activeClip)&&settings.audio)error('Озвучка не загружена. Завершите сохранение урока или повторите с интернетом.')};
 function start(reset=false){if(reset){visited.clear();completed.clear();saved={};settings.audio=true;settings.text=true}started=true;$('loading').hidden=true;$('lesson').hidden=false;$('lesson-speed').value=settings.speed;enter(reset?0:Math.min(saved.index||0,lesson.scenes.length-1))}
 $('start-lesson').onclick=()=>start(!!saved.finished);$('restart-lesson').onclick=()=>start(true);$('review-lesson').onclick=()=>start(true);document.addEventListener('visibilitychange',()=>{if(document.hidden)pause(true)});addEventListener('pagehide',()=>{if(started)persist();clear()});
 if(!item||item.player==='intro'){$('load-error').textContent='Такого урока нет в каталоге.';$('load-error').hidden=false;return}
 const read=key=>{try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}};
 const fetchLesson=topic=>fetch(url(topic.manifest)).then(r=>{if(!r.ok)throw new Error();return r.json()});
 const loading=item.questionBank?Promise.all(banks.parts(window.CBT_COURSE,item).map(fetchLesson)).then(parts=>banks.compose(item,parts)):fetchLesson(item);
 $('lesson-title').textContent=item.title;loading.then(data=>{
  lesson=data;lesson.glossary=lesson.glossary||[];
  if(item.questionBank){
   const previous=banks.restore(item,lesson,read);Object.assign(saved,previous);Object.assign(settings,previous.settings||{});Object.assign(comments,previous.comments||{});
   (previous.visited||[]).forEach(id=>visited.add(id));(previous.completed||[]).forEach(id=>completed.add(id));
  }
  $('lesson-progress').max=lesson.scenes.length;
  $('load-message').textContent=item.questionBank?`${item.questionCount} вопросов · ${lesson.scenes.length} исходных экранов. Проходите их подряд; прогресс сохраняется на этом устройстве.`:`Материалы готовы: ${lesson.scenes.length} сцен. `+(lesson.sourceMode==='test'?'Исходные варианты вопросов доступны для тренировки; экзаменационная оценка не рассчитывается.':'Управляйте показанными органами и выполняйте инструкции.');
  if(lesson.restorationNotice)$('load-message').textContent+=' '+lesson.restorationNotice;
  $('start-lesson').disabled=false;$('start-lesson').textContent=saved.finished?(item.questionBank?'Повторить проверку':'Повторить урок'):saved.index?(item.questionBank?'Продолжить проверку':'Продолжить урок'):item.questionBank?'Начать проверку':'Начать урок';
  $('restart-lesson').hidden=!saved.index;state('Готов к запуску');
  window.CBTCourseNative={get current(){return scene?.id},get state(){return {index,paused,heard,blocked,exerciseReady,waitingForUser,waitingForAudio,sequenceIndex,visited:[...visited],completed:[...completed],settings,finished:!!saved.finished,movies:Object.fromEntries([...movieControllers].map(([id,m])=>[id,{frame:m.frame,...m.snapshot}]))}},get lesson(){return lesson},goTo:id=>enter(lesson.scenes.findIndex(s=>s.id===id))};
 }).catch(()=>{$('load-error').textContent='Урок не загружен. Подключитесь к интернету или вернитесь в каталог и сохраните этот урок целиком.';$('load-error').hidden=false;state('Материал не загружен')});
})();
