// Foto cards: 9 cards por folha A4, com frente e verso alinhados, em PDF (tudo offline).
// Coordenadas em mm, origem no canto de cima à esquerda da FRENTE da folha.
// O verso é calculado na mesma coordenada (o que fica atrás de cada ponto) e só no fim
// é espelhado para a página do verso.
(function () {
  'use strict';

  const { PdfWriter, latin1, pdfText, f, PT, toBlob, download } = window.RancaPdf;

  const W = 210, H = 297;            // A4 em pé
  const CW = 55, CH = 85;            // card pronto (photocard padrão)
  const BL = 2;                      // sangria: a foto passa da linha de corte
  const GAP = 8;                     // espaço entre um card e outro
  const BW = CW + 2 * BL, BH = CH + 2 * BL;
  const RADIUS = 3;                  // cantos arredondados (guia na prévia)
  const SAFE = 3;                    // área segura dentro do corte
  const X0 = (W - (3 * CW + 2 * GAP)) / 2;
  const Y0 = (H - (3 * CH + 2 * GAP)) / 2;
  const DPI = 300, KPX = DPI / 25.4; // px por mm no PDF
  const MARK = 8;                    // centro das marcas de conferência (mm da borda)
  const CELL = 2;                    // quadradinho da grade de conferência
  const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const MAX_SIDE = IS_MOBILE ? 1800 : 2400; // fotos maiores são reduzidas (memória)

  const $ = (id) => document.getElementById(id);
  const el = {
    modal: $('cards'), close: $('cClose'), canvas: $('cCanvas'), hint: $('cHint'),
    sideFront: $('cSideFront'), sideBack: $('cSideBack'),
    backEach: $('cBackEach'), backMirror: $('cBackMirror'), backSame: $('cBackSame'), backHint: $('cBackHint'),
    selTitle: $('cSelTitle'), imgName: $('cImgName'), pick: $('cPick'), input: $('cInput'),
    editBox: $('cEditBox'), zoom: $('cZoom'), zoomOut: $('cZoomOut'),
    rotate: $('cRotate'), center: $('cCenter'), remove: $('cRemove'), all: $('cAll'),
    quality: $('cQuality'), selHint: $('cSelHint'),
    flip: $('cFlip'), dx: $('cDx'), dy: $('cDy'), marks: $('cMarks'), test: $('cTest'),
    status: $('cStatus'), make: $('cMake'), share: $('cShare'),
  };

  /* ---------------- Estado ---------------- */
  const blank = () => ({ img: null, zoom: 1, ox: 0, oy: 0, rot: 0 });
  const cards = Array.from({ length: 9 }, () => ({ front: blank(), back: blank() }));
  const sharedBack = blank();
  let sel = 0;
  let side = 'front';
  let busy = false;
  let pdfFile = null;
  let view = null; // escala da última prévia: { gx, gy, k, dpr }
  const prefs = { backMode: 'each', flip: 'long', dx: 0, dy: 0, marks: true };

  const num = (v, min, max, def) => {
    const n = parseFloat(String(v).replace(',', '.'));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  const fmt = (n) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

  function loadPrefs() {
    try { Object.assign(prefs, JSON.parse(localStorage.getItem('rancaFundoCards') || '{}')); } catch { /* padrões */ }
    el.flip.value = prefs.flip === 'short' ? 'short' : 'long';
    el.dx.value = fmt(+prefs.dx || 0);
    el.dy.value = fmt(+prefs.dy || 0);
    el.marks.checked = prefs.marks !== false;
    if (!['each', 'mirror', 'same'].includes(prefs.backMode)) prefs.backMode = 'each';
  }
  function savePrefs() {
    try { localStorage.setItem('rancaFundoCards', JSON.stringify(prefs)); } catch { /* ignorado */ }
  }

  // Canto de cima à esquerda do card i (linha de corte), na frente da folha.
  const slot = (i) => ({ x: X0 + (i % 3) * (CW + GAP), y: Y0 + Math.floor(i / 3) * (CH + GAP) });

  // O que aparece no card i do lado s, e se dá para editar ali.
  function layerOf(i, s) {
    if (s === 'front') return { L: cards[i].front, mirror: false, editable: true };
    if (prefs.backMode === 'mirror') return { L: cards[i].front, mirror: true, editable: false };
    if (prefs.backMode === 'same') return { L: sharedBack, mirror: false, editable: true };
    return { L: cards[i].back, mirror: false, editable: true };
  }

  // mm do card por px da foto (zoom 1 = a foto cobre o card inteiro, com sangria)
  function mmPerPx(L) {
    const odd = L.rot % 2 === 1;
    const iw = odd ? L.img.h : L.img.w, ih = odd ? L.img.w : L.img.h;
    return Math.max(BW / iw, BH / ih) * L.zoom;
  }

  /* ---------------- Desenho de um card ---------------- */
  // Desenha a foto da camada L num retângulo BW×BH mm (k px por mm) com origem no ponto atual.
  // hq: usa a foto inteira e amplia com Lanczos (PDF); senão usa a miniatura (prévia).
  function paint(g, L, mirror, k, hq) {
    const bw = BW * k, bh = BH * k;
    const { w: iw, h: ih } = L.img;
    const s = mmPerPx(L) * k; // px do destino por px da foto
    g.save();
    if (mirror) { g.translate(bw, 0); g.scale(-1, 1); }
    g.translate(bw / 2 + L.ox * k, bh / 2 + L.oy * k);
    g.rotate(L.rot * Math.PI / 2);
    if (hq && s > 1.05) {
      // só o pedaço da foto que aparece no card, ampliado com Lanczos
      const inv = g.getTransform().inverse();
      const pts = [[0, 0], [bw, 0], [0, bh], [bw, bh]].map(([x, y]) => inv.transformPoint(new DOMPoint(x, y)));
      const pad = 3;
      const x0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.x)) / s + iw / 2) - pad);
      const y0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.y)) / s + ih / 2) - pad);
      const x1 = Math.min(iw, Math.ceil(Math.max(...pts.map((p) => p.x)) / s + iw / 2) + pad);
      const y1 = Math.min(ih, Math.ceil(Math.max(...pts.map((p) => p.y)) / s + ih / 2) + pad);
      if (x1 > x0 && y1 > y0) {
        const crop = document.createElement('canvas');
        crop.width = x1 - x0; crop.height = y1 - y0;
        const cg = crop.getContext('2d', { willReadFrequently: true });
        cg.fillStyle = '#ffffff'; // o filtro trabalha com a cor do papel por trás
        cg.fillRect(0, 0, crop.width, crop.height);
        cg.drawImage(L.img.bmp, x0, y0, crop.width, crop.height, 0, 0, crop.width, crop.height);
        const big = window.RancaUpscale.lanczos(crop, Math.max(1, Math.round(crop.width * s)), Math.max(1, Math.round(crop.height * s)));
        g.drawImage(big, (x0 - iw / 2) * s, (y0 - ih / 2) * s, crop.width * s, crop.height * s);
      }
    } else {
      g.drawImage(hq ? L.img.bmp : L.img.thumb, -iw * s / 2, -ih * s / 2, iw * s, ih * s);
    }
    g.restore();
  }

  function roundRect(g, x, y, w, h, r) {
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  /* ---------------- Prévia ---------------- */
  function render() {
    const c = el.canvas;
    const rect = c.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.max(1, Math.round(rect.width * dpr));
    c.height = Math.max(1, Math.round(rect.height * dpr));
    const g = c.getContext('2d');
    const css = getComputedStyle(document.documentElement);
    const v = (name) => css.getPropertyValue(name).trim();
    const pad = 12 * dpr;
    const k = Math.min((c.width - 2 * pad) / W, (c.height - 2 * pad) / H);
    const gx = (c.width - W * k) / 2, gy = (c.height - H * k) / 2;
    view = { gx, gy, k, dpr };

    g.fillStyle = v('--surface-2');
    g.fillRect(0, 0, c.width, c.height);
    g.save();
    g.shadowColor = 'rgba(20, 10, 60, .25)';
    g.shadowBlur = 10 * dpr;
    g.fillStyle = '#ffffff';
    g.fillRect(gx, gy, W * k, H * k);
    g.restore();
    g.imageSmoothingQuality = 'high';

    const accent = v('--accent');
    for (let i = 0; i < 9; i++) {
      const r = slot(i);
      const vx = side === 'back' ? W - r.x - CW : r.x; // com a folha virada, o card 1 fica à direita
      const bx = gx + (vx - BL) * k, by = gy + (r.y - BL) * k, bw = BW * k, bh = BH * k;
      const { L, mirror } = layerOf(i, side);
      g.save();
      g.beginPath(); g.rect(bx, by, bw, bh); g.clip();
      g.translate(bx, by);
      if (L.img) paint(g, L, mirror, k, false);
      else {
        g.fillStyle = '#f1eff8';
        g.fillRect(0, 0, bw, bh);
        g.strokeStyle = '#b9b4d6';
        g.lineWidth = 2 * dpr;
        g.lineCap = 'round';
        const cx = bw / 2, cy = bh / 2, a = Math.min(bw, bh) * 0.12;
        g.beginPath(); g.moveTo(cx - a, cy); g.lineTo(cx + a, cy); g.moveTo(cx, cy - a); g.lineTo(cx, cy + a); g.stroke();
      }
      g.restore();

      // o que fica fora do corte aparece esmaecido
      const tx = bx + BL * k, ty = by + BL * k, tw = CW * k, th = CH * k;
      g.save();
      g.beginPath();
      g.rect(bx, by, bw, bh);
      roundRect(g, tx, ty, tw, th, RADIUS * k);
      g.fillStyle = 'rgba(255,255,255,.6)';
      g.fill('evenodd');
      g.beginPath();
      roundRect(g, tx, ty, tw, th, RADIUS * k);
      g.setLineDash([3 * dpr, 3 * dpr]);
      g.strokeStyle = 'rgba(30,25,60,.35)';
      g.lineWidth = dpr;
      g.stroke();
      g.restore();

      // número do card
      const fs = Math.max(9 * dpr, 4 * k);
      g.font = '700 ' + Math.round(fs) + 'px system-ui, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const nx = tx + fs * 0.9, ny = ty + fs * 0.9;
      g.fillStyle = i === sel ? accent : 'rgba(30,25,60,.55)';
      g.beginPath(); g.arc(nx, ny, fs * 0.72, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffffff';
      g.fillText(String(i + 1), nx, ny + dpr * 0.5);

      if (i === sel) {
        g.strokeStyle = accent;
        g.lineWidth = 2.5 * dpr;
        g.strokeRect(bx - 2 * dpr, by - 2 * dpr, bw + 4 * dpr, bh + 4 * dpr);
      }
    }

    // marcas de conferência: grade na frente, ponto no verso
    if (prefs.marks) {
      g.strokeStyle = '#1c1a29'; g.fillStyle = '#1c1a29';
      g.lineWidth = Math.max(0.6, 0.15 * k);
      for (const [mx, my] of [[MARK, MARK], [W - MARK, H - MARK]]) {
        const x = side === 'back' ? W - mx : mx;
        if (side === 'front') {
          g.beginPath();
          for (let j = 0; j <= 3; j++) {
            const o = (j - 1.5) * CELL;
            g.moveTo(gx + (x + o) * k, gy + (my - 1.5 * CELL) * k); g.lineTo(gx + (x + o) * k, gy + (my + 1.5 * CELL) * k);
            g.moveTo(gx + (x - 1.5 * CELL) * k, gy + (my + o) * k); g.lineTo(gx + (x + 1.5 * CELL) * k, gy + (my + o) * k);
          }
          g.stroke();
        } else {
          g.beginPath(); g.arc(gx + x * k, gy + my * k, Math.max(1.2 * dpr, 0.5 * k), 0, Math.PI * 2); g.fill();
        }
      }
    }
  }

  /* ---------------- Painel ---------------- */
  const BACK_HINTS = {
    each: 'Cada card tem a sua foto no verso.',
    mirror: 'O verso mostra a foto da frente espelhada, como se ela atravessasse o card.',
    same: 'Uma foto só para o verso dos 9 cards.',
  };

  function quality(L) {
    const d = Math.round(25.4 / mmPerPx(L));
    const q = d >= 250 ? 'ótima' : d >= 180 ? 'boa' : d >= 120 ? 'razoável' : 'baixa, pode sair borrada';
    return 'Qualidade: ' + q + ' (' + d + ' dpi)';
  }

  function syncUI() {
    el.sideFront.checked = side === 'front';
    el.sideBack.checked = side === 'back';
    el.backEach.checked = prefs.backMode === 'each';
    el.backMirror.checked = prefs.backMode === 'mirror';
    el.backSame.checked = prefs.backMode === 'same';
    el.backHint.textContent = BACK_HINTS[prefs.backMode];

    const { L, editable } = layerOf(sel, side);
    const shared = side === 'back' && prefs.backMode === 'same';
    el.selTitle.textContent = shared ? 'Verso de todos os cards' : 'Card ' + (sel + 1) + ' · ' + (side === 'front' ? 'frente' : 'verso');
    el.pick.hidden = !editable;
    el.pick.textContent = L.img ? 'Trocar foto' : 'Escolher foto';
    el.imgName.hidden = !L.img;
    el.imgName.textContent = L.img ? L.img.name : '';
    el.imgName.title = el.imgName.textContent;
    el.editBox.hidden = !editable || !L.img;
    el.all.hidden = shared;
    if (L.img) {
      el.zoom.value = Math.round(L.zoom * 100);
      el.zoomOut.textContent = Math.round(L.zoom * 100) + '%';
      el.quality.textContent = quality(L);
    }
    el.selHint.textContent = !editable
      ? 'No modo "Espelho da frente", o verso acompanha a foto da frente. Para mudar, edite a frente.'
      : L.img ? '' : 'Escolha uma foto ou toque no card. Dá para escolher várias de uma vez: elas vão para os cards vazios em seguida.';
    el.hint.textContent = side === 'front'
      ? 'Arraste a foto para posicionar. Zoom: roda do mouse ou dois dedos. A linha tracejada é o corte.'
      : 'Assim fica o verso com a folha virada de lado: cada card fica atrás do mesmo número da frente.';

    const any = cards.some((c) => c.front.img || c.back.img) || sharedBack.img;
    el.make.disabled = busy || !any;
    el.test.disabled = busy;
  }

  function changed() {
    pdfFile = null;
    el.share.hidden = true;
    if (!busy) el.status.textContent = '';
    syncUI();
    render();
  }

  /* ---------------- Fotos ---------------- */
  async function loadImage(file) {
    let bmp = await createImageBitmap(file);
    const big = Math.max(bmp.width, bmp.height);
    if (big > MAX_SIDE) {
      const k = MAX_SIDE / big;
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
      bmp = await createImageBitmap(c);
    }
    const tk = Math.min(1, 900 / Math.max(bmp.width, bmp.height));
    const thumb = document.createElement('canvas');
    thumb.width = Math.max(1, Math.round(bmp.width * tk));
    thumb.height = Math.max(1, Math.round(bmp.height * tk));
    const tg = thumb.getContext('2d');
    tg.imageSmoothingQuality = 'high';
    tg.drawImage(bmp, 0, 0, thumb.width, thumb.height);
    return { bmp, thumb, w: bmp.width, h: bmp.height, name: (file.name || 'foto').replace(/\.[^.]+$/, '') };
  }

  function setImage(L, img) {
    Object.assign(L, blank(), { img });
  }

  // A primeira foto vai para o card selecionado; as outras, para os próximos cards vazios.
  async function addFiles(fileList) {
    const files = [...fileList].filter((x) => x.type.startsWith('image/'));
    if (!files.length) { el.status.textContent = 'Envie um arquivo de imagem (PNG, JPG, WEBP…).'; return; }
    if (busy) return;
    if (!layerOf(sel, side).editable) side = 'front';
    el.status.textContent = files.length > 1 ? 'Abrindo ' + files.length + ' fotos…' : 'Abrindo a foto…';
    let i = sel, placed = 0;
    for (const file of files) {
      let img;
      try { img = await loadImage(file); } catch (err) {
        el.status.textContent = 'Não foi possível abrir "' + file.name + '": ' + (err?.message || err);
        continue;
      }
      if (placed === 0) setImage(layerOf(sel, side).L, img);
      else {
        if (side === 'back' && prefs.backMode === 'same') break;
        // próximo card vazio depois do atual
        let j = -1;
        for (let n = 1; n < 9; n++) {
          const t = (i + n) % 9;
          if (t !== sel && !layerOf(t, side).L.img) { j = t; break; }
        }
        if (j < 0) break;
        setImage(layerOf(j, side).L, img);
        i = j;
      }
      placed++;
    }
    changed();
    if (placed < files.length && placed) el.status.textContent = 'Só cabem ' + placed + ' fotos nos cards vazios.';
  }

  el.pick.addEventListener('click', () => { if (!busy) el.input.click(); });
  el.input.addEventListener('change', () => {
    const files = el.input.files;
    if (files.length) addFiles(files);
    el.input.value = '';
  });

  function current() {
    const r = layerOf(sel, side);
    return r.editable && r.L.img ? r.L : null;
  }

  el.zoom.addEventListener('input', () => {
    const L = current(); if (!L) return;
    L.zoom = +el.zoom.value / 100;
    changed();
  });
  el.rotate.addEventListener('click', () => {
    const L = current(); if (!L) return;
    L.rot = (L.rot + 1) % 4;
    [L.ox, L.oy] = [-L.oy, L.ox];
    changed();
  });
  el.center.addEventListener('click', () => {
    const L = current(); if (!L) return;
    L.ox = 0; L.oy = 0; L.zoom = 1;
    changed();
  });
  el.remove.addEventListener('click', () => {
    const L = current(); if (!L) return;
    Object.assign(L, blank());
    changed();
  });
  el.all.addEventListener('click', () => {
    const L = current(); if (!L) return;
    for (let i = 0; i < 9; i++) {
      const t = layerOf(i, side).L;
      if (t !== L) Object.assign(t, { ...L });
    }
    el.status.textContent = 'Foto repetida nos 9 cards.';
    syncUI(); render();
  });

  for (const r of [el.sideFront, el.sideBack]) {
    r.addEventListener('change', () => { side = el.sideBack.checked ? 'back' : 'front'; changed(); });
  }
  for (const r of [el.backEach, el.backMirror, el.backSame]) {
    r.addEventListener('change', () => {
      if (!r.checked) return;
      prefs.backMode = r.value;
      savePrefs();
      side = 'back'; // mostra o resultado na hora
      changed();
    });
  }
  el.flip.addEventListener('change', () => { prefs.flip = el.flip.value; savePrefs(); changed(); });
  for (const [input, key] of [[el.dx, 'dx'], [el.dy, 'dy']]) {
    input.addEventListener('input', () => { prefs[key] = num(input.value, -20, 20, 0); savePrefs(); pdfFile = null; el.share.hidden = true; });
    input.addEventListener('change', () => { input.value = fmt(prefs[key]); });
  }
  el.marks.addEventListener('change', () => { prefs.marks = el.marks.checked; savePrefs(); changed(); });

  /* ---------------- Arrastar, zoom com a roda e com dois dedos ---------------- */
  const ptrs = new Map();
  let drag = null, pinch = null;

  function hit(e) {
    if (!view) return -1;
    const rect = el.canvas.getBoundingClientRect();
    let u = ((e.clientX - rect.left) * view.dpr - view.gx) / view.k;
    const v = ((e.clientY - rect.top) * view.dpr - view.gy) / view.k;
    if (side === 'back') u = W - u;
    for (let i = 0; i < 9; i++) {
      const r = slot(i);
      if (u >= r.x - BL - GAP / 2 && u <= r.x + CW + BL + GAP / 2 && v >= r.y - BL - GAP / 2 && v <= r.y + CH + BL + GAP / 2) return i;
    }
    return -1;
  }
  const dist = () => { const [a, b] = [...ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
  const clampZoom = (z) => Math.min(4, Math.max(0.2, z));

  el.canvas.addEventListener('pointerdown', (e) => {
    if (busy) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    el.canvas.setPointerCapture(e.pointerId);
    if (ptrs.size === 1) {
      const i = hit(e);
      drag = i < 0 ? null : { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
      if (i >= 0 && i !== sel) { sel = i; syncUI(); render(); }
    } else if (ptrs.size === 2) {
      const L = current();
      pinch = L ? { d: dist(), zoom: L.zoom } : null;
      drag = null;
    }
  });
  el.canvas.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const L = current();
    if (pinch && ptrs.size === 2 && L) {
      L.zoom = clampZoom(pinch.zoom * dist() / pinch.d);
      changed();
      return;
    }
    if (!drag) return;
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) drag.moved = true;
    if (drag.moved && L) {
      L.ox += ((e.clientX - drag.x) * view.dpr) / view.k;
      L.oy += ((e.clientY - drag.y) * view.dpr) / view.k;
      render();
    }
    drag.x = e.clientX; drag.y = e.clientY;
  });
  function endPointer(e) {
    if (!ptrs.delete(e.pointerId)) return;
    if (drag && !drag.moved && e.type === 'pointerup') {
      const r = layerOf(sel, side);
      if (r.editable && !r.L.img) el.input.click(); // card vazio: escolher a foto
    }
    if (drag && drag.moved) changed();
    if (ptrs.size < 2) pinch = null;
    drag = null;
  }
  el.canvas.addEventListener('pointerup', endPointer);
  el.canvas.addEventListener('pointercancel', endPointer);
  el.canvas.addEventListener('wheel', (e) => {
    const i = hit(e);
    if (i < 0 || busy) return;
    e.preventDefault();
    if (i !== sel) sel = i;
    const L = current();
    if (L) L.zoom = clampZoom(L.zoom * Math.exp(-e.deltaY * 0.0015));
    changed();
  }, { passive: false });

  /* ---------------- PDF ---------------- */
  const P = (x, y) => f(x * PT) + ' ' + f((H - y) * PT);
  const ln = (x1, y1, x2, y2) => P(x1, y1) + ' m ' + P(x2, y2) + ' l S\n';
  function dot(x, y, r) {
    const c = 0.5523 * r;
    return P(x + r, y) + ' m ' + P(x + r, y - c) + ' ' + P(x + c, y - r) + ' ' + P(x, y - r) + ' c ' +
      P(x - c, y - r) + ' ' + P(x - r, y - c) + ' ' + P(x - r, y) + ' c ' +
      P(x - r, y + c) + ' ' + P(x - c, y + r) + ' ' + P(x, y + r) + ' c ' +
      P(x + c, y + r) + ' ' + P(x + r, y + c) + ' ' + P(x + r, y) + ' c f\n';
  }
  // texto (tamanho em pt); align 'c' centraliza (largura aproximada da Helvetica)
  function text(x, y, size, s, align) {
    const dx = align === 'c' ? (s.length * size * 0.5) / 2 / PT : 0;
    return 'BT /F1 ' + size + ' Tf ' + P(x - dx, y) + ' Td ' + pdfText(s) + ' Tj ET\n';
  }
  // ponto da frente -> ponto do verso que fica atrás dele, já com o ajuste da impressora
  const backX = (x) => W - (x - prefs.dx);
  const backY = (y) => y - prefs.dy;

  function newDoc() {
    const pdf = new PdfWriter();
    const doc = { pdf, kids: [] };
    doc.font = pdf.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    doc.pagesId = pdf.add('');
    return doc;
  }

  // imgs: [{ jpeg, iw, ih, x, y }] (canto de cima à esquerda em mm, tamanho BW×BH)
  // rot180: verso para impressoras que viram pela borda menor
  function addPage(doc, imgs, ops, rot180) {
    const { pdf } = doc;
    const ids = imgs.map((im) => pdf.add(['<< /Type /XObject /Subtype /Image /Width ' + im.iw + ' /Height ' + im.ih +
      ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.jpeg.size + ' >>\nstream\n', im.jpeg, '\nendstream']));
    let s = rot180 ? 'q -1 0 0 -1 ' + f(W * PT) + ' ' + f(H * PT) + ' cm\n' : 'q\n';
    imgs.forEach((im, j) => {
      s += 'q ' + f(BW * PT) + ' 0 0 ' + f(BH * PT) + ' ' + f(im.x * PT) + ' ' + f((H - im.y - BH) * PT) + ' cm /Im' + j + ' Do Q\n';
    });
    s += ops + 'Q\n';
    const body = latin1(s);
    const content = pdf.add(['<< /Length ' + body.length + ' >>\nstream\n', body, '\nendstream']);
    const xo = ids.map((id, j) => '/Im' + j + ' ' + id + ' 0 R').join(' ');
    doc.kids.push(pdf.add('<< /Type /Page /Parent ' + doc.pagesId + ' 0 R /MediaBox [0 0 ' + f(W * PT) + ' ' + f(H * PT) +
      '] /Resources << /Font << /F1 ' + doc.font + ' 0 R >> /XObject << ' + xo + ' >> >> /Contents ' + content + ' 0 R >>'));
  }

  function finish(doc) {
    doc.pdf.set(doc.pagesId, '<< /Type /Pages /Kids [' + doc.kids.map((id) => id + ' 0 R').join(' ') + '] /Count ' + doc.kids.length + ' >>');
    return doc.pdf.toBlob(doc.pdf.add('<< /Type /Catalog /Pages ' + doc.pagesId + ' 0 R >>'));
  }

  async function cardJpeg(L, mirror) {
    const c = document.createElement('canvas');
    c.width = Math.round(BW * KPX); c.height = Math.round(BH * KPX);
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    paint(g, L, mirror, c.width / BW, true);
    return { jpeg: await toBlob(c, 'image/jpeg', 0.92), iw: c.width, ih: c.height };
  }

  // marcas de corte nas margens, na direção de cada linha de corte
  function cropMarks() {
    let s = '0.5 w 0 G\n';
    const xs = [], ys = [];
    for (let j = 0; j < 3; j++) {
      xs.push(X0 + j * (CW + GAP), X0 + j * (CW + GAP) + CW);
      ys.push(Y0 + j * (CH + GAP), Y0 + j * (CH + GAP) + CH);
    }
    const top = Y0 - BL - 1, bottom = ys[5] + BL + 1, left = X0 - BL - 1, right = xs[5] + BL + 1;
    for (const x of xs) s += ln(x, top, x, top - 5) + ln(x, bottom, x, bottom + 5);
    for (const y of ys) s += ln(left, y, left - 5, y) + ln(right, y, right + 5, y);
    return s;
  }

  function gridMark(cx, cy) {
    let s = '0.4 w 0 G\n';
    for (let j = 0; j <= 3; j++) {
      const o = (j - 1.5) * CELL;
      s += ln(cx + o, cy - 1.5 * CELL, cx + o, cy + 1.5 * CELL) + ln(cx - 1.5 * CELL, cy + o, cx + 1.5 * CELL, cy + o);
    }
    return s;
  }
  const MARK_POS = [[MARK, MARK], [W - MARK, H - MARK]];

  async function buildCards(onProgress) {
    const doc = newDoc();
    const cache = new Map(); // a mesma foto (verso igual em todos) é gerada uma vez só
    const jpegOf = async (L, mirror) => {
      const key = L === sharedBack ? 'shared' : null;
      if (key && cache.has(key)) return cache.get(key);
      const r = await cardJpeg(L, mirror);
      if (key) cache.set(key, r);
      return r;
    };
    const total = 18;
    let n = 0;

    const front = [];
    for (let i = 0; i < 9; i++) {
      onProgress('Gerando a frente: card ' + (i + 1) + ' de 9…', n++ / total);
      await new Promise((r) => setTimeout(r));
      const L = cards[i].front;
      if (!L.img) continue;
      const r = slot(i);
      front.push({ ...(await jpegOf(L, false)), x: r.x - BL, y: r.y - BL });
    }
    let ops = cropMarks();
    if (prefs.marks) for (const [x, y] of MARK_POS) ops += gridMark(x, y);
    ops += '0.45 g\n' + text(W / 2, 6, 7, 'FRENTE - imprima em tamanho real (100%)', 'c');
    addPage(doc, front, ops, false);

    const back = [];
    for (let i = 0; i < 9; i++) {
      onProgress('Gerando o verso: card ' + (i + 1) + ' de 9…', n++ / total);
      await new Promise((r) => setTimeout(r));
      const { L, mirror } = layerOf(i, 'back');
      if (!L.img) continue;
      const r = slot(i);
      back.push({ ...(await jpegOf(L, mirror)), x: backX(r.x - BL) - BW, y: backY(r.y - BL) });
    }
    ops = '';
    if (prefs.marks) for (const [x, y] of MARK_POS) ops += '0 g\n' + dot(backX(x), backY(y), 0.5);
    ops += '0.45 g\n' + text(W / 2, 6, 7, 'VERSO', 'c');
    addPage(doc, back, ops, prefs.flip === 'short');
    return finish(doc);
  }

  /* ---------------- Folha de teste ---------------- */
  const TARGETS = [[35, 75], [175, 75], [105, 160], [35, 262], [175, 262]];

  function scaleFront(px, py) {
    let s = '0.4 w 0 G 0 g\n';
    const sy = py - 9, sx = px - 9; // régua de cima (horizontal) e do lado (vertical), separadas
    s += ln(px - 6, sy, px + 6, sy) + ln(sx, py - 6, sx, py + 6);
    for (let d = -6; d <= 6; d++) {
      const len = d === 0 ? 3 : d % 5 === 0 ? 2.2 : 1.3;
      s += ln(px + d, sy, px + d, sy + len); // ticks para baixo
      s += ln(sx, py + d, sx + len, py + d); // ticks para a direita
    }
    for (const d of [-5, 0, 5]) {
      const lbl = d > 0 ? '+' + d : String(d);
      s += text(px + d, sy - 1.2, 5, lbl, 'c');
      s += text(sx - 1.2 - lbl.length * 1.1, py + d + 0.7, 5, lbl);
    }
    return s;
  }
  // no verso: uma cruz vermelha atrás do zero das réguas
  function crossBack(px, py) {
    return '0.5 w 0.85 0.1 0.1 RG\n' +
      ln(backX(px), backY(py - 13), backX(px), backY(py + 3)) + // vertical: cruza a régua de cima
      ln(backX(px - 13), backY(py), backX(px + 3), backY(py));  // horizontal: cruza a régua do lado
  }

  async function buildTest() {
    const doc = newDoc();
    const flipName = prefs.flip === 'short' ? 'borda menor' : 'borda maior';
    const lines = [
      '1. Imprima as 2 páginas em frente e verso, em tamanho real (100%), no papel dos cards.',
      '   Sem frente e verso automático: imprima a página 1, recoloque a folha virada e imprima a 2.',
      '2. Olhando este lado contra a luz, veja onde as linhas vermelhas do verso cruzam as réguas.',
      '   Régua de cima: quantos mm o verso saiu para a direita (+) ou para a esquerda (-).',
      '   Régua do lado: quantos mm saiu para baixo (+) ou para cima (-). Use o alvo do meio.',
      '3. Some esses números ao "Ajuste do verso" do app e imprima o teste de novo: deve dar 0.',
      'Se os alvos dos cantos derem números bem diferentes, o papel entrou torto na impressora.',
      'Ajuste atual: ' + fmt(prefs.dx) + ' mm para a direita, ' + fmt(prefs.dy) + ' mm para baixo; virando pela ' + flipName + '.',
    ];
    let ops = '0.1 g\n' + text(15, 16, 14, 'Folha de teste do Foto Card');
    ops += '0.25 g\n';
    lines.forEach((s, j) => { ops += text(15, 24 + j * 4.2, 8, s); });
    for (const [x, y] of TARGETS) ops += scaleFront(x, y);
    ops += '0.45 g\n' + text(105, 160 + 14, 7, 'alvo do meio', 'c');
    addPage(doc, [], ops, false);

    let back = '';
    for (const [x, y] of TARGETS) back += crossBack(x, y);
    back += '0.25 g\n' +
      text(W / 2, 20, 9, 'VERSO: virando a folha de lado (como página de livro), este texto deve ficar em pé.', 'c') +
      text(W / 2, 25, 9, 'Se ficar de cabeça para baixo, troque "Virar a folha pela" no app.', 'c');
    addPage(doc, [], back, prefs.flip === 'short');
    return finish(doc);
  }

  /* ---------------- Botões ---------------- */
  async function run(build, name) {
    if (busy) return;
    busy = true;
    syncUI();
    el.pick.disabled = true;
    try {
      const blob = await build((msg) => { el.status.textContent = msg; });
      const file = new File([blob], name, { type: 'application/pdf' });
      el.status.textContent = 'PDF pronto (' + (blob.size / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' MB). Imprima em tamanho real (100%).';
      download(file);
      return file;
    } catch (err) {
      console.error(err);
      el.status.textContent = 'Não foi possível gerar o PDF: ' + (err?.message || err);
      return null;
    } finally {
      busy = false;
      el.pick.disabled = false;
      syncUI();
    }
  }

  el.make.addEventListener('click', async () => {
    if (pdfFile) { download(pdfFile); return; }
    const file = await run(buildCards, 'foto-cards.pdf');
    if (!file) return;
    pdfFile = file;
    try { el.share.hidden = !(navigator.canShare && navigator.canShare({ files: [file] })); } catch { el.share.hidden = true; }
  });
  el.test.addEventListener('click', () => run(buildTest, 'foto-card-teste.pdf'));
  el.share.addEventListener('click', async () => {
    if (!pdfFile) return;
    try { await navigator.share({ files: [pdfFile], title: 'Foto cards' }); }
    catch (err) { if (err?.name !== 'AbortError') el.status.textContent = 'Não foi possível compartilhar: ' + err.message; }
  });

  /* ---------------- Abrir / fechar ---------------- */
  // As fotos ficam guardadas enquanto o app estiver aberto, mesmo fechando a janela.
  function open() {
    el.modal.hidden = false;
    document.body.classList.add('modal-open');
    syncUI();
    render();
    el.close.focus();
  }
  function close() {
    el.modal.hidden = true;
    document.body.classList.remove('modal-open');
  }
  el.close.addEventListener('click', () => { if (!busy) close(); });
  el.modal.addEventListener('click', (e) => { if (e.target === el.modal && !busy) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.modal.hidden && !busy) close(); });
  window.addEventListener('resize', () => { if (!el.modal.hidden) render(); });

  loadPrefs();
  window.RancaCards = { open, addFiles, isOpen: () => !el.modal.hidden };
})();
