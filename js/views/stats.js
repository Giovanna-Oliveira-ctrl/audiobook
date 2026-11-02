import { h } from '../ui.js';
import { icon } from '../icons.js';
import { state, bus } from '../state.js';
import * as repo from '../repo.js';
import { back } from '../router.js';
import { pageHeader, coverEl, emptyState, bookProgress } from '../components.js';
import { dayKey, formatDuration, plural } from '../utils.js';

const dfShort = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' });
const dfDay = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });
const dfFull = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

function lastDays(n) {
  const out = [];
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d);
    x.setDate(d.getDate() - i);
    out.push(x);
  }
  return out;
}

function streak(stats) {
  let n = 0;
  const d = new Date();
  if (!(stats.get(dayKey(d))?.seconds > 30)) d.setDate(d.getDate() - 1); // hoje ainda pode começar
  while (stats.get(dayKey(d))?.seconds > 30) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

function tile(label, value, ic, hint) {
  return h('div', { class: 'stat-tile' },
    h('span', { class: 'stat-tile-icon' }, icon(ic, 20)),
    h('span', { class: 'stat-tile-label' }, label),
    h('span', { class: 'stat-tile-value' }, value),
    hint && h('span', { class: 'stat-tile-hint' }, hint));
}

function barChart(days, stats) {
  const values = days.map((d) => (stats.get(dayKey(d))?.seconds || 0) / 60);
  const max = Math.max(...values, 1);
  const niceMax = max <= 10 ? Math.max(2, Math.ceil(max / 2) * 2) : max <= 60 ? Math.ceil(max / 10) * 10 : Math.ceil(max / 30) * 30;
  const tip = h('div', { class: 'chart-tip', role: 'status', 'aria-live': 'polite', hidden: true });
  const plot = h('div', { class: 'chart-plot' });
  const showTip = (i, el) => {
    tip.hidden = false;
    tip.replaceChildren(h('strong', {}, formatDuration(values[i] * 60)), h('span', {}, dfFull.format(days[i])));
    const r = el.getBoundingClientRect();
    const pr = plot.getBoundingClientRect();
    tip.style.left = `${Math.min(Math.max(r.left - pr.left + r.width / 2, 60), pr.width - 60)}px`;
    plot.querySelectorAll('.chart-col').forEach((c) => c.classList.toggle('is-hover', c === el));
  };
  const hideTip = () => {
    tip.hidden = true;
    plot.querySelectorAll('.chart-col').forEach((c) => c.classList.remove('is-hover'));
  };
  days.forEach((d, i) => {
    const pct = (values[i] / niceMax) * 100;
    const col = h('button', {
      type: 'button',
      class: `chart-col ${dayKey(d) === dayKey() ? 'is-today' : ''}`,
      'aria-label': `${dfFull.format(d)}: ${formatDuration(values[i] * 60)}`,
      onPointerenter: (e) => showTip(i, e.currentTarget),
      onPointerleave: hideTip,
      onFocus: (e) => showTip(i, e.currentTarget),
      onBlur: hideTip,
      onClick: (e) => showTip(i, e.currentTarget),
    },
      h('span', { class: 'chart-bar', style: { height: values[i] > 0 ? `max(${pct}%, 3px)` : '0' } }),
      h('span', { class: 'chart-x' }, i === days.length - 1 ? 'hoje' : days.length > 7 && i % 2 ? '' : dfShort.format(d).replace('.', '')));
    plot.append(col);
  });
  plot.append(tip);
  const table = h('details', { class: 'chart-table' },
    h('summary', {}, 'Ver como tabela'),
    h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Dia'), h('th', {}, 'Tempo ouvido'))),
      h('tbody', {}, days.map((d, i) => h('tr', {}, h('td', {}, `${dfShort.format(d)} ${dfDay.format(d)}`), h('td', {}, formatDuration(values[i] * 60)))))));
  return h('figure', { class: 'chart' },
    h('div', { class: 'chart-head' },
      h('figcaption', { class: 'section-title' }, 'Minutos por dia'),
      h('span', { class: 'muted small' }, 'Últimos 14 dias')),
    h('div', { class: 'chart-body' },
      h('div', { class: 'chart-y', 'aria-hidden': 'true' }, h('span', {}, `${niceMax} min`), h('span', {}, `${niceMax / 2}`), h('span', {}, '0')),
      plot),
    table);
}

export default function statsView(root) {
  async function draw() {
    const stats = await repo.getStats();
    const books = repo.allBooks();
    const total = [...state.progress.values()].reduce((s, p) => s + (p.listened || 0), 0);
    const today = stats.get(dayKey())?.seconds || 0;
    const week = lastDays(7).reduce((s, d) => s + (stats.get(dayKey(d))?.seconds || 0), 0);
    const month = lastDays(30).reduce((s, d) => s + (stats.get(dayKey(d))?.seconds || 0), 0);
    const activeDays = lastDays(30).filter((d) => stats.get(dayKey(d))?.seconds > 30).length;
    const done = books.filter((b) => b.finished).length;
    const inProgress = books.filter((b) => bookProgress(b).status === 'progress').length;
    const st = streak(stats);

    const top = books
      .map((b) => ({ b, t: state.progress.get(b.id)?.listened || 0 }))
      .filter((x) => x.t > 0)
      .sort((a, b) => b.t - a.t)
      .slice(0, 5);

    const genres = new Map();
    for (const b of books) {
      const g = b.genre || 'Sem gênero';
      const cur = genres.get(g) || { count: 0, time: 0, done: 0 };
      cur.count++;
      cur.time += state.progress.get(b.id)?.listened || 0;
      if (b.finished) cur.done++;
      genres.set(g, cur);
    }
    const genreRows = [...genres].sort((a, b) => b[1].time - a[1].time || b[1].count - a[1].count);

    root.replaceChildren(h('div', { class: 'page page-stats' },
      pageHeader({ title: 'Estatísticas', subtitle: 'Calculadas no seu dispositivo, a partir do tempo real de reprodução.', back: () => back('/inicio') }),
      !books.length && !total
        ? emptyState({ icon: 'chart', title: 'Sem dados ainda', text: 'Ouça um audiolivro e suas estatísticas aparecerão aqui.' })
        : [
            h('div', { class: 'stat-grid' },
              tile('Tempo total escutado', formatDuration(total), 'headphones'),
              tile('Hoje', formatDuration(today), 'clock'),
              tile('Últimos 7 dias', formatDuration(week), 'chart'),
              tile('Livros concluídos', String(done), 'checkCircle', inProgress ? `${inProgress} em andamento` : null),
              tile('Sequência', plural(st, 'dia', 'dias'), 'flame', 'dias seguidos ouvindo'),
              tile('Média diária', formatDuration(activeDays ? month / activeDays : 0), 'speed', `${plural(activeDays, 'dia ativo', 'dias ativos')} no mês`)),
            h('section', { class: 'stats-card' }, barChart(lastDays(14), stats)),
            top.length > 0 && h('section', { class: 'stats-card' },
              h('h2', { class: 'section-title' }, 'Mais ouvidos'),
              h('ol', { class: 'rank-list' },
                top.map(({ b, t }, i) =>
                  h('li', {},
                    h('a', { href: `#/livro/${encodeURIComponent(b.id)}`, class: 'rank-item' },
                      h('span', { class: 'rank-n' }, String(i + 1)),
                      coverEl(b, { size: 'xs' }),
                      h('span', { class: 'rank-text' }, h('strong', {}, b.title), h('small', {}, b.author || '')),
                      h('span', { class: 'rank-value' }, formatDuration(t))))))),
            h('section', { class: 'stats-card' },
              h('h2', { class: 'section-title' }, 'Por gênero'),
              h('table', { class: 'genre-table' },
                h('thead', {}, h('tr', {}, h('th', {}, 'Gênero'), h('th', {}, 'Livros'), h('th', {}, 'Concluídos'), h('th', {}, 'Tempo'))),
                h('tbody', {}, genreRows.map(([g, v]) =>
                  h('tr', {},
                    h('td', {}, h('a', { href: `#/biblioteca?genero=${encodeURIComponent(g === 'Sem gênero' ? '' : g)}` }, g)),
                    h('td', {}, String(v.count)),
                    h('td', {}, String(v.done)),
                    h('td', {}, formatDuration(v.time))))))),
          ]));
  }
  draw();
  const offs = [bus.on('library', draw)];
  return () => offs.forEach((o) => o());
}
