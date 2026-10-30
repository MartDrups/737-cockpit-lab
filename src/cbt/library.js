'use strict';
(() => {
 const course=window.CBT_COURSE,banks=window.CBTQuestionBanks;
 let expandedFrame=null;
 function lessonFullscreen(active){
  const frame=active?target?.querySelector('.cbt-player-shell iframe'):expandedFrame;
  if(active&&!frame)return;
  expandedFrame?.closest('.cbt-player-shell')?.classList.remove('is-fullscreen');
  expandedFrame=active?frame:null;
  frame?.closest('.cbt-player-shell')?.classList.toggle('is-fullscreen',active);
  document.documentElement.classList.toggle('cbt-fullscreen',active);
  frame?.contentWindow?.postMessage({type:'CBT_FULLSCREEN_STATE',active},location.origin);
 }
 addEventListener('keydown',event=>{if(event.key==='Escape'&&expandedFrame){event.preventDefault();lessonFullscreen(false)}});
 let target,query='',category='all',offlineOnly=false,opened=null,status={},job=null;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const size=n=>n>=1e9?(n/1e9).toFixed(2)+' ГБ':Math.max(.1,n/1e6).toFixed(1)+' МБ';
 const read=key=>{try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}};
 const progress=id=>id==='intro'?read('737-cbt-intro-native-v2'):banks.progress(banks.find(course,id),read);
 const done=id=>progress(id)?.finished||id==='intro'&&localStorage.getItem('737-cbt-intro-viewed')==='yes';
 const saved=item=>banks.parts(course,item).every(t=>status[t.id]?.ready);
 const partiallySaved=item=>banks.parts(course,item).some(t=>status[t.id]?.ready);
 async function message(type,data={}){
  const registration=await navigator.serviceWorker.ready;
  return new Promise((resolve,reject)=>{
   const channel=new MessageChannel(),timeout=setTimeout(()=>reject(new Error('Не удалось связаться с сохранёнными материалами. Откройте «Приложение» и повторите.')),15000);
   channel.port1.onmessage=e=>{clearTimeout(timeout);channel.port1.close();e.data.error?reject(new Error(e.data.error)):resolve(e.data)};
   registration.active.postMessage({type,...data},[channel.port2]);
  });
 }
 function row(topic){
  const cached=saved(topic),complete=done(topic.id),p=progress(topic.id),started=p?.started||p?.index||p?.visited?.length;
  const available=topic.status==='ready',running=job?.id===topic.id;
  const absent=topic.status==='source-missing'||topic.status==='source-incomplete';
  const description=topic.questionBank?`${topic.questionCount} вопросов · исходные варианты A/B · ${topic.sceneCount} экранов подряд`:`${topic.training?'Тренировка · ':''}${topic.sceneCount} сцен${topic.bytes?' · '+size(topic.bytes):''}${topic.viewOnlyScenes?' · '+topic.viewOnlyScenes+' сцен с пояснениями без интерактивного ввода':''}`;
  const action=complete?(topic.questionBank?'Повторить проверку':'Повторить урок'):started?'Продолжить':topic.questionBank?'Начать проверку':'Открыть урок';
  return `<article class="cbt-topic${topic.questionBank?' cbt-question-bank':''}" data-topic="${esc(topic.id)}"><div><span class="cbt-topic-state">${complete?'✓ Завершено':cached?'Сохранено офлайн':started?'В процессе':available?'Доступно':absent?'Недоступно':'Готовится'}</span><h3>${topic.questionBank?'Проверить знания':esc(topic.title)}</h3><p>${available?description:absent?esc(topic.unavailableReason||'Clearway and Stopway отсутствует в предоставленном комплекте.'):'Материалы извлечены. Перенос темы ещё не завершён.'}</p>${topic.restorationNotice?`<p class="cbt-restoration-note">${esc(topic.restorationNotice)}</p>`:''}</div><div class="cbt-topic-actions">${available?`<button class="cbt-primary" data-cbt-open="${esc(topic.id)}">${action} →</button>${topic.id==='intro'?'<span class="cbt-download-note">Сохраняется вместе со справочником</span>':`<button class="cbt-secondary" data-cbt-download="${esc(topic.id)}" ${job?'disabled':''}>${running?'Сохранение…':cached?'Скачать заново':topic.questionBank?'Скачать вопросы':'Скачать урок'}</button>${partiallySaved(topic)?`<button class="cbt-secondary" data-cbt-delete="${esc(topic.id)}" ${job?'disabled':''}>Удалить с устройства</button>`:''}`}`:''}</div></article>`;
 }
 function groups(){
  const needle=query.trim().toLowerCase();let count=0;
  const html=course.groups.filter(g=>category==='all'||g.category===category).map(g=>{
   const groupMatch=(g.title+' '+g.originalTitle).toLowerCase().includes(needle);
   const entries=banks.entries(course,g);
   const topics=entries.filter(t=>(!needle||groupMatch||(t.title+' '+(t.searchText||'')).toLowerCase().includes(needle))&&(!offlineOnly||saved(t)));
   if(!topics.length)return '';count+=topics.length;
   return `<details class="cbt-group" ${needle||g.id==='00117'?'open':''}><summary><span class="cbt-group-number">${String(g.number).padStart(2,'0')}</span><span><strong>${esc(g.title)}</strong><small>${esc(g.originalTitle)} · ${topics.length} пунктов · ${g.minutes} мин по исходному меню</small></span><span class="cbt-group-progress">${entries.filter(t=>done(t.id)).length}/${entries.length}</span></summary><div class="cbt-group-topics">${topics.map(row).join('')}</div></details>`;
  }).join('');
  target.querySelector('#cbt-groups').innerHTML=html||'<p class="cbt-empty">Таких уроков пока нет. Измени запрос или фильтр.</p>';
  target.querySelector('#cbt-found').textContent=`Найдено тем: ${count}`;
  target.querySelectorAll('[data-cbt-open]').forEach(b=>b.onclick=()=>open(b.dataset.cbtOpen));
  target.querySelectorAll('[data-cbt-download]').forEach(b=>b.onclick=()=>download(b.dataset.cbtDownload));
  target.querySelectorAll('[data-cbt-delete]').forEach(b=>b.onclick=()=>remove(b.dataset.cbtDelete));
 }
 function jobText(text,error=false){
  const element=target?.querySelector('#cbt-download-state');if(!element)return;
  element.hidden=!text;element.classList.toggle('cbt-error',error);element.textContent=text;
  const pause=target?.querySelector('#cbt-pause-download');if(pause)pause.hidden=!job;
 }
 async function refresh(){
  if(!('serviceWorker' in navigator))return;
  try{const result=await message('CBT_STATUS');status=result.lessons||{};if(!opened&&target?.querySelector('#cbt-groups'))groups()}catch{}
 }
 async function saveNext(current){
  if(job!==current||current.pausing)return;
  if(current.cursor===current.ids.length){
   job=null;jobText(current.bank?'Все вопросы сохранены. Проверку можно пройти без интернета.':'Урок полностью сохранён. Можно открыть без интернета.');await refresh();return;
  }
  current.current=current.ids[current.cursor];
  try{await message('CBT_DOWNLOAD',{id:current.current})}catch(error){if(job===current){job=null;jobText(error.message,true);await refresh()}}
 }
 async function download(id){
  const item=banks.find(course,id),all=banks.parts(course,item).map(t=>t.id);
  const missing=all.filter(id=>!status[id]?.ready);
  job={id,bank:!!item.questionBank,all,ids:missing.length?missing:all,cursor:0,current:null};
  groups();jobText(item.questionBank?'Начинаем сохранение вопросов…':'Начинаем сохранение урока…');
  await saveNext(job);
 }
 async function remove(id){
  try{for(const item of banks.parts(course,banks.find(course,id)))await message('CBT_DELETE',{id:item.id});await refresh();jobText('Материалы удалены с устройства. Прогресс сохранён.')}catch(error){jobText(error.message,true)}
 }
 function render(element){
  lessonFullscreen(false);
  target=element;opened=null;
  target.classList.remove('cbt-lesson-open');document.body.classList.remove('cbt-lesson-active');
  target.innerHTML=`<section class="cbt-intro"><span class="cbt-section-tag">ОБУЧЕНИЕ · BOEING 737</span><h2>Учебный курс CBT</h2><p>Оригинальные озвучка, схемы и задания из предоставленного комплекта. ${course.groups.length} разделов · ${course.topics.filter(t=>t.status==='ready'&&t.sourceMode!=='test').length} уроков и практик · ${course.groups.filter(g=>banks.bank(course,g)).length} проверок знаний. Начните со знакомства с курсом или выберите нужную систему.</p></section><div class="cbt-library-controls"><label class="cbt-search-label"><span>Найти урок</span><input id="cbt-search" type="search" placeholder="Система или название на английском" value="${esc(query)}"></label><label><span>Раздел курса</span><select id="cbt-category"><option value="all">Все разделы</option><option value="systems">Самолёт и системы</option><option value="fmc">FMC</option><option value="performance">Лётные характеристики</option></select></label><label class="cbt-offline-filter"><input id="cbt-offline-only" type="checkbox" ${offlineOnly?'checked':''}> Сохранённые уроки</label></div><div class="cbt-library-summary"><span id="cbt-found"></span><button class="cbt-secondary" id="cbt-refresh">Проверить сохранённые</button></div><p id="cbt-download-state" role="status" hidden></p><div id="cbt-groups"></div><div class="cbt-notes"><div><h3>Без интернета</h3><p>«Скачать урок» сохраняет выбранную тему целиком: звук, графику и задания. Общие файлы соседних тем используются повторно. Вводный урок сохраняется через «Приложение» вместе со справочником.</p></div><div><h3>Об учебном комплекте</h3><p>${esc(course.source)}. В историческом курсе встречаются разные варианты оборудования. Сопоставляйте их с действующей документацией; источник справочника — FCOM S7 от 15 ноября 2021 года.</p><p>Вопросы каждого раздела собраны в одну проверку с исходными вариантами A/B. Учебные уроки и практические упражнения открываются отдельно.</p></div></div>`;
  const pause=document.createElement('button');pause.id='cbt-pause-download';pause.className='cbt-secondary';pause.textContent='Приостановить сохранение';pause.hidden=!job;pause.onclick=()=>{if(job){job.pausing=true;message('CBT_PAUSE').catch(error=>jobText(error.message,true))}};target.querySelector('#cbt-download-state').after(pause);
  if(course.draft){const warning=document.createElement('p');warning.className='cbt-error';warning.textContent='Черновик переноса. Три темы открыты для проверки проигрывателя; исходная графика ещё дорабатывается.';target.querySelector('.cbt-intro').append(warning)}
  const field=target.querySelector('#cbt-search');field.oninput=()=>{query=field.value;groups()};
  target.querySelector('#cbt-category').value=category;target.querySelector('#cbt-category').onchange=e=>{category=e.target.value;groups()};
  target.querySelector('#cbt-offline-only').onchange=e=>{offlineOnly=e.target.checked;groups()};
  target.querySelector('#cbt-refresh').onclick=refresh;groups();refresh();
 }
 function open(id){
  const lesson=banks.find(course,id);if(!lesson||lesson.status!=='ready')return;
  lessonFullscreen(false);opened=id;
  target.classList.add('cbt-lesson-open');document.body.classList.add('cbt-lesson-active');
  target.innerHTML=`<section class="cbt-lesson-head"><button class="cbt-back" data-cbt-back>← К урокам</button><div><h2>${esc(lesson.title)}</h2><p>${lesson.questionBank?lesson.questionCount+' вопросов · '+lesson.sceneCount+' экранов':lesson.sceneCount+' сцен'} · ${esc(course.groups.find(g=>g.id===lesson.group).title)}</p></div></section><div class="cbt-player-shell"><iframe src="${id==='intro'?'cbt/player.html':'cbt/course-player.html?lesson='+encodeURIComponent(id)}" title="${esc(lesson.title)}" allow="autoplay; fullscreen" allowfullscreen></iframe></div><details class="cbt-help"><summary>Как пройти урок</summary><p>Нажмите «Начать урок», чтобы включить оригинальную озвучку. Слушайте пояснения и выполняйте задания на сцене. Доступны пауза, повтор, масштаб и подписи; прогресс сохраняется на этом устройстве.</p><p>Для офлайна вернитесь к урокам, нажмите «Скачать урок» и дождитесь сообщения о завершении. На телефоне удобно повернуть экран.</p></details>`;
  target.querySelector('[data-cbt-back]').onclick=()=>render(target);
  if(id==='intro'){
   const mark=document.createElement('div');mark.className='cbt-finish';mark.innerHTML=`<label><input type="checkbox" data-cbt-viewed ${done(id)?'checked':''}> Я прошёл урок</label><p>Отметка сохраняется на этом устройстве.</p>`;target.append(mark);mark.querySelector('input').onchange=e=>localStorage.setItem('737-cbt-intro-viewed',e.target.checked?'yes':'no');
  }
 }
 window.CBTView={render,open,close:()=>{lessonFullscreen(false);target?.querySelector('iframe')?.remove();target?.classList.remove('cbt-lesson-open');document.body.classList.remove('cbt-lesson-active');opened=null}};
 navigator.serviceWorker?.addEventListener('message',event=>{
  const d=event.data;
  if(d.type==='CBT_DOWNLOAD_PROGRESS'){
   if(!job)job={id:d.id,bank:false,all:[d.id],ids:[d.id],cursor:0,current:d.id};
   if(job.current===d.id)jobText(`${job.bank?'Сохраняем вопросы: '+(job.all.indexOf(d.id)+1)+'/'+job.all.length+' · ':'Сохраняем урок: '}${d.completed}/${d.total} файлов · ${size(d.bytes)} из ${size(d.totalBytes)}`);
  }
  if(d.type==='CBT_COMPLETE'){
   status=d.status?.lessons||status;
   if(job?.current===d.id){if(job.pausing){job=null;jobText('Сохранение приостановлено. Можно продолжить позже.');refresh()}else{job.cursor++;saveNext(job)}}
   else refresh();
  }
  if(d.type==='CBT_ERROR'&&(!job||job.current===d.id)){job=null;jobText(d.message||'Загрузка прервана. Повторите сохранение.',true);refresh()}
  if(d.type==='CBT_CLEARED')refresh();
 });
 window.addEventListener('message',event=>{
  const frame=target?.querySelector('iframe');if(event.origin!==location.origin||event.source!==frame?.contentWindow)return;
  if(event.data?.type==='CBT_FULLSCREEN'){
   if(event.data.action==='toggle')lessonFullscreen(!expandedFrame);
   else if(event.data.action==='exit')lessonFullscreen(false);
   else if(event.data.action==='state')frame.contentWindow.postMessage({type:'CBT_FULLSCREEN_STATE',active:expandedFrame===frame},location.origin);
   return;
  }
  if(event.data?.type==='CBT_RETURN_TO_CATALOG'){render(target);return;}
  if(event.data?.type==='CBT_LESSON_COMPLETE'&&opened==='intro'){localStorage.setItem('737-cbt-intro-viewed','yes');const mark=target.querySelector('[data-cbt-viewed]');if(mark)mark.checked=true}
 });
})();
