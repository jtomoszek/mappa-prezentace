/* =====================================================================
   MAPPA — podklad + prezentace
   Jeden zdroj obsahu (assets/slides.js), dva režimy.
   ===================================================================== */
(function () {
  'use strict';

  var SLIDES = window.MAPPA_SLIDES || [];
  var PARTS = window.MAPPA_PARTS || [];
  var TOTAL = SLIDES.length;
  var DUR = 820;                       // délka přechodu (ms)
  var CH = 'mappa-deck';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // ------------------------------------------------------------ toast
  var toastEl = $('#toast'), toastT;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('is-on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove('is-on'); }, 1800);
  }

  /* ===================================================================
     QR kód — generuje se z adresy, na které stránka opravdu běží
     =================================================================== */
  function readerUrl() {
    var u = location.origin + location.pathname;
    if (location.protocol === 'file:') u = location.href.split('#')[0];
    return u.replace(/index\.html$/, '');
  }
  function paintQR() {
    var url = readerUrl();
    var pretty = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    $$('[data-qr]').forEach(function (el) {
      if (el.dataset.done) return;
      try {
        el.innerHTML = window.MappaQR.svg(url, { ecl: 'M', margin: 1, dark: '#101010' });
        el.dataset.done = '1';
      } catch (e) { el.textContent = url; }
    });
    $$('[data-qr-url]').forEach(function (el) { el.textContent = pretty; });
  }

  /* ===================================================================
     REŽIM PREZENTACE
     =================================================================== */
  var presentEl = $('#present');
  var stage = $('#stage');
  var uiEl = $('#present-ui');
  var hintEl = $('#present-hint');
  var blankEl = $('#blank');
  var gridEl = $('#grid-overlay');
  var gridScroll = $('#grid-scroll');
  var barEl = $('#progress-bar');
  var nEl = $('#pui-n'), totalEl = $('#pui-total');

  var isPresent = false;
  var cur = 1;
  var curSlot = null;
  var uiTimer = null;
  var bc = null;
  var pushedHistory = false;      // vstoupili jsme do prezentace z podkladu?
  var exitTimer = null;
  var exiting = false;             // probíhá history.back() vyvolané zavřením
  var presenterWin = null;
  var startedAt = null;

  if (totalEl) totalEl.textContent = TOTAL;

  try { bc = new BroadcastChannel(CH); } catch (e) { bc = null; }

  function slideByN(n) { return SLIDES[n - 1]; }

  function buildSlot(n) {
    var slot = document.createElement('div');
    slot.className = 'slot';
    var canvas = document.createElement('div');
    canvas.className = 'canvas';
    canvas.innerHTML = slideByN(n).html;
    slot.appendChild(canvas);
    slot.style.setProperty('--fit', fitScale());
    return slot;
  }

  function fitScale() {
    var w = window.innerWidth, h = window.innerHeight;
    return Math.min(w / 1920, h / 1080);
  }

  function refit() {
    var s = fitScale();
    $$('.slot', stage).forEach(function (el) { el.style.setProperty('--fit', s); });
  }

  /* --- oživení snímku po najetí --------------------------------------- */
  // Prochází strukturu slidu do hloubky: layoutové obaly (grid/flex) rozbalí
  // na jejich děti, zastaví se u karet, řádků a textových bloků. Díky tomu
  // dostane vlastní animaci každá karta a každý řádek, ne jen celý sloupec.
  function isLayoutBox(el) {
    var st = el.getAttribute('style') || '';
    return /display:\s*(grid|flex)/.test(st);
  }
  function isCard(el) {
    var st = el.getAttribute('style') || '';
    return /border-radius:\s*(1[6-9]|[2-9]\d)px/.test(st) && /background/.test(st);
  }
  function collectTargets(el, depth, out) {
    var kids = Array.prototype.filter.call(el.children, function (k) { return k.tagName !== 'BR'; });
    var text = (el.textContent || '').trim();
    if (!kids.length || depth >= 4 || isCard(el) || !isLayoutBox(el) || kids.length > 8) {
      if (text || isCard(el)) out.push(el);
      return;
    }
    kids.forEach(function (k) { collectTargets(k, depth + 1, out); });
  }
  function revealTargets(canvas) {
    var section = canvas.firstElementChild;
    if (!section) return [];
    var out = [];
    Array.prototype.forEach.call(section.children, function (child) { collectTargets(child, 1, out); });
    // příliš mnoho dílů → zpět o úroveň, ať nabíhání netrvá věčnost
    if (out.length > 22) {
      out = [];
      Array.prototype.forEach.call(section.children, function (child) { collectTargets(child, 3, out); });
    }
    return out;
  }

  function reveal(canvas, dir) {
    if (reduceMotion) return;
    var els = revealTargets(canvas);
    if (!els.length) return;
    var sign = dir < 0 ? -1 : 1;
    var n = els.length;
    var stagger = Math.max(45, Math.min(95, 1100 / n));   // celé nabíhání ~1,1 s
    els.forEach(function (el, i) {
      var base = el.style.transform || '';
      var fs = parseFloat(el.style.fontSize) || 0;
      var big = fs >= 90;                                  // velká čísla a nadpisy
      var from = base + ' translateY(' + (big ? 26 : 44) * sign + 'px)' + (big ? ' scale(.93)' : '');
      var to = base + ' translateY(0)' + (big ? ' scale(1)' : '');
      try {
        el.animate(
          [{ opacity: 0, transform: from.trim(), filter: 'blur(' + (big ? 6 : 3) + 'px)' },
           { opacity: 1, transform: to.trim(), filter: 'blur(0)' }],
          {
            duration: big ? 1100 : 900,
            delay: 240 + i * stagger,                      // rozjede se během jízdy slidu
            easing: 'cubic-bezier(.16,1,.3,1)',
            fill: 'backwards'
          }
        );
      } catch (e) { /* starší prohlížeč — jen bez animace */ }
    });
  }

  /* --- vykreslení slidu s přechodem --------------------------------- */
  var renderToken = 0;

  function dropStaleSlots() {
    // v DOM nechá jen aktuální slot; robustní i tehdy, když se přechod
    // nedokončil (okno prezentace bylo na pozadí a neběžel rAF)
    Array.prototype.slice.call(stage.children).forEach(function (s) {
      if (s !== curSlot && s.parentNode) s.parentNode.removeChild(s);
    });
  }

  function render(n, dir) {
    n = Math.min(Math.max(n, 1), TOTAL);
    if (curSlot && cur === n) return;

    dropStaleSlots();                          // zbytky předchozích přechodů

    var prevSlot = curSlot;
    var slot = buildSlot(n);
    slot.classList.add('is-entering');
    var canvas = $('.canvas', slot);
    var inClass = dir === 0 ? 'from-jump' : (dir > 0 ? 'from-next' : 'from-prev');
    var outClass = dir === 0 ? 'to-jump' : (dir > 0 ? 'to-next' : 'to-prev');

    if (dir === 0) {
      canvas.style.transition = 'opacity .28s ease-out';
      canvas.style.opacity = '0';
    } else {
      canvas.classList.add(inClass);
    }
    stage.appendChild(slot);
    paintQR();                                 // slide s QR kódem se plní až po vložení
    canvas.getBoundingClientRect();            // vynutit reflow

    // Commit přechodu. Normálně ho spustí rAF v dalším snímku; když je okno
    // prezentace na pozadí (rAF se nevolá), zaskočí za něj timeout.
    var committed = false;
    function commit() {
      if (committed) return;
      committed = true;
      if (dir === 0) { canvas.style.opacity = '1'; }
      else { canvas.classList.remove(inClass); canvas.classList.add('is-current'); }

      if (prevSlot) {
        var pc = $('.canvas', prevSlot);
        prevSlot.classList.remove('is-entering');
        prevSlot.classList.add('is-leaving');
        // u skoku zůstává starý slide neprůhledný pod novým — jinak by se
        // oba prolnuly přes tmavé pozadí a obraz by problikl do černé
        if (dir !== 0) { pc.classList.remove('is-current'); pc.classList.add(outClass); }
      }
      reveal(canvas, dir);
    }
    requestAnimationFrame(commit);
    setTimeout(commit, 120);

    curSlot = slot;
    cur = n;

    var token = ++renderToken;
    var d = reduceMotion ? 220 : (dir === 0 ? 320 : DUR);
    setTimeout(function () {
      if (token !== renderToken) return;       // mezitím přišel další slide
      dropStaleSlots();
    }, d + 60);

    syncUI();
  }

  function syncUI() {
    if (nEl) nEl.textContent = cur;
    if (barEl) barEl.style.width = (cur / TOTAL * 100) + '%';
    if (isPresent) history.replaceState({ mappa: 'present', n: cur }, '', '#/present/' + cur);
    if (bc) {
      try {
        bc.postMessage({ type: 'state', n: cur, total: TOTAL, started: startedAt });
      } catch (e) {}
    }
    $$('.thumb', gridScroll).forEach(function (t) {
      t.classList.toggle('is-current', +t.dataset.n === cur);
    });
  }

  function go(delta) {
    var n = cur + delta;
    if (n < 1) { n = 1; if (cur === 1) return bump(-1); }
    if (n > TOTAL) { n = TOTAL; if (cur === TOTAL) return bump(1); }
    render(n, delta > 0 ? 1 : -1);
  }

  function bump(dir) {
    if (!curSlot || reduceMotion) return;
    var c = $('.canvas', curSlot);
    try {
      c.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(' + (-10 * dir) + 'px)' },
                 { transform: 'translateY(0)' }], { duration: 320, easing: 'ease-out' });
    } catch (e) {}
  }

  function jump(n) { render(n, 0); }

  /* --- vstup / výstup ------------------------------------------------ */
  function enterPresent(n, replace) {
    n = n || 1;
    if (typeof setToc === 'function') setToc(false);
    if (isPresent) { jump(n); return; }
    isPresent = true;
    startedAt = Date.now();
    document.body.classList.add('is-present');
    presentEl.hidden = false;
    presentEl.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(function () { presentEl.classList.add('is-on'); });
    curSlot = null; cur = 0;
    stage.innerHTML = '';
    renderToken++;
    clearTimeout(exitTimer);                 // rozpracované zavírání by skrylo novou prezentaci

    // Historie se musí nastavit PŘED prvním render(): ten volá syncUI(), které
    // dělá replaceState — a to by jinak přepsalo hash i položce podkladu,
    // takže by history.back() při zavření skočilo zpět do prezentace.
    var st = { mappa: 'present', n: n };
    if (replace) { history.replaceState(st, '', '#/present/' + n); pushedHistory = false; }
    else { history.pushState(st, '', '#/present/' + n); pushedHistory = true; }

    render(n, 0);
    showUI();
    if (!sessionStorage.getItem('mappa-hint')) {
      hintEl.classList.add('is-on');
      setTimeout(function () { hintEl.classList.remove('is-on'); }, 5200);
      try { sessionStorage.setItem('mappa-hint', '1'); } catch (e) {}
    }
    buildGrid();
  }

  function exitPresent(fromPop) {
    if (!isPresent) return;
    isPresent = false;
    presentEl.classList.remove('is-on');
    closeGrid();
    setBlank(false);
    if (document.fullscreenElement) { try { document.exitFullscreen(); } catch (e) {} }
    clearTimeout(exitTimer);
    exitTimer = setTimeout(function () {
      if (isPresent) return;                 // mezitím se prezentace znovu spustila
      presentEl.hidden = true;
      presentEl.setAttribute('aria-hidden', 'true');
      stage.innerHTML = '';
      curSlot = null;
    }, 320);
    document.body.classList.remove('is-present');
    if (!fromPop) {
      // zpět jdeme jen tehdy, když jsme do prezentace vstoupili z podkladu;
      // po otevření odkazu rovnou na #/present/N by history.back() odešel ze stránky
      if (pushedHistory && history.state && history.state.mappa === 'present') { exiting = true; history.back(); }
      else history.replaceState(null, '', location.pathname + location.search);
    }
    pushedHistory = false;
    var target = document.getElementById('slide-' + cur);
    if (target) target.scrollIntoView({ block: 'center', behavior: 'auto' });
  }

  /* --- ovládací lišta: schovat, když se nehýbe myš -------------------- */
  function showUI() {
    presentEl.classList.add('ui-on');
    clearTimeout(uiTimer);
    uiTimer = setTimeout(function () {
      if (!gridEl.hidden) return;
      presentEl.classList.remove('ui-on');
    }, 2600);
  }

  /* --- černá / bílá obrazovka --------------------------------------- */
  var blankState = 0;   // 0 vyp, 1 černá, 2 bílá
  function setBlank(state) {
    blankState = state || 0;
    blankEl.hidden = !blankState;
    blankEl.classList.toggle('is-white', blankState === 2);
  }

  /* --- přehled slidů -------------------------------------------------- */
  var gridBuilt = false;
  function buildGrid() {
    if (gridBuilt) return;
    gridBuilt = true;
    var frag = document.createDocumentFragment();
    SLIDES.forEach(function (s) {
      var b = document.createElement('button');
      b.className = 'thumb';
      b.type = 'button';
      b.dataset.n = s.n;
      b.title = s.n + ' — ' + s.label;
      b.innerHTML = '<div class="thumb-canvas">' + s.html + '</div>' +
        '<span class="thumb-n">' + s.n + '</span>';
      frag.appendChild(b);
    });
    gridScroll.appendChild(frag);
    paintQR();
    gridScroll.addEventListener('click', function (e) {
      var t = e.target.closest('.thumb');
      if (!t) return;
      closeGrid();
      jump(+t.dataset.n);
    });
    scaleThumbs();
  }

  function scaleThumbs() {
    $$('.thumb', gridScroll).forEach(function (t) {
      var c = $('.thumb-canvas', t);
      var w = t.clientWidth;
      if (!w) return;
      c.style.transform = 'scale(' + (w / 1920) + ')';
    });
  }

  function openGrid() {
    buildGrid();
    gridEl.hidden = false;
    scaleThumbs();
    syncUI();
    var c = $('.thumb.is-current', gridScroll);
    if (c) c.scrollIntoView({ block: 'center' });
  }
  function closeGrid() { gridEl.hidden = true; }

  /* --- okno řečníka --------------------------------------------------- */
  function openPresenter() {
    if (presenterWin && !presenterWin.closed) { presenterWin.focus(); return; }
    presenterWin = window.open('presenter.html', 'mappa-presenter',
      'width=1180,height=760,menubar=no,toolbar=no');
    if (!presenterWin) { toast('Prohlížeč zablokoval vyskakovací okno'); return; }
    setTimeout(syncUI, 600);
    setTimeout(syncUI, 1600);
  }

  if (bc) {
    bc.onmessage = function (e) {
      var m = e.data || {};
      if (m.type === 'nav' && isPresent) go(m.delta);
      else if (m.type === 'goto' && isPresent) jump(m.n);
      else if (m.type === 'hello') {
        try { bc.postMessage({ type: 'slides', slides: SLIDES }); } catch (e2) {}
        syncUI();
      }
    };
  }

  /* --- klávesnice + kliker ------------------------------------------- */
  var NEXT = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Spacebar', 'Enter'];
  var PREV = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'];

  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    var typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;

    // hledání
    if (!typing && (e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey)))) {
      e.preventDefault(); openSearch(); return;
    }
    if (!searchEl.hidden) return;   // vlastní obsluha níž

    if (!isPresent) {
      if (!typing && (e.key === 'F5' || (e.key === 'p' && !e.metaKey && !e.ctrlKey))) {
        e.preventDefault(); enterPresent(1); return;
      }
      return;
    }

    if (typing) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      if (!gridEl.hidden) closeGrid();
      else if (blankState) setBlank(0);
      else exitPresent();
      return;
    }
    if (!gridEl.hidden && (NEXT.indexOf(e.key) > -1 || PREV.indexOf(e.key) > -1)) return;

    if (NEXT.indexOf(e.key) > -1) { e.preventDefault(); if (blankState) return setBlank(0); go(1); showUI(); return; }
    if (PREV.indexOf(e.key) > -1) { e.preventDefault(); if (blankState) return setBlank(0); go(-1); showUI(); return; }

    switch (e.key) {
      case 'Home': e.preventDefault(); jump(1); break;
      case 'End': e.preventDefault(); jump(TOTAL); break;
      case 'f': case 'F': e.preventDefault(); toggleFull(); break;
      case 'g': case 'G': e.preventDefault(); gridEl.hidden ? openGrid() : closeGrid(); break;
      case 'n': case 'N': e.preventDefault(); openPresenter(); break;
      case 'b': case 'B': case '.': e.preventDefault(); setBlank(blankState === 1 ? 0 : 1); break;
      case 'w': case 'W': case ',': e.preventDefault(); setBlank(blankState === 2 ? 0 : 2); break;
      case 'F5': e.preventDefault(); jump(1); break;
      default:
        if (/^[0-9]$/.test(e.key)) { numberBuffer(e.key); }
    }
  });

  // skok na číslo slidu: napište číslo a Enter
  var numBuf = '', numT;
  function numberBuffer(d) {
    numBuf += d;
    clearTimeout(numT);
    toast('Slide ' + numBuf + ' — Enter');
    numT = setTimeout(function () {
      var n = parseInt(numBuf, 10);
      numBuf = '';
      if (n >= 1 && n <= TOTAL) jump(n);
    }, 900);
  }

  function toggleFull() {
    if (document.fullscreenElement) { document.exitFullscreen(); }
    else {
      var p = document.documentElement.requestFullscreen();
      if (p && p.catch) p.catch(function () { toast('Fullscreen se nepodařilo zapnout'); });
    }
  }

  /* --- myš, kolečko, dotyk (scrollytelling ovládání) ------------------ */
  stage.addEventListener('click', function (e) {
    if (blankState) { setBlank(0); return; }
    var x = e.clientX / window.innerWidth;
    go(x < 0.28 ? -1 : 1);
    showUI();
  });

  var wheelAcc = 0, wheelLock = false, wheelT;
  stage.addEventListener('wheel', function (e) {
    if (!isPresent || !gridEl.hidden) return;
    e.preventDefault();
    if (wheelLock) return;
    wheelAcc += e.deltaY;
    clearTimeout(wheelT);
    wheelT = setTimeout(function () { wheelAcc = 0; }, 260);
    if (Math.abs(wheelAcc) > 90) {
      var dir = wheelAcc > 0 ? 1 : -1;
      wheelAcc = 0;
      wheelLock = true;
      setTimeout(function () { wheelLock = false; }, (reduceMotion ? 240 : DUR) + 80);
      go(dir);
      showUI();
    }
  }, { passive: false });

  var touchY = null, touchX = null;
  stage.addEventListener('touchstart', function (e) {
    touchY = e.touches[0].clientY; touchX = e.touches[0].clientX;
  }, { passive: true });
  stage.addEventListener('touchend', function (e) {
    if (touchY === null) return;
    var dy = e.changedTouches[0].clientY - touchY;
    var dx = e.changedTouches[0].clientX - touchX;
    touchY = null;
    if (Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx)) go(dy < 0 ? 1 : -1);
    else if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
  }, { passive: true });

  presentEl.addEventListener('mousemove', showUI);
  window.addEventListener('resize', function () { refit(); scaleThumbs(); });

  // tlačítka v liště
  presentEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    e.stopPropagation();
    switch (b.dataset.act) {
      case 'next': go(1); break;
      case 'prev': go(-1); break;
      case 'exit': exitPresent(); break;
      case 'full': toggleFull(); break;
      case 'grid': gridEl.hidden ? openGrid() : closeGrid(); break;
      case 'grid-close': closeGrid(); break;
      case 'notes': openPresenter(); break;
    }
    // po kliknutí myší tlačítko odfokusujeme — jinak by mezerník z klikeru
    // zmáčkl tlačítko místo posunu na další slide
    if (e.detail > 0) b.blur();
    showUI();
  });

  // kopírování funguje i mimo https (např. při sdílení po síti na http://192.168…)
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (ok, fail) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      var done = false;
      try { done = document.execCommand('copy'); } catch (e) { done = false; }
      document.body.removeChild(ta);
      done ? ok() : fail(new Error('copy failed'));
    });
  }

  /* ===================================================================
     PODKLAD: kopírování promptů, scrollspy, hledání
     =================================================================== */
  document.addEventListener('click', function (e) {
    var copy = e.target.closest('.btn--copy');
    if (copy) {
      var text = copy.dataset.prompt || '';
      copyText(text).then(function () {
        var old = copy.textContent;
        copy.textContent = 'Zkopírováno ✓';
        copy.classList.add('is-done');
        setTimeout(function () { copy.textContent = old; copy.classList.remove('is-done'); }, 1500);
      }, function () { toast('Kopírování se nepodařilo'); });
      return;
    }
    var play = e.target.closest('[data-present]');
    if (play) { enterPresent(+play.dataset.present); return; }
  });

  ['#btn-present-top', '#btn-present-hero', '#btn-present-outro', '#btn-present-foot'].forEach(function (sel) {
    var b = $(sel);
    if (b) b.addEventListener('click', function () { enterPresent(1); });
  });
  var readBtn = $('#btn-read-hero');
  if (readBtn) readBtn.addEventListener('click', function () {
    var first = $('.part');
    if (first) first.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  });
  var printBtn = $('#btn-print');
  if (printBtn) printBtn.addEventListener('click', function () { window.print(); });
  var copyUrlBtn = $('#btn-copy-url');
  if (copyUrlBtn) copyUrlBtn.addEventListener('click', function () {
    copyText(readerUrl()).then(function () { toast('Odkaz zkopírován'); },
      function () { toast('Kopírování se nepodařilo'); });
  });

  // scrollspy — aktivní je poslední část, která už začala nad linkou
  var parts = $$('.part');
  if (parts.length) {
    var spyTick = null;
    var updateSpy = function () {
      spyTick = null;
      var line = 140, active = parts[0].id;
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].getBoundingClientRect().top <= line) active = parts[i].id;
      }
      $$('[data-nav]').forEach(function (a) { a.classList.toggle('is-active', a.dataset.nav === active); });
      $$('[data-toc]').forEach(function (a) { a.classList.toggle('is-active', a.dataset.toc === active); });
    };
    window.addEventListener('scroll', function () {
      if (spyTick) return;
      spyTick = requestAnimationFrame(updateSpy);
    }, { passive: true });
    updateSpy();
  }

  // jemné nabíhání bloků při čtení
  if ('IntersectionObserver' in window && !reduceMotion) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.animate([{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }],
          { duration: 620, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards' });
        io.unobserve(en.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.04 });
    $$('.rs, .part-band').forEach(function (el) { io.observe(el); });
  }


  /* --- obsah v liště (úzké displeje) a ukazatel postupu čtení --------- */
  var tocBtn = $('#btn-toc'), tocSheet = $('#toc-sheet');

  function setToc(open) {
    if (!tocBtn || !tocSheet) return;
    tocSheet.hidden = !open;
    tocBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  if (tocBtn && tocSheet) {
    tocBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      setToc(tocSheet.hidden);
    });
    tocSheet.addEventListener('click', function (e) {
      if (e.target.closest('a')) setToc(false);
    });
    document.addEventListener('click', function (e) {
      if (tocSheet.hidden) return;
      if (e.target.closest('#toc-sheet') || e.target.closest('#btn-toc')) return;
      setToc(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !tocSheet.hidden && !isPresent) setToc(false);
    });
    // po přechodu na širší displej (kde je boční obsah) panel zavřeme
    window.matchMedia('(min-width: 1001px)').addEventListener('change', function (m) {
      if (m.matches) setToc(false);
    });
  }

  var progressEl = $('#read-progress');
  if (progressEl) {
    var pTick = null;
    var updateProgress = function () {
      pTick = null;
      var h = document.documentElement.scrollHeight - window.innerHeight;
      progressEl.style.width = (h > 0 ? Math.min(scrollY / h, 1) * 100 : 0) + '%';
    };
    window.addEventListener('scroll', function () {
      if (pTick) return;
      pTick = requestAnimationFrame(updateProgress);
    }, { passive: true });
    window.addEventListener('resize', updateProgress);
    updateProgress();
  }

  /* --------------------------------- hledání -------------------------- */
  var searchEl = $('#search-overlay');
  var searchInput = $('#search-input');
  var searchResults = $('#search-results');
  var index = null, selIdx = 0, hits = [];

  function buildIndex() {
    if (index) return index;
    var tmp = document.createElement('div');
    index = SLIDES.map(function (s) {
      tmp.innerHTML = s.html;
      var text = (tmp.textContent || '').replace(/\s+/g, ' ').trim();
      return { n: s.n, label: s.label, part: s.part, text: text, low: (s.label + ' ' + text + ' ' + s.notes).toLowerCase() };
    });
    tmp.innerHTML = '';
    return index;
  }

  function norm(s) {
    return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function openSearch() {
    setToc(false);
    buildIndex();
    searchEl.hidden = false;
    searchInput.value = '';
    searchResults.innerHTML = '<div class="search-empty">Napište, co hledáte — nadpis, slovo ze slidu nebo z poznámky.</div>';
    setTimeout(function () { searchInput.focus(); }, 30);
  }
  function closeSearch() { searchEl.hidden = true; }

  function runSearch(q) {
    var nq = norm(q.trim());
    if (nq.length < 2) {
      hits = [];
      searchResults.innerHTML = '<div class="search-empty">Napište aspoň dva znaky.</div>';
      return;
    }
    hits = buildIndex().filter(function (s) { return norm(s.low).indexOf(nq) > -1; }).slice(0, 14);
    if (!hits.length) {
      searchResults.innerHTML = '<div class="search-empty">Nic nenalezeno.</div>';
      return;
    }
    selIdx = 0;
    searchResults.innerHTML = hits.map(function (s, i) {
      var pos = norm(s.text).indexOf(nq);
      var snippet = pos > -1 ? s.text.substr(Math.max(0, pos - 40), 120) : s.text.substr(0, 120);
      return '<button type="button" data-n="' + s.n + '" class="' + (i === 0 ? 'is-sel' : '') + '">' +
        '<div class="sr-label">' + esc(s.label) + '</div>' +
        '<div class="sr-meta">Slide ' + s.n + ' · ' + esc(snippet) + '…</div></button>';
    }).join('');
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function pickHit(n) {
    closeSearch();
    if (isPresent) { jump(n); return; }
    var el = document.getElementById('slide-' + n);
    if (el) {
      el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
      el.animate([{ boxShadow: '0 0 0 0 rgba(237,247,37,0)' }, { boxShadow: '0 0 0 6px rgba(237,247,37,.9)' },
                  { boxShadow: '0 0 0 0 rgba(237,247,37,0)' }], { duration: 1600, easing: 'ease-out' });
    }
  }

  if (searchEl) {
    var sb = $('#btn-search');
    if (sb) sb.addEventListener('click', openSearch);
    searchInput.addEventListener('input', function () { runSearch(searchInput.value); });
    searchEl.addEventListener('click', function (e) {
      if (e.target === searchEl) { closeSearch(); return; }
      var b = e.target.closest('[data-n]');
      if (b) pickHit(+b.dataset.n);
    });
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); closeSearch(); return; }
      if (!hits.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        selIdx = (selIdx + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
        $$('button', searchResults).forEach(function (b, i) { b.classList.toggle('is-sel', i === selIdx); });
        var sel = $$('button', searchResults)[selIdx];
        if (sel) sel.scrollIntoView({ block: 'nearest' });
      }
      if (e.key === 'Enter') { e.preventDefault(); pickHit(hits[selIdx].n); }
    });
  }

  /* ===================================================================
     Routování podle adresy
     =================================================================== */
  function parseHash() {
    var m = /^#\/present\/(\d+)/.exec(location.hash);
    return m ? Math.min(Math.max(+m[1], 1), TOTAL) : null;
  }

  window.addEventListener('popstate', function () {
    var n = parseHash();
    if (exiting) {
      // back() vyvolané naším zavřením — ať skočilo kamkoli, prezentaci neotvírat
      exiting = false;
      if (n) history.replaceState(null, '', location.pathname + location.search);
      return;
    }
    if (n) { if (!isPresent) enterPresent(n, true); else jump(n); }
    else if (isPresent) exitPresent(true);
  });

  // start
  paintQR();
  var startN = parseHash();
  if (startN) enterPresent(startN, true);

  // kliker může posílat PageUp/PageDown i když je fokus mimo dokument
  window.addEventListener('blur', function () { /* no-op, jen pro jistotu */ });

  // servisní API do konzole
  window.MAPPA = {
    present: enterPresent, exit: exitPresent, goto: jump,
    slides: SLIDES, url: readerUrl, _targets: revealTargets
  };
})();
