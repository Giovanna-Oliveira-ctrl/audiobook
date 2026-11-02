/* Utilitários de interface: criação de elementos, toasts, folhas (sheets) e diálogos.
 * Os modais se integram ao histórico: o botão "voltar" do Android fecha o modal. */

import { icon } from './icons.js';

/** Hyperscript: h('div', { class: 'x', onClick }, 'texto', filho...) — texto é sempre escapado. */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sv == null) continue;
          if (sk.startsWith('--')) el.style.setProperty(sk, sv);
          else el.style[sk] = sv;
        }
      } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k === 'selected') el.selected = !!v;
      else if (k === 'html') el.innerHTML = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === true) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function iconButton(name, label, onClick, { className = '', size = 22, attrs = {} } = {}) {
  return h('button', { type: 'button', class: `icon-btn ${className}`, 'aria-label': label, title: label, onClick, ...attrs }, icon(name, size));
}

export function button(label, { icon: ic, variant = 'secondary', onClick, className = '', attrs = {} } = {}) {
  return h('button', { type: 'button', class: `btn btn--${variant} ${className}`, onClick, ...attrs }, ic && icon(ic, 20), h('span', {}, label));
}

/* ------------------------------------------------------------------ */
/* Toasts                                                               */
/* ------------------------------------------------------------------ */

export function toast(message, { action, duration = 3800, tone } = {}) {
  const root = document.getElementById('toast-root');
  if (!root) return () => {};
  while (root.children.length >= 3) root.firstElementChild.remove();
  const el = h(
    'div',
    { class: `toast ${tone ? `toast--${tone}` : ''}`, role: tone === 'error' ? 'alert' : 'status' },
    h('span', { class: 'toast-msg' }, message),
    action &&
      h('button', {
        type: 'button',
        class: 'toast-action',
        onClick: () => {
          dismiss();
          action.onClick();
        },
      }, action.label),
  );
  root.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const timer = setTimeout(dismiss, duration);
  function dismiss() {
    clearTimeout(timer);
    el.classList.remove('show');
    setTimeout(() => el.remove(), 260);
  }
  return dismiss;
}

/* ------------------------------------------------------------------ */
/* Modais                                                               */
/* ------------------------------------------------------------------ */

const stack = [];
let seq = 0;

window.addEventListener('popstate', () => {
  const current = history.state?.modalId || 0;
  for (const m of [...stack].reverse()) if (m.id > current) m.finalize();
});

/**
 * Abre um modal. variant: 'sheet' (folha inferior no celular) | 'dialog' (centralizado).
 * Retorna { close(): Promise, panel, closed: Promise }.
 */
export function openModal({ title, content, variant = 'sheet', className = '', onClose, actions } = {}) {
  const id = ++seq;
  const root = document.getElementById('modal-root');
  const titleId = `modal-title-${id}`;
  const panel = h(
    'div',
    { class: `modal modal--${variant} ${className}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': title ? titleId : null, tabindex: '-1' },
    variant === 'sheet' && h('div', { class: 'sheet-grabber', 'aria-hidden': 'true' }),
    title &&
      h('header', { class: 'modal-header' },
        h('h2', { class: 'modal-title', id: titleId }, title),
        iconButton('x', 'Fechar', () => close(), { className: 'modal-close' })),
    h('div', { class: 'modal-body' }, content),
    actions && h('footer', { class: 'modal-actions' }, actions),
  );
  const backdrop = h('div', { class: 'modal-backdrop', onClick: () => close() });
  const wrap = h('div', { class: `modal-wrap modal-wrap--${variant}` }, backdrop, panel);
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') trapFocus(e, panel);
  });
  root.append(wrap);
  document.body.classList.add('modal-open');
  const prevFocus = document.activeElement;

  let closed = false;
  let resolveClosed;
  const closedPromise = new Promise((r) => (resolveClosed = r));
  const entry = {
    id,
    finalize() {
      if (closed) return;
      closed = true;
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      wrap.classList.remove('open');
      wrap.classList.add('closing');
      setTimeout(() => wrap.remove(), 240);
      if (!stack.length) document.body.classList.remove('modal-open');
      try {
        onClose?.();
      } catch (err) {
        console.error(err);
      }
      if (prevFocus && document.contains(prevFocus)) prevFocus.focus?.({ preventScroll: true });
      resolveClosed();
    },
  };
  function close() {
    if (closed) return closedPromise;
    if (history.state?.modalId === id) history.back();
    else entry.finalize();
    return closedPromise;
  }
  history.pushState({ ...(history.state || {}), modalId: id }, '');
  stack.push(entry);
  requestAnimationFrame(() => {
    wrap.classList.add('open');
    const focusable = panel.querySelector('[autofocus], input, textarea, select');
    (focusable || panel).focus({ preventScroll: true });
  });
  enableSheetDrag(panel, variant, close);
  return { close, panel, closed: closedPromise };
}

function trapFocus(e, panel) {
  const items = [...panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
    (el) => !el.disabled && el.offsetParent !== null,
  );
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/** Arrastar a folha para baixo para fechar (celular). */
function enableSheetDrag(panel, variant, close) {
  if (variant !== 'sheet') return;
  const grab = panel.querySelector('.sheet-grabber');
  const header = panel.querySelector('.modal-header');
  let startY = null, dy = 0;
  const down = (e) => {
    if (e.target.closest('button')) return;
    startY = e.clientY;
    dy = 0;
    panel.style.transition = 'none';
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e) => {
    if (startY == null) return;
    dy = Math.max(0, e.clientY - startY);
    panel.style.transform = `translateY(${dy}px)`;
  };
  const up = () => {
    if (startY == null) return;
    startY = null;
    panel.style.transition = '';
    panel.style.transform = '';
    if (dy > 90) close();
  };
  for (const el of [grab, header].filter(Boolean)) {
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
}

/** Fecha todos os modais sem mexer no histórico (usado ao trocar de rota). */
export function dismissAllModals() {
  for (const m of [...stack].reverse()) m.finalize();
}

export const hasOpenModal = () => stack.length > 0;

export function confirmDialog({ title, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    const m = openModal({
      title,
      variant: 'dialog',
      content: h('p', { class: 'dialog-message' }, message),
      actions: [
        h('button', { type: 'button', class: 'btn btn--ghost', onClick: () => m.close() }, cancelLabel),
        h('button', {
          type: 'button',
          class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`,
          autofocus: true,
          onClick: () => {
            result = true;
            m.close();
          },
        }, confirmLabel),
      ],
      onClose: () => resolve(result),
    });
  });
}

export function alertDialog({ title, message, label = 'Entendi' }) {
  return new Promise((resolve) => {
    const m = openModal({
      title,
      variant: 'dialog',
      content: typeof message === 'string' ? h('p', { class: 'dialog-message' }, message) : message,
      actions: [h('button', { type: 'button', class: 'btn btn--primary', onClick: () => m.close() }, label)],
      onClose: () => resolve(),
    });
  });
}

export function promptDialog({ title, label, value = '', placeholder = '', confirmLabel = 'Salvar', multiline = false, maxLength = 200 }) {
  return new Promise((resolve) => {
    let result = null;
    const input = multiline
      ? h('textarea', { class: 'input', rows: '4', placeholder, maxlength: String(maxLength * 10), autofocus: true }, value)
      : h('input', { class: 'input', type: 'text', value, placeholder, maxlength: String(maxLength), autofocus: true, enterkeyhint: 'done' });
    const form = h(
      'form',
      {
        class: 'prompt-form',
        onSubmit: (e) => {
          e.preventDefault();
          result = input.value;
          m.close();
        },
      },
      label && h('label', { class: 'field-label' }, label),
      input,
    );
    const m = openModal({
      title,
      variant: 'dialog',
      content: form,
      actions: [
        h('button', { type: 'button', class: 'btn btn--ghost', onClick: () => m.close() }, 'Cancelar'),
        h('button', { type: 'button', class: 'btn btn--primary', onClick: () => form.requestSubmit() }, confirmLabel),
      ],
      onClose: () => resolve(result),
    });
    requestAnimationFrame(() => {
      input.focus();
      if (!multiline) input.select();
    });
  });
}

/** Menu de ações. actions: [{ label, icon, danger, onSelect }] */
export function actionSheet({ title, actions }) {
  let chosen = null;
  const m = openModal({
    title,
    variant: 'sheet',
    className: 'action-sheet',
    content: h(
      'div',
      { class: 'menu-list', role: 'menu' },
      actions.filter(Boolean).map((a) =>
        h('button', {
          type: 'button',
          role: 'menuitem',
          class: `menu-item ${a.danger ? 'menu-item--danger' : ''}`,
          onClick: () => {
            chosen = a;
            m.close();
          },
        }, a.icon && icon(a.icon, 22), h('span', {}, a.label)),
      ),
    ),
    onClose: () => {
      if (chosen) setTimeout(() => chosen.onSelect?.(), 0);
    },
  });
  return m;
}

/** Abre o seletor de arquivos do sistema. */
export function pickFiles({ accept = '', multiple = false, directory = false } = {}) {
  // Remove seletores anteriores que ficaram pendentes (usuário cancelou).
  document.querySelectorAll('input[data-file-picker]').forEach((el) => el.remove());
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple, 'data-file-picker': '', style: { position: 'fixed', left: '-9999px', opacity: '0' } });
    if (directory) {
      input.webkitdirectory = true;
      input.setAttribute('webkitdirectory', '');
    }
    // Só o evento "change" conclui: alguns navegadores disparam "cancel" de forma
    // inconsistente (ou nem disparam). Se o usuário cancelar, a promessa fica pendente
    // e o input é limpo na próxima abertura.
    input.addEventListener('change', () => {
      const files = [...(input.files || [])];
      input.remove();
      resolve(files);
    });
    document.body.append(input);
    input.click();
  });
}
