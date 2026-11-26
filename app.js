(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const el = {
    home: $('home'), editor: $('editor'), dropzone: $('dropzone'),
    fileInput: $('fileInput'), pickBtn: $('pickBtn'),
    stage: $('stage'), imgResult: $('imgResult'), imgOriginal: $('imgOriginal'),
    compare: $('compare'), busyText: $('busyText'), busyBar: $('busyBar'),
    model: $('model'), gpu: $('gpu'), gpuRow: $('gpuRow'),
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
  el.posterBtn = $('posterBtn');
  el.posterHomeBtn = $('posterHomeBtn');
  el.posterInput = $('posterInput');
  el.cardHomeBtn = $('cardHomeBtn');
  el.cardBtn = $('cardBtn');
  el.stickerBtn = $('stickerBtn');
  el.edge = $('edge');
  el.edgeOut = $('edgeOut');
  el.retouchBtn = $('retouchBtn');
  el.retouchInfo = $('retouchInfo');

  const state = {
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
      if (p.edge != null) el.edge.value = p.edge;
    } catch { /* sem armazenamento: usa padrões */ }
  }
  function savePrefs() {
    try {
      localStorage.setItem('rancaFundoPrefs', JSON.stringify({
        model: el.model.value, edge: el.edge.value,
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
  function makeItem(file) {
    return {
      id: nextId++, file,
      name: file.name || 'imagem-colada.png',
      origUrl: URL.createObjectURL(file),
      w: 0, h: 0, resultBlob: null, resultUrl: '', status: 'pending',
    };
  }

  function addFiles(fileList) {
    const files = [...fileList].filter((f) => f.type.startsWith('image/'));
    if (!files.length) { notify('Envie um arquivo de imagem (PNG, JPG, WEBP…).', true); return; }
    let first = null;
    for (const file of files) {
      const item = makeItem(file);
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
    if (!e.dataTransfer?.files?.length) return;
    if (modalTakesFiles(e.dataTransfer.files)) return;
    addFiles(e.dataTransfer.files);
  });
  window.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (!files.length || modalTakesFiles(files)) return;
    addFiles(files);
  });

  // Com o pôster ou os foto cards abertos, a imagem arrastada/colada vai para a janela.
  function modalTakesFiles(files) {
    if (window.RancaRetouch.isOpen()) return true; // no retoque, ignora
    if (window.RancaNav.top() === 'projects') return true; // em Meus projetos, também
    if (window.RancaCards.isOpen()) { window.RancaCards.addFiles(files); return true; }
    if (!window.RancaPoster.isOpen()) return false;
    const img = [...files].find((f) => f.type.startsWith('image/'));
    if (img) loadPosterFile(img);
    else notify('Envie um arquivo de imagem (PNG, JPG, WEBP…).', true);
    return true;
  }

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
      aiJob = { name: item.name, left: state.queue.length };
      window.RancaProgress.set('ai', 0, aiLabel('Preparando…'));
      if (item === state.current) renderStage();
      try {
        const blob = await processAI(item);
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
        aiAttempt++;
        item.status = 'error';
        if (item === state.current) renderStage();
        const msg = String(err?.message || err);
        notify(/fetch|network|rede/i.test(msg)
          ? 'Não consegui baixar o modelo de IA. No computador, abra o iniciar.bat (a janela preta precisa ficar aberta); no celular, confira a internet. Depois toque na miniatura da imagem (embaixo) para tentar de novo.'
          : 'Não foi possível processar "' + item.name + '": ' + msg, true, 12000);
      }
      renderHistory();
    }
    state.running = false;
    aiJob = null;
    window.RancaProgress.done('ai');
  }

  // texto da barra de andamento: qual foto e quantas faltam na fila
  let aiJob = null;
  function aiLabel(step) {
    if (!aiJob) return step;
    return 'Tirando o fundo de "' + aiJob.name + '"' + (aiJob.left ? ' (+' + aiJob.left + ' na fila)' : '') + ' · ' + step;
  }

  /* ---------------- Borda ---------------- */
  // Gera resultBlob a partir do recorte bruto (rawBlob) com a suavidade escolhida.
  // strict = descarta o resultado se o slider mudou enquanto calculava.
  // Depois da borda entram os retoques do lápis (item.edits), se houver.
  async function applyEdges(item, strict) {
    const v = +el.edge.value;
    if (item.edgeValue === v) return;
    const edits = item.edits;
    let blob = item.rawBlob;
    if (v || edits) {
      const { ctx, w, h } = await decodeRaw(item);
      const img = ctx.getImageData(0, 0, w, h);
      if (v) window.adjustEdges(img, v);
      if (edits && edits.length === w * h) {
        window.RancaRetouch.apply(img.data, (await origPixels(item, w, h)).data, edits);
      }
      ctx.putImageData(img, 0, 0);
      blob = await new Promise((r) => ctx.canvas.toBlob(r, 'image/png'));
    }
    if (strict && +el.edge.value !== v) return;
    if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
    item.resultBlob = blob;
    item.resultUrl = URL.createObjectURL(blob);
    item.edgeValue = v;
  }

  // Recorte da IA num canvas (sem borda nem retoque).
  async function decodeRaw(item) {
    const bmp = await createImageBitmap(item.rawBlob);
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    return { ctx, w: c.width, h: c.height };
  }

  // Pixels da foto original no tamanho do recorte (para trazer de volta o que a IA tirou).
  async function origPixels(item, w, h) {
    const bmp = await createImageBitmap(item.input || item.file);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    return ctx.getImageData(0, 0, w, h);
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

  // A biblioteca guarda (memoize) o carregamento do modelo pela config, inclusive quando falha.
  // Mudar "tentativa" depois de um erro força baixar de novo em vez de repetir o erro guardado.
  let aiAttempt = 0;
  function aiConfig(device) {
    return {
      tentativa: aiAttempt,
      publicPath: DATA_PATH,
      model: el.model.value,
      device,
      output: { format: 'image/png' },
      progress: onProgress,
    };
  }

  function onProgress(key, current, total) {
    const pct = total ? Math.round((current / total) * 100) : 0;
    // barra de baixo: baixar o modelo vai até 50%, depois a IA trabalha
    if (aiJob) {
      if (key.startsWith('fetch:')) {
        window.RancaProgress.set('ai', pct / 200, aiLabel(key.includes('/models/') ? 'baixando o modelo de IA ' + pct + '%' : 'preparando a IA'));
      } else if (key === 'compute:inference') {
        window.RancaProgress.set('ai', 0.6, aiLabel('removendo o fundo…'));
      } else if (key === 'compute:encode') {
        window.RancaProgress.set('ai', 0.9, aiLabel('finalizando…'));
      }
    }
    if (!state.current || state.current.status !== 'processing') return;
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

  /* ---------------- Tela ---------------- */
  function showEditor() {
    closeSplash(); // se ela colar/arrastar uma imagem com a abertura na tela
    el.home.hidden = true;
    el.editor.hidden = false;
  }

  function select(item) {
    if (item === state.current && item.status === 'error') { enqueue(item); return; } // tenta de novo
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

    el.retouchBtn.disabled = item.status !== 'done';
    el.retouchInfo.textContent = item.edits ? 'Esta imagem tem retoques.' : '';
    el.downloadBtn.disabled = item.status !== 'done';
    el.stickerBtn.disabled = item.status !== 'done';
    el.shareBtn.disabled = item.status !== 'done';
    el.posterBtn.disabled = false; // dá para fazer pôster da foto original antes de tirar o fundo
    el.cardBtn.disabled = false;
    window.RancaPoster.refresh();
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
  function reprocessCurrent() {
    savePrefs();
    if (state.current) enqueue(state.current);
  }
  el.model.addEventListener('change', reprocessCurrent);
  el.gpu.addEventListener('change', reprocessCurrent);

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

  /* ---------------- Retoque com lápis ---------------- */
  el.retouchBtn.addEventListener('click', async () => {
    const item = state.current;
    if (!item || item.status !== 'done' || el.retouchBtn.dataset.busy) return;
    el.retouchBtn.dataset.busy = '1';
    let opts;
    try {
      // a prévia do retoque usa a borda escolhida, igual ao resultado final
      const { ctx, w, h } = await decodeRaw(item);
      const img = ctx.getImageData(0, 0, w, h);
      const v = +el.edge.value;
      if (v) window.adjustEdges(img, v);
      const base = new Uint8Array(w * h);
      for (let p = 0; p < base.length; p++) base[p] = img.data[p * 4 + 3];
      const orig = await origPixels(item, w, h);
      opts = { w, h, orig, base, edits: item.edits && item.edits.length === w * h ? item.edits : null };
    } catch (err) {
      notify('Não foi possível abrir o retoque: ' + (err?.message || err), true);
      return;
    } finally {
      delete el.retouchBtn.dataset.busy;
    }
    const edits = await window.RancaRetouch.open(opts);
    if (edits === undefined) return; // cancelou
    item.edits = edits;
    item.edgeValue = null; // força refazer o resultado
    if (item === state.current) refreshEdges();
    else applyEdges(item, false).then(renderHistory).catch(console.error);
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

  /* ---------------- Pôster ---------------- */
  // item.status 'idle' = foto aberta pelo atalho "Criar pôster", ainda sem passar pela IA
  // project: projeto de "Meus projetos" que está sendo reaberto
  function openPoster(item, project) {
    if (!item) {
      window.RancaPoster.open(null, { onPick: pickPosterFile });
      return;
    }
    window.RancaPoster.open(() => ({
      original: item.input || item.file, // item.input = versão reduzida, se a foto for enorme
      result: item.status === 'done' ? item.resultBlob : null,
      failed: item.status === 'error',
      idle: item.status === 'idle',
      bg: item.savedBg != null ? item.savedBg : state.bgColor,
      name: item.savedName || item.name.replace(/\.[^.]+$/, ''),
    }), {
      key: 'item' + item.id, project,
      onPick: pickPosterFile,
      // "Remover o fundo" dentro do pôster: manda a foto para o editor (fica atrás da janela)
      onRemoveBg: !AI_AVAILABLE ? null : () => {
        if (item.status !== 'idle') return;
        state.items.push(item);
        showEditor();
        state.current = item;
        enqueue(item);
        renderStage();
      },
    }).catch((err) => notify('Não foi possível abrir o pôster: ' + (err?.message || err), true));
  }

  el.posterBtn.addEventListener('click', () => { if (state.current) openPoster(state.current); });

  // Atalho da tela inicial: abre o pôster vazio; a foto é escolhida (e trocada) dentro da janela
  function pickPosterFile() { el.posterInput.click(); }

  el.posterHomeBtn.addEventListener('click', () => openPoster(null));
  $('projHomeBtn').addEventListener('click', () => window.RancaProjects.open());

  // Reabre um pôster de "Meus projetos" (sem projeto: abre o pôster vazio).
  async function openPosterProject(rec) {
    if (!rec) { openPoster(null); return; }
    let b = {};
    try { b = await window.RancaProjects.posters.blobs(rec.id); } catch (err) { console.warn(err); }
    if (!b.original) { notify('Não foi possível abrir este pôster: a foto não está mais guardada no aparelho.', true); return; }
    const file = new File([b.original], (rec.name || 'imagem') + '.png', { type: b.original.type || 'image/png' });
    const item = makeItem(file);
    item.input = file; // a foto guardada já é a versão reduzida
    item.savedName = rec.name;
    item.savedBg = rec.bg || '';
    if (b.result) { item.status = 'done'; item.resultBlob = b.result; } else item.status = 'idle';
    openPoster(item, rec);
  }
  window.RancaApp = { openPosterProject };
  el.posterInput.addEventListener('change', () => {
    const file = el.posterInput.files[0];
    el.posterInput.value = '';
    if (file) loadPosterFile(file);
  });

  // Carrega uma foto direto no pôster (sem tirar o fundo); troca a imagem se a janela já estiver aberta.
  async function loadPosterFile(file) {
    if (!file.type.startsWith('image/')) { notify('Envie um arquivo de imagem (PNG, JPG, WEBP…).', true); return; }
    const item = makeItem(file);
    item.status = 'idle';
    try {
      await prepareInput(item); // reduz fotos enormes para não travar o aparelho
    } catch (err) {
      notify('Não foi possível abrir a imagem: ' + (err?.message || err), true);
      return;
    }
    openPoster(item);
  }

  /* ---------------- Foto cards ---------------- */
  el.cardHomeBtn.addEventListener('click', () => window.RancaCards.open());
  // Leva a imagem do editor: sem fundo (com a cor escolhida) ou a original, se a IA ainda não terminou.
  el.cardBtn.addEventListener('click', async () => {
    const item = state.current;
    if (!item) return;
    const done = item.status === 'done';
    const blob = done ? await exportBlob(item) : item.input || item.file;
    const name = done ? item.name.replace(/\.[^.]+$/, '') + '-sem-fundo.png' : item.name;
    window.RancaCards.open();
    window.RancaCards.addFiles([new File([blob], name, { type: blob.type || 'image/png' })]);
  });

  // A imagem sem fundo (sempre transparente) vira sticker dos foto cards e bottons.
  el.stickerBtn.addEventListener('click', () => {
    const item = state.current;
    if (!item || item.status !== 'done') return;
    const name = item.name.replace(/\.[^.]+$/, '') + '-sticker.png';
    window.RancaCards.addSticker(new File([item.resultBlob], name, { type: 'image/png' }));
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
  updateEdgeLabel();
  el.gpuRow.hidden = !('gpu' in navigator) || !AI_AVAILABLE;

  if ('serviceWorker' in navigator && window.isSecureContext && AI_AVAILABLE) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW não registrado', e));
    navigator.storage?.persist?.().catch(() => {});
  }

  if (!AI_AVAILABLE) {
    notify('Aberto como arquivo, a IA não consegue carregar. Abra o site pelo iniciar.bat ou pelo link publicado.', true, 15000);
    el.pickBtn.disabled = true;
  } else {
    // pré-carrega a biblioteca em segundo plano para o primeiro uso ser mais rápido
    loadLib().catch(() => {});
  }
})();
