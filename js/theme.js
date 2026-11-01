/* Tema claro/escuro/automático. Espelhado no localStorage para evitar "piscar" ao abrir. */

const mq = matchMedia('(prefers-color-scheme: dark)');
let current = 'auto';

const COLORS = { light: '#f6f3ed', dark: '#11100e' };

function resolve(setting) {
  return setting === 'auto' ? (mq.matches ? 'dark' : 'light') : setting;
}

export function applyTheme(setting = current) {
  current = setting || 'auto';
  const theme = resolve(current);
  document.documentElement.dataset.theme = theme;
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.setAttribute('content', COLORS[theme]);
  try {
    localStorage.setItem('audiobook:theme', current);
  } catch {}
}

mq.addEventListener?.('change', () => current === 'auto' && applyTheme('auto'));
