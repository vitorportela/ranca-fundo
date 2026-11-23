(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const el = {
    home: $('home'), editor: $('editor'), dropzone: $('dropzone'),
    fileInput: $('fileInput'), pickBtn: $('pickBtn'),
    stage: $('stage'), imgResult: $('imgResult'), imgOriginal: $('imgOriginal'),
    compare: $('compare'), busyText: $('busyText'), busyBar: $('busyBar'),
    modeSeg: $('modeSeg'), aiOptions: $('aiOptions'), solidOptions: $('solidOptions'),
    model: $('model'), gpu: $('gpu'), gpuRow: $('gpuRow'),
    tolerance: $('tolerance'), tolOut: $('tolOut'),
    swatches: $('swatches'), customColor: $('customColor'),
    downloadBtn: $('downloadBtn'), newBtn: $('newBtn'), sizeInfo: $('sizeInfo'),
    history: $('history'), notice: $('notice'),
  };

  const AI_AVAILABLE = location.protocol === 'http:' || location.protocol === 'https:';
  const DATA_PATH = new URL('vendor/imgly-data/', location.href).href;
  const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // limite de pixels para não estourar a memória do aparelho
  const MAX_PIXELS = IS_MOBILE ? 12e6 : 36e6;
  el.shareBtn = $('shareBtn');
  el.edge = $('edge');
  el.edgeOut = $('edgeOut');

  const state = {
    mode: AI_AVAILABLE ? 'ai' : 'solid',
    bgColor: '',
    items: [],
    current: null,
    queue: [],
    running: false,
  };
  let nextId = 1;

  /* ---------------- Preferências ---------------- */
  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem('rancaFundoPrefs') || '{}');
      if (IS_MOBILE) el.model.value = 'isnet_quint8'; // modelo leve por padrão no celular
      if (p.model) el.model.value = p.model;
      if (p.mode && (p.mode === 'solid' || AI_AVAILABLE)) state.mode = p.mode;
      if (p.tolerance) el.tolerance.value = p.tolerance;
      if (p.edge != null) el.edge.value = p.edge;
    } catch { /* sem armazenamento: usa padrões */ }
  }
  function savePrefs() {
    try {
      localStorage.setItem('rancaFundoPrefs', JSON.stringify({
        model: el.model.value, mode: state.mode, tolerance: el.tolerance.value, edge: el.edge.value,
      }));
    } catch { /* ignorado */ }
  }

  /* ---------------- Avisos ---------------- */
  let noticeTimer;
  function notify(msg, isError, ms) {
    el.notice.textContent = msg;
    el.notice.classList.toggle('error', !!isError);
    el.notice.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { el.notice.hidden = true; }, ms || 5000);
  }

  /* ---------------- Entrada de arquivos ---------------- */
  function addFiles(fileList) {
    const files = [...fileList].filter((f) => f.type.startsWith('image/'));
    if (!files.length) { notify('Envie um arquivo de imagem (PNG, JPG, WEBP…).', true); return; }
    let first = null;
    for (const file of files) {
      const item = {
        id: nextId++, file,
        name: file.name || 'imagem-colada.png',
        origUrl: URL.createObjectURL(file),
        w: 0, h: 0, resultBlob: null, resultUrl: '', status: 'pending',
      };
      state.items.push(item);
      first = first || item;
      enqueue(item);
    }
    showEditor();
    select(first);
  }

  el.pickBtn.addEventListener('click', () => el.fileInput.click());
  el.dropzone.addEventListener('click', (e) => { if (e.target === el.dropzone || e.target.closest('.upload-inner') && e.target.tagName !== 'BUTTON') el.fileInput.click(); });
  el.fileInput.addEventListener('change', () => { addFiles(el.fileInput.files); el.fileInput.value = ''; });

  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
    e.preventDefault(); dragDepth++; document.body.classList.add('dragging');
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) document.body.classList.remove('dragging');
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  });
  window.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) addFiles(files);
  });

  /* ---------------- Fila de processamento ---------------- */
  function enqueue(item) {
    item.status = 'pending';
    if (!state.queue.includes(item)) state.queue.push(item);
    renderHistory();
    if (item === state.current) renderStage();
    runQueue();
  }

  async function runQueue() {
    if (state.running) return;
    state.running = true;
    while (state.queue.length) {
      const item = state.queue.shift();
      item.status = 'processing';
      if (item === state.current) renderStage();
      try {
        const blob = state.mode === 'ai' ? await processAI(item) : await processSolid(item);
        if (item.status !== 'processing') continue; // reenfileirado enquanto processava
        item.rawBlob = blob;
        item.edgeValue = null;
        await applyEdges(item, false);
        if (item.status !== 'processing') continue;
        item.status = 'done';
        if (item === state.current) {
          renderStage(); revealAnimation();
          if (item.edgeValue !== +el.edge.value) refreshEdges();
        }
      } catch (err) {
        console.error(err);
        item.status = 'error';
        if (item === state.current) renderStage();
        notify('Não foi possível processar "' + item.name + '": ' + (err?.message || err), true, 8000);
      }
      renderHistory();
    }
    state.running = false;
  }

  /* ---------------- Borda ---------------- */
  // Gera resultBlob a partir do recorte bruto (rawBlob) com a suavidade escolhida.
  // strict = descarta o resultado se o slider mudou enquanto calculava.
  async function applyEdges(item, strict) {
    const v = +el.edge.value;
    if (item.edgeValue === v) return;
    let blob = item.rawBlob;
    if (v) {
      const bmp = await createImageBitmap(item.rawBlob);
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      const img = ctx.getImageData(0, 0, c.width, c.height);
      ctx.putImageData(window.adjustEdges(img, v), 0, 0);
      blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    }
    if (strict && +el.edge.value !== v) return;
    if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
    item.resultBlob = blob;
    item.resultUrl = URL.createObjectURL(blob);
    item.edgeValue = v;
  }

  async function refreshEdges() {
    const item = state.current;
    if (!item || item.status !== 'done') return;
    try {
      await applyEdges(item, true);
    } catch (err) {
      console.error(err);
      notify('Não foi possível ajustar a borda: ' + (err?.message || err), true);
      return;
    }
    if (item === state.current) renderStage();
    renderHistory();
  }

  function updateEdgeLabel() {
    const v = +el.edge.value;
    el.edgeOut.textContent = v === 0 ? 'Original' : v < 0 ? 'Nítida ' + -v : 'Suave ' + v;
  }

  let edgeTimer;
  el.edge.addEventListener('input', () => {
    updateEdgeLabel();
    clearTimeout(edgeTimer);
    edgeTimer = setTimeout(() => { savePrefs(); refreshEdges(); }, 120);
  });
  el.edge.addEventListener('dblclick', () => {
    el.edge.value = 0;
    el.edge.dispatchEvent(new Event('input'));
  });

  /* ---------------- IA ---------------- */
  let libPromise = null;
  function loadLib() {
    if (!libPromise) {
      libPromise = import('./vendor/background-removal.js').catch((e) => { libPromise = null; throw e; });
    }
    return libPromise;
  }

  function aiConfig(device) {
    return {
      publicPath: DATA_PATH,
      model: el.model.value,
      device,
      output: { format: 'image/png' },
      progress: onProgress,
    };
  }

  function onProgress(key, current, total) {
    if (!state.current || state.current.status !== 'processing') return;
    const pct = total ? Math.round((current / total) * 100) : 0;
    if (key.startsWith('fetch:')) {
      setBusy(key.includes('/models/') ? 'Carregando modelo de IA… ' + pct + '%' : 'Preparando IA… ' + pct + '%', pct);
    } else if (key === 'compute:inference') {
      setBusy('Removendo o fundo…', 60);
    } else if (key === 'compute:encode') {
      setBusy('Finalizando…', 90);
    }
  }

  async function processAI(item) {
    const input = await prepareInput(item);
    setBusy('Carregando IA…', 5);
    const lib = await loadLib();
    const wantGpu = el.gpu.checked && 'gpu' in navigator;
    let blob;
    try {
      blob = await lib.removeBackground(input, aiConfig(wantGpu ? 'gpu' : 'cpu'));
    } catch (err) {
      if (!wantGpu) throw err;
      console.warn('GPU falhou, usando CPU', err);
      el.gpu.checked = false;
      notify('A GPU não funcionou neste navegador. Usando CPU.');
      blob = await lib.removeBackground(input, aiConfig('cpu'));
    }
    announceOfflineReady();
    return blob;
  }

  function announceOfflineReady() {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return;
    try {
      if (localStorage.getItem('rancaFundoOffline')) return;
      localStorage.setItem('rancaFundoOffline', '1');
    } catch { return; }
    notify('Pronto! O modelo ficou salvo no aparelho: agora funciona até sem internet.', false, 7000);
  }

  /* ---------------- Preparação da imagem ---------------- */
  // Decodifica e, se a foto for grande demais para o aparelho, reduz o tamanho.
  async function prepareInput(item) {
    if (item.input) return item.input;
    const bmp = await createImageBitmap(item.file);
    let w = bmp.width, h = bmp.height;
    if (w * h <= MAX_PIXELS) {
      bmp.close();
      item.w = w; item.h = h; item.input = item.file;
      return item.input;
    }
    const k = Math.sqrt(MAX_PIXELS / (w * h));
    w = Math.round(w * k); h = Math.round(h * k);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const type = /png|webp|gif/.test(item.file.type) ? 'image/png' : 'image/jpeg';
    item.input = await new Promise((r) => c.toBlob(r, type, 0.95));
    item.w = w; item.h = h;
    return item.input;
  }

  /* ---------------- Cor sólida ---------------- */
  async function decode(item) {
    const bmp = await createImageBitmap(await prepareInput(item));
    item.w = bmp.width; item.h = bmp.height;
    return bmp;
  }

  async function processSolid(item) {
    setBusy('Removendo o fundo…', 50);
    await new Promise((r) => setTimeout(r, 30)); // deixa a tela atualizar
    const bmp = await decode(item);
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width; canvas.height = bmp.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const src = ctx.getImageData(0, 0, canvas.width, canvas.height);
    ctx.putImageData(window.removeSolidBackground(src, +el.tolerance.value), 0, 0);
    return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('falha ao gerar PNG'))), 'image/png'));
  }

  /* ---------------- Tela ---------------- */
  function showEditor() {
    closeSplash(); // se ela colar/arrastar uma imagem com a abertura na tela
    el.home.hidden = true;
    el.editor.hidden = false;
  }

  function select(item) {
    state.current = item;
    renderStage();
    renderHistory();
    if (item.status === 'done') {
      setPos(0);
      if (item.edgeValue !== +el.edge.value) refreshEdges();
    }
  }

  function setBusy(text, pct) {
    el.busyText.textContent = text;
    el.busyBar.style.width = (pct || 0) + '%';
  }

  function setPos(p) {
    el.compare.value = p;
    el.stage.style.setProperty('--pos', p + '%');
  }

  function sizeStage(item) {
    if (!item.w) return;
    const r = item.w / item.h;
    el.stage.style.aspectRatio = item.w + ' / ' + item.h;
    el.stage.style.width = 'min(100%, calc(70vh * ' + r.toFixed(4) + '))';
  }

  function renderStage() {
    const item = state.current;
    if (!item) return;
    if (el.imgOriginal.getAttribute('src') !== item.origUrl) el.imgOriginal.src = item.origUrl;
    if (!item.w) {
      el.imgOriginal.onload = () => {
        if (item.w) return;
        item.w = el.imgOriginal.naturalWidth; item.h = el.imgOriginal.naturalHeight;
        if (item === state.current) renderStage();
      };
    }
    sizeStage(item);

    const busy = item.status === 'pending' || item.status === 'processing';
    el.stage.classList.toggle('busy-on', busy);
    if (busy) {
      setPos(100);
      if (item.status === 'pending') setBusy(state.queue.length > 1 ? 'Na fila…' : 'Preparando…', 0);
    }

    if (item.resultUrl) {
      if (el.imgResult.getAttribute('src') !== item.resultUrl) el.imgResult.src = item.resultUrl;
      el.imgResult.hidden = false;
    } else {
      el.imgResult.removeAttribute('src');
      el.imgResult.hidden = true;
    }
    if (item.status === 'error') setPos(100);

    el.downloadBtn.disabled = item.status !== 'done';
    el.shareBtn.disabled = item.status !== 'done';
    el.sizeInfo.textContent = item.w ? item.w + ' × ' + item.h + ' px' : '';
  }

  let revealRaf;
  function revealAnimation() {
    cancelAnimationFrame(revealRaf);
    const start = performance.now();
    const dur = 900;
    const step = (t) => {
      const k = Math.min(1, (t - start) / dur);
      const ease = 1 - Math.pow(1 - k, 3);
      setPos(100 - ease * 100);
      if (k < 1) revealRaf = requestAnimationFrame(step);
    };
    revealRaf = requestAnimationFrame(step);
  }

  el.compare.addEventListener('input', () => {
    cancelAnimationFrame(revealRaf);
    setPos(+el.compare.value);
  });

  function renderHistory() {
    el.history.textContent = '';
    for (const item of state.items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'thumb' + (item === state.current ? ' active' : '') + (item.status !== 'done' ? ' pending' : '');
      b.title = item.name;
      const img = document.createElement('img');
      img.src = item.resultUrl || item.origUrl;
      img.alt = '';
      b.appendChild(img);
      b.addEventListener('click', () => select(item));
      el.history.appendChild(b);
    }
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'thumb thumb-add';
    add.title = 'Adicionar imagem';
    add.textContent = '+';
    add.addEventListener('click', () => el.fileInput.click());
    el.history.appendChild(add);
  }

  /* ---------------- Opções ---------------- */
  function applyMode() {
    for (const b of el.modeSeg.querySelectorAll('button')) {
      b.classList.toggle('active', b.dataset.mode === state.mode);
      if (b.dataset.mode === 'ai' && !AI_AVAILABLE) {
        b.disabled = true;
        b.title = 'Abra o site pelo iniciar.bat para usar a IA';
      }
    }
    el.aiOptions.hidden = state.mode !== 'ai';
    el.solidOptions.hidden = state.mode !== 'solid';
  }

  function reprocessCurrent() {
    savePrefs();
    if (state.current) enqueue(state.current);
  }

  el.modeSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b || b.disabled || b.dataset.mode === state.mode) return;
    state.mode = b.dataset.mode;
    applyMode();
    reprocessCurrent();
  });
  el.model.addEventListener('change', reprocessCurrent);
  el.gpu.addEventListener('change', reprocessCurrent);

  let tolTimer;
  el.tolerance.addEventListener('input', () => {
    el.tolOut.textContent = el.tolerance.value;
    clearTimeout(tolTimer);
    tolTimer = setTimeout(reprocessCurrent, 250);
  });

  function setBg(color, btn) {
    state.bgColor = color;
    for (const s of el.swatches.querySelectorAll('.sw')) s.classList.toggle('active', s === btn);
    el.stage.classList.toggle('solid-bg', !!color);
    el.stage.style.backgroundColor = color || '';
  }
  el.swatches.addEventListener('click', (e) => {
    const b = e.target.closest('button.sw');
    if (b) setBg(b.dataset.color, b);
  });
  el.customColor.addEventListener('input', () => {
    const lbl = el.customColor.closest('.sw');
    lbl.style.background = el.customColor.value;
    setBg(el.customColor.value, lbl);
  });

  /* ---------------- Download ---------------- */
  async function exportBlob(item) {
    if (!state.bgColor) return item.resultBlob;
    const bmp = await createImageBitmap(item.resultBlob);
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d');
    ctx.fillStyle = state.bgColor;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    return new Promise((r) => c.toBlob(r, 'image/png'));
  }

  el.downloadBtn.addEventListener('click', async () => {
    const item = state.current;
    if (!item || item.status !== 'done') return;
    const blob = await exportBlob(item);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.name.replace(/\.[^.]+$/, '') + '-sem-fundo.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });

  // No celular, "Compartilhar" permite salvar direto na galeria ou mandar pelo WhatsApp
  const canShareFiles = (() => {
    try { return !!navigator.canShare && navigator.canShare({ files: [new File([''], 'a.png', { type: 'image/png' })] }); }
    catch { return false; }
  })();
  el.shareBtn.hidden = !canShareFiles;
  el.shareBtn.addEventListener('click', async () => {
    const item = state.current;
    if (!item || item.status !== 'done') return;
    const blob = await exportBlob(item);
    const file = new File([blob], item.name.replace(/\.[^.]+$/, '') + '-sem-fundo.png', { type: 'image/png' });
    try {
      await navigator.share({ files: [file], title: 'Imagem sem fundo' });
    } catch (err) {
      if (err?.name !== 'AbortError') notify('Não foi possível compartilhar: ' + err.message, true);
    }
  });

  el.newBtn.addEventListener('click', () => el.fileInput.click());

  /* ---------------- Tela de abertura ---------------- */
  const splash = $('splash');
  function closeSplash() {
    if (!splash || splash.hidden || splash.classList.contains('closing')) return;
    splash.classList.add('closing');
    document.body.classList.remove('splash-open');
    setTimeout(() => { splash.hidden = true; }, 500);
  }
  $('splashBtn').addEventListener('click', closeSplash);
  document.addEventListener('keydown', (e) => {
    if (!splash.hidden && (e.key === 'Enter' || e.key === 'Escape')) closeSplash();
  });

  /* ---------------- Instalar como app ---------------- */
  // O Chrome avisa (beforeinstallprompt) quando o site pode ser instalado;
  // guardamos o evento e mostramos nossos botões "Instalar app".
  const installBtns = document.querySelectorAll('.install-btn');
  let installPrompt = null;
  const showInstall = (on) => installBtns.forEach((b) => { b.hidden = !on; });
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    showInstall(true);
  });
  installBtns.forEach((b) => b.addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') { installPrompt = null; showInstall(false); }
  }));
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    showInstall(false);
    notify('App instalado! Procure o ícone Ranca Fundo na tela inicial.', false, 7000);
  });

  /* ---------------- Início ---------------- */
  loadPrefs();
  el.tolOut.textContent = el.tolerance.value;
  updateEdgeLabel();
  el.gpuRow.hidden = !('gpu' in navigator) || !AI_AVAILABLE;
  applyMode();

  if ('serviceWorker' in navigator && window.isSecureContext && AI_AVAILABLE) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW não registrado', e));
    navigator.storage?.persist?.().catch(() => {});
  }

  if (!AI_AVAILABLE) {
    notify('Aberto como arquivo: só o método "Cor sólida" funciona. Para usar a IA, abra o site pelo iniciar.bat.', false, 12000);
  } else {
    // pré-carrega a biblioteca em segundo plano para o primeiro uso ser mais rápido
    loadLib().catch(() => {});
  }
})();
