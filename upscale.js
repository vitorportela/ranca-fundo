// Ampliação de imagens para o pôster.
// - lanczos(): filtro clássico, mais nítido que o redimensionamento do navegador (rápido, sem IA).
// - ai(): Real-ESRGAN (realesr-general-x4v3) via ONNX Runtime, recria detalhes ao ampliar 4x (lento).
(function () {
  'use strict';

  const MODEL_URL = 'vendor/upscale/realesr-general-x4.onnx';
  const DATA_PATH = new URL('vendor/imgly-data/', location.href).href;
  const SCALE = 4;
  const PAD = 8; // margem de contexto em volta de cada bloco, para não aparecer emenda

  /* ---------------- Lanczos ---------------- */
  function sinc(x) {
    if (x === 0) return 1;
    x *= Math.PI;
    return Math.sin(x) / x;
  }

  // Pesos de um eixo: para cada pixel de destino, os pixels de origem e seus pesos.
  function weights(srcLen, dstLen) {
    const a = 3, scale = srcLen / dstLen;
    const support = scale > 1 ? a * scale : a;  // ao reduzir, alarga o filtro
    const fscale = scale > 1 ? 1 / scale : 1;
    const out = new Array(dstLen);
    for (let i = 0; i < dstLen; i++) {
      const center = (i + 0.5) * scale - 0.5;
      const lo = Math.max(0, Math.ceil(center - support));
      const hi = Math.min(srcLen - 1, Math.floor(center + support));
      const idx = [], w = [];
      let sum = 0;
      for (let j = lo; j <= hi; j++) {
        const d = (j - center) * fscale;
        const v = Math.abs(d) < a ? sinc(d) * sinc(d / a) : 0;
        if (v) { idx.push(j); w.push(v); sum += v; }
      }
      for (let k = 0; k < w.length; k++) w[k] /= sum;
      out[i] = { idx, w };
    }
    return out;
  }

  // Redimensiona um canvas (opaco) com Lanczos-3. Devolve um canvas novo.
  function lanczos(src, dw, dh) {
    const sw = src.width, sh = src.height;
    const sd = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, sw, sh).data;
    const wx = weights(sw, dw), wy = weights(sh, dh);
    // passo horizontal: sw×sh → dw×sh (float, 3 canais)
    const tmp = new Float32Array(dw * sh * 3);
    for (let y = 0; y < sh; y++) {
      const row = y * sw * 4;
      for (let x = 0; x < dw; x++) {
        const { idx, w } = wx[x];
        let r = 0, g = 0, b = 0;
        for (let k = 0; k < idx.length; k++) {
          const p = row + idx[k] * 4, v = w[k];
          r += sd[p] * v; g += sd[p + 1] * v; b += sd[p + 2] * v;
        }
        const t = (y * dw + x) * 3;
        tmp[t] = r; tmp[t + 1] = g; tmp[t + 2] = b;
      }
    }
    // passo vertical: dw×sh → dw×dh
    const out = new ImageData(dw, dh);
    const od = out.data;
    for (let y = 0; y < dh; y++) {
      const { idx, w } = wy[y];
      for (let x = 0; x < dw; x++) {
        let r = 0, g = 0, b = 0;
        for (let k = 0; k < idx.length; k++) {
          const t = (idx[k] * dw + x) * 3, v = w[k];
          r += tmp[t] * v; g += tmp[t + 1] * v; b += tmp[t + 2] * v;
        }
        const o = (y * dw + x) * 4;
        od[o] = r; od[o + 1] = g; od[o + 2] = b; od[o + 3] = 255; // Uint8Clamped arredonda e limita
      }
    }
    const c = document.createElement('canvas');
    c.width = dw; c.height = dh;
    c.getContext('2d').putImageData(out, 0, 0);
    return c;
  }

  /* ---------------- IA ---------------- */
  let sessionPromise = null;
  function getSession(onStatus) {
    if (!sessionPromise) {
      sessionPromise = (async () => {
        onStatus?.('Carregando a IA de ampliação…');
        const lib = await import('./vendor/background-removal.js');
        const resp = await fetch(MODEL_URL);
        if (!resp.ok) throw new Error('modelo de ampliação não encontrado (' + resp.status + ')');
        const model = new Uint8Array(await resp.arrayBuffer());
        if ('gpu' in navigator) {
          try {
            const s = await lib.createSession(model, { publicPath: DATA_PATH, device: 'gpu' });
            if (s.gpu) return s;
          } catch (err) {
            console.warn('Ampliação por GPU indisponível, usando CPU', err);
          }
        }
        return lib.createSession(model, { publicPath: DATA_PATH, device: 'cpu' });
      })().catch((err) => { sessionPromise = null; throw err; });
    }
    return sessionPromise;
  }

  // Amplia src (canvas opaco) 4x com IA, desenhando cada bloco direto em destCtx,
  // na posição (dx, dy) e com q pixels de destino por pixel de origem.
  // Assim nunca existe a imagem inteira 4x na memória.
  async function ai(src, destCtx, dx, dy, q, opts) {
    const { session, ort, gpu } = await getSession(opts.onStatus);
    const T = gpu ? 256 : 160;
    const W = src.width, H = src.height;
    const sd = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    const tile = document.createElement('canvas');
    const tctx = tile.getContext('2d');
    const total = Math.ceil(W / T) * Math.ceil(H / T);
    let done = 0;

    for (let ty = 0; ty < H; ty += T) {
      for (let tx = 0; tx < W; tx += T) {
        if (opts.cancelled()) throw new DOMException('cancelado', 'AbortError');
        const x0 = Math.max(0, tx - PAD), y0 = Math.max(0, ty - PAD);
        const x1 = Math.min(W, tx + T + PAD), y1 = Math.min(H, ty + T + PAD);
        const w = x1 - x0, h = y1 - y0, n = w * h;
        const input = new Float32Array(3 * n);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const s = ((y0 + y) * W + x0 + x) * 4, i = y * w + x;
            input[i] = sd[s] / 255; input[n + i] = sd[s + 1] / 255; input[2 * n + i] = sd[s + 2] / 255;
          }
        }
        const res = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, h, w]) });
        const o = res[session.outputNames[0]].data;
        const OW = w * SCALE, ON = OW * h * SCALE;

        // parte útil do bloco, com 1 px a mais de cada lado para cobrir emendas ao desenhar
        const cx0 = Math.max(0, tx - 1), cy0 = Math.max(0, ty - 1);
        const cx1 = Math.min(W, tx + T + 1), cy1 = Math.min(H, ty + T + 1);
        const cw = (cx1 - cx0) * SCALE, ch = (cy1 - cy0) * SCALE;
        const img = new ImageData(cw, ch);
        const d = img.data;
        const ox = (cx0 - x0) * SCALE, oy = (cy0 - y0) * SCALE;
        for (let y = 0; y < ch; y++) {
          const row = (oy + y) * OW + ox;
          for (let x = 0; x < cw; x++) {
            const i = row + x, p = (y * cw + x) * 4;
            d[p] = o[i] * 255; d[p + 1] = o[ON + i] * 255; d[p + 2] = o[2 * ON + i] * 255; d[p + 3] = 255;
          }
        }
        tile.width = cw; tile.height = ch;
        tctx.putImageData(img, 0, 0);
        destCtx.drawImage(tile, dx + cx0 * q, dy + cy0 * q, (cx1 - cx0) * q, (cy1 - cy0) * q);

        done++;
        opts.onProgress?.(done / total);
        await new Promise((r) => setTimeout(r, 0)); // deixa a tela respirar
      }
    }
  }

  window.RancaUpscale = { lanczos, ai, SCALE };
})();
