/* Roteador por hash (#/rota). Funciona offline e em qualquer hospedagem estática,
 * sem configuração de servidor. */

const routes = [];
let maxIdx = 0;
let forwardNav = false;
const scrollMemory = new Map();
let handler = null;

export function route(pattern, view, meta = {}) {
  const keys = [];
  const re = new RegExp(
    '^' + pattern.replace(/\//g, '\\/').replace(/:([a-zA-Z]+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '\\/?$',
  );
  routes.push({ pattern, re, keys, view, meta });
}

export function parseHash(hash = location.hash) {
  const raw = hash.replace(/^#/, '') || '/inicio';
  const [path, qs = ''] = raw.split('?');
  return { path: path || '/inicio', query: Object.fromEntries(new URLSearchParams(qs)), raw };
}

export function match(path) {
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { ...r, params };
    }
  }
  return null;
}

export function navigate(to, { replace = false } = {}) {
  forwardNav = true;
  const target = '#' + to.replace(/^#/, '');
  if (replace) location.replace(target);
  else location.hash = target;
}

/** Volta na pilha do app; se não houver histórico interno, vai para o fallback. */
export function back(fallback = '/inicio') {
  if ((history.state?.idx || 0) > 0) history.back();
  else navigate(fallback, { replace: true });
}

/** Atualiza a query da rota atual sem disparar nova renderização. */
export function replaceQuery(query) {
  const { path } = parseHash();
  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== '')).toString();
  history.replaceState(history.state, '', `#${path}${qs ? '?' + qs : ''}`);
}

function tagEntry() {
  if (history.state?.idx == null) {
    maxIdx += 1;
    history.replaceState({ ...(history.state || {}), idx: maxIdx }, '');
  } else maxIdx = Math.max(maxIdx, history.state.idx);
}

export function startRouter(onRoute) {
  handler = onRoute;
  if (history.state?.idx == null) history.replaceState({ ...(history.state || {}), idx: 0 }, '');
  let lastKey = location.hash;
  window.addEventListener('hashchange', () => {
    scrollMemory.set(lastKey, window.scrollY);
    lastKey = location.hash;
    const isForward = forwardNav;
    forwardNav = false;
    tagEntry();
    run({ restoreScroll: !isForward });
  });
  // Links internos marcam a navegação como "para frente" (sem restaurar rolagem).
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#/"]');
    if (a && !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey) forwardNav = true;
  });
  run({ restoreScroll: false });
}

function run({ restoreScroll }) {
  const loc = parseHash();
  const m = match(loc.path) || match('/inicio');
  handler?.({ ...loc, route: m, params: m?.params || {}, scrollY: restoreScroll ? scrollMemory.get(location.hash) : 0 });
}

export const currentRoute = () => parseHash();
