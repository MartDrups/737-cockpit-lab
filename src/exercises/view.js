'use strict';
/* The normal-procedure trainer owns its own state; reference controls remain unchanged. */
window.NormalExerciseEngine=(()=>{
 const data=window.EXERCISES_DATA,byId=new Map(data.phases.map(p=>[p.id,p]));
 function matches(role,c){return c.seat==='crew'||role==='BOTH'||role===(c.seat==='captain'?'C':'FO')||role===c.flightRole;}
 function included(s,c){return (!s.when||s.when===c.power)&&((s.checklist&&!s.checklistEvent)||matches(s.role,c));}
 function readable(s){return !!s&&(s.method==='reference'||s.method==='checklist');}
 function build(config,choice){
  const c={power:'gpu',seat:'crew',flightRole:'PF',approach:'ils',finish:'shutdown',...config};
  let phases=choice==='full'?data.phases.filter(p=>p.route&&(!p.approach||p.id===c.approach)):[byId.get(choice)].filter(Boolean);
  if(choice==='full'){const end=phases.findIndex(p=>p.id===c.finish);if(end>=0)phases=phases.slice(0,end+1);}
  const all=[];
  const pfRight=(c.seat==='fo'&&c.flightRole==='PF')||(c.seat==='captain'&&c.flightRole==='PM');
  function station(item){
   if(!/^(pfd|cdu|efis-wxr|efis-terr)-[lr]$/.test(item.target||''))return item;
   let right;
   if(item.checklist&&c.seat!=='crew')right=c.seat==='fo';
   else if(item.role==='PF'||item.role==='PM')right=item.role==='PF'?pfRight:!pfRight;
   else if(item.role==='BOTH'&&c.seat!=='crew')right=c.seat==='fo';
   else return item;
   item.target=item.target.slice(0,-1)+(right?'r':'l');return item;
  }
  for(const p of phases){
   const flow=p.steps.map((s,i)=>({...s,id:p.id+':flow:'+i,phase:p.id,phaseTitle:p.title,document:p.source.document,section:p.source.section,checklist:false}));
   // FD of PF goes on first. Default seat assignment for crew practice: Captain PF.
   flow.forEach(station);
   if(pfRight)for(let i=0;i<flow.length-1;i++)if(flow[i].target==='fd-l'&&flow[i+1].target==='fd-r'&&flow[i].value==='ON'&&flow[i+1].value==='ON'){[flow[i],flow[i+1]]=[flow[i+1],flow[i]];i++;}
   const meta=p.normalChecklist;
   const nc=p.checklist.map((s,i)=>station({...s,id:p.id+':nc:'+i,phase:p.id,phaseTitle:p.title,checklist:true,checklistName:meta.name,reader:meta.reader,caller:meta.caller}));
   if(meta){
    const event=(type,role,detail)=>({id:p.id+':nc:'+type,phase:p.id,phaseTitle:p.title,checklist:true,checklistEvent:type,checklistName:meta.name,reader:meta.reader,caller:meta.caller,method:'checklist',target:null,value:'Подтверждено',kind:'context',role,detail,document:'SOP',section:'2.4.1',page:type==='call'?42:43});
    nc.unshift(event('call',meta.caller,'Вызвать '+meta.name+' CHECKLIST после завершения процедуры.'));
    nc.push(event('complete',meta.reader,'Объявить: '+meta.name+' CHECKLIST COMPLETE.'));
   }
   flow.splice(p.checklistAfter??flow.length,0,...nc);all.push(...flow);
  }
  return {config:c,choice,all:all.filter(s=>!s.when||s.when===c.power),steps:all.filter(s=>included(s,c))};
 }
 function attempt(session,target,value){
  const step=session.plan.steps[session.cursor];if(!step)return {ok:false,reason:'complete'};
  const same=step.target===target;
  const correct=same&&(step.kind==='number'?/^-?\d+(?:[.,]\d+)?$/.test(String(value).trim())&&Number.isFinite(Number(String(value).replace(',','.')))&&Math.abs(Number(String(value).replace(',','.'))-Number(step.value))<0.011:String(value)===step.value);
  if(!correct){session.errors.push({stepId:step.id,target,value,expected:step.value,time:Date.now()});return {ok:false,reason:same?'value':'target'};}
  if(target)session.states[target]=String(value);session.cursor++;return {ok:true,done:session.cursor===session.plan.steps.length};
 }
 return {build,attempt,included,readable,matches};
})();
window.ExercisesView=(()=>{
 const data=window.EXERCISES_DATA,engine=window.NormalExerciseEngine,surface=window.CockpitSurface;
 const controls=new Map(window.COCKPIT_DATA.controls.map(c=>[c.id,c]));
 const panels=window.COCKPIT_DATA.panels,refs=window.COCKPIT_DATA.panelRefs;
 const phaseById=new Map(data.phases.map(p=>[p.id,p]));
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const storageKey='b737-normal-exercises-v1';
 let host=null,root=null,session=null,panel='combined',hinted=false,lastPhase=null,feedback='',feedbackKind='',settings={mode:'guided',seat:'crew',flightRole:'PF',power:'gpu',approach:'ils',finish:'shutdown'},saved=null,history=[];
 const roles={C:'КВС',FO:'Второй пилот',PF:'PF',PM:'PM',BOTH:'Экипаж'};
 let resetNotice=false;
 function read(){try{const raw=JSON.parse(localStorage.getItem(storageKey)||'null');if(raw){settings={...settings,...raw.settings};history=Array.isArray(raw.history)?raw.history.slice(-80):[];if(raw.revision===data.revision)saved=raw.session;else resetNotice=!!raw.session;}}catch{}}
 read();
 function store(){try{localStorage.setItem(storageKey,JSON.stringify({revision:data.revision,settings,history,session:session?{choice:session.plan.choice,config:session.plan.config,cursor:session.cursor,states:session.states,errors:session.errors,hints:session.hints,checklistPaused:!!session.checklistPaused,started:session.started}:saved}));}catch{}}
 function select(name,label,options){return `<label>${label}<select data-ex-setting="${name}">${options.map(([v,t])=>`<option value="${v}" ${settings[name]===v?'selected':''}>${t}</option>`).join('')}</select></label>`;}
 function catalogue(){
  session=null;lastPhase=null;document.body.classList.remove('exercise-running');
  const groups=[...new Set(data.phases.map(p=>p.group))];
  root.innerHTML=`<section class="ex-intro"><div><span class="ex-kicker">NORMAL PROCEDURES · S7</span><h2>От первого питания<br>до выключения двигателей.</h2><p>Выполняйте normal flow по памяти или с подсказками. Supplementary Procedures читайте по документу, затем проверяйте конфигурацию по открытому чек-листу.</p></div><div class="ex-intro-mark" aria-hidden="true">01 <span>→</span> 27</div></section><div class="ex-method-legend">${Object.entries(data.methods).map(([key,m])=>`<div class="ex-method-tag ${key}"><strong>${esc(m.label)}</strong><span>${esc(m.description)}</span></div>`).join('')}</div><section class="ex-settings" aria-label="Настройки упражнения">${select('mode','Тренировка normal flow',[['guided','Flow с подсказками'],['memory','Flow по памяти']])}${select('seat','Рабочее место',[['crew','Весь экипаж'],['captain','КВС'],['fo','Второй пилот']])}${select('flightRole','Роль в полёте',[['PF','Pilot Flying · PF'],['PM','Pilot Monitoring · PM']])}${select('power','Power Up',[['gpu','Внешнее питание · GPU'],['apu','Запуск APU']])}${select('approach','Заход в полном маршруте',data.phases.filter(p=>p.approach).map(p=>[p.id,p.title]))}${select('finish','Завершение маршрута',[['shutdown','Shutdown'],['secure','Secure'],['power-down','Electrical Power Down']])}</section><div class="ex-start-row"><button class="ex-primary" data-ex-start="full">Весь маршрут <span>↗</span></button><p>Один нормальный полёт в заданных условиях. Для отдельного flow выберите процедуру ниже.</p></div>${saved?`<div class="ex-resume"><div><strong>Есть незавершённое упражнение</strong><p>${esc(saved.choice==='full'?'Весь маршрут':phaseById.get(saved.choice)?.title||'Процедура')} · ${Number(saved.cursor)||0} действий выполнено</p></div><button data-ex-resume>Продолжить →</button><button data-ex-discard aria-label="Удалить сохранённую попытку">×</button></div>`:''}<p class="ex-scenario-note">B737-800 NG, пассажирский вариант. Первый вылет дня, исправные системы, сухая погода +15°C, центральный бак пуст. Условия каждого этапа показаны перед его началом. Действия другого пилота остаются в контексте выбранной роли.</p>${groups.map(g=>`<section class="ex-group"><h3>${esc(g)}</h3><div class="ex-cards">${data.phases.filter(p=>p.group===g).map((p,i)=>{const plan=engine.build(settings,p.id),old=history.filter(h=>h.revision===data.revision&&h.choice===p.id&&h.seat===settings.seat&&h.mode===settings.mode).at(-1);return `<button class="ex-card" data-ex-start="${p.id}" ${!plan.steps.length?'disabled':''}><span class="ex-card-top"><span>${String(data.phases.indexOf(p)+1).padStart(2,'0')}</span><span>${p.source.document} · ${esc(p.source.section)}</span></span><strong>${esc(p.title)}</strong><span class="ex-card-method">${esc(data.methods[p.method].label)}${p.checklist.length?' · затем чек-лист':''}</span><span class="ex-card-bottom">${plan.steps.length?`${plan.steps.length} действий${p.checklist.length?' · чек-лист':''}`:'Выполняет другой пилот'}<span>${old?'✓':'↗'}</span></span></button>`;}).join('')}</div></section>`).join('')}<details class="ex-sources"><summary>Источники и условия тренировки</summary><p>Порядок и роли — SOP S7 Edition 8 от 15.05.2026, глава 4. Electrical Power Up/Down — FCOM SP.6.1–4; сверка нормальных процедур — FCOM NP.21. Normal checklists — SOP Appendix B, PDF 261; правила чтения и ответов — SOP 2.4.1, PDF 42–43. QRH NC.1–4 используется для сверки. Каждый шаг содержит ссылку на раздел и страницу.</p><p>Для указанного варианта панели PROBE HEAT — AUTO, transponder XPNDR соответствует ALT ON. Обозначения ON/OFF стояночного тормоза представлены физическими положениями AFT/FORWARD. Тесты, проверки и работа экипажа подтверждаются по описанным критериям; ход времени, полёт и работа FMC не моделируются. Внешний осмотр и действия вне показанных панелей подтверждаются отдельно.</p>${data.sources.map(s=>`<p><strong>${esc(s.id)}</strong> · ${esc(s.title)}<br>${esc(s.edition)}</p>`).join('')}</details>`;
  if(resetNotice)root.querySelector('.ex-start-row').insertAdjacentHTML('beforebegin','<p class="ex-scenario-note" role="status">Процедуры обновлены. Незавершённую попытку нужно начать заново; настройки и история сохранены.</p>');
  const flightRole=root.querySelector('[data-ex-setting="flightRole"]');flightRole.disabled=settings.seat==='crew';
 }
 function start(choice,resume){
  if(resume)settings={...settings,...resume.config};
  const config=resume?resume.config:settings,plan=engine.build(config,choice);if(!plan.steps.length)return;
  resetNotice=false;
  session={plan,cursor:0,errors:[],states:{},hints:0,checklistPaused:false,started:Date.now(),...resume};session.plan=plan;
  if(!Number.isInteger(session.cursor)||session.cursor<0||session.cursor>plan.steps.length){session.cursor=0;session.states={};session.errors=[];}
  const display=plan.steps.slice(0,session.cursor).reverse().find(s=>s.display)?.display;if(display)surface.setDisplayMode(display);
  saved=null;hinted=false;panel=(plan.config.mode==='guided'||engine.readable(plan.steps[session.cursor]))?surface.owner(plan.steps[session.cursor]?.target)||'combined':'combined';lastPhase=null;feedback='';
  document.body.classList.add('exercise-running');drawSession();host?.closest('main')?.scrollTo({top:0,left:0});store();
 }
 function current(){return session?.plan.steps[session.cursor];}
 function source(s){return `${s.document} · ${s.section} · PDF стр. ${s.page}`;}
 function title(s){if(s.checklist&&!s.checklistEvent)return s.challenge+' — '+s.response;return s.target?`${controls.get(s.target)?.label||s.target} — ${s.value}`:s.detail;}
 function contextFor(s){const p=phaseById.get(s.phase);return p.context+(s.phase==='power-up'?` Источник этого упражнения: ${session.plan.config.power==='gpu'?'GPU, внешнее питание':'APU'}.`:'')+(session.plan.config.seat==='crew'?' КВС выполняет PF, второй пилот — PM.':` Выбрано: ${session.plan.config.seat==='captain'?'КВС':'второй пилот'}, ${session.plan.config.flightRole}.`);}
 function teammate(s){if(session.plan.config.seat==='crew')return '';const index=session.plan.all.findIndex(x=>x.id===s.id),before=[];for(let i=index-1;i>=0&&session.plan.all[i].phase===s.phase;i--){const x=session.plan.all[i];if(engine.included(x,session.plan.config))break;before.unshift(`${roles[x.role]}: ${title(x)}`);}return before.length?`<details class="ex-teammate"><summary>Предшествующие действия другого пилота</summary>${before.map(t=>`<p>${esc(t)}</p>`).join('')}</details>`:'';}
 function documentView(s){
  if(s.checklist){
   const items=session.plan.all.filter(x=>x.phase===s.phase&&x.checklist&&!x.checklistEvent),at=session.plan.all.findIndex(x=>x.id===s.id);
   return `<section class="ex-document" data-ex-document="checklist" aria-label="${esc(s.checklistName)} checklist"><div class="ex-document-title"><span>B737NG NORMAL CHECKLISTS</span><h3>${esc(s.checklistName)}</h3></div><p class="ex-document-crew">Вызывает: ${esc(roles[s.caller])} · Читает: ${esc(roles[s.reader])}</p><ol class="ex-document-list">${items.map(x=>{const done=session.plan.all.findIndex(y=>y.id===x.id)<at,active=x.id===s.id,answer=x.role==='BOTH'?(s.caller==='C'?'КВС, затем ВП':'PF, затем PM'):roles[x.role];return `<li data-ex-doc-step="${esc(x.id)}" class="${done?'done ':''}${active?'current':''}" ${active?'aria-current="step"':''}><span class="ex-doc-status" aria-hidden="true">${done?'✓':active?'→':'·'}</span><div><div class="ex-check-line"><strong>${esc(x.challenge)}</strong><span class="ex-dot-leader"></span><span>${esc(x.response)}</span></div><small>Ответ: ${esc(answer)}</small><p class="ex-doc-note" ${active?'':'hidden'}>${esc(x.detail)}</p></div></li>`;}).join('')}</ol><p class="ex-document-source">SOP · Appendix B, PDF 261 · Правила: PDF 42–43</p></section>`;
  }
  if(s.method!=='reference')return '';
  if(s.reference)return `<section class="ex-document" data-ex-document="reference"><div class="ex-document-title"><span>SUPPLEMENTARY PROCEDURE</span><h3>${esc(s.reference.title)}</h3></div><ol class="ex-reference-lines">${s.reference.lines.map(t=>`<li>${esc(t)}</li>`).join('')}</ol><p class="ex-document-source">${esc(s.reference.source)}</p></section>`;
  const items=session.plan.all.filter(x=>x.phase===s.phase&&!x.checklist&&x.method==='reference'),at=session.plan.all.findIndex(x=>x.id===s.id);
  return `<section class="ex-document" data-ex-document="reference"><div class="ex-document-title"><span>SUPPLEMENTARY PROCEDURE</span><h3>${esc(s.phaseTitle)}</h3></div><p class="ex-document-crew">Читайте строку, выполните действие и проверьте результат.</p><ol class="ex-document-list">${items.map(x=>{const done=session.plan.all.findIndex(y=>y.id===x.id)<at,active=x.id===s.id;return `<li data-ex-doc-step="${esc(x.id)}" class="${done?'done ':''}${active?'current':''}" ${active?'aria-current="step"':''}><span class="ex-doc-status" aria-hidden="true">${done?'✓':active?'→':'·'}</span><div><strong>${esc(title(x))}</strong>${x.detail&&x.target?`<p class="ex-doc-note">${esc(x.detail)}</p>`:''}</div></li>`;}).join('')}</ol><p class="ex-document-source">${esc(source(s))}</p></section>`;
 }
 function instruction(s,known){
  if(s.checklist){
   if(s.checklistEvent)return `<div class="ex-instruction"><h3>${s.checklistEvent==='call'?'Вызов чек-листа':'Завершение чек-листа'}</h3><p>${esc(s.detail)}</p><button class="ex-primary" data-ex-confirm>${s.checklistEvent==='call'?'Чек-лист вызван':'CHECKLIST COMPLETE'}</button></div>`;
   const own=engine.matches(s.role,session.plan.config),reads=engine.matches(s.reader,session.plan.config);
   return `<div class="ex-instruction"><h3>${esc(s.challenge)} — ${esc(s.response)}</h3><p class="ex-check-duty">${reads?'Вы читаете пункт. ':''}${own?'Дайте указанный ответ после проверки.':'Проверьте конфигурацию и подтвердите ответ другого пилота.'}</p>${session.checklistPaused?'<p class="ex-check-paused" role="alert">Чек-лист остановлен. Выполните соответствующие действия процедуры; затем возобновите проверку этого пункта.</p>':''}<div class="ex-check-actions"><button class="ex-primary" data-ex-check-complete>${session.checklistPaused?'Возобновить проверку':'Пункт проверен'}</button>${session.checklistPaused?'':'<button data-ex-check-stop title="Несоответствие — остановить чек-лист">Остановить</button>'}</div></div>`;
  }
  if(s.kind==='context')return `<div class="ex-instruction"><h3>Подтвердите выполнение</h3><p>${esc(s.detail)}</p><button class="ex-primary" data-ex-confirm>Выполнено</button></div>`;
  return `<div class="ex-instruction"><h3>${known?esc(title(s)):'Вспомните следующее действие'}</h3><p>${known?esc(s.detail||'Найдите элемент на панели и задайте его положение.'):'Найдите нужный элемент в кабине и выполните действие в правильной последовательности.'}</p>${!known?'<button data-ex-hint>Показать подсказку</button>':''}</div>`;
 }
 function drawSession(){
  document.body.classList.add('exercise-running');
  if(!current()){complete();return;}
  const s=current(),known=session.plan.config.mode==='guided'||hinted||engine.readable(s),method=data.methods[s.method],doc=documentView(s);
  const camera=!known&&root.querySelector('#ex-board')?surface.getCamera():null;
  root.innerHTML=`<div class="ex-session-top"><button data-ex-exit>← К процедурам</button><span>${session.plan.config.mode==='guided'?'Flow с подсказками':'Flow по памяти'} · ${session.plan.config.seat==='crew'?'Весь экипаж':session.plan.config.seat==='captain'?'КВС':'Второй пилот'}${session.plan.config.seat!=='crew'?' · '+session.plan.config.flightRole:''}</span><button data-ex-restart>Начать заново</button></div><div class="ex-run-heading"><div><span class="ex-kicker">${esc(method.label)}</span><h2>${esc(s.phaseTitle)}</h2></div><div class="ex-counter"><strong>${session.cursor+1}</strong> / ${session.plan.steps.length}</div></div><progress class="ex-progress" max="${session.plan.steps.length}" value="${session.cursor}" aria-label="Выполнено действий"></progress><div class="ex-running-layout ${doc?'ex-has-document':''}"><div class="ex-board-area"><nav class="ex-panel-tabs" aria-label="Панели для упражнения">${panels.map(p=>`<button data-ex-panel="${p.id}" class="${panel===p.id?'active':''}">${esc(p.id==='combined'?'Вся кабина':p.name)}</button>`).join('')}</nav><div id="ex-board"></div></div><aside class="ex-coach ${s.checklist?'ex-checklist-coach':''}" aria-label="Условия и ход упражнения"><div class="ex-step-line"><span>${s.checklist&&!s.checklistEvent?'Проверяют оба':esc(roles[s.role])}</span><span>${s.checklist?'Чек-лист':s.kind==='context'?'Экипаж / вне панелей':s.kind==='check'?'Проверка':'Действие'}</span></div><details class="ex-context" ${lastPhase!==s.phase&&!s.checklist?'open':''}><summary>Условия этапа</summary><p>${esc(contextFor(s))}</p></details><details class="ex-method"><summary>${esc(method.label)}</summary><p>${esc(method.description)}</p><small>${esc(method.source)}</small></details>${doc}${s.event?`<div class="ex-event"><span>СЕЙЧАС</span><p>${esc(s.event)}</p></div>`:''}${instruction(s,known)}<div id="ex-feedback" class="ex-feedback ${feedbackKind}" role="status" aria-live="polite">${esc(feedback)}</div>${teammate(s)}<details class="ex-source"><summary>Источник шага</summary><p>${esc(source(s))}</p>${known?`<p>${esc(s.detail)}</p>`:'<p>Подсказка открывает ожидаемое действие и критерий проверки.</p>'}</details><div class="ex-attempt-stats"><span>Ошибки действий <b>${session.errors.length}</b></span><span>Подсказки flow <b>${session.hints}</b></span></div><p class="ex-last-state" id="ex-last-state"></p></aside></div><dialog class="ex-action-dialog" aria-labelledby="ex-action-title"><div class="ex-action-head"><h3 id="ex-action-title"></h3><button data-ex-close aria-label="Закрыть выбор действия">×</button></div><div id="ex-action-body"></div></dialog>`;
  lastPhase=s.phase;board(known);if(camera&&camera.panel===panel)requestAnimationFrame(()=>requestAnimationFrame(()=>surface.restoreCamera(camera)));
  requestAnimationFrame(()=>{const list=root?.querySelector('.ex-document-list'),row=list?.querySelector('[aria-current="step"]');if(row)list.scrollTop=Math.max(0,row.offsetTop-list.clientHeight/3);});
 }
 function board(reveal=false){
  const el=root.querySelector('#ex-board');if(!el)return;
  const s=current(),highlight=(session.plan.config.mode==='guided'||hinted||engine.readable(s))&&s?.target;
  const displayMode=controls.get(highlight)?.displayMode;if(displayMode)surface.setDisplayMode(displayMode);
  surface.render(el,{panel,selected:highlight?s.target:null,matches:null,zones:false,refs:refs[panel]||refs.overhead});
  el.querySelectorAll('.panel-original,.variant-controls').forEach(n=>n.remove());
  const hint=el.querySelector('.canvas-hint');if(hint)hint.textContent='Выберите орган управления · Перетаскивайте и увеличивайте панель';
  el.querySelectorAll('.part-open').forEach(n=>{n.dataset.exPanel=n.dataset.panel;delete n.dataset.panel;});
  el.querySelectorAll('[data-panel]').forEach(n=>{n.dataset.exPanel=n.dataset.panel;delete n.dataset.panel;});
  if(highlight&&reveal)document.fonts.ready.then(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{if(root.querySelector("#ex-board")===el&&current()?.target===s.target)surface.reveal(s.target);})));
 }
 function setPanel(id){if(!session||!panels.some(p=>p.id===id))return;panel=id;root.querySelectorAll('[data-ex-panel]').forEach(b=>b.classList.toggle('active',b.dataset.exPanel===id));board(false);}
 function message(text,kind=''){feedback=text;feedbackKind=kind;const el=root?.querySelector('#ex-feedback');if(el){el.textContent=text;el.className='ex-feedback '+kind;}}
 function choose(id){
  const s=current();if(!s)return;
  if(s.checklist&&id!==s.target){message('Сверьте конфигурацию с открытым чек-листом и подтвердите текущий пункт.');return;}
  if(id!==s.target){engine.attempt(session,id,'');store();message('Это не следующее действие. Попробуйте ещё раз.','error');root.querySelector('.ex-attempt-stats b').textContent=session.errors.length;return;}
  const c=controls.get(id),dialog=root.querySelector('.ex-action-dialog'),body=dialog.querySelector('#ex-action-body');
  dialog.querySelector('h3').textContent=c.label;
  const guided=session.plan.config.mode==='guided'||hinted||engine.readable(s);
  if(s.kind==='number')body.innerHTML=`<p>Задайте значение${s.unit?' · '+esc(s.unit):''}.</p>${guided?`<p class="ex-action-hint">${esc(s.detail)} · ${esc(s.value)} ${esc(s.unit)}</p>`:''}<form id="ex-number-form"><label>Значение<input id="ex-number" inputmode="decimal" type="text" autocomplete="off" required aria-label="Значение ${esc(c.label)}"></label><button class="ex-primary" type="submit">Установить</button></form>`;
  else if(s.kind==='check')body.innerHTML=`<p class="ex-check-criterion">${esc(s.detail)}</p><p>Сопоставьте указанный критерий проверки с условиями упражнения.</p><div class="ex-action-options"><button data-ex-answer="Проверено">Проверено</button><button data-ex-answer="Не соответствует">Не соответствует</button></div>`;
  else {const choices=s.choices||c.positions.map(p=>p.name);body.innerHTML=`${guided?`<p class="ex-action-hint">${esc(s.detail||'Выберите положение')} · ${esc(s.value)}</p>`:'<p>Выберите положение или действие.</p>'}<div class="ex-action-options">${choices.map(v=>`<button data-ex-answer="${esc(v)}">${esc(v)}</button>`).join('')}</div>`;}
  dialog.showModal();if(s.kind==='number')body.querySelector('input').focus();
 }
 function answer(value){
  const s=current();if(!s)return;const result=engine.attempt(session,s.target,value);
  if(!result.ok){store();const body=root.querySelector('#ex-action-body');let error=body.querySelector('.ex-value-error');if(!error){error=document.createElement('p');error.className='ex-value-error';error.role='alert';body.append(error);}error.textContent='Неверное положение или значение. Проверьте условия и повторите.';message('Неверное действие. Шаг остаётся текущим.','error');root.querySelector('.ex-attempt-stats b').textContent=session.errors.length;return;}
  root.querySelector('.ex-action-dialog')?.close();session.checklistPaused=false;if(s.display)surface.setDisplayMode(s.display);feedback='Выполнено: '+title(s);feedbackKind='success';hinted=false;const next=current();
  if(next&&(session.plan.config.mode==='guided'||engine.readable(next)))panel=surface.owner(next.target)||panel;
  store();drawSession();
 }
 function complete(){
  const result={revision:data.revision,choice:session.plan.choice,seat:session.plan.config.seat,mode:session.plan.config.mode,steps:session.plan.steps.length,errors:session.errors.length,hints:session.hints,at:Date.now()};
  history.push(result);history=history.slice(-80);saved=null;const done=session,hasMemory=done.plan.steps.some(s=>s.method==='memory');session=null;store();document.body.classList.remove('exercise-running');
  root.innerHTML=`<section class="ex-complete"><span class="ex-done-icon" aria-hidden="true">✓</span><span class="ex-kicker">NORMAL PROCEDURES</span><h2>Последовательность завершена</h2><p>${esc(result.choice==='full'?'Весь маршрут':phaseById.get(result.choice).title)}</p><div class="ex-result-stats"><div><strong>${result.steps}</strong><span>действий</span></div><div><strong>${result.errors}</strong><span>ошибок</span></div><div><strong>${result.hints}</strong><span>подсказок</span></div></div><p>${hasMemory?(result.mode==='guided'?'Normal flow выполнен с подсказками.':'Normal flow выполнен по памяти'+(result.hints?' с дополнительными подсказками.':'.')):'Процедура выполнена с открытым текстом.'} Read and Do и чек-листы выполнялись с открытым текстом.</p><div><button class="ex-primary" data-ex-start="${esc(result.choice)}">Повторить</button> <button data-ex-catalog>К процедурам</button></div>${done.errors.length?`<details class="ex-review"><summary>Разобрать ошибки · ${done.errors.length}</summary>${done.errors.map(e=>{const s=done.plan.steps.find(s=>s.id===e.stepId);return `<p><strong>${esc(s?.phaseTitle)}</strong><br>${esc(s?title(s):e.stepId)}<br><small>${esc(s?source(s):'')}</small></p>`;}).join('')}</details>`:''}</section>`;
 }
 function handle(e){
  const b=e.target.closest('button');if(!b)return;
  if(b.hasAttribute('data-ex-start'))start(b.dataset.exStart);
  else if(b.hasAttribute('data-ex-resume'))start(saved.choice,saved);
  else if(b.hasAttribute('data-ex-discard')){saved=null;store();catalogue();}
  else if(b.hasAttribute('data-ex-exit')){saved={choice:session.plan.choice,config:session.plan.config,cursor:session.cursor,states:session.states,errors:session.errors,hints:session.hints,checklistPaused:!!session.checklistPaused,started:session.started};session=null;store();catalogue();}
  else if(b.hasAttribute('data-ex-restart'))start(session.plan.choice);
  else if(b.hasAttribute('data-ex-catalog'))catalogue();
  else if(b.dataset.exPanel)setPanel(b.dataset.exPanel);
  else if(b.hasAttribute('data-ex-hint')){session.hints++;hinted=true;panel=surface.owner(current().target)||panel;store();drawSession();}
  else if(b.hasAttribute('data-ex-check-stop')){session.checklistPaused=true;store();drawSession();}
  else if(b.hasAttribute('data-ex-check-complete')){if(session.checklistPaused){session.checklistPaused=false;store();drawSession();}else answer(current().value);}
  else if(b.hasAttribute('data-ex-confirm'))answer('Подтверждено');
  else if(b.hasAttribute('data-ex-answer'))answer(b.dataset.exAnswer);
  else if(b.hasAttribute('data-ex-close'))root.querySelector('.ex-action-dialog').close();
  else if(session&&(b.dataset.control||b.dataset.related)){e.preventDefault();e.stopPropagation();choose(b.dataset.control||b.dataset.related);return;}
  else if(b.dataset.zoom||b.dataset.focusPart||b.dataset.displayMode)return;else return;
  e.preventDefault();e.stopPropagation();
 }
 function render(container){host=container;if(root?.isConnected)return;root=document.createElement('div');root.className='exercises-root';container.replaceChildren(root);root.addEventListener('click',handle);root.addEventListener('submit',e=>{if(e.target.id==='ex-number-form'){e.preventDefault();answer(root.querySelector('#ex-number').value);}});root.addEventListener('change',e=>{if(e.target.dataset.exSetting){settings[e.target.dataset.exSetting]=e.target.value;store();catalogue();}});if(session)drawSession();else catalogue();}
 function close(){if(!root)return;root.querySelector('.ex-action-dialog')?.close();root=null;host=null;document.body.classList.remove('exercise-running');}
 return {render,close,setPanel,isRunning:()=>!!session,getState:()=>session?{cursor:session.cursor,total:session.plan.steps.length,current:current(),errors:session.errors.length,mode:session.plan.config.mode}:null};
})();
