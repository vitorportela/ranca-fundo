// Ajuste da borda do recorte (canal alpha).
// value < 0: borda mais nítida (aumenta o contraste da transparência)
// value = 0: como saiu do recorte
// value > 0: borda mais suave (desfoque para dentro, sem "auréola" da cor do fundo antigo)
(function () {
  'use strict';

  function blurH(src, dst, w, h, r) {
    const d = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += src[row + Math.min(w - 1, Math.max(0, i))];
      for (let x = 0; x < w; x++) {
        dst[row + x] = sum / d;
        sum += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
      }
    }
  }

  function blurV(src, dst, w, h, r) {
    const d = 2 * r + 1;
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += src[Math.min(h - 1, Math.max(0, i)) * w + x];
      for (let y = 0; y < h; y++) {
        dst[y * w + x] = sum / d;
        sum += src[Math.min(h - 1, y + r + 1) * w + x] - src[Math.max(0, y - r) * w + x];
      }
    }
  }

  function adjustEdges(img, value) {
    const { width: w, height: h, data } = img;
    const n = w * h;
    if (!value) return img;

    if (value < 0) {
      const k = 1 + -value * 0.45;
      for (let i = 3; i < data.length; i += 4) {
        const a = (data[i] - 128) * k + 128;
        data[i] = a < 0 ? 0 : a > 255 ? 255 : a;
      }
      return img;
    }

    // raio proporcional ao tamanho da imagem, para o efeito parecer igual em qualquer resolução
    const radius = Math.max(1, Math.round(value * Math.max(w, h) / 1200));
    const pass = Math.max(1, Math.round(radius / 1.7));
    const a = new Float32Array(n);
    const b = new Float32Array(n);
    for (let p = 0; p < n; p++) a[p] = data[p * 4 + 3];
    // 3 passadas de box blur ~ desfoque gaussiano
    for (let i = 0; i < 3; i++) { blurH(a, b, w, h, pass); blurV(b, a, w, h, pass); }
    for (let p = 0; p < n; p++) {
      const i = p * 4 + 3;
      if (a[p] < data[i]) data[i] = a[p];
    }
    return img;
  }

  window.adjustEdges = adjustEdges;
})();
