'use strict';
window.SystemReferenceView = (() => {
  const data = window.FCOM_SYSTEM_REFERENCE;
  const sectionDiagrams = /* @section-diagrams */ {};
  const aliases = /* @node-aliases */ {};
  const extraDiagrams = /* @extra-diagrams */ {};
  for (const [id, entry] of Object.entries(extraDiagrams)) {
    data.diagrams[id] = entry.diagram;
    if (!data.systems[entry.system].diagrams.includes(id)) data.systems[entry.system].diagrams.push(id);
  }
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const literal = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const refs = values => `<div class="fcom-links">${values.map(ref => `<button data-fcom="${esc(ref)}" data-sequence="${esc(values.join('|'))}">${esc(ref)} ↗</button>`).join('')}</div>`;
  const generic = new Set(['LEFT','RIGHT','NORMAL','AUTO','MANUAL','ENGINE','PUMP','CONTROL','VALVE','PRESSURE','OFF','ON','UP','DOWN','OPEN','CLOSED','POWER','AFT','FWD','LOW','HIGH','SYSTEM','STANDBY','TRANSFER','SOURCE','FIRE','BLEED','BAT','TEST','ARM','DEPLOY','STOW']);
  let root, systemId, controller, lazyObserver, dialog, modalState, selected = null;
  const plans = new Map();
  const viewers = new Map();

  function dispose() {
    controller?.abort();
    lazyObserver?.disconnect();
    if (dialog?.open) closeFigure();
    for (const viewer of viewers.values()) viewer.dispose();
    viewers.clear();
    plans.clear();
    selected = null;
  }

  function rulesFor(system, section, preferred) {
    const diagrams = data.systems[system].diagrams;
    const rules = [];
    function add(pattern, ids, priority = 0) {
      const choices = diagrams.map(id => {
        const d = data.diagrams[id];
        const nodes = d.nodes.filter(n => ids.includes(n.id));
        const local = nodes.filter(n => n.section === section.id).length;
        const order = preferred.indexOf(id);
        return {id, nodes, score: nodes.length * 100 + (order < 0 ? 0 : 50 - order) + local};
      }).filter(choice => choice.nodes.length).sort((a, b) => b.score - a.score);
      if (!choices.length) return;
      const choice = choices[0];
      rules.push({pattern: new RegExp(pattern, 'giu'), diagram: choice.id, nodes: choice.nodes.map(n => n.id), priority});
    }
    // Exact labels are a safe baseline. Inflected Russian names and abbreviations
    // below are explicitly tied to existing, inspectable hotspots.
    const names = new Map();
    for (const id of preferred) {
      for (const n of data.diagrams[id].nodes) {
        const values = [n.name, n.name.split(' · ')[0], n.en];
        if (n.section === section.id) values.push(...n.en.split(/\s+\/\s+/));
        for (const term of values) {
          if (term.length < 3 || generic.has(term.toUpperCase())) continue;
          const ids = names.get(term) || new Set();
          ids.add(n.id);
          names.set(term, ids);
        }
      }
    }
    for (const [term, ids] of names) add(literal(term), [...ids]);
    for (const rule of aliases[system] || []) {
      if (!rule.sections || rule.sections.includes(section.id)) add(rule.pattern, rule.nodes, rule.sections ? 20 : 10);
    }
    return rules;
  }

  function linkText(text, plan, rules) {
    const matches = [];
    for (const rule of rules) {
      rule.pattern.lastIndex = 0;
      for (const match of text.matchAll(rule.pattern)) {
        const start = match.index, end = start + match[0].length;
        if (/^[\p{L}\p{N}_]/u.test(match[0]) && /[\p{L}\p{N}_]/u.test(text[start - 1] || '')) continue;
        if (/[\p{L}\p{N}_]$/u.test(match[0]) && /[\p{L}\p{N}_]/u.test(text[end] || '')) continue;
        matches.push({start, end, text: match[0], rule});
      }
    }
    matches.sort((a, b) => (b.end-b.start)-(a.end-a.start) || b.rule.priority-a.rule.priority || a.start-b.start);
    const chosen = [];
    for (const match of matches) {
      if (!chosen.some(other => match.start < other.end && match.end > other.start)) chosen.push(match);
    }
    chosen.sort((a, b) => a.start-b.start);
    let html = '', position = 0;
    for (const match of chosen) {
      const {diagram, nodes} = match.rule;
      if (!plan.diagrams.includes(diagram)) plan.diagrams.push(diagram);
      const labels = nodes.map(id => data.diagrams[diagram].nodes.find(n => n.id === id).name).join('; ');
      html += esc(text.slice(position, match.start));
      html += `<a class="system-term" href="#system-figure-${esc(plan.id)}" data-system-term data-section="${esc(plan.id)}" data-target-diagram="${esc(diagram)}" data-target-nodes="${esc(nodes.join('|'))}" aria-controls="system-figure-${esc(plan.id)}" title="Показать на схеме: ${esc(labels)}">${esc(match.text)}</a>`;
      position = match.end;
    }
    return html + esc(text.slice(position));
  }

  function render(container, id) {
    dispose();
    root = container;
    systemId = id;
    controller = new AbortController();
    const system = data.systems[id];
    const meta = window.COCKPIT_DATA.systems.find(s => s.id === id);
    const sections = system.sections.map(section => {
      const diagrams = [...(sectionDiagrams[id]?.[section.id] || [])];
      const plan = {id: section.id, title: section.title, diagrams, primary: diagrams[0]};
      plans.set(section.id, plan);
      // Do not introduce illustrations into a text-only subsection.
      const rules = diagrams.length ? rulesFor(id, section, diagrams) : [];
      const prose = section.body.map(p => `<p>${linkText(p, plan, rules)}</p>`).join('');
      return `<section class="system-reading-section ${diagrams.length ? 'has-figure' : 'text-only'}" id="system-section-${esc(section.id)}" aria-labelledby="system-heading-${esc(section.id)}"><div class="system-section-text"><h3 id="system-heading-${esc(section.id)}">${esc(section.title)}</h3>${prose}${refs(section.refs)}</div>${diagrams.length ? `<figure class="system-section-figure" id="system-figure-${esc(section.id)}" data-section-figure="${esc(section.id)}" aria-label="Схема к подразделу: ${esc(section.title)}"><div class="reading-figure-content" data-figure-content="${esc(section.id)}"><div class="reading-figure-placeholder">Схема · ${esc(data.diagrams[plan.primary].ref)}</div></div></figure>` : ''}</section>`;
    }).join('');
    root.innerHTML = `<article class="system-article fcom-system"><header class="system-article-header"><button class="back" data-all-systems>← Все системы</button><span class="eyebrow">FCOM S7 · ГЛАВА ${esc(meta.chapter)}</span></header><div class="system-description-heading"><p class="system-intro">${esc(system.intro)}</p>${system.diagrams.length ? '<p class="system-reading-guide">Синие названия в тексте показывают элементы на схеме. Схемы можно увеличивать и перемещать.</p>' : ''}</div><nav class="system-toc" aria-label="Подразделы системы">${system.sections.map(s => `<a href="#system-section-${esc(s.id)}" data-section-jump="${esc(s.id)}">${esc(s.title)}</a>`).join('')}</nav><div class="system-prose">${sections}</div><h3>Органы управления в кабине</h3><div class="system-control-list">${window.COCKPIT_DATA.controls.filter(c => c.system === id).map(c => `<button data-related="${esc(c.id)}">${esc(c.label)}</button>`).join('')}</div></article><dialog class="system-figure-dialog" aria-labelledby="system-figure-dialog-title"><header><h2 id="system-figure-dialog-title"></h2><button data-close-system-figure aria-label="Закрыть схему и вернуться к тексту">×</button></header><div class="system-figure-modal-host"></div></dialog>`;
    dialog = root.querySelector('.system-figure-dialog');
    const signal = controller.signal;
    root.addEventListener('click', handleClick, {signal});
    dialog.addEventListener('cancel', event => {event.preventDefault(); closeFigure();}, {signal});
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeFigure();
    }, {signal});
    lazyObserver = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        ensureViewer(entry.target.dataset.sectionFigure);
        lazyObserver.unobserve(entry.target);
      }
    }, {root: root.closest('#main'), rootMargin: '300px 0px'});
    root.querySelectorAll('[data-section-figure]').forEach(figure => lazyObserver.observe(figure));
  }

  function ensureViewer(section) {
    if (!viewers.has(section)) {
      const plan = plans.get(section);
      const content = root.querySelector(`[data-figure-content="${section}"]`);
      viewers.set(section, new DiagramView(content, plan, plan.primary));
    }
    return viewers.get(section);
  }

  function handleClick(event) {
    const term = event.target.closest('[data-system-term]');
    if (term) {
      event.preventDefault();
      const viewer = ensureViewer(term.dataset.section);
      const viewport = viewer.viewport.getBoundingClientRect();
      const main = root.closest('#main').getBoundingClientRect();
      if (matchMedia('(max-width:1099px)').matches || viewport.bottom < main.top || viewport.top > main.bottom) openFigure(viewer, term);
      viewer.choose(term.dataset.targetDiagram, term.dataset.targetNodes.split('|'));
      return;
    }
    const jump = event.target.closest('[data-section-jump]');
    if (jump) {
      event.preventDefault();
      root.querySelector(`#system-section-${jump.dataset.sectionJump}`).scrollIntoView({behavior: reducedMotion() ? 'instant' : 'smooth', block: 'start'});
      return;
    }
    const button = event.target.closest('button');
    if (button?.hasAttribute('data-close-system-figure')) closeFigure();
    if (button?.dataset.expandSystemFigure) openFigure(ensureViewer(button.dataset.expandSystemFigure), button);
  }

  function reducedMotion() { return matchMedia('(prefers-reduced-motion:reduce)').matches; }

  function openFigure(viewer, trigger) {
    if (dialog.open) return;
    const home = viewer.element.parentElement;
    const placeholder = document.createElement('div');
    placeholder.style.height = home.clientHeight + 'px';
    placeholder.className = 'reading-open-placeholder';
    placeholder.textContent = 'Схема открыта';
    home.append(placeholder);
    modalState = {viewer, trigger, home, placeholder, scroll: root.closest('#main').scrollTop};
    dialog.querySelector('h2').textContent = viewer.plan.title;
    dialog.querySelector('.system-figure-modal-host').append(viewer.element);
    dialog.showModal();
    root.closest('#main').scrollTop = modalState.scroll;
    viewer.fit(true);
  }

  function closeFigure() {
    if (!modalState) return;
    const {viewer, trigger, home, placeholder, scroll} = modalState;
    modalState = null;
    dialog.close();
    home.append(viewer.element);
    placeholder.remove();
    viewer.fit(true);
    trigger?.focus({preventScroll: true});
    root.closest('#main').scrollTop = scroll;
  }

  class DiagramView {
    constructor(element, plan, diagramId) {
      this.element = element;
      this.plan = plan;
      this.scale = this.fitScale = 1;
      this.tx = this.ty = 0;
      this.points = new Map();
      this.nodeIds = [];
      this.setDiagram(diagramId);
    }

    dispose() { this.observer?.disconnect(); this.events?.abort(); this.points.clear(); }

    setDiagram(id) {
      this.dispose();
      this.events = new AbortController();
      this.diagram = data.diagrams[id];
      this.nodeIds = [];
      this.element.classList.remove('has-selection');
      const d = this.diagram;
      const options = this.plan.diagrams.map(id => `<option value="${esc(id)}" ${id === d.id ? 'selected' : ''}>${esc(data.diagrams[id].name)} · ${esc(data.diagrams[id].ref)}</option>`).join('');
      const diagramLabel = `Схема к подразделу «${this.plan.title}»`;
      this.element.innerHTML = `<div class="reading-figure-header"><span>СХЕМА · FCOM ${esc(d.ref)}</span><button data-expand-system-figure="${esc(this.plan.id)}" aria-label="Открыть схему: ${esc(this.plan.title)}">На весь экран ↗</button></div>${this.plan.diagrams.length > 1 ? `<label class="diagram-picker"><span>Рисунок и вариант комплектации</span><select data-diagram-select aria-label="${esc(diagramLabel)}">${options}</select></label>` : ''}<div class="fcom-diagram-frame"><div class="system-viewport" tabindex="0" aria-label="${esc(d.name)}. Перетаскивайте схему; масштаб — кнопками или двумя пальцами"><div class="system-scene" data-diagram="${esc(d.id)}"><img class="system-original" src="${esc(d.image)}" alt="${esc(d.name)} · оригинал FCOM ${esc(d.ref)}" draggable="false" style="width:${d.sourceWidth / d.clip[2] * 100}%;left:${-d.clip[0] / d.clip[2] * 100}%;top:${-d.clip[1] / d.clip[3] * 100}%">${d.nodes.flatMap(n => n.hits.map((h, i) => `<button class="system-node" data-system-node="${esc(n.id)}" aria-label="${esc(n.name)} · ${esc(n.en)}" title="${esc(n.name)} · ${esc(n.en)}" aria-pressed="false" ${i ? 'tabindex="-1"' : ''} style="left:${(h[0]-d.clip[0]) / d.clip[2] * 100}%;top:${(h[1]-d.clip[1]) / d.clip[3] * 100}%;width:${h[2] / d.clip[2] * 100}%;height:${h[3] / d.clip[3] * 100}%"></button>`)).join('')}</div><div class="system-hover" aria-live="polite"></div></div><div class="system-canvas-tools"><button data-system-zones aria-pressed="false">Узлы</button><div class="zoom-tools"><button data-system-zoom="out" aria-label="Уменьшить схему">−</button><output data-system-scale></output><button data-system-zoom="in" aria-label="Увеличить схему">+</button><button data-system-zoom="fit">Вписать</button></div></div></div><div class="reading-node-selection" role="status" aria-live="polite">Нажмите синее название в тексте или элемент схемы.</div><details class="reading-figure-notes"><summary>${esc(d.name)} · ${esc(d.ref)}</summary>${d.applicability ? `<p class="diagram-applicability"><strong>Вариант комплектации:</strong> ${esc(d.applicability)}</p>` : ''}${d.condition ? `<p class="diagram-condition">${esc(d.condition)}</p>` : ''}${refs([d.ref])}</details><details class="diagram-node-list"><summary>Все элементы схемы · ${d.nodes.length}</summary><label class="node-search-label"><input type="search" data-node-search placeholder="Найти элемент…" aria-label="Поиск элемента на схеме: ${esc(this.plan.title)}"></label><div class="diagram-node-buttons">${d.nodes.map(n => `<button data-system-node="${esc(n.id)}" aria-pressed="false"><strong>${esc(n.name)}</strong><span>${esc(n.en)}</span></button>`).join('')}</div><p data-node-empty hidden>Ничего не найдено.</p></details>`;
      this.viewport = this.element.querySelector('.system-viewport');
      this.scene = this.element.querySelector('.system-scene');
      this.lastWidth = this.lastHeight = 0;
      this.observer = new ResizeObserver(() => {
        if (this.viewport.clientWidth !== this.lastWidth || this.viewport.clientHeight !== this.lastHeight) this.fit(true);
      });
      this.observer.observe(this.viewport);
      this.fit();
      this.bind();
    }

    choose(diagramId, ids) {
      if (this.diagram.id !== diagramId) this.setDiagram(diagramId);
      const nodes = this.diagram.nodes.filter(n => ids.includes(n.id));
      if (!nodes.length) return;
      this.nodeIds = nodes.map(n => n.id);
      this.element.querySelectorAll('[data-system-node]').forEach(button => {
        const yes = this.nodeIds.includes(button.dataset.systemNode);
        button.classList.toggle('selected', yes);
        button.setAttribute('aria-pressed', String(yes));
      });
      root.querySelectorAll(`[data-system-term][data-section="${this.plan.id}"]`).forEach(link => {
        const yes = link.dataset.targetDiagram === this.diagram.id && link.dataset.targetNodes.split('|').some(id => this.nodeIds.includes(id));
        link.classList.toggle('selected', yes);
      });
      const controls = [...new Set(nodes.flatMap(n => n.controls))].map(id => window.COCKPIT_DATA.controls.find(c => c.id === id)).filter(Boolean);
      const paragraphs = [...new Set(nodes.flatMap(n => n.body))];
      this.element.classList.add('has-selection');
      this.element.querySelector('.reading-node-selection').innerHTML = `<strong>${nodes.map(n => esc(n.name)).join(' · ')}</strong><span>${nodes.map(n => esc(n.en)).join(' · ')}</span><div class="reading-node-explanation" tabindex="0" aria-label="Пояснение к выбранному элементу">${paragraphs.map(p => `<p>${esc(p)}</p>`).join('')}</div>${controls.length ? `<div class="relationships">${controls.map(c => `<button data-related="${esc(c.id)}">${esc(c.label)} ↗</button>`).join('')}</div>` : ''}`;
      selected = {system: systemId, diagram: this.diagram, node: nodes[0]};
      this.reveal();
    }

    reveal() {
      const hits = this.diagram.nodes.filter(n => this.nodeIds.includes(n.id)).flatMap(n => n.hits);
      if (!hits.length) return;
      const x = Math.min(...hits.map(h => h[0])), y = Math.min(...hits.map(h => h[1]));
      const width = Math.max(...hits.map(h => h[0]+h[2]))-x, height = Math.max(...hits.map(h => h[1]+h[3]))-y;
      this.scale = Math.max(this.fitScale, Math.min(this.fitScale*2.1, (this.viewport.clientWidth-48)/(width*1.3), (this.viewport.clientHeight-48)/(height*1.3)));
      this.tx = this.viewport.clientWidth/2-(x+width/2-this.diagram.clip[0])*this.scale;
      this.ty = this.viewport.clientHeight/2-(y+height/2-this.diagram.clip[1])*this.scale;
      this.apply();
    }

    apply() {
      const width = this.diagram.clip[2]*this.scale, height = this.diagram.clip[3]*this.scale;
      this.tx = width < this.viewport.clientWidth ? (this.viewport.clientWidth-width)/2 : Math.min(12, Math.max(this.viewport.clientWidth-width-12, this.tx));
      this.ty = height < this.viewport.clientHeight ? (this.viewport.clientHeight-height)/2 : Math.min(12, Math.max(this.viewport.clientHeight-height-12, this.ty));
      this.scene.style.width = width+'px';
      this.scene.style.height = height+'px';
      this.scene.style.transform = `translate(${this.tx}px,${this.ty}px)`;
      this.scene.dataset.scale = this.scale;
      this.element.querySelector('[data-system-scale]').textContent = Math.round(this.scale*100)+'%';
    }

    fit(keepSelection = false) {
      if (!this.viewport?.isConnected || !this.viewport.clientWidth || !this.viewport.clientHeight) return;
      this.lastWidth = this.viewport.clientWidth;
      this.lastHeight = this.viewport.clientHeight;
      this.fitScale = Math.min((this.lastWidth-24)/this.diagram.clip[2], (this.lastHeight-24)/this.diagram.clip[3]);
      this.scale = this.fitScale;
      this.tx = (this.lastWidth-this.diagram.clip[2]*this.scale)/2;
      this.ty = (this.lastHeight-this.diagram.clip[3]*this.scale)/2;
      this.apply();
      if (keepSelection && this.nodeIds.length) this.reveal();
    }

    zoomAt(scale, x = this.viewport.clientWidth/2, y = this.viewport.clientHeight/2) {
      const next = Math.max(this.fitScale*.65, Math.min(10, scale));
      const ratio = next/this.scale;
      this.tx = x-(x-this.tx)*ratio;
      this.ty = y-(y-this.ty)*ratio;
      this.scale = next;
      this.apply();
    }

    bind() {
      const listen = (el, type, callback, options = {}) => el.addEventListener(type, callback, {...options, signal: this.events.signal});
      listen(this.element, 'change', event => {
        if (event.target.matches('[data-diagram-select]')) this.setDiagram(event.target.value);
      });
      listen(this.element, 'input', event => {
        if (!event.target.matches('[data-node-search]')) return;
        const terms = event.target.value.toLowerCase().trim().split(/\s+/);
        let count = 0;
        this.element.querySelectorAll('.diagram-node-buttons button').forEach(button => {
          button.hidden = !terms.every(term => button.textContent.toLowerCase().includes(term));
          if (!button.hidden) count++;
        });
        this.element.querySelector('[data-node-empty]').hidden = !!count;
      });
      listen(this.element, 'click', event => {
        const button = event.target.closest('button');
        if (!button) return;
        if (button.dataset.systemNode) this.choose(this.diagram.id, [button.dataset.systemNode]);
        if (button.dataset.systemZoom) {
          if (button.dataset.systemZoom === 'fit') this.fit();
          else this.zoomAt(this.scale*(button.dataset.systemZoom === 'in' ? 1.4 : 1/1.4));
        }
        if (button.hasAttribute('data-system-zones')) {
          const show = button.getAttribute('aria-pressed') !== 'true';
          button.setAttribute('aria-pressed', String(show));
          this.scene.classList.toggle('system-zones', show);
        }
      });
      listen(this.viewport, 'wheel', event => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        const r = this.viewport.getBoundingClientRect();
        this.zoomAt(this.scale*Math.exp(-event.deltaY*.006), event.clientX-r.left, event.clientY-r.top);
      }, {passive: false});
      listen(this.viewport, 'pointerdown', event => {
        if (event.button !== 0) return;
        this.points.set(event.pointerId, {x:event.clientX, y:event.clientY});
        if (this.points.size === 1) this.gesture = {x:event.clientX, y:event.clientY, tx:this.tx, ty:this.ty, moved:false};
        if (this.points.size === 2) {
          const [a,b] = [...this.points.values()];
          this.gesture = {pinch:true, distance:Math.hypot(a.x-b.x,a.y-b.y), scale:this.scale, tx:this.tx, ty:this.ty, mx:(a.x+b.x)/2, my:(a.y+b.y)/2, moved:true};
        }
      });
      listen(this.viewport, 'pointermove', event => {
        if (!this.points.size) {
          const button = event.target.closest('[data-system-node]');
          const node = button && this.diagram.nodes.find(n => n.id === button.dataset.systemNode);
          this.element.querySelector('.system-hover').textContent = node ? node.name+' · '+node.en : '';
          return;
        }
        const g = this.gesture;
        if (!this.points.has(event.pointerId) || !g) return;
        this.points.set(event.pointerId, {x:event.clientX, y:event.clientY});
        if (g.pinch && this.points.size === 2) {
          const [a,b] = [...this.points.values()], r = this.viewport.getBoundingClientRect();
          this.scale = Math.max(this.fitScale*.65, Math.min(10, g.scale*Math.hypot(a.x-b.x,a.y-b.y)/g.distance));
          const ratio = this.scale/g.scale;
          this.tx = (a.x+b.x)/2-r.left-(g.mx-r.left-g.tx)*ratio;
          this.ty = (a.y+b.y)/2-r.top-(g.my-r.top-g.ty)*ratio;
          this.apply();
        } else if (!g.pinch) {
          const dx = event.clientX-g.x, dy = event.clientY-g.y;
          if (Math.hypot(dx,dy) > 5) {
            g.moved = true;
            this.viewport.setPointerCapture(event.pointerId);
            this.viewport.classList.add('dragging');
            this.tx = g.tx+dx;
            this.ty = g.ty+dy;
            this.apply();
          }
        }
      });
      const end = event => {
        if (!this.points.has(event.pointerId)) return;
        if (this.gesture?.moved) {this.suppressClick = true; setTimeout(() => this.suppressClick = false, 100);}
        this.points.delete(event.pointerId);
        this.viewport.classList.remove('dragging');
        if (this.points.size === 1) {
          const p = [...this.points.values()][0];
          this.gesture = {x:p.x, y:p.y, tx:this.tx, ty:this.ty, moved:true};
        } else this.gesture = null;
      };
      listen(this.viewport, 'pointerup', end);
      listen(this.viewport, 'pointercancel', end);
      listen(this.viewport, 'click', event => {if (this.suppressClick) {event.preventDefault(); event.stopPropagation();}}, {capture:true});
      listen(this.viewport, 'pointerleave', () => this.element.querySelector('.system-hover').textContent = '');
      listen(this.viewport, 'keydown', event => {
        if (event.target !== this.viewport) return;
        if (['+','=','-','0'].includes(event.key)) {
          event.preventDefault();
          if (event.key === '0') this.fit();
          else this.zoomAt(this.scale*(event.key === '-' ? 1/1.4 : 1.4));
        }
        if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) {
          event.preventDefault();
          this.tx += event.key === 'ArrowLeft' ? 45 : event.key === 'ArrowRight' ? -45 : 0;
          this.ty += event.key === 'ArrowUp' ? 45 : event.key === 'ArrowDown' ? -45 : 0;
          this.apply();
        }
      });
    }
  }

  function getSelection() { return selected || {system: systemId, diagram: null, node: null}; }
  return {render, getSelection, dispose};
})();
