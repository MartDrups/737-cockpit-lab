'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const narration = $('narration'), video = $('scene-video');
  const key = '737-cbt-intro-native-v2';
  let lesson, scene, index = 0, epoch = 0, started = false, paused = false;
  let zoom = 1, timer = null, timerAt = 0, remaining = 0, clock = null, heard = false;
  let sceneStart = 0, blocked = false, dialogPaused = false, pauseStart = 0, scheduledRun;
  let saved;
  try { saved = JSON.parse(localStorage.getItem(key) || 'null'); } catch {}
  const settings = {audio: true, text: true, speed: 'normal', ...saved?.settings};
  const visited = new Set(saved?.visited || []), completed = new Set(saved?.completed || []);
  const comments = saved?.comments || {};
  let selected = new Set(), choice = saved?.choice || 0, matrix = saved?.matrix || [], wrong = 0;
  const stateText = text => $('player-state').textContent = text;
  const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const persist = () => {
    try { localStorage.setItem(key, JSON.stringify({index, visited: [...visited], completed: [...completed], settings, comments, choice, matrix, finished: !!saved?.finished})); } catch {}
  };
  function fit() {
    window.CBTPlayerLayout.fit(zoom);
  }
  function clearClock() {
    clearTimeout(timer); timer = null;
    clearTimeout(clock); clock = null;
  }
  function schedule(ms, run) {
    clearTimeout(timer); remaining = ms; timerAt = performance.now(); scheduledRun = run;
    timer = setTimeout(() => { timer = null; if (!paused && !blocked) run(); }, ms);
  }
  function captions(text = scene?.text || '') {
    $('caption').textContent = settings.text ? text : '';
    $('source-caption').textContent = settings.text ? text : '';
    $('source-caption').classList.toggle('off', !settings.text);
    $('text-toggle').textContent = settings.text ? 'Текст включён' : 'Текст выключен';
    $('text-toggle').setAttribute('aria-pressed', String(settings.text));
  }
  function audioLabel() {
    $('audio-toggle').textContent = settings.audio ? 'Звук включён' : 'Звук выключен';
    $('audio-toggle').setAttribute('aria-pressed', String(settings.audio));
  }
  function error(message) {
    blocked = true; clearClock(); narration.pause(); video.pause(); $('effect').pause();
    $('media-error').textContent = message; $('media-error').hidden = false;
    stateText('Материал не загружен');
  }
  function playAudio() {
    if (!scene?.audio || !settings.audio || paused) return;
    const token = epoch;
    narration.play().then(() => {
      if (token !== epoch) return;
      $('enable-audio').hidden = true;
      stateText('Урок открыт');
    }).catch(reason => {
      if (token !== epoch || reason.name === 'AbortError') return;
      if (reason.name === 'NotAllowedError') {
        $('enable-audio').hidden = false;
        stateText('Нажмите «Включить звук»');
      } else error('Не удалось загрузить озвучку. Подключитесь к интернету или завершите сохранение материалов, затем нажмите «Повторить».');
    });
  }
  function narrationFinished() {
    if (paused || blocked || heard) return;
    heard = true;
    if (scene.transition.kind === 'automatic') {
      const delay = settings.speed === 'fast' ? 0 : settings.speed === 'slow' ? (scene.transition.delay || 1) + 7 : scene.transition.delay || 1;
      const loops = scene.media.sourceMovie?.playback?.loopCount || 1;
      const animationRemaining = !scene.media.video ? 0 : scene.media.loop
        ? Math.max(0, (scene.media.duration || 0)*loops - (performance.now()-sceneStart)/1000)
        : Math.max(0,(scene.media.duration || video.duration || 0)-video.currentTime);
      schedule((delay + animationRemaining) * 1000, next);
    } else { stateText('Выполните действие на экране'); $('next').disabled = !!scene.exercise; }
  }
  function runSilentClock() {
    const token = epoch;
    const duration = (scene.audio?.duration || 2) + (scene.audioDelay || 0);
    clock = setTimeout(() => { if (token === epoch) narrationFinished(); }, Math.max(0, duration * 1000 - (performance.now() - sceneStart)));
  }
  function rectStyle(element, rect) {
    element.style.left = rect.x + 'px'; element.style.top = rect.y + 'px';
    element.style.width = rect.w + 'px'; element.style.height = Math.min(rect.h, 768 - rect.y) + 'px';
  }
  const names = {
    'audio-off':'Audio OFF', 'audio-on':'Audio ON', 'text-off':'Text OFF', 'text-on':'Text ON',
    'glossary-open':'Glossary · Глоссарий', 'glossary-close':'Close · Закрыть глоссарий',
    'comments-open':'Comments · Комментарии', 'comments-save':'Save · Сохранить',
    'captain-fd-on':'F/D командира · ON', 'practice-select':'Practice · Практика',
    'parking-brake-exercise-select':'Set parking brake', 'information-select':'Информация',
    'brake-pedals-press':'Нажать верх тормозных педалей', 'test-select':'Test · Тест',
    'choice-first':'1 · Too many', 'choice-third':'3 · The correct number',
    'choice-done':'Done · Подтвердить', 'review-open':'Review · Разбор', 'review-close':'Continue · Продолжить',
    'test-next':'Зелёная стрелка →', 'matrix-done':'Done · Подтвердить',
    'start-lever-first':'Рычаг запуска левого двигателя',
    'window-heat-1-on':'WINDOW HEAT · L SIDE', 'window-heat-2-on':'WINDOW HEAT · L FWD',
    'window-heat-3-on':'WINDOW HEAT · R FWD', 'window-heat-4-on':'WINDOW HEAT · R SIDE'
  };
  function targets() {
    return scene.exercise?.targets || [];
  }
  function addButton(target) {
    const name = names[target.id] || target.label || target.id;
    const button = document.createElement('button'); button.className = 'hotspot';
    button.dataset.action = target.id; button.setAttribute('aria-label', name);
    rectStyle(button, target.rect); button.onclick = event => { event.stopPropagation(); action(target.id); };
    $('hotspots').append(button);
    const accessible = document.createElement('button'); accessible.textContent = name;
    accessible.dataset.action = target.id; accessible.onclick = () => action(target.id);
    if (/matrix-t|window-heat/.test(target.id)) accessible.setAttribute('aria-pressed', String(selected.has(target.id)));
    $('exercise-actions').append(accessible);
  }
  function drawSelections() {
    $('selections').replaceChildren();
    if (scene.id === 'F-15.3') {
      const clean=document.createElement('div');clean.className='source-state';rectStyle(clean,{x:719,y:117,w:132,h:123});
      clean.style.backgroundImage="url('scenes/F-15.1.png')";clean.style.backgroundSize='1024px 768px';clean.style.backgroundPosition='-719px -117px';$('selections').append(clean);
    }
    for (const target of targets()) {
      if (!selected.has(target.id)) continue;
      if (scene.exercise.stateImage) {
        const patch = document.createElement('div'); patch.className = 'source-state';
        const rect = target.stateRect || target.rect;
        rectStyle(patch,rect); patch.style.backgroundImage = `url('${scene.exercise.stateImage}')`;
        patch.style.backgroundSize = '1024px 768px'; patch.style.backgroundPosition = `${-rect.x}px ${-rect.y}px`;
        $('selections').append(patch); continue;
      }
      const box = document.createElement('div'); box.className = 'selection'; rectStyle(box, target.rect);
      $('selections').append(box);
    }
    document.querySelectorAll('#exercise-actions [aria-pressed]').forEach(b => b.setAttribute('aria-pressed', String(selected.has(b.dataset.action))));
  }
  function showHint() {
    $('hotspots').querySelectorAll('.hotspot').forEach(b => b.classList.add('hinted'));
    $('instruction').textContent = scene.exercise?.instruction || scene.instruction || 'Слушайте пояснение. Урок продолжится автоматически.';
  }
  function wrongClick() {
    if (!scene.exercise || paused) return;
    wrong++; showHint();
    const feedback = lesson.feedback.find(f => f.id === scene.id + 'W1');
    if (feedback?.audio && settings.audio) {
      narration.pause(); $('effect').src = feedback.audio.file; $('effect').play().catch(() => {});
      captions(feedback.text); $('effect').onended = () => { captions(); if (!heard) playAudio(); };
    } else if (lesson.effects.beep) {
      $('effect').src = lesson.effects.beep.file; $('effect').play().catch(() => {});
    }
    stateText('Попробуйте ещё раз');
  }
  function applyExpected(expected) {
    if (typeof expected.audioEnabled === 'boolean') settings.audio = expected.audioEnabled;
    if (typeof expected.narrationTextVisible === 'boolean') settings.text = expected.narrationTextVisible;
    if (expected.selectedOption) choice = expected.selectedOption;
    audioLabel(); captions();
  }
  function action(id) {
    if (!started || paused || blocked) return;
    const target = targets().find(t => t.id === id);
    if (!target) return wrongClick();
    if (scene.exercise.kind === 'matrix-done') {
      if (id !== 'matrix-done') {
        selected.has(id) ? selected.delete(id) : selected.add(id); drawSelections(); return;
      }
      matrix = [...selected];
    } else if (scene.exercise.kind === 'multiple-targets') {
      selected.add(id); drawSelections();
      if (selected.size !== targets().length) return;
    }
    applyExpected(scene.exercise.expected || {});
    completed.add(scene.id); persist();
    next();
  }
  function sectionMenu() {
    $('section-list').replaceChildren();
    lesson.sections.forEach(section => {
      const button = document.createElement('button');
      button.textContent = section.titleRu; button.disabled = !visited.has(section.firstSourceFrame) && !saved?.finished;
      button.onclick = () => enter(lesson.scenes.findIndex(s => s.id === section.firstSourceFrame));
      $('section-list').append(button);
    });
  }
  function next() {
    if (scene.exercise && !completed.has(scene.id)) return;
    if (index + 1 < lesson.scenes.length) enter(index + 1);
    else finish();
  }
  function finish() {
    clearClock(); narration.pause(); video.pause();
    const required = lesson.scenes.filter(s => s.exercise || ['green-arrow','native-options-close'].includes(s.transition.kind));
    const full = visited.size === lesson.scenes.length && required.every(s => completed.has(s.id));
    saved ||= {}; saved.finished = full;
    $('completion').hidden = false; stateText(full ? 'Урок завершён' : 'Конец урока · часть разделов ещё не просмотрена');
    $('lesson-progress').value = visited.size; persist(); sectionMenu();
    $('completion').querySelector('h2').textContent=full?'Урок завершён':'Есть непройденные сцены';
    const missing=lesson.scenes.findIndex(s=>!visited.has(s.id)||required.includes(s)&&!completed.has(s.id));
    window.CBTPlayerLayout.complete({title:full?'Урок завершён':'Есть непройденные сцены',
      detail:full?'Прогресс сохранён. Можно перейти к следующему уроку.':'Пройдите оставшиеся сцены и задания, чтобы завершить урок.',
      repeat:()=>start(true),resume:full?null:()=>enter(Math.max(0,missing))});
    if (full) parent.postMessage({type:'CBT_LESSON_COMPLETE',id:'intro'}, location.origin);
  }
  function enter(nextIndex) {
    if (nextIndex < 0 || nextIndex >= lesson.scenes.length) return;
    window.CBTPlayerLayout.dismissCompletion();
    epoch++; const token = epoch; clearClock(); narration.pause(); video.pause(); $('effect').pause(); $('effect').onended = null;
    index = nextIndex; scene = lesson.scenes[index]; heard = false; blocked = false; paused = false;
    sceneStart = performance.now(); wrong = 0; selected = new Set();
    $('media-error').hidden = true; $('enable-audio').hidden = true; $('completion').hidden = true;
    $('hotspots').replaceChildren(); $('exercise-actions').replaceChildren(); $('selections').replaceChildren();
    $('scene-image').onerror = () => { if (token === epoch) error('Не удалось открыть изображение сцены. Проверьте соединение и нажмите «Повторить».'); };
    $('scene-image').src = scene.media.image || scene.media.poster;
    $('scene-image').alt = scene.title;
    $('scene-image').onload = () => { if (token === epoch) fit(); };
    video.hidden = !scene.media.video;
    video.onended = () => {};
    video.onerror = () => { if (token === epoch && scene.media.video) error('Не удалось открыть анимацию. Проверьте соединение и нажмите «Повторить».'); };
    if (scene.media.video) {
      rectStyle(video, scene.media.rect || {x:0,y:0,w:1024,h:768});
      let cycles = scene.media.loop ? scene.media.sourceMovie?.playback?.loopCount || 1 : 1;
      video.src = scene.media.video; video.loop = false;
      video.onended = () => { if (token===epoch && --cycles>0) { video.currentTime=0; if (!paused) video.play().catch(()=>{}); } };
      video.play().catch(() => {});
    } else { video.removeAttribute('src'); video.load(); }
    $('section-title').textContent = lesson.sections.find(s => s.sourceSection === scene.section)?.titleRu || lesson.title;
    $('scene-counter').textContent = `${index+1} / ${lesson.scenes.length}`;
    $('lesson-progress').value = visited.size;
    $('instruction').textContent = scene.exercise?.instruction || scene.instruction || 'Слушайте пояснение.';
    captions(); audioLabel();
    $('pause').textContent = 'Пауза'; $('pause').setAttribute('aria-pressed','false');
    $('back').disabled = index === 0;
    $('next').disabled = true;
    $('next').textContent = scene.transition.kind === 'native-options-close' ? 'Close · Закрыть' : 'Продолжить →';
    targets().forEach(addButton);
    if (scene.transition.kind === 'green-arrow') {
      const forward=document.createElement('button');forward.className='hotspot';forward.setAttribute('aria-label','Зелёная стрелка · продолжить');
      rectStyle(forward,{x:336,y:717,w:54,h:47});forward.onclick=event=>{event.stopPropagation();if(!heard)return;completed.add(scene.id);persist();next();};$('hotspots').append(forward);
    }
    if (scene.exercise?.kind === 'matrix-done') {
      const labels = ['RUNWAY TURNOFF · ON','RUNWAY TURNOFF · OFF','TAXI · ON','TAXI · OFF','FIXED LANDING · ON','FIXED LANDING · OFF'];
      targets().filter(t => t.id !== 'matrix-done').forEach((t,i) => {
        document.querySelector(`#exercise-actions [data-action="${t.id}"]`).textContent = labels[i];
        document.querySelector(`#hotspots [data-action="${t.id}"]`).setAttribute('aria-label',labels[i]);
      });
    }
    if (['F-15.3','F-15.4'].includes(scene.id)) {
      const clean = document.createElement('div'); clean.className = 'source-state';
      rectStyle(clean,{x:719,y:117,w:132,h:123});
      clean.style.backgroundImage = "url('scenes/F-15.1.png')"; clean.style.backgroundSize = '1024px 768px'; clean.style.backgroundPosition = '-719px -117px';
      $('selections').append(clean);
      if (scene.id === 'F-15.4') {
        const table = lesson.scenes.find(s=>s.id==='F-15.3').exercise.targets;
        table.filter(t=>matrix.includes(t.id)).forEach(t=>{const box=document.createElement('div');box.className='selection';rectStyle(box,t.rect);$('selections').append(box);});
        table.filter(t=>['matrix-t2','matrix-t3','matrix-t5'].includes(t.id)).forEach(t=>{const box=document.createElement('div');box.className='selection correct';rectStyle(box,t.rect);$('selections').append(box);});
        const correct = matrix.length===3 && ['matrix-t2','matrix-t3','matrix-t5'].every(t=>matrix.includes(t));
        const result = document.createElement('div'); result.className='source-result'; result.textContent=correct?'Correct':'Incorrect'; result.style.color=correct?'#00ff00':'#ff5555';
        $('selections').append(result);
      }
    }
    if (['F-15.5','F-15.6','F-15.7'].includes(scene.id)) {
      const correct = matrix.length===3 && ['matrix-t2','matrix-t3','matrix-t5'].every(t=>matrix.includes(t));
      const counter=document.createElement('div');counter.className='source-counter';counter.textContent=`Question 3 of 3, ${correct?2:1} correct.`;$('selections').append(counter);
    }
    visited.add(scene.id); persist(); sectionMenu(); fit(); stateText('Урок открыт');
    narration.onended = () => { if (token === epoch) narrationFinished(); };
    narration.onerror = () => { if (token === epoch && scene.audio && settings.audio) error('Озвучка не загружена. Проверьте интернет или сохранение материалов и нажмите «Повторить».'); };
    if (scene.audio) {
      narration.src = scene.audio.file;
      if (settings.audio) {
        if (scene.audioDelay) schedule(scene.audioDelay*1000, playAudio);
        else playAudio();
      } else runSilentClock();
    } else { narration.removeAttribute('src'); narration.load(); runSilentClock(); }
    const following = lesson.scenes[index+1];
    if (following?.media.image) { const image = new Image(); image.src = following.media.image; }
  }
  function pause(value) {
    if (!started || paused === value) return;
    paused = value;
    if (value) {
      pauseStart = performance.now();
      remaining = timer ? Math.max(0,remaining-(performance.now()-timerAt)) : 0;
      clearTimeout(timer); timer = null; clearTimeout(clock); clock = null;
      narration.pause(); video.pause(); $('effect').pause();
    } else {
      sceneStart += performance.now() - pauseStart;
      if (scene.media.video && !video.ended) video.play().catch(() => {});
      if (remaining > 0 && scheduledRun) schedule(remaining, scheduledRun);
      else if (!heard) settings.audio && scene.audio ? playAudio() : runSilentClock();
      else if (scene.transition.kind === 'automatic') schedule(remaining || 1,next);
    }
    $('pause').textContent = value ? 'Продолжить' : 'Пауза'; $('pause').setAttribute('aria-pressed',String(value));
    stateText(value ? 'Пауза' : 'Урок открыт'); persist();
  }
  function openDialog(id) {
    if (!document.querySelector('dialog[open]')) dialogPaused = paused;
    pause(true); $('options-dialog').close();
    $(id).showModal();
  }
  document.querySelectorAll('[data-close-dialog]').forEach(b => b.onclick = () => b.closest('dialog').close());
  document.querySelectorAll('dialog').forEach(d => d.addEventListener('close',()=>{ if (!document.querySelector('dialog[open]') && !dialogPaused) pause(false); }));
  $('pause').onclick = () => pause(!paused);
  $('repeat').onclick = () => enter(index);
  $('retry').onclick = () => location.reload();
  $('audio-toggle').onclick = () => {
    const required = targets().find(t => t.id === (settings.audio ? 'audio-off' : 'audio-on'));
    if (required) { action(required.id); return; }
    settings.audio = !settings.audio; audioLabel();
    if (settings.audio) { clearTimeout(clock); playAudio(); }
    else { narration.pause(); runSilentClock(); }
    persist();
  };
  $('text-toggle').onclick = () => {
    const required = targets().find(t => t.id === (settings.text ? 'text-off' : 'text-on'));
    if (required) { action(required.id); return; }
    settings.text = !settings.text; captions(); persist();
  };
  $('enable-audio').onclick = () => { settings.audio = true; audioLabel(); playAudio(); };
  $('next').onclick = () => { completed.add(scene.id); persist(); next(); };
  $('back').onclick = () => enter(Math.max(0,index-1));
  $('hint').onclick = showHint;
  $('stage').onclick = event => { if (!event.target.closest('button')) wrongClick(); };
  $('zoom-in').onclick = () => { zoom = Math.min(3,zoom+.5); fit(); };
  $('zoom-out').onclick = () => { zoom = Math.max(1,zoom-.5); fit(); };
  $('zoom-fit').onclick = () => { zoom = 1; fit(); };
  $('fullscreen').onclick = () => window.CBTPlayerLayout.fullscreen();
  $('options-open').onclick = () => openDialog('options-dialog');
  $('lesson-speed').onchange = event => { settings.speed = event.target.value; persist(); };
  function glossary() {
    const query = $('glossary-search').value.trim().toLowerCase();
    $('glossary-results').innerHTML = '<dl>'+lesson.glossary.filter(g=>g.name.toLowerCase().includes(query)||g.definition.toLowerCase().includes(query)).map(g=>`<dt>${escape(g.name)}</dt><dd>${escape(g.definition)}</dd>`).join('')+'</dl>';
  }
  $('glossary-open').onclick = () => { openDialog('glossary-dialog'); glossary(); };
  $('glossary-search').oninput = glossary;
  $('comments-open').onclick = () => { $('comment-text').value = comments[scene.id] || ''; openDialog('comments-dialog'); };
  $('comment-save').onclick = () => { comments[scene.id] = $('comment-text').value; persist(); $('comments-dialog').close(); };
  $('menu-open').onclick = () => { $('options-dialog').close(); $('contents').open = true; $('contents').scrollIntoView({behavior:'smooth',block:'start'}); };
  $('review-lesson').onclick = () => enter(0);
  function start(reset = false) {
    if (reset) { visited.clear(); completed.clear(); choice = 0; matrix = []; saved = null; settings.audio = true; settings.text = true; }
    started = true; $('loading').hidden = true; $('lesson').hidden = false;
    $('lesson-speed').value = settings.speed;
    const requested = lesson.scenes.findIndex(s => s.id === decodeURIComponent(location.hash.slice(1)));
    enter(reset ? 0 : requested >= 0 ? requested : Math.min(saved?.index || 0,lesson.scenes.length-1));
  }
  $('start-lesson').onclick = () => start();
  $('restart-lesson').onclick = () => start(true);
  addEventListener('pagehide',() => { if(started)persist(); narration.pause(); video.pause(); });
  document.addEventListener('visibilitychange',() => { if (document.hidden && started) pause(true); });
  fetch('lesson.json').then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(data => {
    lesson = data; $('start-lesson').disabled = false;
    $('start-lesson').textContent = saved?.index ? 'Продолжить урок' : 'Начать урок';
    $('restart-lesson').hidden = !saved?.index;
    $('load-message').textContent = 'Урок готов. Управляйте показанными кнопками и выполняйте инструкции.';
    stateText('Готов к запуску');
    narration.src = lesson.scenes[saved?.index || 0]?.audio?.file || '';
    window.CBTNative = {get current(){return scene?.id;},get state(){return {index,paused,heard,blocked,visited:[...visited],completed:[...completed],settings,choice,matrix};},get lesson(){return lesson;},goTo:id=>enter(lesson.scenes.findIndex(s=>s.id===id))};
  }).catch(() => { $('load-message').textContent = 'Не удалось получить материалы урока. Проверьте интернет или завершите загрузку в окне «Приложение».'; $('retry').hidden = false; stateText('Урок не загружен'); });
})();
