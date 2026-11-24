// Pôster em várias folhas: divide a imagem em folhas de papel e gera um PDF (tudo offline).
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

  const $ = (id) => document.getElementById(id);
  const el = {
    modal: $('poster'), close: $('posterClose'),
    paper: $('pPaper'), orient: $('pOrient'),
    marginOn: $('pMarginOn'), margin: $('pMargin'),
    overlapOn: $('pOverlapOn'), overlap: $('pOverlap'),
    count: $('pCount'), axis: $('pAxis'),
    skip: $('pSkip'), skipRow: $('pSkipRow'), guide: $('pGuide'),
    ai: $('pAi'), aiRow: $('pAiRow'), aiLevel: $('pAiLevel'), aiLevelRow: $('pAiLevelRow'),
    canvas: $('pCanvas'), info: $('pInfo'), status: $('pStatus'),
    make: $('pMake'), share: $('pShare'), cancel: $('pCancel'),
    srcResult: $('pSrcResult'), srcOrig: $('pSrcOrig'), srcHint: $('pSrcHint'), srcAction: $('pSrcAction'),
    srcBox: $('pSrcBox'), pick: $('pPick'), imgName: $('pImgName'),
    empty: $('pEmpty'), emptyPick: $('pEmptyPick'),
  };

  let src = null;    // imagem atual: { bmp, thumb, alpha, aw, ah, w, h, bg, name }
  let layout = null; // resultado de compute()
  let pdfFile = null;
  let busy = false;
  let cancelled = false;

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
  const FIELDS = ['paper', 'orient', 'marginOn', 'margin', 'overlapOn', 'overlap', 'count', 'axis', 'skip', 'guide', 'ai', 'aiLevel'];
  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem('rancaFundoPoster') || '{}');
      for (const k of FIELDS) {
        if (p[k] == null) continue;
        if (el[k].type === 'checkbox') el[k].checked = !!p[k]; else el[k].value = p[k];
      }
    } catch { /* usa padrões */ }
  }
  function savePrefs() {
    try {
      const p = {};
      for (const k of FIELDS) p[k] = el[k].type === 'checkbox' ? el[k].checked : el[k].value;
      localStorage.setItem('rancaFundoPoster', JSON.stringify(p));
    } catch { /* ignorado */ }
  }

  /* ---------------- Cálculo das folhas ---------------- */
  function compute() {
    const paper = PAPERS[el.paper.value] || PAPERS.a4;
    let W = paper[0], H = paper[1];
    if (el.orient.value === 'landscape') [W, H] = [H, W];
    const m = el.marginOn.checked ? num(el.margin.value, 0, 40, 10) : 0;
    const pw = W - 2 * m, ph = H - 2 * m; // área impressa de cada folha
    const ov = el.overlapOn.checked ? Math.min(num(el.overlap.value, 0, 50, 10), Math.floor(Math.min(pw, ph) / 3)) : 0;
    const n = num(el.count.value, 1, 30, 4);
    const sx = pw - ov, sy = ph - ov; // passo entre uma folha e a próxima
    const ratio = src.w / src.h;

    let posterW, posterH;
    if (el.axis.value === 'tall') { posterH = ph + (n - 1) * sy; posterW = posterH * ratio; }
    else { posterW = pw + (n - 1) * sx; posterH = posterW / ratio; }

    const cols = Math.max(1, Math.ceil((posterW - ov) / sx - 1e-6));
    const rows = Math.max(1, Math.ceil((posterH - ov) / sy - 1e-6));
    const gridW = ov + cols * sx, gridH = ov + rows * sy;
    const L = {
      W, H, m, pw, ph, ov, sx, sy, cols, rows, gridW, gridH, posterW, posterH,
      offX: (gridW - posterW) / 2, offY: (gridH - posterH) / 2, // imagem centralizada na grade
      paperName: paper[2], landscape: el.orient.value === 'landscape',
      dpi: src.w / (posterW / 25.4),
      pages: [],
    };
    L.lowRes = L.dpi < MIN_DPI;            // ampliar vai perder nitidez
    L.useAi = L.lowRes && el.ai.checked;
    if (rows * cols > MAX_PAGES) { L.tooMany = true; return L; }

    const skip = el.skip.checked && !src.bg && !src.opaque;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const p = { r, c, x: c * sx, y: r * sy, label: rowName(r) + (c + 1) };
        p.blank = skip && isBlank(L, p);
        L.pages.push(p);
      }
    }
    L.printed = L.pages.filter((p) => !p.blank);
    return L;
  }

  // A folha fica vazia se a parte da imagem que cai nela é toda transparente.
  function isBlank(L, p) {
    const kx = src.aw / L.posterW, ky = src.ah / L.posterH;
    const x0 = Math.max(0, Math.floor((p.x - L.offX) * kx));
    const x1 = Math.min(src.aw, Math.ceil((p.x - L.offX + L.pw) * kx));
    const y0 = Math.max(0, Math.floor((p.y - L.offY) * ky));
    const y1 = Math.min(src.ah, Math.ceil((p.y - L.offY + L.ph) * ky));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) if (src.alpha[y * src.aw + x] > 8) return false;
    }
    return true;
  }

  /* ---------------- Desenho (prévia e mapa de montagem) ---------------- */
  function drawScene(ctx, cw, ch, L, opt) {
    const pad = opt.pad;
    const k = Math.min((cw - 2 * pad) / L.gridW, (ch - 2 * pad) / L.gridH);
    const gx = (cw - L.gridW * k) / 2, gy = (ch - L.gridH * k) / 2;

    ctx.fillStyle = opt.bg;
    ctx.fillRect(0, 0, cw, ch);

    // folhas impressas
    ctx.fillStyle = src.bg || '#ffffff';
    for (const p of L.pages) if (!p.blank) ctx.fillRect(gx + p.x * k, gy + p.y * k, L.pw * k, L.ph * k);
    // imagem
    ctx.drawImage(src.thumb, gx + L.offX * k, gy + L.offY * k, L.posterW * k, L.posterH * k);

    // contornos e nomes das folhas
    const fs = Math.min(L.pw, L.ph) * k * 0.22;
    ctx.lineWidth = Math.max(1, opt.line);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 ' + Math.round(fs) + 'px system-ui, sans-serif';
    for (const p of L.pages) {
      const x = gx + p.x * k, y = gy + p.y * k, w = L.pw * k, h = L.ph * k;
      ctx.setLineDash(p.blank ? [4, 4] : []);
      ctx.strokeStyle = p.blank ? opt.muted : opt.accent;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      if (fs >= 9) {
        if (!p.blank) { // contorno branco para ler o código mesmo em cima da imagem
          ctx.lineWidth = Math.max(2, fs / 5);
          ctx.strokeStyle = 'rgba(255,255,255,.85)';
          ctx.lineJoin = 'round';
          ctx.strokeText(p.label, x + w / 2, y + h / 2);
          ctx.lineWidth = Math.max(1, opt.line);
        }
        ctx.fillStyle = p.blank ? opt.muted : opt.accent;
        ctx.globalAlpha = p.blank ? 0.6 : 1;
        ctx.fillText(p.label, x + w / 2, y + h / 2);
        ctx.globalAlpha = 1;
      }
    }
    ctx.setLineDash([]);
  }

  function renderPreview() {
    const c = el.canvas;
    const r = c.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.max(1, Math.round(r.width * dpr));
    c.height = Math.max(1, Math.round(r.height * dpr));
    const ctx = c.getContext('2d');
    if (!src || !layout || layout.tooMany) {
      ctx.clearRect(0, 0, c.width, c.height);
      return;
    }
    const css = getComputedStyle(document.documentElement);
    const v = (name) => css.getPropertyValue(name).trim();
    ctx.imageSmoothingQuality = 'high';
    drawScene(ctx, c.width, c.height, layout, {
      pad: 14 * dpr, line: 1.5 * dpr,
      bg: v('--surface-2'), accent: v('--accent'), muted: v('--muted'),
    });
  }

  function renderInfo() {
    const L = layout;
    const rows = [];
    if (L.tooMany) {
      el.info.innerHTML = '<p class="poster-warn">Ficaria com mais de ' + MAX_PAGES + ' folhas. Diminua o tamanho.</p>';
      el.make.disabled = true;
      return;
    }
    const skipped = L.pages.length - L.printed.length;
    rows.push(['Folha', cm(L.W) + ' × ' + cm(L.H) + ' cm']);
    rows.push(['Pôster pronto', cm(L.posterW) + ' × ' + cm(L.posterH) + ' cm']);
    rows.push(['Folhas', L.printed.length + (skipped ? ' (' + skipped + ' vazias ficam de fora)' : '') +
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
    if (L.m < 5) {
      const note = document.createElement('p');
      note.className = 'small';
      note.textContent = 'Sem margem, as folhas saem sem código e sem marcas de corte.';
      el.info.append(note);
    }
    el.make.disabled = busy || !L.printed.length;
  }

  function update() {
    if (!src) return;
    savePrefs();
    el.margin.disabled = !el.marginOn.checked;
    el.overlap.disabled = !el.overlapOn.checked;
    el.skipRow.hidden = !!src.bg || src.opaque;
    layout = compute();
    el.aiRow.hidden = !layout.lowRes;
    el.aiLevelRow.hidden = !el.ai.checked;
    pdfFile = null;
    el.share.hidden = true;
    if (!busy) el.status.textContent = '';
    renderInfo();
    renderPreview();
  }

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

  function addPage(pdf, ctx, jpeg, iw, ih, ops) {
    const img = pdf.add(['<< /Type /XObject /Subtype /Image /Width ' + iw + ' /Height ' + ih +
      ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.size + ' >>\nstream\n', jpeg, '\nendstream']);
    const body = latin1(ops);
    const content = pdf.add(['<< /Length ' + body.length + ' >>\nstream\n', body, '\nendstream']);
    ctx.kids.push(pdf.add('<< /Type /Page /Parent ' + ctx.pagesId + ' 0 R /MediaBox [0 0 ' + f(ctx.W) + ' ' + f(ctx.H) +
      '] /Resources << /Font << /F1 ' + ctx.font + ' 0 R >> /XObject << /Im0 ' + img + ' 0 R >> >> /Contents ' + content + ' 0 R >>'));
  }

  const line = (x1, y1, x2, y2) => f(x1 * PT) + ' ' + f(y1 * PT) + ' m ' + f(x2 * PT) + ' ' + f(y2 * PT) + ' l S\n';

  // Marcas de corte nos cantos e de sobreposição (coordenadas em mm, origem embaixo à esquerda)
  function marks(L, p) {
    const { W, H, m, ov } = L;
    const gap = 1.5, len = Math.min(m - 2, 7);
    let s = '0.4 w 0.45 G\n';
    for (const cx of [m, W - m]) {
      for (const cy of [m, H - m]) {
        const dx = cx === m ? -1 : 1, dy = cy === m ? -1 : 1;
        s += line(cx + dx * gap, cy, cx + dx * (gap + len), cy);
        s += line(cx, cy + dy * gap, cx, cy + dy * (gap + len));
      }
    }
    if (ov) {
      s += '[1.5 1] 0 d\n';
      if (p.c < L.cols - 1) { // a folha da direita cola até aqui
        const x = m + L.pw - ov;
        s += line(x, H - m + gap, x, H - m + gap + len) + line(x, m - gap, x, m - gap - len);
      }
      if (p.r < L.rows - 1) { // a folha de baixo cola até aqui
        const y = m + ov;
        s += line(m - gap, y, m - gap - len, y) + line(W - m + gap, y, W - m + gap + len, y);
      }
      s += '[] 0 d\n';
    }
    return s;
  }

  async function guidePage(pdf, ctx, L) {
    const mg = Math.max(L.m, 12);
    const lines = [
      src.name + ' - pôster de ' + cm(L.posterW) + ' × ' + cm(L.posterH) + ' cm',
      L.printed.length + ' folhas ' + L.paperName + ' (' + (L.landscape ? 'paisagem' : 'retrato') + '), margem de ' +
        f(L.m) + ' mm' + (L.ov ? ', sobreposição de ' + f(L.ov) + ' mm' : ''),
      '',
      '1. Imprima em tamanho real (100%), sem "ajustar à página".',
      L.m >= 5 ? '2. Corte a margem branca de cada folha seguindo as marcas dos cantos.'
        : '2. As folhas não têm margem: use o mapa abaixo para saber a ordem.',
      L.ov ? '3. A folha da direita (ou de baixo) cola por cima da anterior, até as marcas tracejadas.'
        : '3. Junte as folhas lado a lado e prenda com fita pelo verso.',
    ];
    if (L.printed.length < L.pages.length) lines.push('4. As folhas tracejadas no mapa ficaram vazias e não foram impressas.');
    lines.push('Dica: para um boneco em pé, cole as folhas num papelão e recorte o contorno.');

    const textH = 26 + lines.length * 13; // pt
    const areaW = ctx.W - 2 * mg * PT, areaH = ctx.H - 2 * mg * PT - textH - 10;
    const ratio = L.gridW / L.gridH;
    let mw = areaW, mh = areaW / ratio;
    if (mh > areaH) { mh = areaH; mw = areaH * ratio; }
    const scale = 2.5; // ~180 dpi
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(mw * scale));
    c.height = Math.max(1, Math.round(mh * scale));
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    drawScene(g, c.width, c.height, L, {
      pad: 2, line: 2, bg: '#ffffff', accent: '#5b4cf0', muted: '#9a97ab',
    });
    const jpeg = await toBlob(c, 'image/jpeg', 0.9);

    const x = mg * PT, top = ctx.H - mg * PT;
    let ops = 'q ' + f(mw) + ' 0 0 ' + f(mh) + ' ' + f(x + (areaW - mw) / 2) + ' ' + f(mg * PT) + ' cm /Im0 Do Q\n';
    ops += 'BT 0.11 0.1 0.16 rg /F1 16 Tf ' + f(x) + ' ' + f(top - 16) + ' Td ' + pdfText('Montagem do pôster') + ' Tj ET\n';
    ops += 'BT 0.25 g /F1 9 Tf 13 TL ' + f(x) + ' ' + f(top - 36) + ' Td\n';
    for (const s of lines) ops += pdfText(s) + " '\n";
    ops += 'ET\n';
    addPage(pdf, ctx, jpeg, c.width, c.height, ops.replace(" '\n", ' Tj\n')); // 1ª linha sem quebra antes
  }

  // Desenha a parte da imagem que cai na folha p.
  async function drawPage(g, c, L, p, k, onAiProgress, onStatus) {
    g.fillStyle = src.bg || '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    const X0 = (L.offX - p.x) * k, Y0 = (L.offY - p.y) * k; // canto da imagem na folha
    const q = (L.posterW * k) / src.w;                       // px da folha por px da foto
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
    const ctx = { W: L.W * PT, H: L.H * PT, kids: [] };
    ctx.font = pdf.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    ctx.pagesId = pdf.add('');
    const total = L.printed.length;

    if (el.guide.checked) {
      onProgress('Desenhando o mapa de montagem…');
      await guidePage(pdf, ctx, L);
    }

    // com IA a foto ganha 4x mais pixels, então dá para imprimir com mais dpi
    const dpi = Math.min(MAX_DPI, Math.max(MIN_DPI, L.useAi ? L.dpi * window.RancaUpscale.SCALE : L.dpi));
    const k = dpi / 25.4; // px por mm
    const c = document.createElement('canvas');
    c.width = Math.round(L.pw * k);
    c.height = Math.round(L.ph * k);
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';

    let i = 0;
    for (const p of L.printed) {
      i++;
      if (cancelled) throw new DOMException('cancelado', 'AbortError');
      onProgress('Gerando folha ' + i + ' de ' + total + '…');
      await drawPage(g, c, L, p, k, (frac) =>
        onProgress('Melhorando com IA: folha ' + i + ' de ' + total + ' (' + Math.round(((i - 1 + frac) / total) * 100) + '%)…'), onProgress);
      const jpeg = await toBlob(c, 'image/jpeg', 0.9);

      let ops = 'q ' + f(L.pw * PT) + ' 0 0 ' + f(L.ph * PT) + ' ' + f(L.m * PT) + ' ' + f(L.m * PT) + ' cm /Im0 Do Q\n';
      if (L.m >= 5) {
        ops += marks(L, p);
        const text = p.label + '    linha ' + (p.r + 1) + ', coluna ' + (p.c + 1) + '    folha ' + i + ' de ' + total;
        ops += 'BT 0.4 g /F1 7 Tf ' + f(L.m * PT) + ' ' + f(Math.max(1.5, L.m / 2 - 1) * PT) + ' Td ' + pdfText(text) + ' Tj ET\n';
      }
      addPage(pdf, ctx, jpeg, c.width, c.height, ops);
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
      const blob = await buildPdf(L, (msg) => { el.status.textContent = msg; });
      if (L !== layout) return; // configuração mudou durante a geração
      pdfFile = new File([blob], src.name + '-poster.pdf', { type: 'application/pdf' });
      el.status.textContent = 'PDF pronto (' + (blob.size / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' MB).';
      try { el.share.hidden = !(navigator.canShare && navigator.canShare({ files: [pdfFile] })); } catch { el.share.hidden = true; }
      download(pdfFile);
    } catch (err) {
      if (err?.name === 'AbortError') { el.status.textContent = 'Cancelado.'; return; }
      console.error(err);
      el.status.textContent = 'Não foi possível gerar o PDF: ' + (err?.message || err) +
        (L.useAi && !navigator.onLine ? ' (na primeira vez, a IA de ampliação precisa de internet para baixar)' : '');
    } finally {
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

  /* ---------------- Abrir / fechar ---------------- */
  // getSource() devolve a imagem atual do editor: { original, result, bg, name }.
  // result fica vazio enquanto a IA ainda está tirando o fundo.
  let getSource = null;
  let mode = 'result'; // 'result' (sem fundo) ou 'original'
  let loadToken = 0;

  // opts.onRemoveBg: chamado pelo botão "Remover o fundo" quando a foto ainda não passou pela IA
  // opts.onPick: chamado por "Escolher / Trocar imagem"
  let openOpts = {};

  // Abre a janela (ou troca a imagem, se já estiver aberta). Sem getter, abre vazia.
  async function open(getter, opts) {
    if (busy) return;
    const wasOpen = !el.modal.hidden;
    reset();
    getSource = getter;
    openOpts = opts || {};
    el.modal.hidden = false;
    document.body.classList.add('modal-open');
    setEmpty(!getter);
    if (!getter) {
      if (!wasOpen) el.emptyPick.focus();
      return;
    }
    const s = getSource();
    el.imgName.textContent = s.name || '';
    el.imgName.title = s.name || '';
    mode = s.result ? 'result' : 'original';
    syncSourceUI();
    if (!wasOpen) el.close.focus();
    await load();
  }

  // Estado sem imagem: no lugar da prévia, um convite para escolher a foto.
  function setEmpty(on) {
    el.empty.hidden = !on;
    el.canvas.hidden = on;
    el.info.hidden = on;
    el.srcBox.hidden = on;
    el.imgName.hidden = on;
    el.pick.textContent = on ? 'Escolher imagem' : 'Trocar imagem';
    if (on) {
      el.make.disabled = true;
      el.status.textContent = '';
      el.aiRow.hidden = true;   // opções que dependem da foto
      el.skipRow.hidden = true;
    }
  }

  const pick = () => { if (!busy && openOpts.onPick) openOpts.onPick(); };
  el.pick.addEventListener('click', pick);
  el.emptyPick.addEventListener('click', pick);

  // Atualiza as opções "Sem fundo / Com o fundo original" (chamado também quando a IA termina).
  function syncSourceUI() {
    if (!getSource) return;
    const s = getSource();
    el.srcResult.disabled = !s.result;
    el.srcResult.checked = mode === 'result';
    el.srcOrig.checked = mode === 'original';
    const idle = !!s.idle && !!openOpts.onRemoveBg;
    el.srcHint.textContent = s.result ? '' : idle
      ? 'Para um boneco de papelão, tire o fundo antes de imprimir.'
      : s.failed
        ? 'Não foi possível tirar o fundo desta imagem; dá para imprimir com o fundo original.'
        : 'O fundo está sendo removido. A opção "Sem fundo" libera quando terminar.';
    el.srcAction.hidden = !idle;
  }

  el.srcAction.addEventListener('click', () => {
    if (openOpts.onRemoveBg) openOpts.onRemoveBg();
    syncSourceUI();
  });

  async function load() {
    const token = ++loadToken;
    const s = getSource();
    const blob = mode === 'result' ? s.result : s.original;
    el.status.textContent = 'Preparando…';
    el.make.disabled = true;
    el.share.hidden = true;
    pdfFile = null;

    const bmp = await createImageBitmap(blob);
    // miniatura para a prévia e mapa de transparência para achar folhas vazias
    const tk = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
    const thumb = document.createElement('canvas');
    thumb.width = Math.max(1, Math.round(bmp.width * tk));
    thumb.height = Math.max(1, Math.round(bmp.height * tk));
    const tg = thumb.getContext('2d');
    tg.imageSmoothingQuality = 'high';
    tg.drawImage(bmp, 0, 0, thumb.width, thumb.height);
    let alpha = null, aw = 0, ah = 0;
    if (mode === 'result') {
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

    // fechou ou trocou de opção enquanto carregava
    if (el.modal.hidden || token !== loadToken) { bmp.close(); return; }
    if (src) src.bmp.close();
    src = {
      bmp, thumb, alpha, aw, ah, w: bmp.width, h: bmp.height,
      bg: mode === 'result' ? s.bg || '' : '',
      opaque: mode === 'original', // foto inteira: nenhuma folha fica vazia
      name: s.name || 'imagem',
    };
    el.status.textContent = '';
    update();
  }

  function setMode(m) {
    if (busy || m === mode) return;
    if (m === 'result' && !getSource()?.result) return;
    mode = m;
    syncSourceUI();
    load().catch((err) => { el.status.textContent = 'Não foi possível carregar a imagem: ' + (err?.message || err); });
  }

  // Esquece a imagem atual (mantém as configurações de papel e tamanho).
  function reset() {
    loadToken++;
    if (src) src.bmp.close();
    src = null; layout = null; pdfFile = null; getSource = null; openOpts = {};
    el.srcAction.hidden = true;
    el.share.hidden = true;
    el.status.textContent = '';
  }

  function close() {
    el.modal.hidden = true;
    document.body.classList.remove('modal-open');
    reset();
  }

  el.srcResult.addEventListener('change', () => setMode('result'));
  el.srcOrig.addEventListener('change', () => setMode('original'));
  el.close.addEventListener('click', () => { if (!busy) close(); });
  el.modal.addEventListener('click', (e) => { if (e.target === el.modal && !busy) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.modal.hidden && !busy) close(); });
  for (const k of FIELDS) el[k].addEventListener(el[k].tagName === 'SELECT' || el[k].type === 'checkbox' ? 'change' : 'input', update);
  window.addEventListener('resize', () => { if (src) renderPreview(); });

  loadPrefs();
  window.RancaPoster = { open, refresh: syncSourceUI, isOpen: () => !el.modal.hidden };
  // usado também pelos foto cards (cards.js)
  window.RancaPdf = { PdfWriter, latin1, pdfText, f, PT, toBlob, download };
})();
