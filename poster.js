// Pôster em várias folhas: divide a imagem em folhas de papel e gera um PDF (tudo offline).
// Coordenadas das folhas em mm, com a origem no canto de cima à esquerda da imagem impressa.
// Dois jeitos de montar:
//  - Grade: as folhas alinhadas em linhas e colunas (A1, A2, B1…).
//  - Encaixe livre: cada faixa de folhas fica na posição que gasta menos papel, as faixas podem ser
//    de folhas em pé ou deitadas, e dá para arrastar, girar, tirar e pôr folhas à mão.
(function () {
  'use strict';

  const PT = 72 / 25.4; // pontos PDF por mm
  const PAPERS = {
    a4: [210, 297, 'A4'],
    a3: [297, 420, 'A3'],
    letter: [215.9, 279.4, 'Carta'],
    legal: [215.9, 355.6, 'Ofício'],
  };
  const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const MAX_DPI = IS_MOBILE ? 180 : 220;
  const MIN_DPI = 150;
  const MAX_PAGES = 300;
  const MAX_CM = 500;

  const $ = (id) => document.getElementById(id);
  const el = {
    modal: $('poster'), close: $('posterClose'), projects: $('pProjects'),
    paper: $('pPaper'), orient: $('pOrient'), orientHint: $('pOrientHint'),
    marginOn: $('pMarginOn'), margin: $('pMargin'),
    overlapOn: $('pOverlapOn'), overlap: $('pOverlap'),
    sizeCm: $('pSizeCm'), sizeSheets: $('pSizeSheets'), cmBox: $('pCmBox'), sheetsBox: $('pSheetsBox'),
    cm: $('pCm'), cmAxis: $('pCmAxis'), cmHint: $('pCmHint'),
    count: $('pCount'), axis: $('pAxis'),
    layGrid: $('pLayGrid'), layFree: $('pLayFree'), layHint: $('pLayHint'), freeBox: $('pFreeBox'), head: $('pHead'),
    skip: $('pSkip'), skipRow: $('pSkipRow'), guide: $('pGuide'),
    ai: $('pAi'), aiRow: $('pAiRow'), aiLevel: $('pAiLevel'), aiLevelRow: $('pAiLevelRow'),
    tabMap: $('pTabMap'), tabPages: $('pTabPages'), tabs: $('pTabs'),
    mapBox: $('pMapBox'), canvas: $('pCanvas'), freeBar: $('pFreeBar'), freeHint: $('pFreeHint'),
    fRot: $('pfRot'), fAdd: $('pfAdd'), fDel: $('pfDel'), fAuto: $('pfAuto'),
    pagesBox: $('pPagesBox'), pages: $('pPages'), big: $('pBig'), bigCanvas: $('pBigCanvas'),
    bigPrev: $('pBigPrev'), bigNext: $('pBigNext'), bigClose: $('pBigClose'), bigCap: $('pBigCap'),
    info: $('pInfo'), status: $('pStatus'),
    make: $('pMake'), share: $('pShare'), cancel: $('pCancel'), openPdf: $('pOpenPdf'),
    srcResult: $('pSrcResult'), srcOrig: $('pSrcOrig'), srcHint: $('pSrcHint'), srcAction: $('pSrcAction'),
    srcBox: $('pSrcBox'), pick: $('pPick'), imgName: $('pImgName'),
    empty: $('pEmpty'), emptyPick: $('pEmptyPick'), recent: $('pRecent'),
  };

  let src = null;    // imagem atual (ver load())
  let layout = null; // resultado de compute()
  let pdfFile = null;
  let busy = false;
  let cancelled = false;
  // encaixe livre: folhas { x, y, land } em mm; sheetsKey = configuração para a qual foram calculadas
  let sheets = null, sheetsKey = '', manual = false, selSheet = -1, headFail = false;
  let tab = 'map';
  let bigIdx = -1;

  /* ---------------- Utilidades ---------------- */
  const num = (v, min, max, def) => {
    const n = parseFloat(String(v).replace(',', '.'));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  const cm = (mm) => (Math.round(mm) / 10).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  const rowName = (r) => (r >= 26 ? rowName(Math.floor(r / 26) - 1) : '') + String.fromCharCode(65 + (r % 26));
  const f = (n) => String(Math.round(n * 100) / 100);
  const toBlob = (c, type, q) => new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('o navegador não conseguiu gerar a imagem'))), type, q));
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

  function latin1(str) {
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      out[i] = c < 256 ? c : 63; // '?'
    }
    return out;
  }
  const pdfText = (s) => '(' + s.replace(/[\\()]/g, '\\$&') + ')';

  /* ---------------- Preferências ---------------- */
  const FIELDS = ['paper', 'orient', 'marginOn', 'margin', 'overlapOn', 'overlap', 'count', 'axis', 'cm', 'cmAxis',
    'head', 'skip', 'guide', 'ai', 'aiLevel'];
  const sizeBy = () => (el.sizeSheets.checked ? 'sheets' : 'cm');
  const layMode = () => (el.layFree.checked ? 'free' : 'grid');

  function getSettings() {
    const p = { sizeBy: sizeBy(), lay: layMode() };
    for (const k of FIELDS) p[k] = el[k].type === 'checkbox' ? el[k].checked : el[k].value;
    return p;
  }
  function applySettings(p) {
    if (!p) return;
    for (const k of FIELDS) {
      if (p[k] == null) continue;
      if (el[k].type === 'checkbox') el[k].checked = !!p[k]; else el[k].value = p[k];
    }
    if (p.sizeBy) { el.sizeCm.checked = p.sizeBy !== 'sheets'; el.sizeSheets.checked = p.sizeBy === 'sheets'; }
    if (p.lay) { el.layGrid.checked = p.lay !== 'free'; el.layFree.checked = p.lay === 'free'; }
  }
  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem('rancaFundoPoster') || '{}');
      // quem já usava o app continua no tamanho por folhas
      if (!p.sizeBy && p.count != null) p.sizeBy = 'sheets';
      applySettings(p);
    } catch { /* usa padrões */ }
  }
  function savePrefs() {
    try { localStorage.setItem('rancaFundoPoster', JSON.stringify(getSettings())); } catch { /* ignorado */ }
  }

  /* ---------------- Cálculo das folhas ---------------- */
  function compute() {
    const paper = PAPERS[el.paper.value] || PAPERS.a4;
    const W0 = paper[0], H0 = paper[1]; // folha em pé
    const land = el.orient.value === 'landscape';
    const W = land ? H0 : W0, H = land ? W0 : H0; // folha da grade
    const m = el.marginOn.checked ? num(el.margin.value, 0, 40, 10) : 0;
    const pw = W - 2 * m, ph = H - 2 * m; // área impressa de cada folha
    const ov = el.overlapOn.checked ? Math.min(num(el.overlap.value, 0, 50, 10), Math.floor(Math.min(pw, ph) / 3)) : 0;
    const sx = pw - ov, sy = ph - ov; // passo entre uma folha e a próxima
    const ratio = src.w / src.h;
    const fig = src.fig;

    let posterW, posterH;
    if (sizeBy() === 'cm') {
      const T = num(el.cm.value, 1, MAX_CM, 170) * 10;
      if (el.cmAxis.value === 'wide') { posterW = T / (fig.x1 - fig.x0); posterH = posterW / ratio; }
      else { posterH = T / (fig.y1 - fig.y0); posterW = posterH * ratio; }
    } else {
      const n = num(el.count.value, 1, 30, 4);
      if (el.axis.value === 'tall') { posterH = ph + (n - 1) * sy; posterW = posterH * ratio; }
      else { posterW = pw + (n - 1) * sx; posterH = posterW / ratio; }
    }

    const L = {
      W0, H0, W, H, m, pw, ph, ov, sx, sy, posterW, posterH,
      free: layMode() === 'free', paperName: paper[2], landscape: land,
      figW: posterW * (fig.x1 - fig.x0), figH: posterH * (fig.y1 - fig.y0),
      dpi: src.w / (posterW / 25.4),
      pages: [],
    };
    L.lowRes = L.dpi < MIN_DPI;            // ampliar vai perder nitidez
    L.useAi = L.lowRes && el.ai.checked;

    if (L.free) {
      const key = freeKey(L);
      if (!sheets || sheetsKey !== key) {
        const r = autoSheets(L);
        sheets = r.sheets; headFail = r.headFail;
        sheetsKey = key; manual = false;
        if (selSheet >= sheets.length) selSheet = -1;
      }
      if (sheets.length > MAX_PAGES) { L.tooMany = true; return L; }
      L.pages = sheets.map((s, si) => sheetOf(L, s, si));
      labelFree(L.pages);
    } else {
      const cols = Math.max(1, Math.ceil((posterW - ov) / sx - 1e-6));
      const rows = Math.max(1, Math.ceil((posterH - ov) / sy - 1e-6));
      if (rows * cols > MAX_PAGES) { L.tooMany = true; return L; }
      const offX = (ov + cols * sx - posterW) / 2, offY = (ov + rows * sy - posterH) / 2; // imagem no meio da grade
      Object.assign(L, { cols, rows });
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          L.pages.push({ r, c, x: c * sx - offX, y: r * sy - offY, w: pw, h: ph, land, label: rowName(r) + (c + 1) });
        }
      }
    }

    const skip = el.skip.checked && !src.bg && !src.opaque;
    for (const p of L.pages) p.blank = skip && isBlank(L, p);
    L.printed = L.pages.filter((p) => !p.blank);
    L.bx0 = Math.min(0, ...L.pages.map((p) => p.x));
    L.by0 = Math.min(0, ...L.pages.map((p) => p.y));
    L.bx1 = Math.max(posterW, ...L.pages.map((p) => p.x + p.w));
    L.by1 = Math.max(posterH, ...L.pages.map((p) => p.y + p.h));
    if (L.free) L.cover = coverage(L);
    return L;
  }

  function sheetOf(L, s, si) {
    const pw = L.W0 - 2 * L.m, ph = L.H0 - 2 * L.m;
    return { si, x: s.x, y: s.y, land: !!s.land, w: s.land ? ph : pw, h: s.land ? pw : ph };
  }

  // No encaixe livre as folhas são numeradas de cima para baixo e da esquerda para a direita.
  function labelFree(pages) {
    const order = pages.slice().sort((a, b) => (Math.round(a.y / 20) - Math.round(b.y / 20)) || (a.x - b.x));
    order.forEach((p, i) => { p.label = String(i + 1); });
  }

  // A folha fica vazia se a parte da imagem que cai nela é toda transparente.
  function isBlank(L, p) {
    if (!src.alpha) return false;
    const kx = src.aw / L.posterW, ky = src.ah / L.posterH;
    const x0 = Math.max(0, Math.floor(p.x * kx)), x1 = Math.min(src.aw, Math.ceil((p.x + p.w) * kx));
    const y0 = Math.max(0, Math.floor(p.y * ky)), y1 = Math.min(src.ah, Math.ceil((p.y + p.h) * ky));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) if (src.alpha[y * src.aw + x] > 8) return false;
    }
    return true;
  }

  /* ---------------- Encaixe livre automático ---------------- */
  const freeKey = (L) => [el.paper.value, L.m, L.ov, L.posterW.toFixed(1), L.posterH.toFixed(1), el.head.checked,
    src.kind, src.w, src.h, src.bg ? 1 : 0].join('|');

  // A figura é dividida em faixas horizontais. Cada faixa é de folhas em pé ou deitadas, e as folhas
  // da faixa começam onde a figura começa naquela altura (não precisam alinhar com a faixa de cima).
  // Uma programação dinâmica escolhe a orientação de cada faixa para usar o mínimo de folhas.
  function autoSheets(L) {
    const { m, ov } = L;
    const P = { land: false, w: L.W0 - 2 * m, h: L.H0 - 2 * m };
    const O = [P, { land: true, w: P.h, h: P.w }];
    const mw = src.mw, mh = src.mh, M = src.mask;
    const ux = L.posterW / mw, uy = L.posterH / mh;

    // prefixo por coluna: quantas linhas com figura até y
    const cp = new Int32Array((mh + 1) * mw);
    const rowHas = new Uint8Array(mh), rowMin = new Int32Array(mh).fill(mw), rowMax = new Int32Array(mh).fill(-1);
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        const v = M[y * mw + x];
        cp[(y + 1) * mw + x] = cp[y * mw + x] + v;
        if (v) { rowHas[y] = 1; if (x < rowMin[y]) rowMin[y] = x; rowMax[y] = x; }
      }
    }
    const occ = (x, i, j) => cp[j * mw + x] - cp[i * mw + x] > 0;
    const next = (i, o) => Math.min(mh, Math.max(i + 1, Math.floor((i * uy + o.h - ov) / uy + 1e-9)));

    // folhas de uma faixa (linhas i..j da máscara), da esquerda para a direita
    function strip(i, j, o, place) {
      const out = [];
      let c = 0, chain = null;
      const chains = [];
      while (c < mw) {
        if (!occ(c, i, j)) { c++; continue; }
        const last = out[out.length - 1];
        const glued = last && c > 0 && occ(c - 1, i, j) && c * ux < last.x + o.w + 1e-6;
        const x = glued ? last.x + o.w - ov : c * ux;
        out.push({ x, y: i * uy, land: o.land });
        if (!glued) { chain = { first: out.length - 1, a: c * ux, b: (c + 1) * ux }; chains.push(chain); }
        chain.last = out.length - 1;
        while (c < mw && (c + 1) * ux <= x + o.w + 1e-6) {
          if (occ(c, i, j)) chain.b = (c + 1) * ux;
          c++;
        }
      }
      if (!place) return out.length;
      // centraliza cada grupo de folhas coladas em cima da parte da figura que ele cobre
      let prevEnd = -Infinity;
      for (const ch of chains) {
        const x0 = out[ch.first].x, len = out[ch.last].x + o.w - x0;
        let shift = (ch.a + ch.b - len) / 2 - x0;
        shift = Math.min(0, Math.max(shift, prevEnd - x0));
        for (let k = ch.first; k <= ch.last; k++) out[k].x += shift;
        prevEnd = out[ch.last].x + o.w;
      }
      return out;
    }

    const best = new Float64Array(mh + 1), choice = new Int8Array(mh + 1);
    for (let i = mh - 1; i >= 0; i--) {
      if (!rowHas[i]) { best[i] = best[i + 1]; choice[i] = -1; continue; }
      best[i] = Infinity;
      for (let k = 0; k < 2; k++) {
        const j = next(i, O[k]);
        const cost = strip(i, j, O[k], false) + 0.01 + best[j]; // 0,01: em empate, menos faixas
        if (cost < best[i] - 1e-9) { best[i] = cost; choice[i] = k; }
      }
    }

    const out = [];
    let start = 0, fail = false;
    while (start < mh && !rowHas[start]) start++;

    // "Uma folha para a cabeça": a primeira folha pega o alto da figura inteiro, centralizada,
    // e vai até onde a figura ainda cabe na largura dela.
    if (el.head.checked && start < mh) {
      let bestJ = start, bestO = null, bestA = 0, bestB = 0;
      for (const o of O) {
        const jmax = next(start, o);
        let lo = mw, hi = -1, j = start;
        while (j < jmax) {
          const nlo = rowHas[j] ? Math.min(lo, rowMin[j]) : lo, nhi = rowHas[j] ? Math.max(hi, rowMax[j]) : hi;
          if (nhi >= 0 && (nhi + 1 - nlo) * ux > o.w + 1e-6) break;
          lo = nlo; hi = nhi; j++;
        }
        if (j > bestJ) { bestJ = j; bestO = o; bestA = lo * ux; bestB = (hi + 1) * ux; }
      }
      if (bestO) {
        const bottom = bestJ * uy + ov;
        out.push({ x: (bestA + bestB) / 2 - bestO.w / 2, y: Math.min(start * uy, bottom - bestO.h), land: bestO.land, head: true });
        start = bestJ;
      } else fail = true;
    }

    for (let i = start; i < mh;) {
      if (choice[i] < 0) { i++; continue; }
      const o = O[choice[i]];
      const j = next(i, o);
      out.push(...strip(i, j, o, true));
      i = j;
    }
    return { sheets: out.map((s) => ({ x: s.x, y: s.y, land: s.land })), headFail: fail };
  }

  // Parte da figura que ficou sem folha (encaixe livre): conta e pinta de vermelho.
  function coverage(L) {
    const mw = src.mw, mh = src.mh, M = src.mask;
    const cov = new Uint8Array(mw * mh);
    const ux = L.posterW / mw, uy = L.posterH / mh;
    for (const p of L.printed) {
      const x0 = Math.max(0, Math.ceil(p.x / ux - 0.5)), x1 = Math.min(mw, Math.ceil((p.x + p.w) / ux - 0.5));
      const y0 = Math.max(0, Math.ceil(p.y / uy - 0.5)), y1 = Math.min(mh, Math.ceil((p.y + p.h) / uy - 0.5));
      for (let y = y0; y < y1; y++) cov.fill(1, y * mw + x0, y * mw + Math.max(x0, x1));
    }
    let n = 0, total = 0;
    for (let i = 0; i < cov.length; i++) { if (M[i]) { total++; if (!cov[i]) n++; } }
    let canvas = null;
    if (n) {
      canvas = document.createElement('canvas');
      canvas.width = mw; canvas.height = mh;
      const g = canvas.getContext('2d');
      const img = g.createImageData(mw, mh);
      for (let i = 0; i < cov.length; i++) {
        if (M[i] && !cov[i]) { img.data[i * 4] = 230; img.data[i * 4 + 1] = 30; img.data[i * 4 + 2] = 40; img.data[i * 4 + 3] = 200; }
      }
      g.putImageData(img, 0, 0);
    }
    return { n, frac: total ? n / total : 0, canvas };
  }

  /* ---------------- Desenho (prévia e mapa de montagem) ---------------- */
  function sceneView(cw, ch, L, pad) {
    const bw = L.bx1 - L.bx0, bh = L.by1 - L.by0;
    const k = Math.min((cw - 2 * pad) / bw, (ch - 2 * pad) / bh);
    return { k, gx: (cw - bw * k) / 2 - L.bx0 * k, gy: (ch - bh * k) / 2 - L.by0 * k };
  }

  function drawScene(ctx, cw, ch, L, opt) {
    const { k, gx, gy } = sceneView(cw, ch, L, opt.pad);

    ctx.fillStyle = opt.bg;
    ctx.fillRect(0, 0, cw, ch);

    // folhas impressas
    ctx.fillStyle = src.bg || '#ffffff';
    for (const p of L.pages) if (!p.blank) ctx.fillRect(gx + p.x * k, gy + p.y * k, p.w * k, p.h * k);
    // imagem
    ctx.drawImage(src.thumb, gx, gy, L.posterW * k, L.posterH * k);
    // parte da figura sem folha
    if (opt.uncovered && L.cover && L.cover.canvas) {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(L.cover.canvas, gx, gy, L.posterW * k, L.posterH * k);
      ctx.restore();
    }

    // contornos e nomes das folhas
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of L.pages) {
      const x = gx + p.x * k, y = gy + p.y * k, w = p.w * k, h = p.h * k;
      const selected = opt.sel != null && p.si === opt.sel;
      ctx.setLineDash(p.blank ? [4, 4] : []);
      ctx.lineWidth = Math.max(1, opt.line) * (selected ? 2.5 : 1);
      ctx.strokeStyle = p.blank ? opt.muted : opt.accent;
      if (selected) { ctx.fillStyle = 'rgba(91, 76, 240, .14)'; ctx.fillRect(x, y, w, h); }
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      const side = Math.min(p.w, p.h) * k;
      let fs = side * (L.free ? 0.18 : 0.22);
      if (fs < 9 && side >= 16) fs = Math.min(9, side * 0.5); // prévia pequena (celular): número legível
      if (fs >= 7) {
        ctx.font = '700 ' + Math.round(fs) + 'px system-ui, sans-serif';
        if (!p.blank) { // contorno branco para ler o código mesmo em cima da imagem
          ctx.lineWidth = Math.max(2, fs / 5);
          ctx.strokeStyle = 'rgba(255,255,255,.85)';
          ctx.lineJoin = 'round';
          ctx.strokeText(p.label, x + w / 2, y + h / 2);
        }
        ctx.fillStyle = p.blank ? opt.muted : opt.accent;
        ctx.globalAlpha = p.blank ? 0.6 : 1;
        ctx.fillText(p.label, x + w / 2, y + h / 2);
        ctx.globalAlpha = 1;
      }
    }
    ctx.setLineDash([]);
    return { k, gx, gy };
  }

  const cssVars = () => {
    const css = getComputedStyle(document.documentElement);
    const v = (name) => css.getPropertyValue(name).trim();
    return { surface2: v('--surface-2'), accent: v('--accent'), muted: v('--muted') };
  };

  let pv = null; // transformação da última prévia (para arrastar as folhas)
  function renderPreview() {
    const c = el.canvas;
    const r = c.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.max(1, Math.round(r.width * dpr));
    c.height = Math.max(1, Math.round(r.height * dpr));
    const ctx = c.getContext('2d');
    if (!src || !layout || layout.tooMany) {
      ctx.clearRect(0, 0, c.width, c.height);
      pv = null;
      return;
    }
    const v = cssVars();
    ctx.imageSmoothingQuality = 'high';
    const t = drawScene(ctx, c.width, c.height, layout, {
      pad: 14 * dpr, line: 1.5 * dpr, bg: v.surface2, accent: v.accent, muted: v.muted,
      uncovered: layout.free, sel: layout.free ? selSheet : null,
    });
    pv = { ...t, dpr };
  }

  // Quantas folhas o encaixe livre usaria (para sugerir na grade).
  let freeGuess = { key: '', n: 0 };
  function freeCount(L) {
    const key = freeKey(L);
    if (freeGuess.key !== key) freeGuess = { key, n: autoSheets(L).sheets.length };
    return freeGuess.n;
  }

  function renderInfo() {
    const L = layout;
    if (L.tooMany) {
      el.info.innerHTML = '<p class="poster-warn">Ficaria com mais de ' + MAX_PAGES + ' folhas. Diminua o tamanho.</p>';
      el.make.disabled = true;
      return;
    }
    const rows = [];
    const skipped = L.pages.length - L.printed.length;
    const figDiff = Math.abs(L.figW - L.posterW) > 1 || Math.abs(L.figH - L.posterH) > 1;
    rows.push([src.kind === 'result' || src.figFrom ? 'Tamanho real' : 'Imagem', cm(L.figW) + ' × ' + cm(L.figH) + ' cm']);
    if (figDiff) rows.push(['Foto inteira', cm(L.posterW) + ' × ' + cm(L.posterH) + ' cm']);
    const nLand = L.printed.filter((p) => p.land).length;
    const mix = L.free ? (nLand ? nLand === L.printed.length ? ', deitadas' : ', ' + nLand + ' deitada' + (nLand > 1 ? 's' : '') : ', em pé') : '';
    const out = skipped === 1 ? ' (1 vazia fica de fora)' : skipped ? ' (' + skipped + ' vazias ficam de fora)' : '';
    rows.push(['Folhas', L.printed.length + ' ' + L.paperName + mix + out +
      (el.guide.checked ? ' + mapa' : '')]);
    const d = Math.round(L.dpi);
    const q = d >= 150 ? 'ótima' : d >= 90 ? 'boa' : d >= 50 ? 'boa de longe' : 'baixa, pode ficar pixelado';
    rows.push(['Qualidade', L.useAi
      ? 'melhorada com IA (a foto sozinha daria ' + d + ' dpi)'
      : q + ' (' + d + ' dpi)']);
    el.info.textContent = '';
    for (const [k, v] of rows) {
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v;
      el.info.append(dt, dd);
    }
    const note = (text, warn) => {
      const p = document.createElement('p');
      p.className = warn ? 'poster-warn' : 'small';
      p.textContent = text;
      el.info.append(p);
    };
    if (L.free && L.cover.n) {
      note('Uma parte da figura (em vermelho) ficou sem folha. Arraste uma folha para cima dela, use "Pôr folha" ou "Arrumar sozinho".', true);
    }
    if (L.free && headFail) note('O alto da figura é mais largo que uma folha, então a cabeça não coube numa folha só.');
    if (!L.free && L.printed.length > 2) {
      const n = freeCount(L);
      if (n < L.printed.length) note('No encaixe livre seriam ' + n + ' folhas (' + (L.printed.length - n) + ' a menos).');
    }
    if (L.m < 5) note('Sem margem, as folhas saem sem código e sem marcas de corte.');
    el.make.disabled = busy || !L.printed.length;
  }

  function syncForm() {
    el.margin.disabled = !el.marginOn.checked;
    el.overlap.disabled = !el.overlapOn.checked;
    el.cmBox.hidden = sizeBy() !== 'cm';
    el.sheetsBox.hidden = sizeBy() !== 'sheets';
    const free = layMode() === 'free';
    el.freeBox.hidden = !free;
    el.layHint.textContent = free
      ? 'As folhas não precisam ficar alinhadas: o app mistura folhas em pé e deitadas para gastar menos papel. Na prévia, toque numa folha para arrastar, girar ou tirar.'
      : 'Folhas alinhadas em linhas e colunas.';
    el.orientHint.textContent = free && sizeBy() === 'cm' ? 'No encaixe livre, o app escolhe em pé ou deitada para cada faixa.' : '';
    if (src) {
      el.cmHint.textContent = src.kind === 'result'
        ? 'Medido só na parte que aparece (a pessoa, da cabeça aos pés), não na folha.'
        : src.figFrom
          ? 'Medido na pessoa (pelo recorte da IA). O fundo da foto aumenta junto.'
          : 'Sem tirar o fundo, a medida vale para a foto inteira. Tire o fundo para medir só a pessoa.';
    }
  }

  function update() {
    if (!src) return;
    savePrefs();
    syncForm();
    el.skipRow.hidden = !!src.bg || src.opaque;
    layout = compute();
    el.aiRow.hidden = !layout.lowRes;
    el.aiLevelRow.hidden = !el.ai.checked;
    invalidatePdf();
    if (!busy) el.status.textContent = '';
    renderInfo();
    syncFreeBar();
    renderPreview();
    if (tab === 'pages') renderPages();
    scheduleProjectSave();
  }

  function invalidatePdf() {
    pdfFile = null;
    el.share.hidden = true;
    el.openPdf.hidden = true;
  }

  /* ---------------- Marcas de cada folha (PDF e visualizador) ---------------- */
  // Tudo em mm, com a origem no canto de cima à esquerda do papel, na orientação da folha.
  function sheetMarks(L, p, i, total) {
    const m = L.m, SW = p.w + 2 * m, SH = p.h + 2 * m;
    const S = { SW, SH, lines: [], dashed: [], texts: [] };
    if (m < 5) return S;
    const gap = 1.5, len = Math.min(m - 2, 7);
    for (const cx of [m, SW - m]) {
      for (const cy of [m, SH - m]) {
        const dx = cx === m ? -1 : 1, dy = cy === m ? -1 : 1;
        S.lines.push([cx + dx * gap, cy, cx + dx * (gap + len), cy], [cx, cy + dy * gap, cx, cy + dy * (gap + len)]);
      }
    }
    // onde fica a borda das folhas vizinhas (tracejado na margem) e o nome delas
    const tol = 0.6, side = { top: [], bottom: [], left: [], right: [] };
    for (const q of L.printed) {
      if (q === p) continue;
      for (const ex of [q.x, q.x + q.w]) {
        if (ex <= p.x + tol || ex >= p.x + p.w - tol) continue;
        const lx = m + ex - p.x, a = q.y, b = q.y + q.h;
        if (a < p.y - tol && b > p.y - tol) S.dashed.push([lx, m - gap, lx, m - gap - len]);
        if (b > p.y + p.h + tol && a < p.y + p.h + tol) S.dashed.push([lx, SH - m + gap, lx, SH - m + gap + len]);
      }
      for (const ey of [q.y, q.y + q.h]) {
        if (ey <= p.y + tol || ey >= p.y + p.h - tol) continue;
        const ly = m + ey - p.y, a = q.x, b = q.x + q.w;
        if (a < p.x - tol && b > p.x - tol) S.dashed.push([m - gap, ly, m - gap - len, ly]);
        if (b > p.x + p.w + tol && a < p.x + p.w + tol) S.dashed.push([SW - m + gap, ly, SW - m + gap + len, ly]);
      }
      const ox0 = Math.max(p.x, q.x), ox1 = Math.min(p.x + p.w, q.x + q.w);
      const oy0 = Math.max(p.y, q.y), oy1 = Math.min(p.y + p.h, q.y + q.h);
      if (ox1 - ox0 > 25) {
        if (q.y < p.y - tol && q.y + q.h >= p.y - 2) side.top.push([m + (ox0 + ox1) / 2 - p.x, q.label]);
        if (q.y + q.h > p.y + p.h + tol && q.y <= p.y + p.h + 2) side.bottom.push([m + (ox0 + ox1) / 2 - p.x, q.label]);
      }
      if (oy1 - oy0 > 25) {
        if (q.x < p.x - tol && q.x + q.w >= p.x - 2) side.left.push([m + (oy0 + oy1) / 2 - p.y, q.label]);
        if (q.x + q.w > p.x + p.w + tol && q.x <= p.x + p.w + 2) side.right.push([m + (oy0 + oy1) / 2 - p.y, q.label]);
      }
    }
    const main = L.free
      ? 'Folha ' + p.label + (p.land ? ' (deitada)' : '') + '    folha ' + i + ' de ' + total
      : p.label + '    linha ' + (p.r + 1) + ', coluna ' + (p.c + 1) + '    folha ' + i + ' de ' + total;
    const base = SH - Math.max(1.5, m / 2 - 1);
    S.texts.push({ x: m, y: base, size: 7, s: main, align: 'left' });
    const mainEnd = m + textW(main, 7) + 4;
    const nb = (lbl) => 'folha ' + lbl;
    for (const [x, lbl] of side.top) S.texts.push({ x, y: m / 2 + 1.2, size: 6, s: nb(lbl), align: 'center' });
    for (const [x, lbl] of side.bottom) {
      const s = nb(lbl), w = textW(s, 6);
      S.texts.push({ x: Math.max(x, mainEnd + w / 2), y: base, size: 6, s, align: 'center' });
    }
    for (const [y, lbl] of side.left) S.texts.push({ x: m / 2, y, size: 6, s: nb(lbl), align: 'center', rot: -90 });
    for (const [y, lbl] of side.right) S.texts.push({ x: SW - m / 2, y, size: 6, s: nb(lbl), align: 'center', rot: 90 });
    return S;
  }
  const textW = (s, size) => s.length * size * 0.5 / PT; // largura aproximada (Helvetica), em mm

  /* ---------------- PDF ---------------- */
  function PdfWriter() { this.objs = []; }
  PdfWriter.prototype.add = function (parts) {
    this.objs.push(Array.isArray(parts) ? parts : [parts]);
    return this.objs.length;
  };
  PdfWriter.prototype.set = function (id, parts) { this.objs[id - 1] = Array.isArray(parts) ? parts : [parts]; };
  PdfWriter.prototype.toBlob = function (rootId) {
    const out = [];
    let pos = 0;
    const push = (p) => {
      const b = typeof p === 'string' ? latin1(p) : p;
      out.push(b);
      pos += b instanceof Blob ? b.size : b.length;
    };
    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const offs = [];
    this.objs.forEach((parts, i) => {
      offs.push(pos);
      push((i + 1) + ' 0 obj\n');
      parts.forEach(push);
      push('\nendobj\n');
    });
    const xref = pos;
    const n = this.objs.length + 1;
    push('xref\n0 ' + n + '\n0000000000 65535 f \n' +
      offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('') +
      'trailer\n<< /Size ' + n + ' /Root ' + rootId + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    return new Blob(out, { type: 'application/pdf' });
  };

  // pw, ph: tamanho da página em mm
  function addPage(pdf, ctx, jpeg, iw, ih, ops, pw, ph) {
    const img = pdf.add(['<< /Type /XObject /Subtype /Image /Width ' + iw + ' /Height ' + ih +
      ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.size + ' >>\nstream\n', jpeg, '\nendstream']);
    const body = latin1(ops);
    const content = pdf.add(['<< /Length ' + body.length + ' >>\nstream\n', body, '\nendstream']);
    ctx.kids.push(pdf.add('<< /Type /Page /Parent ' + ctx.pagesId + ' 0 R /MediaBox [0 0 ' + f(pw * PT) + ' ' + f(ph * PT) +
      '] /Resources << /Font << /F1 ' + ctx.font + ' 0 R >> /XObject << /Im0 ' + img + ' 0 R >> >> /Contents ' + content + ' 0 R >>'));
  }

  // marcas em operadores PDF (origem embaixo à esquerda)
  function marksOps(S) {
    const ln = ([x1, y1, x2, y2]) => f(x1 * PT) + ' ' + f((S.SH - y1) * PT) + ' m ' + f(x2 * PT) + ' ' + f((S.SH - y2) * PT) + ' l S\n';
    let s = '0.4 w 0.45 G\n' + S.lines.map(ln).join('');
    if (S.dashed.length) s += '[1.5 1] 0 d\n' + S.dashed.map(ln).join('') + '[] 0 d\n';
    for (const t of S.texts) {
      const w = t.align === 'center' ? textW(t.s, t.size) : 0;
      const x = t.x * PT, y = (S.SH - t.y) * PT;
      if (t.rot) {
        // girado em volta do ponto (x, y), texto centralizado nele
        const r = t.rot === 90 ? '0 -1 1 0 ' : '0 1 -1 0 ';
        s += 'q ' + r + f(x) + ' ' + f(y) + ' cm BT 0.4 g /F1 ' + t.size + ' Tf ' + f(-w * PT / 2) + ' ' + f(-t.size / 3) + ' Td ' + pdfText(t.s) + ' Tj ET Q\n';
      } else {
        s += 'BT 0.4 g /F1 ' + t.size + ' Tf ' + f(x - w * PT / 2) + ' ' + f(y) + ' Td ' + pdfText(t.s) + ' Tj ET\n';
      }
    }
    return s;
  }

  // Tamanho da página do PDF. No encaixe livre todas saem em pé (a folha deitada vai girada na página).
  const pageRot = (L, p) => L.free && p.land;

  function guideTexts(L) {
    const figDiff = Math.abs(L.figW - L.posterW) > 1 || Math.abs(L.figH - L.posterH) > 1;
    const lines = [
      src.name + ' - ' + (figDiff ? 'figura de ' + cm(L.figW) + ' × ' + cm(L.figH) + ' cm, foto de ' : 'pôster de ') +
        cm(L.posterW) + ' × ' + cm(L.posterH) + ' cm',
      L.printed.length + ' folhas ' + L.paperName + (L.free ? ', encaixe livre' : ' (' + (L.landscape ? 'paisagem' : 'retrato') + ')') +
        ', margem de ' + f(L.m) + ' mm' + (L.ov ? ', sobreposição de ' + f(L.ov) + ' mm' : ''),
      '',
      '1. Imprima em tamanho real (100%), sem "ajustar à página".',
      L.m >= 5 ? '2. Corte a margem branca de cada folha seguindo as marcas dos cantos.'
        : '2. As folhas não têm margem: use o mapa abaixo para saber a ordem.',
    ];
    if (L.free) {
      lines.push('3. As folhas não ficam em grade: monte seguindo o mapa.' + (L.m >= 5 ? ' Na margem de cada folha aparece o' : ''));
      if (L.m >= 5) lines.push('    nome da vizinha, e o tracejado mostra onde a borda dela encaixa.');
      if (L.printed.some((p) => p.land)) lines.push('4. As folhas deitadas saem giradas na página: gire o papel para montar.');
    } else {
      lines.push(L.ov ? '3. A folha da direita (ou de baixo) cola por cima da anterior, até as marcas tracejadas.'
        : '3. Junte as folhas lado a lado e prenda com fita pelo verso.');
    }
    if (L.printed.length < L.pages.length) lines.push('As folhas tracejadas no mapa ficaram vazias e não foram impressas.');
    lines.push('Dica: para um boneco em pé, cole as folhas num papelão e recorte o contorno.');
    return lines;
  }

  // posição do mapa na página do guia (em pt, origem embaixo à esquerda)
  function guideGeom(L, PW, PH) {
    const lines = guideTexts(L);
    const mg = Math.max(L.m, 12);
    const textH = 26 + lines.length * 13;
    const areaW = PW * PT - 2 * mg * PT, areaH = PH * PT - 2 * mg * PT - textH - 10;
    const ratio = (L.bx1 - L.bx0) / (L.by1 - L.by0);
    let mw = areaW, mh = areaW / ratio;
    if (mh > areaH) { mh = areaH; mw = areaH * ratio; }
    const x = mg * PT;
    return { lines, mg, mw, mh, mapX: x + (areaW - mw) / 2, mapY: mg * PT, x, top: PH * PT - mg * PT };
  }
  const guideSize = (L) => (L.free ? [L.W0, L.H0] : [L.W, L.H]);

  async function guidePage(pdf, ctx, L) {
    const [PW, PH] = guideSize(L);
    const G = guideGeom(L, PW, PH);
    const scale = 2.5; // ~180 dpi
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(G.mw * scale));
    c.height = Math.max(1, Math.round(G.mh * scale));
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    drawScene(g, c.width, c.height, L, { pad: 2, line: 2, bg: '#ffffff', accent: '#5b4cf0', muted: '#9a97ab' });
    const jpeg = await toBlob(c, 'image/jpeg', 0.9);

    let ops = 'q ' + f(G.mw) + ' 0 0 ' + f(G.mh) + ' ' + f(G.mapX) + ' ' + f(G.mapY) + ' cm /Im0 Do Q\n';
    ops += 'BT 0.11 0.1 0.16 rg /F1 16 Tf ' + f(G.x) + ' ' + f(G.top - 16) + ' Td ' + pdfText('Montagem do pôster') + ' Tj ET\n';
    ops += 'BT 0.25 g /F1 9 Tf 13 TL ' + f(G.x) + ' ' + f(G.top - 36) + ' Td\n';
    G.lines.forEach((s, i) => { ops += pdfText(s) + (i ? " '\n" : ' Tj\n'); });
    ops += 'ET\n';
    addPage(pdf, ctx, jpeg, c.width, c.height, ops, PW, PH);
  }

  // Desenha a parte da imagem que cai na folha p (canvas c do tamanho da área impressa).
  async function drawPage(g, c, L, p, k, onAiProgress, onStatus) {
    g.fillStyle = src.bg || '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    const X0 = -p.x * k, Y0 = -p.y * k;   // canto da imagem na folha
    const q = (L.posterW * k) / src.w;    // px da folha por px da foto
    if (q <= 1.05) { // foto com resolução de sobra: só reduz
      g.drawImage(src.bmp, X0, Y0, L.posterW * k, L.posterH * k);
      return;
    }
    // recorte da foto que aparece nesta folha (com folga para o filtro)
    const pad = 3;
    const sx = Math.max(0, Math.floor(-X0 / q) - pad), sy = Math.max(0, Math.floor(-Y0 / q) - pad);
    const ex = Math.min(src.w, Math.ceil((c.width - X0) / q) + pad), ey = Math.min(src.h, Math.ceil((c.height - Y0) / q) + pad);
    if (ex <= sx || ey <= sy) return;
    const crop = document.createElement('canvas');
    crop.width = ex - sx; crop.height = ey - sy;
    const cg = crop.getContext('2d', { willReadFrequently: true });
    cg.fillStyle = src.bg || '#ffffff'; // a IA e o filtro trabalham com a cor do papel por trás
    cg.fillRect(0, 0, crop.width, crop.height);
    cg.drawImage(src.bmp, sx, sy, crop.width, crop.height, 0, 0, crop.width, crop.height);
    const dx = X0 + sx * q, dy = Y0 + sy * q;
    if (L.useAi) {
      await window.RancaUpscale.ai(crop, g, dx, dy, q, {
        onProgress: onAiProgress, onStatus, cancelled: () => cancelled,
        strength: Math.min(1, Math.max(0, +el.aiLevel.value || 0.6)),
      });
    } else {
      const big = window.RancaUpscale.lanczos(crop, Math.max(1, Math.round(crop.width * q)), Math.max(1, Math.round(crop.height * q)));
      g.drawImage(big, dx, dy, crop.width * q, crop.height * q);
    }
  }

  async function buildPdf(L, onProgress) {
    const pdf = new PdfWriter();
    const ctx = { kids: [] };
    ctx.font = pdf.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    ctx.pagesId = pdf.add('');
    const total = L.printed.length;

    if (el.guide.checked) {
      onProgress('Desenhando o mapa de montagem…', 0);
      await guidePage(pdf, ctx, L);
    }

    // com IA a foto ganha 4x mais pixels, então dá para imprimir com mais dpi
    const dpi = Math.min(MAX_DPI, Math.max(MIN_DPI, L.useAi ? L.dpi * window.RancaUpscale.SCALE : L.dpi));
    const k = dpi / 25.4; // px por mm
    const canvases = new Map(); // um canvas por formato (em pé / deitada)

    let i = 0;
    for (const p of L.printed) {
      i++;
      if (cancelled) throw new DOMException('cancelado', 'AbortError');
      onProgress('Gerando folha ' + i + ' de ' + total + '…', (i - 1) / total);
      const w = Math.round(p.w * k), h = Math.round(p.h * k);
      let c = canvases.get(w + 'x' + h);
      if (!c) {
        c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').imageSmoothingQuality = 'high';
        canvases.set(w + 'x' + h, c);
      }
      const g = c.getContext('2d');
      await drawPage(g, c, L, p, k, (frac) =>
        onProgress('Melhorando com IA: folha ' + i + ' de ' + total + ' (' + Math.round(((i - 1 + frac) / total) * 100) + '%)…', (i - 1 + frac) / total), (msg) => onProgress(msg, null));
      const jpeg = await toBlob(c, 'image/jpeg', 0.9);

      const S = sheetMarks(L, p, i, total);
      let ops = 'q ' + f(p.w * PT) + ' 0 0 ' + f(p.h * PT) + ' ' + f(L.m * PT) + ' ' + f(L.m * PT) + ' cm /Im0 Do Q\n' + marksOps(S);
      let PW = S.SW, PH = S.SH;
      if (pageRot(L, p)) { // página em pé, folha deitada girada dentro dela
        ops = 'q 0 1 -1 0 ' + f(S.SH * PT) + ' 0 cm\n' + ops + 'Q\n';
        PW = S.SH; PH = S.SW;
      }
      addPage(pdf, ctx, jpeg, c.width, c.height, ops, PW, PH);
    }

    pdf.set(ctx.pagesId, '<< /Type /Pages /Kids [' + ctx.kids.map((id) => id + ' 0 R').join(' ') + '] /Count ' + ctx.kids.length + ' >>');
    const root = pdf.add('<< /Type /Catalog /Pages ' + ctx.pagesId + ' 0 R >>');
    return pdf.toBlob(root);
  }

  function download(file) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  el.make.addEventListener('click', async () => {
    if (busy || !layout || layout.tooMany) return;
    if (pdfFile) { download(pdfFile); return; }
    busy = true;
    cancelled = false;
    el.make.hidden = true;
    el.cancel.hidden = false;
    el.pick.disabled = true;
    const L = layout;
    try {
      let lastFrac = 0;
      const blob = await buildPdf(L, (msg, frac) => {
        el.status.textContent = msg;
        if (frac != null) lastFrac = frac;
        window.RancaProgress.set('poster', frac === null ? null : lastFrac, 'Pôster: ' + msg);
      });
      if (L !== layout) return; // configuração mudou durante a geração
      pdfFile = new File([blob], src.name + '-poster.pdf', { type: 'application/pdf' });
      el.status.textContent = 'PDF pronto (' + (blob.size / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' MB).';
      try { el.share.hidden = !(navigator.canShare && navigator.canShare({ files: [pdfFile] })); } catch { el.share.hidden = true; }
      el.openPdf.hidden = IS_MOBILE; // no celular, o PDF baixado já abre no leitor
      download(pdfFile);
    } catch (err) {
      if (err?.name === 'AbortError') { el.status.textContent = 'Cancelado.'; return; }
      console.error(err);
      el.status.textContent = 'Não foi possível gerar o PDF: ' + (err?.message || err) +
        (L.useAi && !navigator.onLine ? ' (na primeira vez, a IA de ampliação precisa de internet para baixar)' : '');
    } finally {
      window.RancaProgress.done('poster');
      el.make.hidden = false;
      el.cancel.hidden = true;
      el.pick.disabled = false;
      busy = false;
      el.make.disabled = !layout || layout.tooMany || !layout.printed.length;
    }
  });

  el.cancel.addEventListener('click', () => {
    cancelled = true;
    el.status.textContent = 'Cancelando…';
  });

  el.share.addEventListener('click', async () => {
    if (!pdfFile) return;
    try { await navigator.share({ files: [pdfFile], title: 'Pôster' }); }
    catch (err) { if (err?.name !== 'AbortError') el.status.textContent = 'Não foi possível compartilhar: ' + err.message; }
  });

  // abre o PDF de verdade no leitor do navegador (outra aba)
  el.openPdf.addEventListener('click', () => {
    if (!pdfFile) return;
    const url = URL.createObjectURL(pdfFile);
    const w = window.open(url, '_blank');
    if (!w) download(pdfFile);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });

  /* ---------------- Folhas do PDF, dentro do app ---------------- */
  // Cada página como vai sair da impressora: papel, margem, marcas de corte e textos.
  function pageList() {
    const L = layout;
    const out = [];
    if (el.guide.checked) out.push({ guide: true });
    L.printed.forEach((p, i) => out.push({ p, i: i + 1 }));
    return out;
  }
  function pageSize(L, it) {
    if (it.guide) return guideSize(L);
    const W = it.p.w + 2 * L.m, H = it.p.h + 2 * L.m;
    return pageRot(L, it.p) ? [H, W] : [W, H];
  }
  function pageCaption(L, it) {
    if (it.guide) return 'Mapa de montagem';
    const p = it.p;
    return 'Página ' + (it.i + (el.guide.checked ? 1 : 0)) + ' · folha ' + p.label + (L.free && p.land ? ' (deitada, girada na página)' : '');
  }

  // k: px por mm
  function drawPdfPage(g, L, it, k) {
    const [PW, PH] = pageSize(L, it);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, PW * k, PH * k);
    if (it.guide) {
      const G = guideGeom(L, PW, PH);
      const u = k / PT; // px por pt
      g.fillStyle = '#1c1a29';
      g.textBaseline = 'alphabetic';
      g.textAlign = 'left';
      g.font = '700 ' + (16 * u) + 'px Helvetica, Arial, sans-serif';
      g.fillText('Montagem do pôster', G.x * u, (PH * PT - G.top + 16) * u);
      g.fillStyle = '#404040';
      g.font = (9 * u) + 'px Helvetica, Arial, sans-serif';
      G.lines.forEach((s, i) => g.fillText(s, G.x * u, (PH * PT - G.top + 36 + i * 13) * u));
      const mc = document.createElement('canvas');
      mc.width = Math.max(1, Math.round(G.mw * u)); mc.height = Math.max(1, Math.round(G.mh * u));
      drawScene(mc.getContext('2d'), mc.width, mc.height, L, { pad: 2, line: 1, bg: '#ffffff', accent: '#5b4cf0', muted: '#9a97ab' });
      g.drawImage(mc, G.mapX * u, (PH * PT - G.mapY - G.mh) * u, G.mw * u, G.mh * u);
      return;
    }
    const p = it.p, m = L.m;
    const S = sheetMarks(L, p, it.i, L.printed.length);
    // sistema da folha (mm); folha deitada no encaixe livre: girada na página
    if (pageRot(L, p)) g.setTransform(0, -k, k, 0, 0, S.SW * k);
    else g.setTransform(k, 0, 0, k, 0, 0);
    g.save();
    g.beginPath();
    g.rect(m, m, p.w, p.h);
    g.clip();
    g.fillStyle = src.bg || '#ffffff';
    g.fillRect(m, m, p.w, p.h);
    g.imageSmoothingQuality = 'high';
    g.drawImage(src.thumb, m - p.x, m - p.y, L.posterW, L.posterH);
    g.restore();
    const px = 1 / k; // 1 px em mm
    g.strokeStyle = '#737373';
    g.lineWidth = Math.max(0.14, px);
    const stroke = (arr) => { g.beginPath(); for (const [x1, y1, x2, y2] of arr) { g.moveTo(x1, y1); g.lineTo(x2, y2); } g.stroke(); };
    stroke(S.lines);
    g.setLineDash([0.53, 0.35]);
    stroke(S.dashed);
    g.setLineDash([]);
    g.fillStyle = '#666666';
    for (const t of S.texts) {
      g.save();
      g.translate(t.x, t.y);
      if (t.rot) g.rotate(t.rot * Math.PI / 180);
      g.font = (t.size / PT) + 'px Helvetica, Arial, sans-serif';
      g.textAlign = t.align === 'center' ? 'center' : 'left';
      g.textBaseline = t.rot ? 'middle' : 'alphabetic';
      g.fillText(t.s, 0, 0);
      g.restore();
    }
  }

  function renderPages() {
    if (!layout || layout.tooMany || !src) { el.pages.textContent = ''; return; }
    const L = layout;
    const list = pageList();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const colW = el.pages.clientWidth > 520 ? 170 : 132;
    el.pages.textContent = '';
    list.forEach((it, idx) => {
      const [PW, PH] = pageSize(L, it);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pg-item';
      const c = document.createElement('canvas');
      const k = (colW * dpr) / Math.max(PW, PH); // página deitada ocupa a mesma largura
      c.width = Math.round(PW * k); c.height = Math.round(PH * k);
      c.style.width = Math.round(PW * k / dpr) + 'px';
      c.style.height = Math.round(PH * k / dpr) + 'px';
      drawPdfPage(c.getContext('2d'), L, it, k);
      const cap = document.createElement('span');
      cap.className = 'pg-cap';
      cap.textContent = it.guide ? 'Mapa' : (it.p.label + (L.free && it.p.land ? ' · deitada' : ''));
      b.append(c, cap);
      b.title = pageCaption(L, it);
      b.addEventListener('click', () => openBig(idx));
      el.pages.append(b);
    });
    if (bigIdx >= 0) renderBig();
  }

  function openBig(i) { bigIdx = i; el.big.hidden = false; renderBig(); }
  function renderBig() {
    const list = pageList();
    if (bigIdx < 0 || !list.length) { el.big.hidden = true; return; }
    bigIdx = Math.min(bigIdx, list.length - 1);
    const it = list[bigIdx];
    const L = layout;
    const [PW, PH] = pageSize(L, it);
    const box = el.bigCanvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const k = Math.min(box.width / PW, box.height / PH) * dpr;
    el.bigCanvas.width = Math.max(1, Math.round(PW * k));
    el.bigCanvas.height = Math.max(1, Math.round(PH * k));
    el.bigCanvas.style.width = (PW * k / dpr) + 'px';
    el.bigCanvas.style.height = (PH * k / dpr) + 'px';
    drawPdfPage(el.bigCanvas.getContext('2d'), L, it, k);
    el.bigCap.textContent = pageCaption(L, it) + ' — ' + (bigIdx + 1) + ' de ' + list.length;
    el.bigPrev.disabled = bigIdx === 0;
    el.bigNext.disabled = bigIdx === list.length - 1;
  }
  el.bigPrev.addEventListener('click', () => { if (bigIdx > 0) { bigIdx--; renderBig(); } });
  el.bigNext.addEventListener('click', () => { bigIdx++; renderBig(); });
  el.bigClose.addEventListener('click', () => { bigIdx = -1; el.big.hidden = true; });

  function setTab(t) {
    tab = t;
    el.tabMap.checked = t === 'map';
    el.tabPages.checked = t === 'pages';
    el.mapBox.hidden = t !== 'map';
    el.pagesBox.hidden = t !== 'pages';
    if (t === 'pages') { bigIdx = -1; el.big.hidden = true; renderPages(); } else renderPreview();
    syncFreeBar();
  }
  el.tabMap.addEventListener('change', () => setTab('map'));
  el.tabPages.addEventListener('change', () => setTab('pages'));

  /* ---------------- Encaixe livre: mexer nas folhas à mão ---------------- */
  function syncFreeBar() {
    const free = !!layout && layout.free && !layout.tooMany;
    el.canvas.classList.toggle('free-canvas', free); // arrastar folhas sem rolar a página
    el.freeBar.hidden = !free;
    el.freeHint.hidden = !free;
    if (!free) return;
    const has = selSheet >= 0 && selSheet < sheets.length;
    el.fRot.disabled = !has || busy;
    el.fDel.disabled = !has || busy || sheets.length <= 1;
    el.fAdd.disabled = busy;
    el.fAuto.disabled = busy || !manual;
    el.freeHint.textContent = has
      ? 'Folha ' + (layout.pages[selSheet]?.label || '') + ' selecionada: arraste para mover.'
      : 'Toque numa folha para selecionar e arraste para mover. Ela gruda na borda das vizinhas.';
  }

  function edited() {
    manual = true;
    sheetsKey = freeKey(layout);
    update();
  }

  el.fRot.addEventListener('click', () => {
    const s = sheets[selSheet];
    if (!s) return;
    const p = sheetOf(layout, s, selSheet);
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    s.land = !s.land;
    const q = sheetOf(layout, s, selSheet);
    s.x = cx - q.w / 2; s.y = cy - q.h / 2;
    edited();
  });
  el.fDel.addEventListener('click', () => {
    if (selSheet < 0 || sheets.length <= 1) return;
    sheets.splice(selSheet, 1);
    selSheet = -1;
    edited();
  });
  el.fAdd.addEventListener('click', () => {
    const L = layout;
    // no primeiro pedaço da figura sem folha, ou no meio da imagem
    let x = L.posterW / 2, y = L.posterH / 2;
    const C = L.cover;
    if (C && C.n) {
      const M = src.mask;
      for (let i = 0; i < M.length; i++) {
        if (!M[i]) continue;
        const px = i % src.mw, py = Math.floor(i / src.mw);
        const mmx = (px + 0.5) * L.posterW / src.mw, mmy = (py + 0.5) * L.posterH / src.mh;
        if (!L.printed.some((p) => mmx >= p.x && mmx < p.x + p.w && mmy >= p.y && mmy < p.y + p.h)) {
          x = mmx; y = mmy + (L.H0 - 2 * L.m) / 2 - 5; break;
        }
      }
    }
    const pw = L.W0 - 2 * L.m, ph = L.H0 - 2 * L.m;
    sheets.push({ x: x - pw / 2, y: y - ph / 2, land: false });
    selSheet = sheets.length - 1;
    edited();
  });
  el.fAuto.addEventListener('click', () => {
    if (manual && !confirm('Desfazer as mudanças feitas à mão e arrumar as folhas sozinho?')) return;
    sheets = null; selSheet = -1;
    update();
  });

  // arrastar
  let drag = null, dragRaf = 0;
  const toMm = (e) => {
    const r = el.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * pv.dpr - pv.gx) / pv.k, y: ((e.clientY - r.top) * pv.dpr - pv.gy) / pv.k };
  };
  el.canvas.addEventListener('pointerdown', (e) => {
    if (!layout || !layout.free || !pv || busy) return;
    const pt = toMm(e);
    let hit = -1;
    for (let i = layout.pages.length - 1; i >= 0; i--) {
      const p = layout.pages[i];
      if (pt.x >= p.x && pt.x <= p.x + p.w && pt.y >= p.y && pt.y <= p.y + p.h) { hit = p.si; break; }
    }
    selSheet = hit;
    if (hit >= 0) {
      const s = sheets[hit];
      drag = { id: e.pointerId, x0: s.x, y0: s.y, px: pt.x, py: pt.y, moved: false };
      el.canvas.setPointerCapture(e.pointerId);
    }
    renderPreview();
    syncFreeBar();
  });
  el.canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const pt = toMm(e);
    const s = sheets[selSheet];
    const p = sheetOf(layout, s, selSheet);
    let nx = drag.x0 + pt.x - drag.px, ny = drag.y0 + pt.y - drag.py;
    if (!drag.moved && Math.hypot(pt.x - drag.px, pt.y - drag.py) * pv.k < 4 * pv.dpr) return;
    drag.moved = true;
    // gruda nas bordas das vizinhas (encostada ou com a sobreposição) e nas bordas da imagem
    const thr = 10 * pv.dpr / pv.k, ov = layout.ov;
    const xs = [0, layout.posterW], ys = [0, layout.posterH];
    sheets.forEach((t, i) => {
      if (i === selSheet) return;
      const q = sheetOf(layout, t, i);
      xs.push(q.x, q.x + q.w, q.x + ov, q.x + q.w - ov);
      ys.push(q.y, q.y + q.h, q.y + ov, q.y + q.h - ov);
    });
    const snap = (v, size, list) => {
      let best = v, d = thr;
      for (const c of list) {
        if (Math.abs(c - v) < d) { d = Math.abs(c - v); best = c; }
        if (Math.abs(c - (v + size)) < d) { d = Math.abs(c - (v + size)); best = c - size; }
      }
      return best;
    };
    s.x = snap(nx, p.w, xs);
    s.y = snap(ny, p.h, ys);
    if (!dragRaf) {
      dragRaf = requestAnimationFrame(() => {
        dragRaf = 0;
        if (!src) return;
        sheetsKey = freeKey(layout);
        layout = compute();
        renderPreview();
      });
    }
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const moved = drag.moved;
    drag = null;
    if (moved) edited();
  };
  el.canvas.addEventListener('pointerup', endDrag);
  el.canvas.addEventListener('pointercancel', endDrag);
  document.addEventListener('keydown', (e) => {
    if (el.modal.hidden || !layout || !layout.free || selSheet < 0 || window.RancaNav.top() !== 'poster') return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || '')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); el.fDel.click(); return; }
    const d = e.shiftKey ? 10 : 1;
    const mv = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key];
    if (mv) { e.preventDefault(); sheets[selSheet].x += mv[0]; sheets[selSheet].y += mv[1]; edited(); }
  });

  /* ---------------- Projeto salvo ---------------- */
  // Cada pôster vira um projeto em "Meus projetos" (foto, recorte, configurações e folhas).
  let proj = null;            // { id, name, created, origRef, resRef }
  const keyToProj = new Map(); // imagem do editor -> projeto (abrir de novo continua o mesmo)
  let saveTimer = 0;
  const Projects = () => window.RancaProjects && window.RancaProjects.posters;

  function scheduleProjectSave() {
    if (!src || !proj || !Projects()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveProject().catch((e) => console.warn('Guardar pôster:', e)); }, 900);
  }
  async function saveProject() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    const P = Projects();
    if (!src || !proj || !getSource || !P || !layout) return;
    const s = getSource();
    if (proj.origRef !== s.original) { await P.putBlob(proj.id, 'original', s.original); proj.origRef = s.original; }
    if (s.result && proj.resRef !== s.result) { await P.putBlob(proj.id, 'result', s.result); proj.resRef = s.result; }
    const t = document.createElement('canvas');
    t.width = 360; t.height = 360;
    let thumb = null;
    if (!layout.tooMany) {
      drawScene(t.getContext('2d'), t.width, t.height, layout, { pad: 10, line: 1.5, bg: '#f0eef8', accent: '#5b4cf0', muted: '#9a97ab' });
      thumb = await toBlob(t, 'image/jpeg', 0.8).catch(() => null);
    }
    await P.put({
      id: proj.id, name: proj.name, created: proj.created, updated: Date.now(),
      bg: s.bg || '', mode, hasResult: !!proj.resRef, settings: getSettings(),
      sheets: layMode() === 'free' && sheets ? sheets.map((q) => ({ x: q.x, y: q.y, land: !!q.land })) : null,
      sheetsKey: layMode() === 'free' ? sheetsKey : '', manual,
      pages: layout.tooMany ? 0 : layout.printed.length,
      size: layout.tooMany ? '' : cm(layout.figW) + ' × ' + cm(layout.figH) + ' cm',
      thumb,
    });
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden && saveTimer) saveProject().catch(() => {}); });

  /* ---------------- Abrir / fechar ---------------- */
  // getSource() devolve a imagem atual: { original, result, bg, name }.
  // result fica vazio enquanto a IA ainda está tirando o fundo.
  let getSource = null;
  let mode = 'result'; // 'result' (sem fundo) ou 'original'
  let loadToken = 0;

  // opts.onRemoveBg: chamado pelo botão "Remover o fundo" quando a foto ainda não passou pela IA
  // opts.onPick: chamado por "Escolher / Trocar imagem"
  // opts.key: identifica a imagem (abrir o pôster de novo com ela continua o mesmo projeto)
  // opts.project: projeto salvo que está sendo reaberto
  let openOpts = {};

  // Abre a página (ou troca a imagem, se já estiver aberta). Sem getter, abre vazia.
  async function open(getter, opts) {
    if (busy) return;
    const wasOpen = !el.modal.hidden;
    if (proj && saveTimer) await saveProject().catch(() => {});
    reset();
    getSource = getter;
    openOpts = opts || {};
    el.modal.hidden = false;
    document.body.classList.add('modal-open');
    if (!wasOpen) window.RancaNav.push('poster', () => { if (busy) return false; close(true); return true; });
    setEmpty(!getter);
    if (!getter) {
      renderRecent();
      if (!wasOpen) el.emptyPick.focus();
      return;
    }
    const s = getSource();
    const P = openOpts.project;
    if (P) {
      proj = { id: P.id, name: P.name, created: P.created, origRef: s.original, resRef: s.result || null };
      applySettings(P.settings);
      if (P.sheets) { sheets = P.sheets.map((q) => ({ ...q })); sheetsKey = P.sheetsKey || ''; manual = !!P.manual; }
      mode = P.mode === 'original' || !s.result ? 'original' : 'result';
    } else {
      mode = s.result ? 'result' : 'original';
      if (openOpts.key && keyToProj.has(openOpts.key)) proj = keyToProj.get(openOpts.key);
    }
    el.imgName.textContent = s.name || '';
    el.imgName.title = s.name || '';
    syncSourceUI();
    if (!wasOpen) el.close.focus();
    await load();
  }

  // Estado sem imagem: no lugar da prévia, um convite para escolher a foto (e os pôsteres salvos).
  function setEmpty(on) {
    el.empty.hidden = !on;
    el.tabs.hidden = on;
    el.mapBox.hidden = on || tab !== 'map';
    el.pagesBox.hidden = on || tab !== 'pages';
    el.info.hidden = on;
    el.srcBox.hidden = on;
    el.imgName.hidden = on;
    el.pick.textContent = on ? 'Escolher imagem' : 'Trocar imagem';
    if (on) {
      el.make.disabled = true;
      el.status.textContent = '';
      el.aiRow.hidden = true;   // opções que dependem da foto
      el.skipRow.hidden = true;
      el.freeBar.hidden = true;
      el.freeHint.hidden = true;
      syncForm();
    }
  }

  function renderRecent() {
    el.recent.textContent = '';
    if (window.RancaProjects) window.RancaProjects.renderList(el.recent, { kind: 'poster', limit: 6, title: 'Pôsteres salvos' });
  }

  const pick = () => { if (!busy && openOpts.onPick) openOpts.onPick(); };
  el.pick.addEventListener('click', pick);
  el.emptyPick.addEventListener('click', pick);
  el.projects.addEventListener('click', () => { if (!busy && window.RancaProjects) window.RancaProjects.open(); });

  // Atualiza as opções "Sem fundo / Com o fundo original" (chamado também quando a IA termina).
  function syncSourceUI() {
    if (!getSource) return;
    const s = getSource();
    el.srcResult.disabled = !s.result;
    el.srcResult.checked = mode === 'result';
    el.srcOrig.checked = mode === 'original';
    const idle = !!s.idle && !!openOpts.onRemoveBg;
    el.srcHint.textContent = s.result ? '' : idle
      ? 'Para um boneco de papelão (e para medir só a pessoa), tire o fundo antes de imprimir.'
      : s.failed
        ? 'Não foi possível tirar o fundo desta imagem; dá para imprimir com o fundo original.'
        : 'O fundo está sendo removido. A opção "Sem fundo" libera quando terminar.';
    el.srcAction.hidden = !idle;
    // o recorte ficou pronto: agora dá para medir só a pessoa
    if (src && !busy && !!s.result !== src.figFrom) load().catch(() => {});
  }

  el.srcAction.addEventListener('click', () => {
    if (openOpts.onRemoveBg) openOpts.onRemoveBg();
    syncSourceUI();
  });

  // Caixa da parte visível (transparência > 8), em frações da imagem.
  function alphaBox(bmp) {
    const ak = Math.min(1, 600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    const aw = c.width = Math.max(1, Math.round(bmp.width * ak));
    const ah = c.height = Math.max(1, Math.round(bmp.height * ak));
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0, aw, ah);
    const d = g.getImageData(0, 0, aw, ah).data;
    let x0 = aw, y0 = ah, x1 = -1, y1 = -1;
    for (let y = 0; y < ah; y++) {
      for (let x = 0; x < aw; x++) {
        if (d[(y * aw + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
      }
    }
    if (x1 < 0) return { x0: 0, y0: 0, x1: 1, y1: 1 };
    return { x0: x0 / aw, y0: y0 / ah, x1: (x1 + 1) / aw, y1: (y1 + 1) / ah };
  }

  async function load() {
    const token = ++loadToken;
    const s = getSource();
    const kind = mode === 'result' && s.result ? 'result' : 'original';
    const blob = kind === 'result' ? s.result : s.original;
    el.status.textContent = 'Preparando…';
    el.make.disabled = true;
    invalidatePdf();

    let bmp = await createImageBitmap(blob);
    let fig = { x0: 0, y0: 0, x1: 1, y1: 1 };
    if (kind === 'result') {
      // sem as sobras transparentes: o tamanho vale para a figura e nenhuma folha fica à toa
      const b = alphaBox(bmp);
      const sx = Math.floor(b.x0 * bmp.width), sy = Math.floor(b.y0 * bmp.height);
      const sw = Math.min(bmp.width - sx, Math.ceil(b.x1 * bmp.width) - sx + 1);
      const sh = Math.min(bmp.height - sy, Math.ceil(b.y1 * bmp.height) - sy + 1);
      if (sw > 0 && sh > 0 && (sw < bmp.width || sh < bmp.height)) {
        const crop = await createImageBitmap(bmp, sx, sy, sw, sh);
        bmp.close();
        bmp = crop;
      }
    } else if (s.result) {
      // foto com fundo: mede a pessoa pelo recorte da IA
      const rb = await createImageBitmap(s.result);
      fig = alphaBox(rb);
      rb.close();
    }

    // miniatura para a prévia e mapa de transparência para achar folhas vazias
    const tk = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
    const thumb = document.createElement('canvas');
    thumb.width = Math.max(1, Math.round(bmp.width * tk));
    thumb.height = Math.max(1, Math.round(bmp.height * tk));
    const tg = thumb.getContext('2d');
    tg.imageSmoothingQuality = 'high';
    tg.drawImage(bmp, 0, 0, thumb.width, thumb.height);
    let alpha = null, aw = 0, ah = 0;
    if (kind === 'result') {
      const ak = Math.min(1, 600 / Math.max(bmp.width, bmp.height));
      const a = document.createElement('canvas');
      aw = a.width = Math.max(1, Math.round(bmp.width * ak));
      ah = a.height = Math.max(1, Math.round(bmp.height * ak));
      const ag = a.getContext('2d', { willReadFrequently: true });
      ag.drawImage(bmp, 0, 0, aw, ah);
      const data = ag.getImageData(0, 0, aw, ah).data;
      alpha = new Uint8Array(aw * ah);
      for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
    }
    const bg = kind === 'result' ? s.bg || '' : '';
    // máscara do que precisa de papel (para o encaixe livre): a figura, ou a imagem toda
    let mask, mw, mh;
    if (alpha && !bg) {
      mw = aw; mh = ah;
      mask = new Uint8Array(aw * ah);
      for (let i = 0; i < mask.length; i++) mask[i] = alpha[i] > 8 ? 1 : 0;
    } else {
      const mk = 300 / Math.max(bmp.width, bmp.height);
      mw = Math.max(1, Math.round(bmp.width * mk)); mh = Math.max(1, Math.round(bmp.height * mk));
      mask = new Uint8Array(mw * mh).fill(1);
    }

    // fechou ou trocou de opção enquanto carregava
    if (el.modal.hidden || token !== loadToken) { bmp.close(); return; }
    if (src) src.bmp.close();
    if (src && src.kind !== kind && !openOpts.project) { sheets = null; } // outra imagem: folhas novas
    src = {
      bmp, thumb, alpha, aw, ah, mask, mw, mh, w: bmp.width, h: bmp.height, fig, kind,
      figFrom: !!s.result, bg,
      opaque: kind === 'original', // foto inteira: nenhuma folha fica vazia
      name: s.name || 'imagem',
    };
    openOpts.project = null; // as folhas salvas já foram usadas
    if (!proj) {
      proj = { id: newId(), name: src.name, created: Date.now(), origRef: null, resRef: null };
      if (openOpts.key) keyToProj.set(openOpts.key, proj);
    }
    el.status.textContent = '';
    update();
  }

  function setMode(m) {
    if (busy || m === mode) return;
    if (m === 'result' && !getSource()?.result) return;
    mode = m;
    sheets = null;
    syncSourceUI();
    load().catch((err) => { el.status.textContent = 'Não foi possível carregar a imagem: ' + (err?.message || err); });
  }

  // Esquece a imagem atual (mantém as configurações de papel e tamanho).
  function reset() {
    loadToken++;
    clearTimeout(saveTimer); saveTimer = 0;
    if (src) src.bmp.close();
    src = null; layout = null; pdfFile = null; getSource = null; openOpts = {}; proj = null;
    sheets = null; sheetsKey = ''; manual = false; selSheet = -1; headFail = false;
    bigIdx = -1; el.big.hidden = true;
    el.srcAction.hidden = true;
    invalidatePdf();
    el.status.textContent = '';
  }

  function close(fromNav) {
    if (proj && saveTimer) saveProject().catch(() => {});
    el.modal.hidden = true;
    document.body.classList.remove('modal-open');
    if (!fromNav) window.RancaNav.pop('poster');
    reset();
  }

  el.srcResult.addEventListener('change', () => setMode('result'));
  el.srcOrig.addEventListener('change', () => setMode('original'));
  el.close.addEventListener('click', () => { if (!busy) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || el.modal.hidden || busy || window.RancaNav.top() !== 'poster') return;
    if (!el.big.hidden) { el.bigClose.click(); return; }
    if (layout && layout.free && selSheet >= 0) { selSheet = -1; renderPreview(); syncFreeBar(); return; }
    close();
  });
  for (const k of FIELDS) el[k].addEventListener(el[k].tagName === 'SELECT' || el[k].type === 'checkbox' ? 'change' : 'input', update);
  for (const r of [el.sizeCm, el.sizeSheets, el.layGrid, el.layFree]) r.addEventListener('change', () => { selSheet = -1; update(); });
  window.addEventListener('resize', () => { if (src) { renderPreview(); if (tab === 'pages') renderPages(); } });

  loadPrefs();
  syncForm();
  window.RancaPoster = {
    open, refresh: syncSourceUI, isOpen: () => !el.modal.hidden,
    close: () => { if (!busy && !el.modal.hidden) close(); },
    // projeto apagado em "Meus projetos": se estiver aberto, deixa de salvar nele
    forget: (id) => {
      if (proj && proj.id === id) proj = null;
      for (const [k, v] of keyToProj) if (v.id === id) keyToProj.delete(k);
    },
    rename: (id, name) => { if (proj && proj.id === id) proj.name = name; },
  };
  // usado também pelos foto cards (cards.js)
  window.RancaPdf = { PdfWriter, latin1, pdfText, f, PT, toBlob, download };
})();
