// Service worker do Ranca Fundo
// - Guarda o site e o modelo de IA no aparelho para funcionar sem internet.
// - Acrescenta os cabeçalhos COOP/COEP (necessários para a IA usar vários núcleos),
//   já que hospedagens como o GitHub Pages não permitem configurá-los.
const VERSION = 'v11';
const SHELL_CACHE = 'shell-' + VERSION;
const DATA_CACHE = 'data-v1'; // modelo e wasm (arquivos imutáveis, nomeados por hash)

const SHELL = [
  './', 'index.html', 'style.css', 'app.js', 'edges.js', 'poster.js', 'cards.js', 'retouch.js', 'upscale.js', 'manifest.webmanifest',
  'img/mozao.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'vendor/background-removal.js', 'vendor/imgly-data/resources.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k !== SHELL_CACHE && k !== DATA_CACHE) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

function withIsolation(resp) {
  if (!resp || resp.status === 0 || resp.type === 'opaque') return resp;
  const h = new Headers(resp.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'require-corp');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

// Baixa com novas tentativas (rede do celular instável, erro 5xx momentâneo do servidor)
async function fetchWithRetry(req, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const resp = await fetch(req);
      if (resp.ok || resp.status < 500 || i >= tries) return resp;
    } catch (err) {
      if (i >= tries) throw err;
    }
    await new Promise((r) => setTimeout(r, 800 * i));
  }
}

// Arquivos do modelo: cache primeiro (nunca mudam)
async function cacheFirst(req) {
  const cache = await caches.open(DATA_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const resp = await fetchWithRetry(req);
  if (resp.ok) await cache.put(req, resp.clone());
  return resp;
}

// Site: responde do cache na hora e atualiza em segundo plano
async function staleWhileRevalidate(req, event) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  const update = fetch(req).then((resp) => {
    if (resp.ok) cache.put(req, resp.clone());
    return resp;
  });
  if (hit) {
    event.waitUntil(update.catch(() => {}));
    return hit;
  }
  return update;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const isData = (url.pathname.includes('/vendor/imgly-data/') && !url.pathname.endsWith('.json')) ||
    url.pathname.includes('/vendor/upscale/');
  // Sem rede e sem cópia guardada: só a abertura da página cai no index.html.
  // Para os outros arquivos (como o modelo), a falha segue como erro de rede,
  // senão a IA recebe o HTML no lugar do arquivo e dá um erro sem sentido.
  e.respondWith(
    (isData ? cacheFirst(req) : staleWhileRevalidate(req, e))
      .then(withIsolation)
      .catch((err) => {
        if (req.mode !== 'navigate') throw err;
        return caches.match('index.html').then(withIsolation);
      })
  );
});
