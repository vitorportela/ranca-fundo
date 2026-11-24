// Foto cards (9 por folha A4, frente e verso) e bottons, com stickers e molduras, em PDF (tudo offline).
// Coordenadas em mm, origem no canto de cima à esquerda da FRENTE da folha.
// O verso é calculado na mesma coordenada (o que fica atrás de cada ponto) e só no fim
// é espelhado para a página do verso.
// Cada card/botton é montado num canvas próprio (foto, moldura, stickers e, se for o caso,
// o contorno de recorte). A prévia, a tela cheia e o PDF usam a mesma montagem.
(function () {
  'use strict';

  const { PdfWriter, latin1, pdfText, f, PT, toBlob, download } = window.RancaPdf;
  const Deco = window.RancaDeco;

  const W = 210, H = 297;            // A4 em pé
  const CW = 55, CH = 85;            // card pronto (photocard padrão)
  const BL = 2;                      // sangria: a foto passa da linha de corte
  const RADIUS = 3;                  // cantos arredondados
  const GAP = 8;                     // espaço entre um card e outro
  const GAP_OVER = 12;               // ... com enfeites passando da borda
  const OVER = 5;                    // quanto o enfeite pode passar da borda do card
  const RIM = 0.8;                   // borda branca em volta do que passa da borda
  const BTN_BL = 1.5;                // sangria do botton (além do corte)
  const BTN_M = 6;                   // margem da folha de bottons
  const BTN_SEP = 1;                 // espaço entre as sangrias de dois bottons
  // tamanhos comuns de botton: [frente visível, corte] em mm
  const BTN_SIZES = [[25, 33], [32, 41], [38, 47], [44, 54], [58, 67], [76, 89]];
  const DPI = 300, KPX = DPI / 25.4; // px por mm no PDF
  const MARK = 8;                    // centro das marcas de conferência (mm da borda)
  const CELL = 2;                    // quadradinho da grade de conferência
  const HOLE = 4.6;                  // em volta das marcas os enfeites não entram
  const CUT_COLOR = '#8a8a8a';       // linha de recorte impressa
  const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const MAX_SIDE = IS_MOBILE ? 1800 : 2400; // fotos maiores são reduzidas (memória)
  const STICKER_SIDE = 1200;

  const $ = (id) => document.getElementById(id);
  const el = {
    modal: $('cards'), close: $('cClose'), title: $('cardsTitle'), canvas: $('cCanvas'), hint: $('cHint'),
    modeCards: $('cModeCards'), modeBtn: $('cModeBtn'),
    sideBox: $('cSideBox'), sideFront: $('cSideFront'), sideBack: $('cSideBack'),
    backBox: $('cBackBox'), backEach: $('cBackEach'), backMirror: $('cBackMirror'), backSame: $('cBackSame'), backHint: $('cBackHint'),
    btnBox: $('cBtnBox'), btnPreset: $('cBtnPreset'), btnFace: $('cBtnFace'), btnCut: $('cBtnCut'), btnInfo: $('cBtnInfo'),
    selTitle: $('cSelTitle'), imgName: $('cImgName'), pick: $('cPick'), input: $('cInput'),
    editBox: $('cEditBox'), zoom: $('cZoom'), zoomOut: $('cZoomOut'),
    rotate: $('cRotate'), center: $('cCenter'), remove: $('cRemove'), all: $('cAll'),
    quality: $('cQuality'), selHint: $('cSelHint'), fullBtn: $('cFullOpen'),
    printBox: $('cPrintBox'), over: $('cOver'), overHint: $('cOverHint'),
    flip: $('cFlip'), dx: $('cDx'), dy: $('cDy'), marks: $('cMarks'), test: $('cTest'),
    reset: $('cReset'), status: $('cStatus'), make: $('cMake'), share: $('cShare'),
    // tela cheia
    full: $('cFull'), fClose: $('cfClose'), fPrev: $('cfPrev'), fNext: $('cfNext'), fTitle: $('cfTitle'),
    fUndo: $('cfUndo'), fSide: $('cfSide'), fCanvas: $('cfCanvas'), fHint: $('cfHint'),
    fSelBar: $('cfSelBar'), fDel: $('cfDel'), fDup: $('cfDup'), fMir: $('cfMir'), fUp: $('cfUp'), fDown: $('cfDown'),
    fPanel: $('cfPanel'), fPhoto: $('cfPhoto'), fStickers: $('cfStickers'), fFrames: $('cfFrames'),
    fPick: $('cfPick'), fRotate: $('cfRotate'), fCenter: $('cfCenter'), fRemove: $('cfRemove'),
    fZoom: $('cfZoom'), fZoomOut: $('cfZoomOut'), fPhotoHint: $('cfPhotoHint'),
    fStGrid: $('cfStGrid'), fStAll: $('cfStAll'), fStInput: $('cfStInput'),
    fFrGrid: $('cfFrGrid'), fColors: $('cfColors'), fFrAll: $('cfFrAll'),
  };

  /* ---------------- Estado ---------------- */
  let uid = 0;
  // camada: foto (img, zoom, ox, oy em mm, rot em 90°), moldura e stickers.
  // rev muda a cada alteração (a prévia guarda o card montado enquanto rev não muda).
  const blank = () => ({ uid: ++uid, rev: 0, img: null, zoom: 1, ox: 0, oy: 0, rot: 0, frame: null, deco: [] });
  const cards = Array.from({ length: 9 }, () => ({ front: blank(), back: blank() }));
  const sharedBack = blank();
  const buttons = [];
  let mine = [];  // "Meus stickers"
  let sel = 0;
  let side = 'front';
  let busy = false;
  let pdfFile = null;
  let view = null; // escala da última prévia: { gx, gy, k, dpr }
  const prefs = {
    mode: 'cards', backMode: 'each', flip: 'long', dx: 0, dy: 0, marks: true,
    over: false, btnFace: 44, btnCut: 54, frameColor: '#f6a8c8',
  };
  const touch = (L) => { L.rev++; };

  const num = (v, min, max, def) => {
    const n = parseFloat(String(v).replace(',', '.'));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  const fmt = (n) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

  function loadPrefs() {
    try { Object.assign(prefs, JSON.parse(localStorage.getItem('rancaFundoCards') || '{}')); } catch { /* padrões */ }
    if (!['each', 'mirror', 'same'].includes(prefs.backMode)) prefs.backMode = 'each';
    if (prefs.mode !== 'buttons') prefs.mode = 'cards';
    prefs.over = !!prefs.over;
    prefs.btnCut = num(prefs.btnCut, 20, 100, 54);
    prefs.btnFace = num(prefs.btnFace, 15, prefs.btnCut - 2, Math.min(44, prefs.btnCut - 2));
    el.flip.value = prefs.flip === 'short' ? 'short' : 'long';
    el.dx.value = fmt(+prefs.dx || 0);
    el.dy.value = fmt(+prefs.dy || 0);
    el.marks.checked = prefs.marks !== false;
    el.over.checked = prefs.over;
  }
  function savePrefs() {
    try { localStorage.setItem('rancaFundoCards', JSON.stringify(prefs)); } catch { /* ignorado */ }
  }

  /* ---------------- Formato e posição na folha ---------------- */
  const isBtn = () => prefs.mode === 'buttons';
  const curSide = () => (isBtn() ? 'front' : side);

  // G: tamanho do corte (w, h), canto (r), sangria (bl) e área de desenho em volta do corte (E)
  function geom() {
    if (isBtn()) {
      const c = prefs.btnCut;
      return { kind: 'btn', w: c, h: c, r: c / 2, bl: BTN_BL, E: BTN_BL, face: prefs.btnFace };
    }
    return { kind: 'card', w: CW, h: CH, r: RADIUS, bl: BL, E: prefs.over ? OVER : BL, face: 0 };
  }

  function layout() {
    const G = geom();
    if (G.kind === 'card') {
      const gap = prefs.over ? GAP_OVER : GAP;
      const x0 = (W - (3 * CW + 2 * gap)) / 2, y0 = (H - (3 * CH + 2 * gap)) / 2;
      return { G, n: 9, gap, x0, y0, pos: (i) => ({ x: x0 + (i % 3) * (CW + gap), y: y0 + Math.floor(i / 3) * (CH + gap) }) };
    }
    const pts = btnGrid(G.w);
    while (buttons.length < pts.length) buttons.push(blank());
    return { G, n: pts.length, pos: (i) => pts[i] };
  }

  // Posições dos bottons (canto de cima à esquerda do quadrado do corte). Testa fileiras alinhadas
  // e fileiras alternadas (como favo de mel) e fica com a que cabe mais.
  const gridCache = new Map();
  function btnGrid(D) {
    if (gridCache.has(D)) return gridCache.get(D);
    const pitch = D + 2 * BTN_BL + BTN_SEP;            // de centro a centro
    const AW = W - 2 * BTN_M + BTN_SEP, AH = H - 2 * BTN_M + BTN_SEP;
    const fit = (len) => Math.max(0, Math.floor(len / pitch));
    const plans = [];
    { // alinhadas
      const cols = Math.max(1, fit(AW)), rows = Math.max(1, fit(AH));
      plans.push(Array.from({ length: rows }, () => ({ n: cols, off: 0 })).map((r, j) => ({ ...r, y: j * pitch })));
    }
    { // alternadas
      const dy = pitch * Math.sqrt(3) / 2;
      const rows = Math.max(1, Math.floor((AH - pitch) / dy) + 1);
      const a = fit(AW), b = fit(AW - pitch / 2);
      if (b > 0) plans.push(Array.from({ length: rows }, (_, j) => ({ n: j % 2 ? b : a, off: j % 2 ? pitch / 2 : 0, y: j * dy })));
    }
    const count = (p) => p.reduce((s, r) => s + r.n, 0);
    const best = plans.reduce((x, p) => (count(p) > count(x) ? p : x));
    // centraliza o conjunto na folha
    const right = Math.max(...best.map((r) => r.off + r.n * pitch)) - BTN_SEP;
    const bottom = best[best.length - 1].y + pitch - BTN_SEP;
    const x0 = (W - right) / 2 + BTN_BL, y0 = (H - bottom) / 2 + BTN_BL;
    const pts = [];
    for (const r of best) for (let c = 0; c < r.n; c++) pts.push({ x: x0 + r.off + c * pitch, y: y0 + r.y });
    gridCache.set(D, pts);
    return pts;
  }

  // marcas de conferência: nos cantos da folha, ou entre os cards quando os enfeites passam da borda
  function markPos(lay) {
    if (!prefs.over) return [[MARK, MARK], [W - MARK, H - MARK]];
    const a = lay.pos(0), b = lay.pos(4), h = lay.gap / 2;
    return [[a.x + CW + h, a.y + CH + h], [b.x + CW + h, b.y + CH + h]];
  }
  // marcas perto do card i, em mm a partir do centro dele
  function holesOf(i, lay) {
    if (!prefs.over || !prefs.marks || lay.G.kind !== 'card') return [];
    const p = lay.pos(i), cx = p.x + CW / 2, cy = p.y + CH / 2;
    return markPos(lay).map(([x, y]) => ({ x: x - cx, y: y - cy }))
      .filter((h) => Math.abs(h.x) < CW / 2 + OVER + HOLE && Math.abs(h.y) < CH / 2 + OVER + HOLE);
  }

  // O que aparece no item i do lado s, e se dá para editar ali.
  // deco: mostra os stickers; over: stickers podem passar da borda; contour: imprime a linha de recorte;
  // white: no verso, deixa branco atrás do que passa da borda na frente.
  function itemOf(i, s, lay) {
    lay = lay || layout();
    const G = lay.G;
    if (G.kind === 'btn') {
      return { G, L: buttons[i], mirror: false, editable: true, deco: true, over: false, contour: false, holes: [], white: null };
    }
    const holes = holesOf(i, lay);
    if (s === 'front') {
      return { G, L: cards[i].front, mirror: false, editable: true, deco: true, over: prefs.over, contour: prefs.over, holes, white: null };
    }
    const white = prefs.over ? { L: cards[i].front, holes } : null;
    const base = { G, mirror: false, editable: true, deco: true, over: false, contour: false, holes, white };
    if (prefs.backMode === 'mirror') return { ...base, L: cards[i].front, mirror: true, editable: false, deco: false };
    if (prefs.backMode === 'same') return { ...base, L: sharedBack };
    return { ...base, L: cards[i].back };
  }

  function allLayers() {
    return [...cards.flatMap((c) => [c.front, c.back]), sharedBack, ...buttons];
  }

  // mm do card por px da foto (zoom 1 = a foto cobre o card inteiro, com sangria)
  function mmPerPx(L, G) {
    const odd = L.rot % 2 === 1;
    const iw = odd ? L.img.h : L.img.w, ih = odd ? L.img.w : L.img.h;
    return Math.max((G.w + 2 * G.bl) / iw, (G.h + 2 * G.bl) / ih) * L.zoom;
  }

  /* ---------------- Montagem de um card / botton ---------------- */
  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }
  const centerOn = (g, c) => g.setTransform(1, 0, 0, 1, c.width / 2, c.height / 2);

  // linha de corte: retângulo arredondado (card) ou círculo do corte (botton)
  function cutPath(g, G, k) {
    g.beginPath();
    if (G.kind === 'btn') g.arc(0, 0, (G.w / 2) * k, 0, Math.PI * 2);
    else Deco.roundRect(g, -G.w / 2 * k, -G.h / 2 * k, G.w * k, G.h * k, G.r * k);
  }
  // corte + sangria
  function bleedPath(g, G, k) {
    g.beginPath();
    if (G.kind === 'btn') g.arc(0, 0, (G.w / 2 + G.bl) * k, 0, Math.PI * 2);
    else g.rect(-(G.w / 2 + G.bl) * k, -(G.h / 2 + G.bl) * k, (G.w + 2 * G.bl) * k, (G.h + 2 * G.bl) * k);
  }
  // onde os stickers aparecem: até a sangria, ou além da borda (sem chegar perto das marcas)
  function stickerClip(g, it, k) {
    const G = it.G;
    if (!it.over) { bleedPath(g, G, k); g.clip(); return; }
    const m = OVER - RIM - 0.3;
    g.beginPath();
    g.rect(-(G.w / 2 + m) * k, -(G.h / 2 + m) * k, (G.w + 2 * m) * k, (G.h + 2 * m) * k);
    g.clip();
    for (const h of it.holes) {
      g.beginPath();
      g.rect(-1e5, -1e5, 2e5, 2e5);
      g.rect((h.x - HOLE) * k, (h.y - HOLE) * k, 2 * HOLE * k, 2 * HOLE * k);
      g.clip('evenodd');
    }
  }

  // Desenha a foto da camada L com a origem no centro do corte (k px por mm).
  // hq: usa a foto inteira e amplia com Lanczos (PDF); senão usa a miniatura (prévia).
  function paint(g, L, mirror, k, hq, G, c) {
    const { w: iw, h: ih } = L.img;
    const s = mmPerPx(L, G) * k; // px do destino por px da foto
    g.save();
    if (mirror) g.scale(-1, 1);
    g.translate(L.ox * k, L.oy * k);
    g.rotate(L.rot * Math.PI / 2);
    if (hq && s > 1.05) {
      // só o pedaço da foto que aparece no card, ampliado com Lanczos
      const inv = g.getTransform().inverse();
      const pts = [[0, 0], [c.width, 0], [0, c.height], [c.width, c.height]].map(([x, y]) => inv.transformPoint(new DOMPoint(x, y)));
      const pad = 3;
      const x0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.x)) / s + iw / 2) - pad);
      const y0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.y)) / s + ih / 2) - pad);
      const x1 = Math.min(iw, Math.ceil(Math.max(...pts.map((p) => p.x)) / s + iw / 2) + pad);
      const y1 = Math.min(ih, Math.ceil(Math.max(...pts.map((p) => p.y)) / s + ih / 2) + pad);
      if (x1 > x0 && y1 > y0) {
        const crop = makeCanvas(x1 - x0, y1 - y0);
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

  const stH = (s) => (s.w * s.img.h) / s.img.w;
  function drawStickers(g, L, k, hq) {
    for (const s of L.deco) {
      if (!s.img) continue;
      const w = s.w * k, h = stH(s) * k;
      g.save();
      g.translate(s.x * k, s.y * k);
      g.rotate(s.rot);
      if (s.flip) g.scale(-1, 1);
      // miniatura na prévia, a não ser que o sticker fique maior que ela na tela
      const src = hq || w > s.img.thumb.width * 1.1 ? s.img.bmp : s.img.thumb;
      g.drawImage(src, -w / 2, -h / 2, w, h);
      g.restore();
    }
  }
  function stickersCanvas(it, L, k, hq, w, h) {
    if (!L.deco.some((s) => s.img)) return null;
    const D = makeCanvas(w, h);
    const g = D.getContext('2d');
    g.imageSmoothingQuality = 'high';
    centerOn(g, D);
    stickerClip(g, it, k);
    drawStickers(g, L, k, hq);
    return D;
  }
  // a parte dos stickers que passa do corte, engrossada pela borda branca (ou null)
  function overhangOf(D, G, k) {
    const o = makeCanvas(D.width, D.height);
    const g = o.getContext('2d', { willReadFrequently: true });
    g.drawImage(D, 0, 0);
    g.globalCompositeOperation = 'destination-out';
    centerOn(g, o);
    cutPath(g, G, k);
    g.fill();
    if (!Deco.binarize(o)) return null;
    return Deco.dilate(o, RIM * k);
  }
  // pinta de branco a silhueta, fora do corte
  function whiteOutside(mask, G, k) {
    const w = makeCanvas(mask.width, mask.height);
    const g = w.getContext('2d');
    g.drawImage(mask, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w.width, w.height);
    g.globalCompositeOperation = 'destination-out';
    centerOn(g, w);
    cutPath(g, G, k);
    g.fill();
    return w;
  }

  // frame PNG da pasta: o registro da imagem (carrega na primeira vez)
  function frameRec(frame) {
    if (!frame || !frame.png) return null;
    const r = packReady.get(frame.png);
    if (!r) ensurePack(frame.png);
    return r || null;
  }

  // Monta o item num canvas que cobre o corte mais E mm em volta (k px por mm).
  // opt.hq: qualidade do PDF; opt.preview: esmaece o que fica fora do corte; opt.fast: pula o contorno.
  function compose(it, k, opt) {
    opt = opt || {};
    const { G, L } = it;
    const c = makeCanvas((G.w + 2 * G.E) * k, (G.h + 2 * G.E) * k);
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    const reset = () => g.setTransform(1, 0, 0, 1, 0, 0);
    centerOn(g, c);

    // foto
    g.save();
    bleedPath(g, G, k);
    g.clip();
    if (L.img) paint(g, L, it.mirror, k, !!opt.hq, G, c);
    else if (opt.preview) {
      g.fillStyle = '#f1eff8';
      g.fillRect(-c.width, -c.height, 2 * c.width, 2 * c.height);
      g.strokeStyle = '#b9b4d6';
      g.lineWidth = Math.max(1.5, 0.35 * k);
      g.lineCap = 'round';
      const a = Math.min(G.w, G.h) * 0.12 * k;
      g.beginPath(); g.moveTo(-a, 0); g.lineTo(a, 0); g.moveTo(0, -a); g.lineTo(0, a); g.stroke();
    }
    g.restore();

    // moldura
    if (L.frame) {
      g.save();
      bleedPath(g, G, k);
      g.clip();
      if (it.mirror) g.scale(-1, 1);
      Deco.drawFrame(g, G, k, L.frame, frameRec(L.frame));
      g.restore();
    }

    // verso: branco atrás do que passa da borda na frente (o desenho é espelhado)
    if (it.white && !opt.fast) {
      const F = stickersCanvas({ ...it, over: true, holes: it.white.holes }, it.white.L, k, false, c.width, c.height);
      const o = F && overhangOf(F, G, k);
      if (o) {
        reset();
        g.setTransform(-1, 0, 0, 1, c.width, 0);
        g.drawImage(whiteOutside(o, G, k), 0, 0);
        centerOn(g, c);
      }
    }

    const D = it.deco ? stickersCanvas(it, L, k, !!opt.hq, c.width, c.height) : null;
    let S = null, ring = null;
    if (it.contour && !opt.fast) {
      // contorno = corte + o que passa da borda (com a borda branca)
      const o = D && overhangOf(D, G, k);
      S = makeCanvas(c.width, c.height);
      const sg = S.getContext('2d');
      if (o) {
        reset();
        g.drawImage(whiteOutside(o, G, k), 0, 0);
        centerOn(g, c);
        sg.drawImage(o, 0, 0);
      }
      centerOn(sg, S);
      cutPath(sg, G, k);
      sg.fillStyle = '#000';
      sg.fill();
      ring = Deco.dilate(S, Math.max(0.6, 0.25 * k));
      const rg = ring.getContext('2d');
      rg.globalCompositeOperation = 'destination-out';
      rg.drawImage(S, 0, 0);
      rg.globalCompositeOperation = 'source-in';
      rg.fillStyle = CUT_COLOR;
      rg.fillRect(0, 0, ring.width, ring.height);
    }

    reset();
    if (D && !it.contour) g.drawImage(D, 0, 0);
    if (opt.preview) {
      // o que sai no recorte aparece esmaecido
      const F = makeCanvas(c.width, c.height);
      const fg = F.getContext('2d');
      fg.fillStyle = 'rgba(255,255,255,.6)';
      fg.fillRect(0, 0, F.width, F.height);
      fg.globalCompositeOperation = 'destination-out';
      if (S) fg.drawImage(S, 0, 0);
      else { centerOn(fg, F); cutPath(fg, G, k); fg.fillStyle = '#000'; fg.fill(); } // opaco: apaga o véu inteiro dentro do corte
      g.drawImage(F, 0, 0);
    }
    if (D && it.contour) g.drawImage(D, 0, 0);
    if (ring) g.drawImage(ring, 0, 0);
    if (G.kind === 'btn') {
      // linha de corte do botton (impressa)
      centerOn(g, c);
      g.beginPath();
      g.arc(0, 0, (G.w / 2 + 0.12) * k, 0, Math.PI * 2);
      g.lineWidth = Math.max(1, 0.22 * k);
      g.strokeStyle = CUT_COLOR;
      g.stroke();
    }
    return c;
  }

  const hasContent = (it) => !!(it.L.img || it.L.frame || (it.deco && it.L.deco.length));

  /* ---------------- Prévia da folha ---------------- */
  const cache = new Map();
  function itemCanvas(i, s, it, k) {
    const fr = it.white ? it.white.L.uid + ':' + it.white.L.rev : '';
    const key = [it.L.uid, it.L.rev, fr, k.toFixed(4), prefs.mode, prefs.over, prefs.marks, prefs.backMode, prefs.btnCut, prefs.btnFace, it.mirror].join('|');
    const hit = cache.get(s + i);
    if (hit && hit.key === key) return hit.c;
    const c = compose(it, k, { preview: true });
    cache.set(s + i, { key, c });
    return c;
  }

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
    const lay = layout(), G = lay.G, E = G.E, s = curSide();
    for (let i = 0; i < lay.n; i++) {
      const p = lay.pos(i);
      const vx = s === 'back' ? W - p.x - G.w : p.x; // com a folha virada, o card 1 fica à direita
      const it = itemOf(i, s, lay);
      const cx = gx + (vx + G.w / 2) * k, cy = gy + (p.y + G.h / 2) * k;
      g.save();
      if (G.kind === 'btn') { g.beginPath(); g.arc(cx, cy, (G.w / 2 + G.bl) * k, 0, Math.PI * 2); g.clip(); } // nas fileiras alternadas os quadrados se cruzam
      g.drawImage(itemCanvas(i, s, it, k), gx + (vx - E) * k, gy + (p.y - E) * k, (G.w + 2 * E) * k, (G.h + 2 * E) * k);
      g.restore();

      // guias que não são impressas
      g.save();
      g.setLineDash([3 * dpr, 3 * dpr]);
      g.strokeStyle = 'rgba(30,25,60,.35)';
      g.lineWidth = dpr;
      g.beginPath();
      if (G.kind === 'btn') g.arc(cx, cy, G.face / 2 * k, 0, Math.PI * 2);
      else if (!prefs.over || s === 'back') Deco.roundRect(g, cx - G.w / 2 * k, cy - G.h / 2 * k, G.w * k, G.h * k, G.r * k);
      g.stroke();
      g.restore();

      // número
      const fz = Math.max(9 * dpr, (G.kind === 'btn' ? Math.min(4, G.w / 9) : 4) * k);
      g.font = '700 ' + Math.round(fz) + 'px system-ui, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const nx = G.kind === 'btn' ? cx - G.w * 0.33 * k : cx - G.w / 2 * k + fz * 0.9;
      const ny = G.kind === 'btn' ? cy - G.w * 0.33 * k : cy - G.h / 2 * k + fz * 0.9;
      g.fillStyle = i === sel ? accent : 'rgba(30,25,60,.55)';
      g.beginPath(); g.arc(nx, ny, fz * 0.72, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffffff';
      g.fillText(String(i + 1), nx, ny + dpr * 0.5);

      if (i === sel) {
        g.strokeStyle = accent;
        g.lineWidth = 2.5 * dpr;
        g.beginPath();
        if (G.kind === 'btn') g.arc(cx, cy, (G.w / 2 + G.bl) * k + 2 * dpr, 0, Math.PI * 2);
        else g.rect(cx - (G.w / 2 + E) * k - 2 * dpr, cy - (G.h / 2 + E) * k - 2 * dpr, (G.w + 2 * E) * k + 4 * dpr, (G.h + 2 * E) * k + 4 * dpr);
        g.stroke();
      }
    }

    // marcas de conferência: grade na frente, ponto no verso
    if (prefs.marks && G.kind === 'card') {
      g.strokeStyle = '#1c1a29'; g.fillStyle = '#1c1a29';
      g.lineWidth = Math.max(0.6, 0.15 * k);
      for (const [mx, my] of markPos(lay)) {
        const x = s === 'back' ? W - mx : mx;
        if (s === 'front') {
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
    mirror: 'O verso mostra a foto e a moldura da frente espelhadas, como se atravessassem o card.',
    same: 'Uma foto só para o verso dos 9 cards.',
  };

  function quality(L, G) {
    const d = Math.round(25.4 / mmPerPx(L, G));
    const q = d >= 250 ? 'ótima' : d >= 180 ? 'boa' : d >= 120 ? 'razoável' : 'baixa, pode sair borrada';
    return 'Qualidade: ' + q + ' (' + d + ' dpi)';
  }

  const itemName = (i) => (isBtn() ? 'Botton ' : 'Card ') + (i + 1);
  function selTitle() {
    if (isBtn()) return itemName(sel);
    if (side === 'back' && prefs.backMode === 'same') return 'Verso de todos os cards';
    return itemName(sel) + ' · ' + (side === 'front' ? 'frente' : 'verso');
  }

  function syncUI() {
    const btn = isBtn();
    const lay = layout();
    if (sel >= lay.n) sel = 0;
    el.modeCards.checked = !btn;
    el.modeBtn.checked = btn;
    el.title.textContent = btn ? 'Bottons (' + lay.n + ' por folha A4)' : 'Foto cards (9 por folha A4)';
    el.sideBox.hidden = btn;
    el.backBox.hidden = btn;
    el.btnBox.hidden = !btn;
    el.printBox.hidden = btn;
    el.sideFront.checked = side === 'front';
    el.sideBack.checked = side === 'back';
    el.backEach.checked = prefs.backMode === 'each';
    el.backMirror.checked = prefs.backMode === 'mirror';
    el.backSame.checked = prefs.backMode === 'same';
    el.backHint.textContent = BACK_HINTS[prefs.backMode];
    el.overHint.textContent = prefs.over
      ? 'Os cards ficam mais afastados e os stickers podem passar até 5 mm da borda. Uma linha cinza fina mostra onde recortar.'
      : '';

    if (btn) {
      const pre = BTN_SIZES.findIndex(([fc, ct]) => fc === prefs.btnFace && ct === prefs.btnCut);
      el.btnPreset.value = pre >= 0 ? String(pre) : 'custom';
      if (document.activeElement !== el.btnFace) el.btnFace.value = fmt(prefs.btnFace);
      if (document.activeElement !== el.btnCut) el.btnCut.value = fmt(prefs.btnCut);
      el.btnInfo.textContent = 'Cabem ' + lay.n + ' por folha. A linha tracejada é a frente do botton; entre ela e a linha de corte, a imagem dobra para trás.';
    }

    const { L, editable } = itemOf(sel, curSide(), lay);
    const shared = !btn && side === 'back' && prefs.backMode === 'same';
    el.selTitle.textContent = selTitle();
    el.pick.hidden = !editable;
    el.pick.textContent = L.img ? 'Trocar foto' : 'Escolher foto';
    el.imgName.hidden = !L.img;
    el.imgName.textContent = L.img ? L.img.name : '';
    el.imgName.title = el.imgName.textContent;
    el.editBox.hidden = !editable || !L.img;
    el.all.hidden = shared;
    el.all.textContent = btn ? 'Usar esta foto em todos os bottons' : 'Usar esta foto nos 9 cards';
    el.fullBtn.hidden = !editable;
    if (L.img) {
      el.zoom.value = Math.round(L.zoom * 100);
      el.zoomOut.textContent = Math.round(L.zoom * 100) + '%';
      el.quality.textContent = quality(L, lay.G);
    }
    el.selHint.textContent = !editable
      ? 'No modo "Espelho da frente", o verso acompanha a foto da frente. Para mudar, edite a frente.'
      : L.img ? '' : 'Escolha uma foto ou toque no ' + (btn ? 'botton' : 'card') + '. Dá para escolher várias de uma vez: elas vão para os vazios em seguida.';
    el.hint.textContent = btn
      ? 'Arraste a foto para posicionar. Zoom: roda do mouse ou dois dedos. Para stickers e moldura, use a tela cheia.'
      : side === 'front'
        ? 'Arraste a foto para posicionar. Zoom: roda do mouse ou dois dedos. Para stickers e moldura, use a tela cheia.'
        : 'Assim fica o verso com a folha virada de lado: cada card fica atrás do mesmo número da frente.';

    const any = btn
      ? buttons.slice(0, lay.n).some((b) => b.img || b.frame || b.deco.length)
      : cards.some((c) => hasContent({ L: c.front, deco: true }) || hasContent({ L: c.back, deco: true })) || hasContent({ L: sharedBack, deco: true });
    el.make.disabled = busy || !any;
    el.test.disabled = busy;
    el.reset.disabled = busy;
  }

  function invalidatePdf() {
    pdfFile = null;
    el.share.hidden = true;
  }
  function changed() {
    invalidatePdf();
    if (!busy) el.status.textContent = '';
    syncUI();
    render();
    scheduleSave();
  }

  /* ---------------- Imagens ---------------- */
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

  // Abre a imagem (reduz se for grande) e faz uma miniatura para a prévia.
  async function decode(blob, maxSide, thumbSide) {
    let src;
    try {
      src = await createImageBitmap(blob);
    } catch (err) {
      // SVG (e alguns formatos) só abrem por um <img>
      src = await new Promise((res, rej) => {
        const url = URL.createObjectURL(blob);
        const im = new Image();
        im.onload = () => { URL.revokeObjectURL(url); res(im); };
        im.onerror = () => { URL.revokeObjectURL(url); rej(err); };
        im.src = url;
      });
    }
    const w0 = src.naturalWidth || src.width || 512, h0 = src.naturalHeight || src.height || 512;
    const vector = /svg/i.test(blob.type); // desenho: abre no tamanho máximo
    const kk = vector ? maxSide / Math.max(w0, h0) : Math.min(1, maxSide / Math.max(w0, h0));
    let bmp = src;
    if (kk !== 1 || !(src instanceof ImageBitmap)) {
      const c = makeCanvas(w0 * kk, h0 * kk);
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(src, 0, 0, c.width, c.height);
      if (src.close) src.close();
      bmp = await createImageBitmap(c);
    }
    const tk = Math.min(1, thumbSide / Math.max(bmp.width, bmp.height));
    const thumb = makeCanvas(bmp.width * tk, bmp.height * tk);
    const tg = thumb.getContext('2d');
    tg.imageSmoothingQuality = 'high';
    tg.drawImage(bmp, 0, 0, thumb.width, thumb.height);
    return { bmp, thumb, w: bmp.width, h: bmp.height };
  }

  async function imageFromFile(file, kind) {
    const sticker = kind === 'sticker';
    const r = await decode(file, sticker ? STICKER_SIDE : MAX_SIDE, sticker ? 500 : 1200);
    const rec = { id: newId(), name: (file.name || (sticker ? 'sticker' : 'foto')).replace(/\.[^.]+$/, ''), ...r };
    Store.putImage(rec.id, file, rec.name, kind);
    return rec;
  }

  // stickers e molduras da pasta enfeites/
  const packCache = new Map(); // caminho -> Promise do registro
  const packReady = new Map(); // caminho -> registro já aberto
  function packImage(path) {
    if (!packCache.has(path)) {
      const p = fetch(encodeURI(path))
        .then((r) => { if (!r.ok) throw new Error('erro ' + r.status); return r.blob(); })
        .then((b) => decode(b, STICKER_SIDE, 500))
        .then((r) => { const rec = { id: 'pack:' + path, name: Deco.niceName(path), ...r }; packReady.set(path, rec); return rec; })
        .catch((e) => { packCache.delete(path); throw e; });
      packCache.set(path, p);
    }
    return packCache.get(path);
  }
  function ensurePack(path) {
    if (packCache.has(path)) return;
    packImage(path).then(() => {
      for (const L of allLayers()) if (L.frame && L.frame.png === path) touch(L);
      redraw();
    }).catch((e) => console.warn('Moldura', path, e));
  }

  function setImage(L, img) {
    Object.assign(L, { img, zoom: 1, ox: 0, oy: 0, rot: 0 });
    touch(L);
  }

  // A primeira foto vai para o item selecionado; as outras, para os próximos vazios.
  async function addFiles(fileList) {
    // copia antes do await: o FileList do <input> esvazia quando o value é limpo
    const files = [...fileList].filter((x) => x.type.startsWith('image/'));
    await ready();
    if (!files.length) { el.status.textContent = 'Envie um arquivo de imagem (PNG, JPG, WEBP…).'; return; }
    if (busy) return;
    if (!itemOf(sel, curSide()).editable) side = 'front';
    const lay = layout(), s = curSide();
    el.status.textContent = files.length > 1 ? 'Abrindo ' + files.length + ' fotos…' : 'Abrindo a foto…';
    let i = sel, placed = 0;
    for (const file of files) {
      let img;
      try { img = await imageFromFile(file, 'photo'); } catch (err) {
        el.status.textContent = 'Não foi possível abrir "' + file.name + '": ' + (err?.message || err);
        continue;
      }
      if (placed === 0) setImage(itemOf(sel, s, lay).L, img);
      else {
        if (s === 'back' && prefs.backMode === 'same') break;
        // próximo vazio depois do atual
        let j = -1;
        for (let n = 1; n < lay.n; n++) {
          const t = (i + n) % lay.n;
          if (t !== sel && !itemOf(t, s, lay).L.img) { j = t; break; }
        }
        if (j < 0) break;
        setImage(itemOf(j, s, lay).L, img);
        i = j;
      }
      placed++;
    }
    changed();
    if (placed < files.length && placed) el.status.textContent = 'Só cabem ' + placed + ' fotos nos vazios.';
    if (fs.open) { fsSync(); fsDraw(); }
  }

  el.pick.addEventListener('click', () => { if (!busy) el.input.click(); });
  el.input.addEventListener('change', () => {
    const files = [...el.input.files];
    if (files.length) addFiles(files);
    el.input.value = '';
  });

  function current() {
    const r = itemOf(sel, curSide());
    return r.editable && r.L.img ? r.L : null;
  }

  el.zoom.addEventListener('input', () => {
    const L = current(); if (!L) return;
    L.zoom = +el.zoom.value / 100;
    touch(L);
    changed();
  });
  function rotatePhoto(L) {
    L.rot = (L.rot + 1) % 4;
    [L.ox, L.oy] = [-L.oy, L.ox];
    touch(L);
  }
  function centerPhoto(L) { L.ox = 0; L.oy = 0; L.zoom = 1; touch(L); }
  function removePhoto(L) { Object.assign(L, { img: null, zoom: 1, ox: 0, oy: 0, rot: 0 }); touch(L); }
  el.rotate.addEventListener('click', () => { const L = current(); if (L) { rotatePhoto(L); changed(); } });
  el.center.addEventListener('click', () => { const L = current(); if (L) { centerPhoto(L); changed(); } });
  el.remove.addEventListener('click', () => { const L = current(); if (L) { removePhoto(L); changed(); } });
  // repete a foto (com o ajuste) em todos; moldura e stickers de cada um ficam
  el.all.addEventListener('click', () => {
    const L = current(); if (!L) return;
    const lay = layout();
    for (let i = 0; i < lay.n; i++) {
      const t = itemOf(i, curSide(), lay).L;
      if (t !== L) { Object.assign(t, { img: L.img, zoom: L.zoom, ox: L.ox, oy: L.oy, rot: L.rot }); touch(t); }
    }
    changed();
    el.status.textContent = isBtn() ? 'Foto repetida em todos os bottons.' : 'Foto repetida nos 9 cards.';
  });

  for (const r of [el.modeCards, el.modeBtn]) {
    r.addEventListener('change', () => {
      if (!r.checked) return;
      prefs.mode = r.value;
      savePrefs();
      sel = 0;
      changed();
    });
  }
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
  el.over.addEventListener('change', () => { prefs.over = el.over.checked; savePrefs(); changed(); });
  el.flip.addEventListener('change', () => { prefs.flip = el.flip.value; savePrefs(); changed(); });
  for (const [input, key] of [[el.dx, 'dx'], [el.dy, 'dy']]) {
    input.addEventListener('input', () => { prefs[key] = num(input.value, -20, 20, 0); savePrefs(); invalidatePdf(); });
    input.addEventListener('change', () => { input.value = fmt(prefs[key]); });
  }
  el.marks.addEventListener('change', () => { prefs.marks = el.marks.checked; savePrefs(); changed(); });

  // tamanho do botton
  el.btnPreset.innerHTML = BTN_SIZES.map(([fc, ct], j) =>
    '<option value="' + j + '">' + fmt(fc / 10) + ' cm (corte ' + fmt(ct / 10) + ' cm)</option>').join('') +
    '<option value="custom">Outro tamanho</option>';
  el.btnPreset.addEventListener('change', () => {
    const p = BTN_SIZES[+el.btnPreset.value];
    if (!p) { el.btnFace.focus(); return; }
    [prefs.btnFace, prefs.btnCut] = p;
    savePrefs();
    changed();
  });
  function setBtnSize() {
    prefs.btnCut = num(el.btnCut.value, 20, 100, prefs.btnCut);
    prefs.btnFace = num(el.btnFace.value, 15, prefs.btnCut - 2, Math.min(prefs.btnFace, prefs.btnCut - 2));
    savePrefs();
    changed();
  }
  for (const input of [el.btnFace, el.btnCut]) {
    input.addEventListener('input', () => {
      if (!Number.isFinite(parseFloat(input.value.replace(',', '.')))) return;
      setBtnSize();
    });
    input.addEventListener('change', () => { setBtnSize(); el.btnFace.value = fmt(prefs.btnFace); el.btnCut.value = fmt(prefs.btnCut); });
  }

  el.reset.addEventListener('click', async () => {
    if (busy) return;
    if (!confirm('Apagar todas as fotos, stickers e molduras dos cards e bottons? "Meus stickers" continuam guardados.')) return;
    for (const L of allLayers()) { Object.assign(L, blank(), { uid: L.uid, rev: L.rev + 1 }); }
    fs.undo = [];
    sel = 0;
    changed();
    el.status.textContent = 'Projeto apagado.';
  });

  /* ---------------- Arrastar, zoom com a roda e com dois dedos ---------------- */
  const ptrs = new Map();
  let drag = null, pinch = null;

  function hit(e) {
    if (!view) return -1;
    const rect = el.canvas.getBoundingClientRect();
    let u = ((e.clientX - rect.left) * view.dpr - view.gx) / view.k;
    const v = ((e.clientY - rect.top) * view.dpr - view.gy) / view.k;
    if (curSide() === 'back') u = W - u;
    const lay = layout(), G = lay.G, m = G.E + 1;
    for (let i = 0; i < lay.n; i++) {
      const p = lay.pos(i);
      if (u >= p.x - m && u <= p.x + G.w + m && v >= p.y - m && v <= p.y + G.h + m) return i;
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
      drag = i < 0 ? null : { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, was: i === sel };
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
      touch(L);
      changed();
      return;
    }
    if (!drag) return;
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) drag.moved = true;
    if (drag.moved && L) {
      L.ox += ((e.clientX - drag.x) * view.dpr) / view.k;
      L.oy += ((e.clientY - drag.y) * view.dpr) / view.k;
      touch(L);
      render();
    }
    drag.x = e.clientX; drag.y = e.clientY;
  });
  function endPointer(e) {
    if (!ptrs.delete(e.pointerId)) return;
    if (drag && !drag.moved && e.type === 'pointerup') {
      const r = itemOf(sel, curSide());
      if (r.editable && !r.L.img) el.input.click(); // vazio: escolher a foto
      else if (r.editable && drag.was) fsOpen();    // tocar de novo no selecionado: tela cheia
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
    if (L) { L.zoom = clampZoom(L.zoom * Math.exp(-e.deltaY * 0.0015)); touch(L); }
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

  // imgs: [{ jpeg, iw, ih, x, y, w, h, round }] (canto de cima à esquerda e tamanho em mm;
  // round: recorta a imagem num círculo, para um botton não cobrir o vizinho)
  // rot180: verso para impressoras que viram pela borda menor
  function addPage(doc, imgs, ops, rot180) {
    const { pdf } = doc;
    const ids = imgs.map((im) => pdf.add(['<< /Type /XObject /Subtype /Image /Width ' + im.iw + ' /Height ' + im.ih +
      ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.jpeg.size + ' >>\nstream\n', im.jpeg, '\nendstream']));
    let s = rot180 ? 'q -1 0 0 -1 ' + f(W * PT) + ' ' + f(H * PT) + ' cm\n' : 'q\n';
    imgs.forEach((im, j) => {
      if (im.round) s += 'q ' + dot(im.x + im.w / 2, im.y + im.h / 2, im.w / 2).replace(/ f\n$/, ' W n\n');
      s += 'q ' + f(im.w * PT) + ' 0 0 ' + f(im.h * PT) + ' ' + f(im.x * PT) + ' ' + f((H - im.y - im.h) * PT) + ' cm /Im' + j + ' Do Q\n';
      if (im.round) s += 'Q\n';
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

  async function itemJpeg(it) {
    const c = compose(it, KPX, { hq: true });
    return { jpeg: await toBlob(c, 'image/jpeg', 0.92), iw: c.width, ih: c.height };
  }

  // marcas de corte nas margens, na direção de cada linha de corte
  function cropMarks(lay) {
    let s = '0.5 w 0 G\n';
    const xs = [], ys = [];
    for (let j = 0; j < 3; j++) {
      xs.push(lay.x0 + j * (CW + lay.gap), lay.x0 + j * (CW + lay.gap) + CW);
      ys.push(lay.y0 + j * (CH + lay.gap), lay.y0 + j * (CH + lay.gap) + CH);
    }
    const top = lay.y0 - BL - 1, bottom = ys[5] + BL + 1, left = lay.x0 - BL - 1, right = xs[5] + BL + 1;
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

  async function buildCards(onProgress) {
    const doc = newDoc();
    const lay = layout(), G = lay.G, E = G.E, DW = G.w + 2 * E, DH = G.h + 2 * E;
    const cache = new Map(); // a mesma imagem (verso igual em todos, sem enfeite passando) é gerada uma vez só
    const total = 18;
    let n = 0;

    const front = [];
    for (let i = 0; i < 9; i++) {
      onProgress('Gerando a frente: card ' + (i + 1) + ' de 9…', n++ / total);
      await new Promise((r) => setTimeout(r));
      const it = itemOf(i, 'front', lay);
      if (!hasContent(it)) continue;
      const p = lay.pos(i);
      front.push({ ...(await itemJpeg(it)), x: p.x - E, y: p.y - E, w: DW, h: DH });
    }
    let ops = prefs.over ? '' : cropMarks(lay);
    if (prefs.marks) for (const [x, y] of markPos(lay)) ops += gridMark(x, y);
    ops += '0.45 g\n' + text(W / 2, prefs.over ? 3.6 : 6, 7, 'FRENTE - imprima em tamanho real (100%)' + (prefs.over ? ' - recorte pela linha cinza' : ''), 'c');
    addPage(doc, front, ops, false);

    const back = [];
    for (let i = 0; i < 9; i++) {
      onProgress('Gerando o verso: card ' + (i + 1) + ' de 9…', n++ / total);
      await new Promise((r) => setTimeout(r));
      const it = itemOf(i, 'back', lay);
      if (!hasContent(it)) continue;
      const key = it.L === sharedBack && !it.white ? 'shared' : null;
      let r = key && cache.get(key);
      if (!r) { r = await itemJpeg(it); if (key) cache.set(key, r); }
      const p = lay.pos(i);
      back.push({ ...r, x: backX(p.x - E) - DW, y: backY(p.y - E), w: DW, h: DH });
    }
    ops = '';
    if (prefs.marks) for (const [x, y] of markPos(lay)) ops += '0 g\n' + dot(backX(x), backY(y), 0.5);
    ops += '0.45 g\n' + text(W / 2, prefs.over ? 3.6 : 6, 7, 'VERSO', 'c');
    addPage(doc, back, ops, prefs.flip === 'short');
    return finish(doc);
  }

  async function buildButtons(onProgress) {
    const doc = newDoc();
    const lay = layout(), G = lay.G, E = G.E, D = G.w + 2 * E;
    const imgs = [];
    for (let i = 0; i < lay.n; i++) {
      onProgress('Gerando o botton ' + (i + 1) + ' de ' + lay.n + '…', i / lay.n);
      await new Promise((r) => setTimeout(r));
      const it = itemOf(i, 'front', lay);
      if (!hasContent(it)) continue;
      const p = lay.pos(i);
      imgs.push({ ...(await itemJpeg(it)), x: p.x - E, y: p.y - E, w: D, h: D, round: true });
    }
    const ops = '0.45 g\n' + text(W / 2, 4.4, 6.5, 'BOTTONS ' + fmt(G.face) + ' mm (corte ' + fmt(G.w) + ' mm) - imprima em tamanho real (100%) - recorte pela linha cinza', 'c');
    addPage(doc, imgs, ops, false);
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
    const file = await run(isBtn() ? buildButtons : buildCards, isBtn() ? 'bottons.pdf' : 'foto-cards.pdf');
    if (!file) return;
    pdfFile = file;
    try { el.share.hidden = !(navigator.canShare && navigator.canShare({ files: [file] })); } catch { el.share.hidden = true; }
  });
  el.test.addEventListener('click', () => run(buildTest, 'foto-card-teste.pdf'));
  el.share.addEventListener('click', async () => {
    if (!pdfFile) return;
    try { await navigator.share({ files: [pdfFile], title: isBtn() ? 'Bottons' : 'Foto cards' }); }
    catch (err) { if (err?.name !== 'AbortError') el.status.textContent = 'Não foi possível compartilhar: ' + err.message; }
  });

  /* ================= Tela cheia: um card grande, com stickers e moldura ================= */
  const fs = { open: false, st: -1, panel: null, fast: false, k: 1, cx: 0, cy: 0, dpr: 1, undo: [], raf: 0, pushed: false, wheelAt: 0 };
  const fsItem = () => itemOf(sel, curSide());
  const accentColor = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();

  function fsOpen() {
    if (busy || fs.open) return;
    fs.open = true;
    fs.st = -1;
    fs.panel = null;
    el.full.hidden = false;
    document.body.classList.add('full-open');
    // Android: tela cheia de verdade (some a barra do navegador)
    if (matchMedia('(pointer: coarse)').matches && el.full.requestFullscreen) {
      el.full.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    }
    try { history.pushState({ rancaFull: 1 }, ''); fs.pushed = true; } catch { fs.pushed = false; }
    fsSync();
    fsDraw();
  }
  function fsClose(fromHistory) {
    if (!fs.open) return;
    fs.open = false;
    el.full.hidden = true;
    document.body.classList.remove('full-open');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (fs.pushed && !fromHistory) { fs.pushed = false; history.back(); }
    fs.pushed = false;
    changed();
  }
  // o "voltar" do Android fecha a tela cheia, não o app
  window.addEventListener('popstate', () => { if (fs.open) { fs.pushed = false; fsClose(true); } });

  function fsDraw() { if (fs.open && !fs.raf) fs.raf = requestAnimationFrame(fsRender); }

  function fsRender() {
    fs.raf = 0;
    if (!fs.open) return;
    const c = el.fCanvas;
    const rect = c.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.max(1, Math.round(rect.width * dpr));
    c.height = Math.max(1, Math.round(rect.height * dpr));
    const g = c.getContext('2d');
    const css = getComputedStyle(document.documentElement);
    g.fillStyle = css.getPropertyValue('--surface-2').trim();
    g.fillRect(0, 0, c.width, c.height);

    const it = fsItem(), G = it.G, L = it.L;
    const m = Math.max(G.E, 2) + 3;
    const k = Math.min(c.width / (G.w + 2 * m), (c.height - 22 * dpr) / (G.h + 2 * m));
    Object.assign(fs, { k, dpr, cx: c.width / 2, cy: (c.height - 22 * dpr) / 2 });
    const img = compose(it, k, { preview: true, fast: fs.fast });
    const ix = Math.round(fs.cx - img.width / 2), iy = Math.round(fs.cy - img.height / 2);
    g.save();
    g.shadowColor = 'rgba(20, 10, 60, .22)';
    g.shadowBlur = 14 * dpr;
    g.drawImage(img, ix, iy);
    g.restore();

    // guias (não saem na impressão)
    g.save();
    g.translate(ix + img.width / 2, iy + img.height / 2);
    g.setLineDash([5 * dpr, 4 * dpr]);
    g.lineWidth = 1.2 * dpr;
    g.strokeStyle = 'rgba(30,25,60,.45)';
    g.beginPath();
    if (G.kind === 'btn') g.arc(0, 0, G.face / 2 * k, 0, Math.PI * 2);
    else if (!it.contour) Deco.roundRect(g, -G.w / 2 * k, -G.h / 2 * k, G.w * k, G.h * k, G.r * k);
    else {
      const a = OVER - RIM - 0.3;
      g.strokeStyle = 'rgba(30,25,60,.18)';
      g.rect(-(G.w / 2 + a) * k, -(G.h / 2 + a) * k, (G.w + 2 * a) * k, (G.h + 2 * a) * k);
    }
    g.stroke();

    // sticker selecionado: caixa e alça de tamanho/giro
    const s = it.deco ? L.deco[fs.st] : null;
    if (s && s.img) {
      const w = s.w * k, h = stH(s) * k;
      g.translate(s.x * k, s.y * k);
      g.rotate(s.rot);
      g.strokeStyle = accentColor();
      g.lineWidth = 1.6 * dpr;
      g.strokeRect(-w / 2, -h / 2, w, h);
      g.setLineDash([]);
      const r = 13 * dpr;
      g.beginPath();
      g.arc(w / 2, h / 2, r, 0, Math.PI * 2);
      g.fillStyle = accentColor();
      g.fill();
      g.strokeStyle = '#fff';
      g.lineWidth = 2 * dpr;
      g.lineCap = 'round';
      const a = r * 0.45;
      g.beginPath();
      g.moveTo(w / 2 - a, h / 2 - a); g.lineTo(w / 2 + a, h / 2 + a);
      g.moveTo(w / 2 + a, h / 2 + a - a * 0.9); g.lineTo(w / 2 + a, h / 2 + a); g.lineTo(w / 2 + a - a * 0.9, h / 2 + a);
      g.moveTo(w / 2 - a, h / 2 - a + a * 0.9); g.lineTo(w / 2 - a, h / 2 - a); g.lineTo(w / 2 - a + a * 0.9, h / 2 - a);
      g.stroke();
    }
    g.restore();
  }

  function fsSync() {
    if (!fs.open) return;
    const lay = layout();
    const it = fsItem(), L = it.L;
    if (!it.deco || fs.st >= L.deco.length) fs.st = -1;
    el.fTitle.textContent = selTitle();
    el.fPrev.disabled = el.fNext.disabled = !isBtn() && side === 'back' && prefs.backMode === 'same' || lay.n < 2;
    el.fSide.hidden = isBtn();
    el.fSide.textContent = side === 'front' ? 'Ver verso' : 'Ver frente';
    el.fUndo.disabled = !fs.undo.length;
    el.fSelBar.hidden = fs.st < 0;
    for (const b of el.full.querySelectorAll('.cf-tool')) b.setAttribute('aria-pressed', String(b.dataset.panel === fs.panel));
    el.fPanel.hidden = !fs.panel;
    el.fPhoto.hidden = fs.panel !== 'photo';
    el.fStickers.hidden = fs.panel !== 'stickers';
    el.fFrames.hidden = fs.panel !== 'frames';

    let hint = '';
    if (!it.editable) hint = 'O verso espelha a frente. Para mudar, edite a frente.';
    else if (fs.st >= 0) hint = 'Arraste o sticker. Dois dedos ou a bolinha: tamanho e giro.';
    else if (!L.img && !L.deco.length) hint = 'Toque no card para escolher a foto.';
    else hint = 'Arraste a foto. Dois dedos: zoom. Toque num sticker para mexer nele.';
    if (isBtn() && !hint.startsWith('O verso')) hint += ' Tracejado: frente do botton.';
    el.fHint.textContent = hint;

    if (fs.panel === 'photo') {
      el.fPick.hidden = !it.editable;
      el.fPick.textContent = L.img ? 'Trocar foto' : 'Escolher foto';
      for (const b of [el.fRotate, el.fCenter, el.fRemove]) b.disabled = !it.editable || !L.img;
      el.fZoom.disabled = !it.editable || !L.img;
      el.fZoom.value = Math.round(L.zoom * 100);
      el.fZoomOut.textContent = Math.round(L.zoom * 100) + '%';
      el.fPhotoHint.textContent = !it.editable ? 'No modo "Espelho da frente", edite a foto pela frente.' : L.img ? quality(L, it.G) : '';
    }
    if (fs.panel === 'frames') markFrames();
  }

  function fsAfterEdit() {
    invalidatePdf();
    scheduleSave();
    fsSync();
    fsDraw();
  }

  /* --- desfazer --- */
  function snap(L) {
    return { img: L.img, zoom: L.zoom, ox: L.ox, oy: L.oy, rot: L.rot, frame: L.frame ? { ...L.frame } : null, deco: L.deco.map((s) => ({ ...s })) };
  }
  function pushUndo(L) {
    fs.undo.push({ L, s: snap(L) });
    if (fs.undo.length > 60) fs.undo.shift();
    el.fUndo.disabled = false;
  }
  el.fUndo.addEventListener('click', () => {
    const u = fs.undo.pop();
    if (!u) return;
    Object.assign(u.L, { ...u.s, deco: u.s.deco.map((x) => ({ ...x })) });
    touch(u.L);
    fs.st = -1;
    fsAfterEdit();
  });

  /* --- navegação --- */
  function fsGo(d) {
    const n = layout().n;
    sel = (sel + d + n) % n;
    fs.st = -1;
    fsPanelRefresh();
  }
  // o painel aberto acompanha o card que está na tela
  function fsPanelRefresh() {
    syncUI();
    if (fs.panel === 'stickers') buildStickers();
    if (fs.panel === 'frames') buildFrames();
    fsSync();
    fsDraw();
  }
  el.fPrev.addEventListener('click', () => fsGo(-1));
  el.fNext.addEventListener('click', () => fsGo(1));
  el.fClose.addEventListener('click', () => fsClose(false));
  el.fSide.addEventListener('click', () => {
    side = side === 'front' ? 'back' : 'front';
    fs.st = -1;
    fsPanelRefresh();
  });
  for (const b of el.full.querySelectorAll('.cf-tool')) {
    b.addEventListener('click', () => {
      fs.panel = fs.panel === b.dataset.panel ? null : b.dataset.panel;
      if (fs.panel === 'stickers') buildStickers();
      if (fs.panel === 'frames') buildFrames();
      fsSync();
      fsDraw();
    });
  }
  el.fullBtn.addEventListener('click', fsOpen);
  new ResizeObserver(() => fsDraw()).observe(el.fCanvas);

  /* --- painel da foto --- */
  el.fPick.addEventListener('click', () => { if (!busy) el.input.click(); });
  function fsPhoto(fn) {
    const it = fsItem();
    if (!it.editable || !it.L.img) return;
    pushUndo(it.L);
    fn(it.L);
    fsAfterEdit();
  }
  el.fRotate.addEventListener('click', () => fsPhoto(rotatePhoto));
  el.fCenter.addEventListener('click', () => fsPhoto(centerPhoto));
  el.fRemove.addEventListener('click', () => fsPhoto(removePhoto));
  el.fZoom.addEventListener('pointerdown', () => { const it = fsItem(); if (it.editable && it.L.img) pushUndo(it.L); });
  el.fZoom.addEventListener('input', () => {
    const it = fsItem();
    if (!it.editable || !it.L.img) return;
    it.L.zoom = +el.fZoom.value / 100;
    touch(it.L);
    el.fZoomOut.textContent = el.fZoom.value + '%';
    invalidatePdf();
    scheduleSave();
    fsDraw();
  });

  /* --- stickers --- */
  function addSticker(rec, ref) {
    const it = fsItem();
    if (!it.editable || !it.deco) return;
    const L = it.L, G = it.G;
    pushUndo(L);
    const base = G.kind === 'btn' ? G.face * 0.42 : 24;
    const ar = rec.h / rec.w;
    const w = ar > 1.2 ? (base * 1.2) / ar : base;
    const n = L.deco.length % 5;
    L.deco.push({ ref, img: rec, x: (n - 2) * 3, y: (n - 2) * 3, w, rot: 0, flip: false });
    fs.st = L.deco.length - 1;
    fs.panel = null; // fecha o painel para ver o card grande
    touch(L);
    fsAfterEdit();
  }

  function tile(content, label) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cf-tile';
    if (content) b.appendChild(content);
    if (label) b.setAttribute('aria-label', label);
    b.title = label || '';
    return b;
  }
  function thumbImg(rec) {
    const c = makeCanvas(96, 96);
    const g = c.getContext('2d');
    const s = Math.min(96 / rec.thumb.width, 96 / rec.thumb.height);
    g.drawImage(rec.thumb, (96 - rec.thumb.width * s) / 2, (96 - rec.thumb.height * s) / 2, rec.thumb.width * s, rec.thumb.height * s);
    return c;
  }
  function sectionTitle(text) {
    const p = document.createElement('p');
    p.className = 'cf-sec-title';
    p.textContent = text;
    return p;
  }
  function grid() {
    const d = document.createElement('div');
    d.className = 'cf-grid';
    return d;
  }

  async function buildStickers() {
    const box = el.fStGrid;
    box.innerHTML = '';
    const it = fsItem();
    if (!it.editable || !it.deco) {
      box.appendChild(sectionTitle('No modo "Espelho da frente", o verso não leva stickers.'));
      return;
    }
    box.appendChild(sectionTitle('Meus stickers'));
    const g1 = grid();
    const add = tile(null, 'Adicionar sticker do celular');
    add.classList.add('cf-add');
    add.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>Do celular</span>';
    add.addEventListener('click', () => el.fStInput.click());
    g1.appendChild(add);
    for (const rec of mine) {
      const t = tile(thumbImg(rec), rec.name);
      t.addEventListener('click', () => addSticker(rec, { id: rec.id }));
      const x = document.createElement('span');
      x.className = 'x';
      x.textContent = '×';
      x.setAttribute('role', 'button');
      x.setAttribute('aria-label', 'Tirar de Meus stickers');
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        mine = mine.filter((r) => r !== rec);
        scheduleSave();
        buildStickers();
      });
      t.appendChild(x);
      g1.appendChild(t);
    }
    box.appendChild(g1);
    if (!mine.length) {
      const p = document.createElement('p');
      p.className = 'small';
      p.textContent = 'Dica: tire o fundo de uma foto no Ranca Fundo e toque em "Virar sticker".';
      box.appendChild(p);
    }

    const { stickers } = await Deco.packs();
    if (!fs.open || fs.panel !== 'stickers') return;
    box.appendChild(sectionTitle('Stickers do app'));
    const g2 = grid();
    for (const path of stickers) {
      const im = document.createElement('img');
      im.src = encodeURI(path);
      im.alt = '';
      im.loading = 'lazy';
      const t = tile(im, Deco.niceName(path));
      t.addEventListener('click', () => {
        packImage(path).then((rec) => addSticker(rec, { pack: path }))
          .catch(() => { el.fHint.textContent = 'Não foi possível abrir este sticker.'; });
      });
      g2.appendChild(t);
    }
    if (!stickers.length) g2.appendChild(sectionTitle('Nenhum sticker na pasta enfeites/stickers.'));
    box.appendChild(g2);
  }

  el.fStInput.addEventListener('change', async () => {
    const files = [...el.fStInput.files].filter((x) => x.type.startsWith('image/'));
    el.fStInput.value = '';
    let first = true;
    for (const file of files) {
      try {
        const rec = await imageFromFile(file, 'sticker');
        mine.unshift(rec);
        if (first) addSticker(rec, { id: rec.id });
        first = false;
      } catch (err) {
        el.fHint.textContent = 'Não foi possível abrir "' + file.name + '".';
      }
    }
    scheduleSave();
  });

  // repete os stickers deste card nos outros (do mesmo lado)
  el.fStAll.addEventListener('click', () => {
    const it = fsItem();
    if (!it.editable || !it.deco) return;
    const lay = layout(), src = it.L;
    for (let i = 0; i < lay.n; i++) {
      const t = itemOf(i, curSide(), lay);
      if (t.L === src || !t.deco || !t.editable) continue;
      t.L.deco = src.deco.map((s) => ({ ...s }));
      touch(t.L);
    }
    fs.panel = null;
    fsAfterEdit();
    el.fHint.textContent = 'Stickers repetidos em todos.';
  });

  function stickerAt(L, p) {
    const pad = Math.max(1.5, (10 * fs.dpr) / fs.k);
    for (let j = L.deco.length - 1; j >= 0; j--) {
      const s = L.deco[j];
      if (!s.img) continue;
      const dx = p.x - s.x, dy = p.y - s.y, c = Math.cos(s.rot), sn = Math.sin(s.rot);
      const lx = dx * c + dy * sn, ly = -dx * sn + dy * c;
      if (Math.abs(lx) <= s.w / 2 + pad && Math.abs(ly) <= stH(s) / 2 + pad) return j;
    }
    return -1;
  }
  function onHandle(s, p) {
    const c = Math.cos(s.rot), sn = Math.sin(s.rot), hw = s.w / 2, hh = stH(s) / 2;
    const hx = s.x + hw * c - hh * sn, hy = s.y + hw * sn + hh * c;
    return Math.hypot(p.x - hx, p.y - hy) <= (20 * fs.dpr) / fs.k;
  }
  const clampW = (w) => Math.min(160, Math.max(3, w));

  function selSticker() {
    const it = fsItem();
    return it.editable && it.deco ? it.L.deco[fs.st] : null;
  }
  function stAction(fn) {
    const it = fsItem(), s = selSticker();
    if (!s) return;
    pushUndo(it.L);
    fn(it.L, s);
    touch(it.L);
    fsAfterEdit();
  }
  el.fDel.addEventListener('click', () => stAction((L) => { L.deco.splice(fs.st, 1); fs.st = -1; }));
  el.fDup.addEventListener('click', () => stAction((L, s) => {
    L.deco.push({ ...s, x: s.x + 4, y: s.y + 4 });
    fs.st = L.deco.length - 1;
  }));
  el.fMir.addEventListener('click', () => stAction((L, s) => { s.flip = !s.flip; }));
  el.fUp.addEventListener('click', () => stAction((L, s) => { L.deco.splice(fs.st, 1); L.deco.push(s); fs.st = L.deco.length - 1; }));
  el.fDown.addEventListener('click', () => stAction((L, s) => { L.deco.splice(fs.st, 1); L.deco.unshift(s); fs.st = 0; }));

  /* --- molduras --- */
  function frameThumb(frame, rec) {
    const G = geom();
    const size = 84;
    const c = makeCanvas(size, size);
    const g = c.getContext('2d');
    const k = (size - 6) / Math.max(G.w, G.h);
    centerOn(g, c);
    g.save();
    cutPath(g, G.kind === 'btn' ? { ...G, w: G.face } : G, k);
    g.clip();
    const grad = g.createLinearGradient(0, -G.h / 2 * k, 0, G.h / 2 * k);
    grad.addColorStop(0, '#c9c3ef');
    grad.addColorStop(1, '#f3c6d8');
    g.fillStyle = grad;
    g.fillRect(-size, -size, 2 * size, 2 * size);
    Deco.drawFrame(g, G, k, frame, rec);
    g.restore();
    return c;
  }

  const frameKey = (fr) => (!fr ? 'none' : fr.png ? 'png:' + fr.png : 'st:' + fr.style);
  function setFrame(fr) {
    const it = fsItem();
    if (!it.editable) return;
    pushUndo(it.L);
    it.L.frame = fr;
    touch(it.L);
    fsAfterEdit();
  }

  async function buildFrames() {
    const box = el.fFrGrid;
    box.innerHTML = '';
    const it = fsItem();
    if (!it.editable) {
      box.appendChild(sectionTitle('No modo "Espelho da frente", a moldura vem da frente.'));
      el.fColors.hidden = true;
      return;
    }
    el.fColors.hidden = false;
    const g1 = grid();
    const none = tile(null, 'Sem moldura');
    none.dataset.key = 'none';
    none.innerHTML = '<span>Sem moldura</span>';
    none.addEventListener('click', () => setFrame(null));
    g1.appendChild(none);
    for (const st of Deco.STYLES) {
      const t = tile(frameThumb({ style: st.id, color: prefs.frameColor }), st.name);
      t.dataset.key = 'st:' + st.id;
      const cap = document.createElement('span');
      cap.className = 'cf-cap';
      cap.textContent = st.name;
      t.appendChild(cap);
      t.addEventListener('click', () => setFrame({ style: st.id, color: prefs.frameColor }));
      g1.appendChild(t);
    }
    box.appendChild(g1);
    buildColors();
    markFrames();

    const { molduras } = await Deco.packs();
    if (!fs.open || fs.panel !== 'frames' || !molduras.length) return;
    box.appendChild(sectionTitle('Molduras da pasta'));
    const g2 = grid();
    for (const path of molduras) {
      const t = tile(null, Deco.niceName(path));
      t.dataset.key = 'png:' + path;
      packImage(path).then((rec) => t.prepend(frameThumb({ png: path }, rec))).catch(() => { t.textContent = Deco.niceName(path); });
      t.addEventListener('click', () => setFrame({ png: path }));
      g2.appendChild(t);
    }
    box.appendChild(g2);
    markFrames();
  }
  function markFrames() {
    const key = frameKey(fsItem().L.frame);
    for (const t of el.fFrGrid.querySelectorAll('.cf-tile')) t.setAttribute('aria-pressed', String(t.dataset.key === key));
    for (const s of el.fColors.querySelectorAll('.cf-swatch[data-color]')) s.setAttribute('aria-pressed', String(s.dataset.color === prefs.frameColor));
  }
  function pickColor(color) {
    prefs.frameColor = color;
    savePrefs();
    const it = fsItem();
    if (it.editable && it.L.frame && it.L.frame.style) {
      pushUndo(it.L);
      it.L.frame = { ...it.L.frame, color };
      touch(it.L);
    }
    buildFrames();
    fsAfterEdit();
  }
  function buildColors() {
    const box = el.fColors;
    box.innerHTML = '';
    for (const color of Deco.COLORS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cf-swatch';
      b.style.background = color;
      b.dataset.color = color;
      b.setAttribute('aria-label', 'Cor ' + color);
      b.addEventListener('click', () => pickColor(color));
      box.appendChild(b);
    }
    const lab = document.createElement('label');
    lab.className = 'cf-swatch cf-custom';
    lab.title = 'Outra cor';
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.value = prefs.frameColor;
    inp.setAttribute('aria-label', 'Outra cor');
    inp.addEventListener('change', () => pickColor(inp.value));
    lab.appendChild(inp);
    box.appendChild(lab);
  }
  el.fFrAll.addEventListener('click', () => {
    const it = fsItem();
    if (!it.editable) return;
    const lay = layout(), fr = it.L.frame;
    for (let i = 0; i < lay.n; i++) {
      const t = itemOf(i, curSide(), lay);
      if (t.L === it.L || !t.editable) continue;
      t.L.frame = fr ? { ...fr } : null;
      touch(t.L);
    }
    fsAfterEdit();
    el.fHint.textContent = fr ? 'Moldura repetida em todos.' : 'Moldura tirada de todos.';
  });

  /* --- gestos na tela cheia --- */
  const fptr = new Map();
  let fg = null;
  function fsPt(e) {
    const r = el.fCanvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * fs.dpr - fs.cx) / fs.k, y: ((e.clientY - r.top) * fs.dpr - fs.cy) / fs.k };
  }
  function two() {
    const [a, b] = [...fptr.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, a: Math.atan2(b.y - a.y, b.x - a.x) };
  }
  function undoOnce() { if (fg && !fg.saved) { fg.saved = true; pushUndo(fg.L); } }

  el.fCanvas.addEventListener('pointerdown', (e) => {
    if (busy) return;
    fptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    el.fCanvas.setPointerCapture(e.pointerId);
    const it = fsItem(), L = it.L;
    if (!it.editable) { fg = null; return; }
    if (fptr.size === 1) {
      const p = fsPt(e);
      const s = it.deco ? L.deco[fs.st] : null;
      if (s && s.img && onHandle(s, p)) {
        fg = { mode: 'handle', s, d0: Math.hypot(p.x - s.x, p.y - s.y) || 1, a0: Math.atan2(p.y - s.y, p.x - s.x), w0: s.w, r0: s.rot };
      } else {
        const j = it.deco ? stickerAt(L, p) : -1;
        if (j >= 0) {
          fs.st = j;
          const s2 = L.deco[j];
          fg = { mode: 'st', s: s2, p0: p, x0: s2.x, y0: s2.y };
        } else {
          fs.st = -1;
          fg = L.img ? { mode: 'photo', p0: p, ox: L.ox, oy: L.oy } : { mode: 'tap' };
        }
        fsSync();
      }
      Object.assign(fg, { L, sx: e.clientX, sy: e.clientY, moved: false, saved: false });
      fsDraw();
    } else if (fptr.size === 2) {
      const t = two();
      const s = it.deco ? L.deco[fs.st] : null;
      const saved = fg ? fg.saved : false;
      if (s && s.img) fg = { mode: 'pinch-st', s, d0: t.d, a0: t.a, w0: s.w, r0: s.rot };
      else if (L.img) fg = { mode: 'pinch-photo', d0: t.d, z0: L.zoom };
      else { fg = null; return; }
      Object.assign(fg, { L, moved: true, saved });
      undoOnce();
    }
  });
  el.fCanvas.addEventListener('pointermove', (e) => {
    if (!fptr.has(e.pointerId)) return;
    fptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!fg) return;
    const L = fg.L;
    if (fg.mode === 'pinch-st' || fg.mode === 'pinch-photo') {
      if (fptr.size < 2) return;
      const t = two();
      if (fg.mode === 'pinch-st') { fg.s.w = clampW(fg.w0 * t.d / fg.d0); fg.s.rot = fg.r0 + t.a - fg.a0; }
      else L.zoom = clampZoom(fg.z0 * t.d / fg.d0);
    } else {
      if (!fg.moved && Math.hypot(e.clientX - fg.sx, e.clientY - fg.sy) > 4) { fg.moved = true; undoOnce(); }
      if (!fg.moved || fg.mode === 'tap') return;
      const p = fsPt(e);
      if (fg.mode === 'st') { fg.s.x = fg.x0 + p.x - fg.p0.x; fg.s.y = fg.y0 + p.y - fg.p0.y; }
      else if (fg.mode === 'photo') { L.ox = fg.ox + p.x - fg.p0.x; L.oy = fg.oy + p.y - fg.p0.y; }
      else if (fg.mode === 'handle') {
        const d = Math.hypot(p.x - fg.s.x, p.y - fg.s.y), a = Math.atan2(p.y - fg.s.y, p.x - fg.s.x);
        fg.s.w = clampW(fg.w0 * d / fg.d0);
        fg.s.rot = fg.r0 + a - fg.a0;
      }
    }
    touch(L);
    fs.fast = true;
    fsDraw();
  });
  function fsEnd(e) {
    if (!fptr.delete(e.pointerId)) return;
    if (fg && fg.mode === 'tap' && !fg.moved && e.type === 'pointerup' && !fptr.size) {
      const it = fsItem();
      if (it.editable && !it.L.img) el.input.click();
    }
    const pinching = fg && (fg.mode === 'pinch-st' || fg.mode === 'pinch-photo');
    if (!fptr.size || (pinching && fptr.size < 2)) {
      const edited = fg && fg.moved;
      fg = null;
      fs.fast = false;
      if (edited) fsAfterEdit(); else fsDraw();
    }
  }
  el.fCanvas.addEventListener('pointerup', fsEnd);
  el.fCanvas.addEventListener('pointercancel', fsEnd);
  el.fCanvas.addEventListener('wheel', (e) => {
    const it = fsItem();
    if (!it.editable || busy) return;
    e.preventDefault();
    const L = it.L, s = selSticker();
    if (!s && !L.img) return;
    const now = performance.now();
    if (now - fs.wheelAt > 700) pushUndo(L);
    fs.wheelAt = now;
    if (s && e.shiftKey) s.rot += e.deltaY * 0.003;
    else if (s) s.w = clampW(s.w * Math.exp(-e.deltaY * 0.0015));
    else L.zoom = clampZoom(L.zoom * Math.exp(-e.deltaY * 0.0015));
    touch(L);
    fsAfterEdit();
  }, { passive: false });

  /* ---------------- Guardar no aparelho (IndexedDB) ---------------- */
  const Store = (() => {
    let dbp = null;
    function db() {
      if (!dbp) {
        dbp = new Promise((res, rej) => {
          const q = indexedDB.open('rancaFundoCards', 1);
          q.onupgradeneeded = () => { q.result.createObjectStore('images'); q.result.createObjectStore('state'); };
          q.onsuccess = () => res(q.result);
          q.onerror = () => rej(q.error);
        });
      }
      return dbp;
    }
    async function tx(store, mode, fn) {
      const d = await db();
      return new Promise((res, rej) => {
        const t = d.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => res(req && 'result' in req ? req.result : undefined);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      });
    }
    return {
      putImage: (id, blob, name, kind) => tx('images', 'readwrite', (s) => s.put({ blob, name, kind }, id)).catch((e) => console.warn('Guardar imagem:', e)),
      getImage: (id) => tx('images', 'readonly', (s) => s.get(id)),
      keys: () => tx('images', 'readonly', (s) => s.getAllKeys()),
      del: (ids) => tx('images', 'readwrite', (s) => { ids.forEach((id) => s.delete(id)); }),
      saveState: (st) => tx('state', 'readwrite', (s) => s.put(st, 'project')),
      loadState: () => tx('state', 'readonly', (s) => s.get('project')),
    };
  })();

  function serL(L) {
    return {
      img: L.img ? L.img.id : null, zoom: L.zoom, ox: L.ox, oy: L.oy, rot: L.rot,
      frame: L.frame ? { ...L.frame } : null,
      deco: L.deco.filter((s) => s.ref).map((s) => ({ ref: s.ref, x: s.x, y: s.y, w: s.w, rot: s.rot, flip: !!s.flip })),
    };
  }
  let saveTimer = 0, restored = false;
  function scheduleSave() {
    if (!restored) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 700);
  }
  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    if (!restored) return;
    const st = {
      v: 1, sel, side,
      cards: cards.map((c) => ({ front: serL(c.front), back: serL(c.back) })),
      sharedBack: serL(sharedBack),
      buttons: buttons.map(serL),
      mine: mine.map((r) => r.id),
    };
    Store.saveState(st).catch((e) => console.warn('Guardar projeto:', e));
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden && saveTimer) saveNow(); });

  let readyP = null;
  function ready() {
    if (!readyP) {
      readyP = restore()
        .catch((e) => { console.warn('Abrir projeto salvo:', e); el.status.textContent = ''; })
        .finally(() => { restored = true; busy = false; syncUI(); render(); });
    }
    return readyP;
  }
  async function restore() {
    if (!window.indexedDB) return;
    // pede para o navegador não apagar o projeto quando o celular estiver sem espaço
    try { navigator.storage?.persist?.().catch(() => {}); } catch { /* sem suporte */ }
    const st = await Store.loadState();
    if (!st || st.v !== 1) return;
    busy = true;
    el.status.textContent = 'Abrindo o projeto salvo…';
    const recs = new Map();
    const getRec = (id, kind) => {
      if (!id) return Promise.resolve(null);
      if (!recs.has(id)) {
        recs.set(id, Store.getImage(id).then((o) => (o
          ? decode(o.blob, kind === 'sticker' ? STICKER_SIDE : MAX_SIDE, kind === 'sticker' ? 500 : 1200)
            .then((r) => ({ id, name: o.name || '', ...r }))
          : null)).catch(() => null));
      }
      return recs.get(id);
    };
    async function fill(L, o) {
      if (!o) return;
      Object.assign(L, {
        img: await getRec(o.img, 'photo'), zoom: o.zoom || 1, ox: o.ox || 0, oy: o.oy || 0, rot: o.rot || 0,
        frame: o.frame || null, deco: [],
      });
      for (const s of o.deco || []) {
        const ref = s.ref || {};
        const rec = ref.pack ? await packImage(ref.pack).catch(() => null) : await getRec(ref.id, 'sticker');
        if (rec) L.deco.push({ ref, img: rec, x: +s.x || 0, y: +s.y || 0, w: +s.w || 20, rot: +s.rot || 0, flip: !!s.flip });
      }
      touch(L);
    }
    // uma por vez, para não estourar a memória do celular
    for (let i = 0; i < 9; i++) {
      const c = (st.cards || [])[i];
      if (c) { await fill(cards[i].front, c.front); await fill(cards[i].back, c.back); }
    }
    await fill(sharedBack, st.sharedBack);
    for (let i = 0; i < (st.buttons || []).length; i++) {
      while (buttons.length <= i) buttons.push(blank());
      await fill(buttons[i], st.buttons[i]);
    }
    mine = (await Promise.all((st.mine || []).map((id) => getRec(id, 'sticker')))).filter(Boolean);
    sel = Number.isInteger(st.sel) ? st.sel : 0;
    side = st.side === 'back' ? 'back' : 'front';
    el.status.textContent = '';

    // apaga imagens que ninguém usa mais
    const used = new Set(mine.map((r) => r.id));
    for (const L of allLayers()) {
      if (L.img) used.add(L.img.id);
      for (const s of L.deco) if (s.ref && s.ref.id) used.add(s.ref.id);
    }
    const keys = await Store.keys();
    const old = keys.filter((id) => !used.has(id));
    if (old.length) await Store.del(old);
  }

  /* ---------------- Abrir / fechar ---------------- */
  // As fotos ficam guardadas no aparelho, mesmo fechando o app.
  function open() {
    el.modal.hidden = false;
    document.body.classList.add('modal-open');
    syncUI();
    render();
    el.close.focus();
    return ready();
  }
  function close() {
    if (fs.open) fsClose(false);
    saveNow();
    el.modal.hidden = true;
    document.body.classList.remove('modal-open');
  }
  function redraw() {
    if (!el.modal.hidden) render();
    fsDraw();
  }
  el.close.addEventListener('click', () => { if (!busy) close(); });
  el.modal.addEventListener('click', (e) => { if (e.target === el.modal && !busy) close(); });
  document.addEventListener('keydown', (e) => {
    if (fs.open) {
      const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || '');
      if (e.key === 'Escape') { if (fs.st >= 0) { fs.st = -1; fsSync(); fsDraw(); } else fsClose(false); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && fs.st >= 0 && !typing) { e.preventDefault(); el.fDel.click(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); el.fUndo.click(); }
      return;
    }
    if (e.key === 'Escape' && !el.modal.hidden && !busy) close();
  });
  window.addEventListener('resize', () => { if (!el.modal.hidden) render(); fsDraw(); });

  // Sticker vindo do editor (imagem sem fundo): vai para "Meus stickers" e para o card selecionado.
  async function addStickerFile(file) {
    await open();
    let rec;
    try { rec = await imageFromFile(file, 'sticker'); } catch (err) {
      el.status.textContent = 'Não foi possível abrir o sticker: ' + (err?.message || err);
      return;
    }
    mine.unshift(rec);
    scheduleSave();
    if (!itemOf(sel, curSide()).editable) side = 'front';
    fsOpen();
    addSticker(rec, { id: rec.id });
  }

  loadPrefs();
  window.RancaCards = { open, addFiles, addSticker: addStickerFile, isOpen: () => !el.modal.hidden };
})();
