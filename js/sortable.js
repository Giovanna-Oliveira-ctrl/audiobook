/* Reordenação por arrastar (mouse e toque) usando Pointer Events.
 * Itens: filhos diretos de listEl; alça: elemento com [data-drag-handle]. */

export function enableSortable(listEl, onReorder) {
  listEl.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('[data-drag-handle]');
    if (!handle || !listEl.contains(handle) || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const items = [...listEl.children];
    const item = items.find((el) => el.contains(handle));
    if (!item) return;
    e.preventDefault();

    const from = items.indexOf(item);
    const rects = items.map((el) => el.getBoundingClientRect());
    const gap = rects.length > 1 ? Math.max(0, rects[1].top - rects[0].bottom) : 0;
    const step = rects[from].height + gap;
    const startY = e.clientY;
    const startScroll = window.scrollY;
    let to = from;
    let lastY = e.clientY;
    let raf = 0;

    item.classList.add('is-dragging');
    listEl.classList.add('is-sorting');
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {}

    const layout = () => {
      const dy = lastY - startY + (window.scrollY - startScroll);
      item.style.transform = `translateY(${dy}px)`;
      const center = rects[from].top + rects[from].height / 2 + dy;
      to = 0;
      rects.forEach((r, i) => {
        if (i !== from && r.top + r.height / 2 < center) to++;
      });
      items.forEach((el, i) => {
        if (i === from) return;
        let shift = 0;
        if (from < to && i > from && i <= to) shift = -step;
        else if (from > to && i >= to && i < from) shift = step;
        el.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    };

    const autoScroll = () => {
      const edge = 90;
      if (lastY < edge) window.scrollBy(0, -12);
      else if (lastY > window.innerHeight - edge - 70) window.scrollBy(0, 12);
      layout();
      raf = requestAnimationFrame(autoScroll);
    };
    raf = requestAnimationFrame(autoScroll);

    const move = (ev) => {
      lastY = ev.clientY;
    };
    const end = () => {
      cancelAnimationFrame(raf);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      items.forEach((el) => (el.style.transform = ''));
      item.classList.remove('is-dragging');
      listEl.classList.remove('is-sorting');
      if (to !== from) onReorder(from, to);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  });
}
