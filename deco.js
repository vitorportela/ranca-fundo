// Enfeites dos foto cards e bottons (tudo offline):
// - molduras desenhadas por código, em qualquer cor, que servem no card e no círculo do botton;
// - stickers e molduras PNG da pasta enfeites/ (a lista fica em enfeites/lista.json);
// - máscaras para o contorno de recorte (engrossar uma silhueta).
//
// Forma G (mm, origem no centro do corte):
//   card:   { kind: 'card', w, h, r (canto), bl (sangria) }
//   botton: { kind: 'btn', w = h = diâmetro do corte, face (diâmetro da frente visível), bl }
// No card, a moldura fica na borda do corte. No botton, na borda da frente visível, e a cor
// continua pela parte que dobra para trás. Nos dois casos ela cobre a sangria.
(function () {
  'use strict';

  /* ---------------- Caminhos ---------------- */
  function roundRect(g, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  // contorno da área visível recuado d mm para dentro (sem beginPath)
  function inner(g, G, k, d, minR) {
    if (G.kind === 'btn') {
      g.moveTo((G.face / 2 - d) * k, 0);
      g.arc(0, 0, Math.max(0.1, G.face / 2 - d) * k, 0, Math.PI * 2);
      return;
    }
    const a = G.w / 2 - d, b = G.h / 2 - d;
    roundRect(g, -a * k, -b * k, 2 * a * k, 2 * b * k, Math.max(minR || 0, G.r - d) * k);
  }
  // borda de fora da moldura: até o fim da sangria
  function outer(g, G, k) {
    if (G.kind === 'btn') {
      const R = (G.w / 2 + G.bl) * k;
      g.moveTo(R, 0);
      g.arc(0, 0, R, 0, Math.PI * 2);
      return;
    }
    g.rect(-(G.w / 2 + G.bl) * k, -(G.h / 2 + G.bl) * k, (G.w + 2 * G.bl) * k, (G.h + 2 * G.bl) * k);
  }

  // faixa da borda até d mm para dentro
  function band(g, G, k, d, color) {
    g.beginPath();
    outer(g, G, k);
    inner(g, G, k, d, 1);
    g.fillStyle = color;
    g.fill('evenodd');
  }

  function line(g, G, k, d, width, color, dash) {
    g.beginPath();
    inner(g, G, k, d, 1.5);
    g.lineWidth = width * k;
    g.strokeStyle = color;
    g.setLineDash(dash ? dash.map((v) => v * k) : []);
    g.stroke();
    g.setLineDash([]);
  }

  // pontos igualmente espaçados no contorno recuado d mm (começa no meio do lado de cima)
  function perimeter(G, d, spacing) {
    const pts = [];
    if (G.kind === 'btn') {
      const R = G.face / 2 - d;
      const n = Math.max(6, Math.round((2 * Math.PI * R) / spacing));
      for (let j = 0; j < n; j++) {
        const t = -Math.PI / 2 + (j / n) * Math.PI * 2;
        pts.push({ x: R * Math.cos(t), y: R * Math.sin(t) });
      }
      return pts;
    }
    const a = G.w / 2 - d, b = G.h / 2 - d;
    const r = Math.min(Math.max(1.5, G.r - d), a, b);
    const lx = 2 * (a - r), ly = 2 * (b - r), q = (Math.PI * r) / 2;
    // trechos no sentido horário: reta de cima, canto, reta da direita, ...
    const segs = [
      { len: lx, at: (t) => ({ x: -a + r + t, y: -b }) },
      { len: q, at: (t) => arc(a - r, -b + r, -Math.PI / 2 + t / r) },
      { len: ly, at: (t) => ({ x: a, y: -b + r + t }) },
      { len: q, at: (t) => arc(a - r, b - r, t / r) },
      { len: lx, at: (t) => ({ x: a - r - t, y: b }) },
      { len: q, at: (t) => arc(-a + r, b - r, Math.PI / 2 + t / r) },
      { len: ly, at: (t) => ({ x: -a, y: b - r - t }) },
      { len: q, at: (t) => arc(-a + r, -b + r, Math.PI + t / r) },
    ];
    function arc(cx, cy, ang) { return { x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) }; }
    const P = segs.reduce((s, x) => s + x.len, 0);
    const n = Math.max(8, Math.round(P / spacing));
    for (let j = 0; j < n; j++) {
      let s = (lx / 2 + (j / n) * P) % P;
      for (const seg of segs) {
        if (s <= seg.len) { pts.push(seg.at(s)); break; }
        s -= seg.len;
      }
    }
    return pts;
  }

  function heart(g, x, y, s) {
    g.moveTo(x, y + 0.36 * s);
    g.bezierCurveTo(x - 0.62 * s, y - 0.06 * s, x - 0.34 * s, y - 0.56 * s, x, y - 0.2 * s);
    g.bezierCurveTo(x + 0.34 * s, y - 0.56 * s, x + 0.62 * s, y - 0.06 * s, x, y + 0.36 * s);
    g.closePath();
  }
  function star(g, x, y, s) {
    const R = s / 2, r = R * 0.45;
    for (let j = 0; j < 10; j++) {
      const t = -Math.PI / 2 + (j * Math.PI) / 5, rr = j % 2 ? r : R;
      const px = x + rr * Math.cos(t), py = y + rr * Math.sin(t);
      if (j) g.lineTo(px, py); else g.moveTo(px, py);
    }
    g.closePath();
  }
  function shapes(g, G, k, d, spacing, size, color, kind) {
    g.beginPath();
    for (const p of perimeter(G, d, spacing)) {
      const x = p.x * k, y = p.y * k, s = size * k;
      if (kind === 'heart') heart(g, x, y, s);
      else if (kind === 'star') star(g, x, y, s);
      else { g.moveTo(x + s / 2, y); g.arc(x, y, s / 2, 0, Math.PI * 2); }
    }
    g.fillStyle = color;
    g.fill();
  }

  // cor dos detalhes: branco, ou rosa quando a moldura é clara
  function detail(color) {
    const m = /^#?([0-9a-f]{6})$/i.exec(color || '');
    if (!m) return '#ffffff';
    const n = parseInt(m[1], 16);
    const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return lum > 0.72 ? '#e0558f' : '#ffffff';
  }

  /* ---------------- Molduras desenhadas ---------------- */
  const STYLES = [
    { id: 'lisa', name: 'Lisa', draw: (g, G, k, c) => band(g, G, k, 3, c) },
    { id: 'fina', name: 'Fina', draw: (g, G, k, c) => line(g, G, k, 2.6, 0.7, c) },
    {
      id: 'dupla', name: 'Dupla', draw: (g, G, k, c) => {
        band(g, G, k, 2.2, c);
        line(g, G, k, 3.6, 0.6, c);
      },
    },
    {
      id: 'polaroid', name: 'Polaroid', draw: (g, G, k, c) => {
        if (G.kind === 'btn') { band(g, G, k, 4, c); return; }
        const s = 4, bottom = 16, x = -G.w / 2 + s, y = -G.h / 2 + s;
        g.beginPath();
        outer(g, G, k);
        roundRect(g, x * k, y * k, (G.w - 2 * s) * k, (G.h - s - bottom) * k, 1 * k);
        g.fillStyle = c;
        g.fill('evenodd');
      },
    },
    {
      id: 'costura', name: 'Costura', draw: (g, G, k, c) => {
        band(g, G, k, 4.2, c);
        line(g, G, k, 2.1, 0.45, detail(c), [1.6, 1.1]);
      },
    },
    {
      id: 'bolinhas', name: 'Bolinhas', draw: (g, G, k, c) => {
        band(g, G, k, 4.6, c);
        shapes(g, G, k, 2.3, 3.4, 1.5, detail(c), 'dot');
      },
    },
    {
      id: 'coracoes', name: 'Corações', draw: (g, G, k, c) => {
        band(g, G, k, 5, c);
        shapes(g, G, k, 2.5, 4.3, 2.9, detail(c), 'heart');
      },
    },
    {
      id: 'estrelas', name: 'Estrelas', draw: (g, G, k, c) => {
        band(g, G, k, 5, c);
        shapes(g, G, k, 2.5, 4.3, 3, detail(c), 'star');
      },
    },
    {
      id: 'ondinhas', name: 'Ondinhas', draw: (g, G, k, c) => {
        band(g, G, k, 2.4, c);
        shapes(g, G, k, 2.4, 2.9, 3.2, c, 'dot'); // meias bolinhas na borda de dentro
      },
    },
  ];

  const COLORS = [
    '#ffffff', '#1c1a29', '#f6a8c8', '#e0558f', '#e63946', '#ffb703',
    '#d4af37', '#80c979', '#8ecae6', '#3a86ff', '#c8a2ff', '#5b4cf0',
  ];

  // Desenha a moldura com a origem no centro do corte.
  // frame: { style, color } (desenhada) ou { png, rec } (imagem da pasta)
  function drawFrame(g, G, k, frame, rec) {
    if (!frame) return;
    if (frame.png) {
      if (!rec) return;
      const bw = (G.w + 2 * G.bl) * k, bh = (G.h + 2 * G.bl) * k;
      const s = Math.max(bw / rec.w, bh / rec.h);
      g.drawImage(rec.bmp || rec.thumb, -rec.w * s / 2, -rec.h * s / 2, rec.w * s, rec.h * s);
      return;
    }
    const st = STYLES.find((x) => x.id === frame.style);
    if (st) st.draw(g, G, k, frame.color || '#ffffff');
  }

  /* ---------------- Máscaras ---------------- */
  // Deixa a silhueta só com 0 ou 255 de opacidade (em preto). Devolve se sobrou algo.
  function binarize(c, min) {
    const g = c.getContext('2d', { willReadFrequently: true });
    const im = g.getImageData(0, 0, c.width, c.height);
    const d = im.data;
    let any = false;
    for (let i = 0; i < d.length; i += 4) {
      const on = d[i + 3] > (min || 24);
      d[i] = d[i + 1] = d[i + 2] = 0;
      d[i + 3] = on ? 255 : 0;
      if (on) any = true;
    }
    g.putImageData(im, 0, 0);
    return any;
  }

  // Engrossa a silhueta em r px (desenhando-a deslocada em volta).
  function dilate(src, r) {
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    if (r < 0.4) return c;
    const rings = Math.max(1, Math.ceil(r / 2.5));
    for (let j = 1; j <= rings; j++) {
      const rr = (r * j) / rings;
      const n = Math.max(8, Math.ceil((2 * Math.PI * rr) / 1.6));
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        g.drawImage(src, rr * Math.cos(t), rr * Math.sin(t));
      }
    }
    return c;
  }

  /* ---------------- Pasta de enfeites ---------------- */
  let listPromise = null;
  function packs() {
    if (!listPromise) {
      listPromise = fetch('enfeites/lista.json', { cache: 'no-cache' })
        .then((r) => (r.ok ? r.json() : { stickers: [], molduras: [] }))
        .catch(() => ({ stickers: [], molduras: [] }))
        .then((j) => ({
          stickers: (j.stickers || []).map((n) => 'enfeites/stickers/' + n),
          molduras: (j.molduras || []).map((n) => 'enfeites/molduras/' + n),
        }));
    }
    return listPromise;
  }
  const niceName = (path) => decodeURIComponent(path.split('/').pop()).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');

  window.RancaDeco = { STYLES, COLORS, drawFrame, binarize, dilate, packs, niceName, roundRect };
})();
