// Remoção de fundo por cor sólida (sem IA).
// Descobre as cores predominantes nas bordas da imagem e faz um "flood fill"
// a partir das bordas, apagando tudo que for parecido com essas cores.
// Funciona inclusive abrindo o index.html direto (file://).
(function () {
  'use strict';

  function borderPalette(d, w, h) {
    const bins = new Map();
    let total = 0;
    const add = (x, y) => {
      const i = (y * w + x) * 4;
      if (d[i + 3] < 10) return;
      const key = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
      let b = bins.get(key);
      if (!b) bins.set(key, (b = { n: 0, r: 0, g: 0, b: 0 }));
      b.n++; b.r += d[i]; b.g += d[i + 1]; b.b += d[i + 2];
      total++;
    };
    for (let x = 0; x < w; x++) { add(x, 0); add(x, h - 1); }
    for (let y = 1; y < h - 1; y++) { add(0, y); add(w - 1, y); }

    const sorted = [...bins.values()].sort((a, b) => b.n - a.n);
    const palette = [];
    let covered = 0;
    for (const b of sorted) {
      if (palette.length && (b.n < total * 0.03 || covered > total * 0.9)) break;
      palette.push([b.r / b.n, b.g / b.n, b.b / b.n]);
      covered += b.n;
      if (palette.length >= 6) break;
    }
    return palette;
  }

  // Retorna um ImageData novo com o fundo transparente.
  function removeSolidBackground(src, tolerance) {
    const w = src.width, h = src.height;
    const d = src.data;
    const out = new ImageData(new Uint8ClampedArray(d), w, h);
    const o = out.data;
    const n = w * h;
    const palette = borderPalette(d, w, h);
    if (!palette.length) return out;

    // distância de cada pixel até a cor de fundo mais próxima
    const dist = new Float32Array(n);
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      if (d[i + 3] < 10) { dist[p] = 0; continue; }
      let best = Infinity;
      for (const c of palette) {
        const dr = d[i] - c[0], dg = d[i + 1] - c[1], db = d[i + 2] - c[2];
        const v = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
        if (v < best) best = v;
      }
      dist[p] = Math.sqrt(best * 3);
    }

    // flood fill a partir das bordas
    const bg = new Uint8Array(n);
    const queue = new Int32Array(n);
    let head = 0, tail = 0;
    const seed = (p) => { if (!bg[p] && dist[p] <= tolerance) { bg[p] = 1; queue[tail++] = p; } };
    for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
    while (head < tail) {
      const p = queue[head++];
      const x = p % w, y = (p / w) | 0;
      if (x > 0) seed(p - 1);
      if (x < w - 1) seed(p + 1);
      if (y > 0) seed(p - w);
      if (y < h - 1) seed(p + w);
    }

    // aplica alpha, com borda suave nos pixels vizinhos ao fundo
    for (let p = 0; p < n; p++) {
      const i = p * 4 + 3;
      if (bg[p]) { o[i] = 0; continue; }
      const x = p % w, y = (p / w) | 0;
      const nearBg = (x > 0 && bg[p - 1]) || (x < w - 1 && bg[p + 1]) || (y > 0 && bg[p - w]) || (y < h - 1 && bg[p + w]);
      if (nearBg && dist[p] < tolerance * 2) {
        const a = (dist[p] - tolerance) / tolerance;
        o[i] = Math.round(o[i] * Math.max(0.15, Math.min(1, a)));
      }
    }
    return out;
  }

  window.removeSolidBackground = removeSolidBackground;
})();
