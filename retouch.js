// Retoque manual do recorte: "Lápis" (pinta exatamente onde passa) e "Lápis mágico"
// (risca em cima e o app pega a região de cor parecida ligada ao risco).
// Os dois podem tirar ou trazer de volta.
//
// Os retoques ficam num Int8Array (um valor por pixel, de -127 a 127):
//   0 = como a IA deixou, negativo = tirar, positivo = trazer de volta.
// Eles são aplicados por cima do recorte (já com o ajuste de borda), então
// mudar a Borda ou a qualidade não apaga o que foi riscado.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const el = {
    modal: $('retouch'), close: $('rtClose'), canvas: $('rtCanvas'), hint: $('rtHint'),
    pencil: $('rtPencil'), magic: $('rtMagic'), toolHint: $('rtToolHint'),
    cut: $('rtCut'), keep: $('rtKeep'),
    sizeBox: $('rtSizeBox'), size: $('rtSize'), sizeOut: $('rtSizeOut'),
    tolBox: $('rtTolBox'), tol: $('rtTol'), tolOut: $('rtTolOut'),
    ghost: $('rtGhost'), undo: $('rtUndo'), redo: $('rtRedo'), fit: $('rtFit'), clear: $('rtClear'),
    status: $('rtStatus'), cancel: $('rtCancel'), done: $('rtDone'),
  };
  const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // memória máxima guardada para "Desfazer"
  const UNDO_BYTES = IS_MOBILE ? 60e6 : 200e6;
  const MAIN_COLOR_SHARE = 0.2; // lápis mágico: cor que aparece em menos que isso do risco não conta
  const BIG_REGION = 0.4; // lápis mágico pergunta antes de mexer em mais que isso da imagem

  /* ---------------- Aplicação (usada também pelo app.js) ---------------- */
  function alphaOf(b, e) {
    return e > 0 ? b + ((255 - b) * e) / 127 : e < 0 ? (b * (127 + e)) / 127 : b;
  }
  // data: RGBA do recorte (alterado no lugar); orig: RGBA da foto original do mesmo tamanho
  function apply(data, orig, edits) {
    for (let p = 0, i = 0; p < edits.length; p++, i += 4) {
      const e = edits[p];
      if (!e) continue;
      data[i] = orig[i]; data[i + 1] = orig[i + 1]; data[i + 2] = orig[i + 2];
      data[i + 3] = alphaOf(data[i + 3], e);
    }
  }

  /* ---------------- Preferências ---------------- */
  const prefs = { tool: 'pencil', mode: 'cut', size: 40, tol: 35, ghost: true };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem('rancaFundoRetouch') || '{}')); } catch { /* padrões */ }
  function savePrefs() {
    try { localStorage.setItem('rancaFundoRetouch', JSON.stringify(prefs)); } catch { /* ignorado */ }
  }

  /* ---------------- Estado da janela ---------------- */
  let W = 0, H = 0;
  let base = null;    // Uint8Array: transparência do recorte (sem retoque)
  let orig = null;    // Uint8ClampedArray RGBA da foto original
  let edits = null;   // Int8Array: retoques
  let img = null;     // ImageData mostrado (RGB da original + transparência retocada)
  let work = null, workCtx = null; // canvas com img
  let ghostCv = null; // foto original pintada de vermelho com listras (mostra o que vai sair)
  let scov = null;    // Uint8Array: cobertura do risco atual (0 = ainda não tocado)
  let reg = null;     // Uint8Array: região do lápis mágico
  let soft = null;    // Uint8ClampedArray RGBA: foto levemente desfocada (lápis mágico)
  let undoStack = [], redoStack = [];
  let dirty = false;  // houve mudança desde que abriu
  let resolveOpen = null;
  let busy = false;

  const view = { s: 1, tx: 0, ty: 0 };
  let cssW = 0, cssH = 0, dpr = 1;
  let damage = null;  // retângulo de img a copiar para o canvas
  let raf = 0;
  let hover = null;   // posição do ponteiro (tela) para desenhar o círculo do lápis

  /* ---------------- Registro de mudanças (desfazer) ---------------- */
  // Lista crescente de (índice, valor antigo) dos pixels tocados num risco.
  function newRec() { return { idx: new Int32Array(4096), val: new Int8Array(4096), n: 0, x0: W, y0: H, x1: -1, y1: -1 }; }
  let rec = null;
  function recPush(i, v) {
    if (rec.n === rec.idx.length) {
      const idx = new Int32Array(rec.n * 2); idx.set(rec.idx); rec.idx = idx;
      const val = new Int8Array(rec.n * 2); val.set(rec.val); rec.val = val;
    }
    rec.idx[rec.n] = i; rec.val[rec.n] = v; rec.n++;
  }
  function recBox(x0, y0, x1, y1) {
    if (x0 < rec.x0) rec.x0 = x0; if (y0 < rec.y0) rec.y0 = y0;
    if (x1 > rec.x1) rec.x1 = x1; if (y1 > rec.y1) rec.y1 = y1;
  }
  function bytes(r) { return r.n * 5; }

  // Fecha o risco: limpa a cobertura e guarda para desfazer.
  function commit() {
    const r = rec; rec = null;
    for (let k = 0; k < r.n; k++) scov[r.idx[k]] = 0;
    if (!r.n) return;
    r.idx = r.idx.slice(0, r.n); r.val = r.val.slice(0, r.n);
    undoStack.push(r);
    redoStack = [];
    let total = 0;
    for (let k = undoStack.length - 1; k >= 0; k--) {
      total += bytes(undoStack[k]);
      if (total > UNDO_BYTES && k < undoStack.length - 1) { undoStack.splice(0, k + 1); break; }
    }
    dirty = true;
    syncUI();
  }

  // Troca os valores guardados com os atuais e passa o registro para a outra pilha.
  function swap(from, to) {
    const r = from.pop();
    if (!r) return;
    for (let k = 0; k < r.n; k++) {
      const i = r.idx[k], v = edits[i];
      edits[i] = r.val[k]; r.val[k] = v;
      setAlpha(i);
    }
    to.push(r);
    addDamage(r.x0, r.y0, r.x1, r.y1);
    dirty = true;
    syncUI();
  }

  /* ---------------- Pintura ---------------- */
  function setAlpha(i) { img.data[i * 4 + 3] = alphaOf(base[i], edits[i]); }

  // Aumenta a cobertura do pixel i no risco atual (cov de 0 a 255) e puxa o retoque para o alvo.
  function touch(i, cov, T) {
    const c0 = scov[i];
    if (cov <= c0) return;
    const e = edits[i];
    if (!c0) recPush(i, e);
    if (c0 < 255) {
      const ne = Math.round(T + ((e - T) * (255 - cov)) / (255 - c0));
      if (ne !== e) { edits[i] = ne; setAlpha(i); }
    }
    scov[i] = cov;
  }

  function target() { return prefs.mode === 'keep' ? 127 : -127; }
  function brushR() { return Math.max(0.6, prefs.size / 2 / view.s); }

  function stamp(cx, cy, r, T) {
    const feather = Math.max(0.8, r * 0.18);
    const x0 = Math.max(0, Math.floor(cx - r - 1)), x1 = Math.min(W - 1, Math.ceil(cx + r + 1));
    const y0 = Math.max(0, Math.floor(cy - r - 1)), y1 = Math.min(H - 1, Math.ceil(cy + r + 1));
    if (x0 > x1 || y0 > y1) return;
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const c = (r - Math.sqrt(dx * dx + dy * dy)) / feather + 0.5;
        if (c <= 0) continue;
        touch(y * W + x, c >= 1 ? 255 : Math.round(c * 255), T);
      }
    }
    recBox(x0, y0, x1, y1);
    addDamage(x0, y0, x1, y1);
  }

  function stampSeg(a, b) {
    const r = brushR(), T = target();
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const step = Math.max(0.5, r * 0.25);
    const n = Math.ceil(d / step);
    for (let k = 1; k <= n; k++) stamp(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n, r, T);
  }

  /* ---------------- Lápis mágico ---------------- */
  function tolerance() { return 5 + prefs.tol * 1.5; }

  // Distância de cor aproximada à percepção ("redmean"), na escala de 0 a ~255.
  function colorDist2(r1, g1, b1, r2, g2, b2) {
    const rm = (r1 + r2) / 2, dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
    return ((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db) / 3;
  }

  // Quanto a cor pode mudar de um pixel para o vizinho sem parar o preenchimento.
  // É o que segura o lápis mágico nas bordas (sem isso, numa foto, ele vazava para a imagem toda).
  function stepTolerance() { return 4 + prefs.tol * 0.17; }

  // Foto levemente desfocada (caixa 3x3, RGBA). Assim a textura de tecido, cabelo e ruído
  // não conta como borda. Feita na primeira vez que o lápis mágico é usado.
  function softPixels() {
    if (soft) return soft;
    const t = new Uint16Array(W * H * 3);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const xa = Math.max(0, x - 1), xb = Math.min(W - 1, x + 1);
        for (let c = 0; c < 3; c++) {
          let s = 0;
          for (let xx = xa; xx <= xb; xx++) s += orig[(y * W + xx) * 4 + c];
          t[(y * W + x) * 3 + c] = (s * 64) / (xb - xa + 1);
        }
      }
    }
    soft = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      const ya = Math.max(0, y - 1), yb = Math.min(H - 1, y + 1);
      for (let x = 0; x < W; x++) {
        for (let c = 0; c < 3; c++) {
          let s = 0;
          for (let yy = ya; yy <= yb; yy++) s += t[(yy * W + x) * 3 + c];
          soft[(y * W + x) * 4 + c] = s / 64 / (yb - ya + 1);
        }
      }
    }
    return soft;
  }

  // Devolve quantos pixels pegou, ou -1 se a pessoa desistiu (região grande demais).
  function magicFill(pts) {
    const tol = tolerance(), tol2 = tol * tol, T = target();
    const st = stepTolerance(), st2 = st * st;
    const o = softPixels();
    // pixels debaixo do risco
    const seeds = [];
    const seen = new Set();
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k], b = pts[Math.min(k + 1, pts.length - 1)];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
      for (let j = 0; j < n; j++) {
        const x = Math.floor(a.x + ((b.x - a.x) * j) / n), y = Math.floor(a.y + ((b.y - a.y) * j) / n);
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = y * W + x;
        if (!seen.has(i)) { seen.add(i); seeds.push(i); }
      }
    }
    if (!seeds.length) return 0;
    // Cor principal do risco: agrupa as cores debaixo dele e fica só com os grupos que
    // aparecem numa boa parte do risco. Se o risco encostou de leve numa área de outra cor
    // (ex.: risco no cinza que raspou no preto), essa outra cor não conta.
    const groupTol2 = tol2 * 0.12;
    const stepS = Math.max(1, Math.floor(seeds.length / 1500));
    const groups = []; // [r, g, b, quantos]
    let sampled = 0;
    for (let s = 0; s < seeds.length; s += stepS) {
      const q = seeds[s] * 4, r = o[q], g = o[q + 1], b = o[q + 2];
      sampled++;
      let best = null, bestD = groupTol2;
      for (const gr of groups) {
        const d = colorDist2(r, g, b, gr[0], gr[1], gr[2]);
        if (d < bestD) { bestD = d; best = gr; }
      }
      if (best) {
        // média que vai andando, para o grupo representar bem as cores dele
        const n = ++best[3];
        best[0] += (r - best[0]) / n; best[1] += (g - best[1]) / n; best[2] += (b - best[2]) / n;
      } else if (groups.length < 64) groups.push([r, g, b, 1]);
    }
    groups.sort((x, y) => y[3] - x[3]);
    const ref = [];
    for (const gr of groups) {
      if (ref.length && gr[3] < sampled * MAIN_COLOR_SHARE) break;
      ref.push(gr[0], gr[1], gr[2]);
    }
    const nref = ref.length;
    // i entra se a cor for parecida com a do risco E não mudar de repente em relação a "from"
    // (o vizinho que já está na região)
    const ok = (i, from) => {
      const q = i * 4, r = o[q], g = o[q + 1], b = o[q + 2];
      const p = from * 4;
      if (colorDist2(r, g, b, o[p], o[p + 1], o[p + 2]) > st2) return false;
      for (let k = 0; k < nref; k += 3) if (colorDist2(r, g, b, ref[k], ref[k + 1], ref[k + 2]) <= tol2) return true;
      return false;
    };

    if (!reg) reg = new Uint8Array(W * H);
    let bx0 = W, by0 = H, bx1 = -1, by1 = -1, count = 0;
    const stack = [];
    const mark = (i) => {
      reg[i] = 1; count++;
      const y = (i / W) | 0, x = i - y * W;
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
    };
    // debaixo do risco, só entra o que tem a cor principal
    const likeRef = (i) => {
      const q = i * 4, r = o[q], g = o[q + 1], b = o[q + 2];
      for (let k = 0; k < nref; k += 3) if (colorDist2(r, g, b, ref[k], ref[k + 1], ref[k + 2]) <= tol2) return true;
      return false;
    };
    for (const i of seeds) if (!reg[i] && likeRef(i)) { mark(i); stack.push(i); }
    if (!count) return 0;
    // preenchimento por linhas a partir dos pontos do risco
    const spread = (i) => {
      const y = (i / W) | 0, x = i - y * W, row = y * W;
      let l = x, r = x;
      while (l > 0 && !reg[row + l - 1] && ok(row + l - 1, row + l)) { l--; mark(row + l); }
      while (r < W - 1 && !reg[row + r + 1] && ok(row + r + 1, row + r)) { r++; mark(row + r); }
      for (const ny of [y - 1, y + 1]) {
        if (ny < 0 || ny >= H) continue;
        const nrow = ny * W;
        let run = false;
        for (let k = l; k <= r; k++) {
          const j = nrow + k;
          if (!reg[j] && ok(j, row + k)) { if (!run) { mark(j); stack.push(j); run = true; } } else run = false;
        }
      }
    };
    while (stack.length) spread(stack.pop());

    // pegou muita coisa? pergunta antes (é fácil passar do ponto numa foto)
    const big = count / (W * H);
    if (big > BIG_REGION) {
      const pct = Math.round(big * 100);
      const what = T > 0 ? 'trazer de volta' : 'apagar';
      if (!confirm(`O lápis mágico vai ${what} ${pct}% da imagem. Continuar?\n\nSe não era isso, cancele e diminua o Alcance.`)) {
        for (let y = by0; y <= by1; y++) reg.fill(0, y * W + bx0, y * W + bx1 + 1);
        return -1;
      }
    }

    // beirada: só pixels de cor no meio do caminho (até 2x o Alcance), não uma cor bem diferente
    const nearRef = (i) => {
      const q = orig, p = i * 4;
      for (let k = 0; k < nref; k += 3) if (colorDist2(q[p], q[p + 1], q[p + 2], ref[k], ref[k + 1], ref[k + 2]) <= tol2 * 4) return true;
      return false;
    };
    // aplica: região inteira com força total e uma beirada de 1 px pela metade (fica mais suave)
    const x0 = Math.max(0, bx0 - 1), y0 = Math.max(0, by0 - 1);
    const x1 = Math.min(W - 1, bx1 + 1), y1 = Math.min(H - 1, by1 + 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        if (reg[i]) { touch(i, 255, T); continue; }
        if (((x > 0 && reg[i - 1]) || (x < W - 1 && reg[i + 1]) ||
            (y > 0 && reg[i - W]) || (y < H - 1 && reg[i + W])) && nearRef(i)) touch(i, 128, T);
      }
    }
    for (let y = by0; y <= by1; y++) reg.fill(0, y * W + bx0, y * W + bx1 + 1);
    recBox(x0, y0, x1, y1);
    addDamage(x0, y0, x1, y1);
    return count;
  }

  /* ---------------- Desenho na tela ---------------- */
  function addDamage(x0, y0, x1, y1) {
    if (!damage) damage = { x0, y0, x1, y1 };
    else {
      if (x0 < damage.x0) damage.x0 = x0; if (y0 < damage.y0) damage.y0 = y0;
      if (x1 > damage.x1) damage.x1 = x1; if (y1 > damage.y1) damage.y1 = y1;
    }
    schedule();
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(render); }

  let checker = null;
  function makeChecker() {
    const cs = getComputedStyle(document.documentElement);
    const c = document.createElement('canvas');
    c.width = c.height = 20;
    const g = c.getContext('2d');
    g.fillStyle = cs.getPropertyValue('--checker-a').trim() || '#fff'; g.fillRect(0, 0, 20, 20);
    g.fillStyle = cs.getPropertyValue('--checker-b').trim() || '#e6e4ee';
    g.fillRect(0, 0, 10, 10); g.fillRect(10, 10, 10, 10);
    checker = c;
  }

  function resize() {
    const r = el.canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    cssW = Math.max(1, r.width); cssH = Math.max(1, r.height);
    el.canvas.width = Math.round(cssW * dpr); el.canvas.height = Math.round(cssH * dpr);
  }

  function fitView() {
    const s = Math.min(cssW / W, cssH / H) * 0.96;
    view.s = s; view.tx = (cssW - W * s) / 2; view.ty = (cssH - H * s) / 2;
    schedule();
  }
  function minScale() { return Math.min(cssW / W, cssH / H) * 0.5; }
  function zoomAt(px, py, s) {
    s = Math.min(24, Math.max(minScale(), s));
    view.tx = px - ((px - view.tx) * s) / view.s;
    view.ty = py - ((py - view.ty) * s) / view.s;
    view.s = s;
    schedule();
  }

  function render() {
    raf = 0;
    if (!img || el.modal.hidden) return;
    if (damage) {
      const d = damage; damage = null;
      workCtx.putImageData(img, 0, 0, d.x0, d.y0, d.x1 - d.x0 + 1, d.y1 - d.y0 + 1);
    }
    const g = el.canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, cssH);
    g.fillStyle = g.createPattern(checker, 'repeat');
    g.fillRect(0, 0, cssW, cssH);
    g.save();
    g.translate(view.tx, view.ty);
    g.scale(view.s, view.s);
    g.imageSmoothingEnabled = view.s < 2;
    g.imageSmoothingQuality = 'high';
    if (prefs.ghost) {
      g.globalAlpha = 0.85;
      g.drawImage(ghostCv, 0, 0);
      g.globalAlpha = 1;
    }
    g.drawImage(work, 0, 0);
    g.restore();
    // borda da imagem
    g.strokeStyle = 'rgba(91,76,240,.5)';
    g.lineWidth = 1;
    g.strokeRect(view.tx - 0.5, view.ty - 0.5, W * view.s + 1, H * view.s + 1);

    // risco do lápis mágico (prévia)
    if (stroke && stroke.magic && stroke.pts.length) {
      g.save();
      g.translate(view.tx, view.ty);
      g.scale(view.s, view.s);
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(stroke.pts[0].x, stroke.pts[0].y);
      for (const p of stroke.pts) g.lineTo(p.x, p.y);
      if (stroke.pts.length === 1) g.lineTo(stroke.pts[0].x + 0.01, stroke.pts[0].y);
      g.lineWidth = 6 / view.s; g.strokeStyle = 'rgba(255,255,255,.9)'; g.stroke();
      g.lineWidth = 3 / view.s; g.strokeStyle = prefs.mode === 'keep' ? '#16a34a' : '#dc2626'; g.stroke();
      g.restore();
    }
    // círculo do lápis
    if (hover && !pan && !pinch && prefs.tool === 'pencil') {
      const r = Math.max(2, prefs.size / 2);
      g.beginPath(); g.arc(hover.x, hover.y, r, 0, Math.PI * 2);
      g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.45)'; g.stroke();
      g.lineWidth = 1.5; g.strokeStyle = prefs.mode === 'keep' ? '#4ade80' : '#fff'; g.stroke();
    }
  }

  /* ---------------- Ponteiro ---------------- */
  const ptrs = new Map();
  let stroke = null, pan = null, pinch = null, spaceDown = false;

  function local(e) {
    const r = el.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function toImg(p) { return { x: (p.x - view.tx) / view.s, y: (p.y - view.ty) / view.s }; }
  function pinchInfo() {
    const [a, b] = [...ptrs.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  // Segundo dedo encostou: o risco que tinha começado vira zoom (desfaz o que pintou).
  function abortStroke() {
    if (!stroke) return;
    if (!stroke.magic && rec) {
      for (let k = rec.n - 1; k >= 0; k--) { const i = rec.idx[k]; edits[i] = rec.val[k]; scov[i] = 0; setAlpha(i); }
      addDamage(rec.x0, rec.y0, rec.x1, rec.y1);
      rec = null;
    }
    stroke = null;
    schedule();
  }

  el.canvas.addEventListener('pointerdown', (e) => {
    if (busy || !img) return;
    const p = local(e);
    ptrs.set(e.pointerId, p);
    el.canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    if (ptrs.size === 2) {
      abortStroke();
      pan = null;
      const q = pinchInfo();
      pinch = { ...q, s: view.s, tx: view.tx, ty: view.ty };
      return;
    }
    if (ptrs.size > 2) return;
    if (e.button === 1 || e.button === 2 || spaceDown) {
      pan = { id: e.pointerId, x: p.x, y: p.y, tx: view.tx, ty: view.ty };
      el.canvas.classList.add('panning');
      return;
    }
    if (e.button !== 0) return;
    const ip = toImg(p);
    stroke = { id: e.pointerId, magic: prefs.tool === 'magic', pts: [ip], last: ip };
    if (!stroke.magic) {
      rec = newRec();
      stamp(ip.x, ip.y, brushR(), target());
    }
    schedule();
  });

  el.canvas.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (e.pointerType === 'mouse') { hover = p; schedule(); }
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, p);
    if (pinch && ptrs.size === 2) {
      const q = pinchInfo();
      const s = Math.min(24, Math.max(minScale(), (pinch.s * q.d) / pinch.d));
      view.s = s;
      view.tx = q.x - ((pinch.x - pinch.tx) * s) / pinch.s;
      view.ty = q.y - ((pinch.y - pinch.ty) * s) / pinch.s;
      schedule();
      return;
    }
    if (pan && pan.id === e.pointerId) {
      view.tx = pan.tx + p.x - pan.x; view.ty = pan.ty + p.y - pan.y;
      schedule();
      return;
    }
    if (stroke && stroke.id === e.pointerId) {
      if (e.pointerType !== 'mouse') hover = p;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      const list = evs.length ? evs.map(local) : [p];
      for (const q of list) {
        const ip = toImg(q);
        if (stroke.magic) stroke.pts.push(ip);
        else stampSeg(stroke.last, ip);
        stroke.last = ip;
      }
      schedule();
    }
  });

  async function endPointer(e) {
    if (!ptrs.delete(e.pointerId)) return;
    if (ptrs.size < 2) pinch = null;
    if (pan && pan.id === e.pointerId) { pan = null; el.canvas.classList.remove('panning'); }
    if (e.pointerType !== 'mouse') hover = null;
    if (!stroke || stroke.id !== e.pointerId) { schedule(); return; }
    const s = stroke;
    if (!s.magic) { stroke = null; commit(); schedule(); return; }
    if (e.type === 'pointercancel') { stroke = null; schedule(); return; }
    busy = true;
    el.status.textContent = 'Procurando a região…';
    render();
    await new Promise((r) => setTimeout(r, 30));
    try {
      rec = newRec();
      const n = magicFill(s.pts);
      commit();
      el.status.textContent = n > 0 ? '' : n < 0 ? 'Cancelado. Diminua o Alcance e tente de novo.' : 'Risque em cima da imagem.';
    } catch (err) {
      console.error(err);
      rec = null;
      el.status.textContent = 'Não deu para usar o lápis mágico: ' + (err?.message || err);
    }
    stroke = null;
    busy = false;
    schedule();
  }
  el.canvas.addEventListener('pointerup', endPointer);
  el.canvas.addEventListener('pointercancel', endPointer);
  el.canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { hover = null; schedule(); } });
  el.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  el.canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = local(e);
    zoomAt(p.x, p.y, view.s * Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0015)));
  }, { passive: false });

  /* ---------------- Interface ---------------- */
  const TOOL_HINT = {
    pencil: { cut: 'Pinte por cima do que quer tirar.', keep: 'Pinte por cima do que quer trazer de volta.' },
    magic: {
      cut: 'Faça um risco em cima do que quer tirar: o app pega a parte de cor parecida ligada ao risco.',
      keep: 'Faça um risco em cima do que quer trazer de volta: o app pega a parte de cor parecida ligada ao risco.',
    },
  };

  function syncUI() {
    el.pencil.checked = prefs.tool === 'pencil';
    el.magic.checked = prefs.tool === 'magic';
    el.cut.checked = prefs.mode === 'cut';
    el.keep.checked = prefs.mode === 'keep';
    el.size.value = prefs.size;
    el.sizeOut.textContent = prefs.size + ' px';
    el.tol.value = prefs.tol;
    el.tolOut.textContent = prefs.tol < 25 ? 'pouco' : prefs.tol < 60 ? 'médio' : 'muito';
    el.sizeBox.hidden = prefs.tool !== 'pencil';
    el.tolBox.hidden = prefs.tool !== 'magic';
    el.ghost.checked = prefs.ghost;
    el.toolHint.textContent = TOOL_HINT[prefs.tool][prefs.mode];
    el.undo.disabled = !undoStack.length;
    el.redo.disabled = !redoStack.length;
    el.clear.disabled = !edits || !hasEdits();
  }

  function hasEdits() {
    for (let i = 0; i < edits.length; i++) if (edits[i]) return true;
    return false;
  }

  for (const input of [el.pencil, el.magic]) {
    input.addEventListener('change', () => { prefs.tool = input.value; savePrefs(); syncUI(); schedule(); });
  }
  for (const input of [el.cut, el.keep]) {
    input.addEventListener('change', () => { prefs.mode = input.value; savePrefs(); syncUI(); schedule(); });
  }
  el.size.addEventListener('input', () => { prefs.size = +el.size.value; savePrefs(); syncUI(); schedule(); });
  el.tol.addEventListener('input', () => { prefs.tol = +el.tol.value; savePrefs(); syncUI(); });
  el.ghost.addEventListener('change', () => { prefs.ghost = el.ghost.checked; savePrefs(); schedule(); });
  el.undo.addEventListener('click', () => { if (!busy) swap(undoStack, redoStack); });
  el.redo.addEventListener('click', () => { if (!busy) swap(redoStack, undoStack); });
  el.fit.addEventListener('click', fitView);
  el.clear.addEventListener('click', () => {
    if (busy || !confirm('Apagar todos os retoques desta imagem?')) return;
    rec = newRec();
    for (let i = 0; i < edits.length; i++) {
      if (!edits[i]) continue;
      recPush(i, edits[i]); edits[i] = 0; setAlpha(i);
    }
    rec.x0 = 0; rec.y0 = 0; rec.x1 = W - 1; rec.y1 = H - 1;
    addDamage(0, 0, W - 1, H - 1);
    commit();
  });

  // Versão da foto que aparece onde a imagem vai sair: a foto misturada com vermelho e
  // listras na diagonal. Assim dá para ver bem o que vai ser tirado, mesmo numa foto vermelha.
  function markRemoved(src) {
    const out = new ImageData(W, H), s = src.data, d = out.data;
    const period = Math.max(8, Math.round(Math.max(W, H) / 120));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const stripe = ((x + y) % period) < period / 2;
        const lum = 0.3 * s[i] + 0.59 * s[i + 1] + 0.11 * s[i + 2];
        const k = stripe ? 0.62 : 0.42; // quanto de vermelho entra
        const r = stripe ? 235 : 200, g = stripe ? 35 : 20, b = stripe ? 60 : 45;
        d[i] = lum * (1 - k) + r * k;
        d[i + 1] = lum * (1 - k) * 0.55 + g * k;
        d[i + 2] = lum * (1 - k) * 0.6 + b * k;
        d[i + 3] = 255;
      }
    }
    return out;
  }

  /* ---------------- Abrir / fechar ---------------- */
  // opts: { w, h, orig: ImageData da foto original, base: Uint8Array (transparência), edits: Int8Array|null }
  // Resolve com os retoques (Int8Array, ou null se não sobrou nenhum) ou undefined se cancelar.
  function open(opts) {
    W = opts.w; H = opts.h;
    orig = opts.orig.data;
    base = opts.base;
    edits = opts.edits ? opts.edits.slice() : new Int8Array(W * H);
    scov = new Uint8Array(W * H);
    reg = null; soft = null;
    undoStack = []; redoStack = []; rec = null; stroke = null; pan = null; pinch = null;
    dirty = false; busy = false;

    img = new ImageData(new Uint8ClampedArray(orig), W, H);
    for (let i = 0; i < W * H; i++) setAlpha(i);
    work = document.createElement('canvas');
    work.width = W; work.height = H;
    workCtx = work.getContext('2d');
    workCtx.putImageData(img, 0, 0);
    ghostCv = document.createElement('canvas');
    ghostCv.width = W; ghostCv.height = H;
    ghostCv.getContext('2d').putImageData(markRemoved(opts.orig), 0, 0);

    makeChecker();
    el.status.textContent = '';
    el.hint.textContent = matchMedia('(pointer: coarse)').matches
      ? 'Dois dedos: aproximar e mover.'
      : 'Roda do mouse: aproximar. Botão direito (ou espaço) e arrastar: mover. Ctrl+Z: desfazer.';
    el.modal.hidden = false;
    document.body.classList.add('modal-open');
    resize();
    fitView();
    syncUI();
    return new Promise((r) => { resolveOpen = r; });
  }

  function finish(result) {
    el.modal.hidden = true;
    document.body.classList.remove('modal-open');
    const r = resolveOpen; resolveOpen = null;
    img = null; work = null; workCtx = null; ghostCv = null; scov = null; reg = null; soft = null;
    orig = null; base = null; undoStack = []; redoStack = [];
    const out = edits; edits = null;
    if (r) r(result === 'done' ? (hasEditsIn(out) ? out : null) : undefined);
  }
  function hasEditsIn(a) { for (let i = 0; i < a.length; i++) if (a[i]) return true; return false; }

  function cancel() {
    if (busy) return;
    if (dirty && !confirm('Sair sem salvar os retoques?')) return;
    finish('cancel');
  }
  el.close.addEventListener('click', cancel);
  el.cancel.addEventListener('click', cancel);
  el.done.addEventListener('click', () => { if (!busy) finish('done'); });

  document.addEventListener('keydown', (e) => {
    if (el.modal.hidden) return;
    if (e.key === 'Escape') { cancel(); return; }
    if (e.key === ' ' && !/^(INPUT|BUTTON|SELECT|TEXTAREA|LABEL)$/.test(e.target.tagName)) {
      spaceDown = true; el.canvas.classList.add('pan-ready'); e.preventDefault(); return;
    }
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { e.preventDefault(); if (!busy) swap(undoStack, redoStack); }
    else if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); if (!busy) swap(redoStack, undoStack); }
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === ' ') { spaceDown = false; el.canvas.classList.remove('pan-ready'); }
  });
  window.addEventListener('resize', () => {
    if (el.modal.hidden) return;
    const cx = (cssW / 2 - view.tx) / view.s, cy = (cssH / 2 - view.ty) / view.s;
    resize();
    view.tx = cssW / 2 - cx * view.s; view.ty = cssH / 2 - cy * view.s;
    schedule();
  });

  window.RancaRetouch = { open, apply, isOpen: () => !el.modal.hidden };
})();
