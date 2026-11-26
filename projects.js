// "Meus projetos": pôsteres e folhas de foto cards/bottons guardados no aparelho, para reabrir depois.
// Os pôsteres ficam aqui (IndexedDB "rancaFundoProjetos"); os foto cards guardam os deles em cards.js.
(function () {
  'use strict';

  /* ---------------- Banco dos pôsteres ---------------- */
  let dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise((res, rej) => {
        const q = indexedDB.open('rancaFundoProjetos', 1);
        q.onupgradeneeded = () => {
          q.result.createObjectStore('posters', { keyPath: 'id' });
          q.result.createObjectStore('blobs');
        };
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
  const posters = {
    list: async () => ((await tx('posters', 'readonly', (s) => s.getAll())) || []).sort((a, b) => b.updated - a.updated),
    get: (id) => tx('posters', 'readonly', (s) => s.get(id)),
    put: (rec) => tx('posters', 'readwrite', (s) => s.put(rec)),
    putBlob: (id, which, blob) => tx('blobs', 'readwrite', (s) => s.put(blob, id + ':' + which)),
    blobs: async (id) => ({
      original: await tx('blobs', 'readonly', (s) => s.get(id + ':original')),
      result: await tx('blobs', 'readonly', (s) => s.get(id + ':result')),
    }),
    del: async (id) => {
      await tx('posters', 'readwrite', (s) => s.delete(id));
      await tx('blobs', 'readwrite', (s) => { s.delete(id + ':original'); s.delete(id + ':result'); });
    },
  };

  /* ---------------- Página "Meus projetos" ---------------- */
  const $ = (id) => document.getElementById(id);
  const el = {
    page: $('projects'), close: $('prClose'), posters: $('prPosters'), cards: $('prCards'),
    newPoster: $('prNewPoster'), newCards: $('prNewCards'),
  };

  const when = (t) => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const urls = new WeakMap(); // miniaturas de cada lista (para liberar a memória ao redesenhar)

  async function items(kind) {
    if (kind === 'poster') {
      return (await posters.list()).map((r) => ({
        kind, id: r.id, name: r.name || 'Pôster', updated: r.updated, thumb: r.thumb, rec: r,
        meta: [r.size, r.pages ? r.pages + ' folha' + (r.pages > 1 ? 's' : '') : '', r.settings?.lay === 'free' ? 'encaixe livre' : ''].filter(Boolean).join(' · '),
      }));
    }
    if (!window.RancaCards) return [];
    return (await window.RancaCards.listProjects()).map((r) => ({
      kind, id: r.id, name: r.name, updated: r.updated, thumb: r.thumb, current: r.current,
      meta: r.mode === 'buttons' ? 'Bottons' : 'Foto cards',
    }));
  }

  // Lista de projetos dentro de um elemento (também usada na página vazia do pôster).
  async function renderList(box, opts) {
    const token = (box._token = (box._token || 0) + 1);
    let list;
    try { list = await items(opts.kind); } catch (e) { console.warn('Projetos:', e); list = []; }
    if (box._token !== token) return;
    for (const u of urls.get(box) || []) URL.revokeObjectURL(u);
    const made = [];
    urls.set(box, made);
    box.textContent = '';
    if (opts.limit) list = list.slice(0, opts.limit);
    if (!list.length) {
      if (opts.title) return; // na página do pôster, sem projetos não mostra nada
      const p = document.createElement('p');
      p.className = 'small';
      p.textContent = opts.kind === 'poster'
        ? 'Nenhum pôster ainda. Os pôsteres que você montar aparecem aqui sozinhos.'
        : 'Nenhuma folha ainda. As folhas de foto cards e bottons aparecem aqui sozinhas.';
      box.append(p);
      return;
    }
    if (opts.title) {
      const h = document.createElement('p');
      h.className = 'pr-title';
      h.textContent = opts.title;
      box.append(h);
    }
    const grid = document.createElement('div');
    grid.className = 'pr-grid' + (opts.limit ? ' pr-compact' : '');
    for (const it of list) {
      const card = document.createElement('div');
      card.className = 'pr-card';
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'pr-open';
      open.title = 'Abrir ' + it.name;
      const th = document.createElement('span');
      th.className = 'pr-thumb';
      if (it.thumb) {
        const img = document.createElement('img');
        const u = URL.createObjectURL(it.thumb);
        made.push(u);
        img.src = u;
        img.alt = '';
        th.append(img);
      }
      const name = document.createElement('strong');
      name.className = 'pr-name';
      name.textContent = it.name;
      const meta = document.createElement('small');
      meta.className = 'pr-meta';
      meta.textContent = [it.current ? 'aberto agora' : '', it.meta, when(it.updated)].filter(Boolean).join(' · ');
      open.append(th, name, meta);
      open.addEventListener('click', () => openItem(it));
      const acts = document.createElement('div');
      acts.className = 'pr-acts';
      const ren = document.createElement('button');
      ren.type = 'button';
      ren.className = 'btn btn-ghost btn-sm';
      ren.textContent = 'Renomear';
      ren.addEventListener('click', () => renameItem(it).then(() => refresh()));
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn btn-ghost btn-sm pr-del';
      del.textContent = 'Excluir';
      del.addEventListener('click', () => deleteItem(it).then(() => refresh()));
      acts.append(ren, del);
      card.append(open, acts);
      grid.append(card);
    }
    box.append(grid);
  }

  // redesenha todas as listas visíveis
  function refresh() {
    if (!el.page.hidden) render();
    const recent = $('pRecent');
    if (recent && !$('pEmpty').hidden) renderList(recent, { kind: 'poster', limit: 6, title: 'Pôsteres salvos' });
  }

  async function renameItem(it) {
    const name = (prompt('Nome do projeto:', it.name) || '').trim();
    if (!name || name === it.name) return;
    if (it.kind === 'poster') {
      const rec = await posters.get(it.id);
      if (!rec) return;
      rec.name = name;
      await posters.put(rec);
      window.RancaPoster.rename(it.id, name);
    } else {
      await window.RancaCards.renameProject(it.id, name);
    }
  }

  async function deleteItem(it) {
    if (!confirm('Excluir "' + it.name + '"? Não dá para desfazer.')) return;
    if (it.kind === 'poster') {
      window.RancaPoster.forget(it.id);
      await posters.del(it.id);
    } else {
      await window.RancaCards.deleteProject(it.id);
    }
  }

  async function openItem(it) {
    if (it.kind === 'poster') {
      const rec = await posters.get(it.id);
      if (!rec) return;
      if (window.RancaCards.isOpen()) window.RancaCards.close();
      if (!el.page.hidden) close();
      window.RancaApp.openPosterProject(rec);
    } else {
      if (window.RancaPoster.isOpen()) window.RancaPoster.close();
      if (!el.page.hidden) close();
      window.RancaCards.openProject(it.id);
    }
  }

  function render() {
    renderList(el.posters, { kind: 'poster' });
    renderList(el.cards, { kind: 'cards' });
  }

  function open() {
    if (!el.page.hidden) { render(); return; }
    el.page.hidden = false;
    document.body.classList.add('modal-open');
    window.RancaNav.push('projects', () => { close(true); return true; });
    render();
    el.close.focus();
  }
  function close(fromNav) {
    if (el.page.hidden) return;
    el.page.hidden = true;
    if (!document.querySelector('.modal:not([hidden])')) document.body.classList.remove('modal-open');
    if (!fromNav) window.RancaNav.pop('projects');
  }

  el.close.addEventListener('click', () => close());
  el.newPoster.addEventListener('click', () => {
    if (window.RancaCards.isOpen()) window.RancaCards.close();
    close();
    window.RancaApp.openPosterProject(null);
  });
  el.newCards.addEventListener('click', async () => {
    if (window.RancaPoster.isOpen()) window.RancaPoster.close();
    close();
    await window.RancaCards.newProject();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.page.hidden && window.RancaNav.top() === 'projects') close(); });

  window.RancaProjects = { posters, open, close, renderList, refresh };
})();
