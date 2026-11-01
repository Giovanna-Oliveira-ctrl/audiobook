/* Conjunto de ícones SVG inline (traço 24×24). Sem dependências externas. */

const F = 'fill="currentColor" stroke="none"';

const PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9v11a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1V9"/>',
  library: '<rect x="3.5" y="4" width="4" height="16" rx="1"/><rect x="9.5" y="4" width="4" height="16" rx="1"/><path d="m15.6 5.4 3.5-.9 3.3 14.2-3.5.9z"/>',
  heart: '<path d="M12 20.3s-7.6-4.6-9.3-9.4C1.5 7.4 3.8 4.2 7.2 4.2c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.4 0 5.7 3.2 4.5 6.7-1.7 4.8-9.3 9.4-9.3 9.4z"/>',
  heartFill: `<path ${F} d="M12 20.3s-7.6-4.6-9.3-9.4C1.5 7.4 3.8 4.2 7.2 4.2c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.4 0 5.7 3.2 4.5 6.7-1.7 4.8-9.3 9.4-9.3 9.4z"/>`,
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4v4.5H8"/><path d="M12 7.5V12l3 2"/>',
  settings: '<path d="M4 6.5h9M17 6.5h3M4 12h3M11 12h9M4 17.5h11M19 17.5h1"/><circle cx="15" cy="6.5" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17.5" r="2"/>',
  play: `<path ${F} d="M7.5 4.6v14.8a1 1 0 0 0 1.5.86l12.3-7.4a1 1 0 0 0 0-1.72L9 3.74a1 1 0 0 0-1.5.86z"/>`,
  pause: `<rect ${F} x="6" y="4.5" width="4.4" height="15" rx="1.3"/><rect ${F} x="13.6" y="4.5" width="4.4" height="15" rx="1.3"/>`,
  prev: `<path ${F} d="M19 5.3v13.4a.8.8 0 0 1-1.25.66L8.6 12.66a.8.8 0 0 1 0-1.32l9.15-6.7A.8.8 0 0 1 19 5.3z"/><path d="M5.5 5v14" stroke-width="2.4"/>`,
  next: `<path ${F} d="M5 5.3v13.4a.8.8 0 0 0 1.25.66l9.15-6.7a.8.8 0 0 0 0-1.32L6.25 4.64A.8.8 0 0 0 5 5.3z"/><path d="M18.5 5v14" stroke-width="2.4"/>`,
  back15: `<path d="M4.6 12.4a7.6 7.6 0 1 0 2.3-5.5"/><path d="M4.4 3.6v4.1h4.1"/><text x="12.6" y="15.3" ${F} font-size="7.2" font-weight="700" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif">15</text>`,
  fwd30: `<path d="M19.4 12.4a7.6 7.6 0 1 1-2.3-5.5"/><path d="M19.6 3.6v4.1h-4.1"/><text x="11.4" y="15.3" ${F} font-size="7.2" font-weight="700" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif">30</text>`,
  speed: '<path d="M3.6 17.5a9 9 0 1 1 16.8 0"/><path d="m12 13.5 4.2-4.2"/><circle cx="12" cy="13.5" r="1.2" fill="currentColor"/>',
  moon: '<path d="M20 14.6A8.3 8.3 0 0 1 9.4 4a8.3 8.3 0 1 0 10.6 10.6z"/>',
  bookmark: '<path d="M6.5 3.5h11a1 1 0 0 1 1 1v16l-6.5-4.2-6.5 4.2v-16a1 1 0 0 1 1-1z"/>',
  bookmarkPlus: '<path d="M6.5 3.5h11a1 1 0 0 1 1 1v16l-6.5-4.2-6.5 4.2v-16a1 1 0 0 1 1-1z"/><path d="M12 7.5v5M9.5 10h5"/>',
  chapters: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.1" fill="currentColor"/><circle cx="4.5" cy="12" r="1.1" fill="currentColor"/><circle cx="4.5" cy="18" r="1.1" fill="currentColor"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>',
  list: '<rect x="3.5" y="4" width="5" height="5" rx="1.2"/><rect x="3.5" y="15" width="5" height="5" rx="1.2"/><path d="M12 5.5h8.5M12 8h5M12 16.5h8.5M12 19h5"/>',
  search: '<circle cx="11" cy="11" r="6.8"/><path d="m20.5 20.5-4.7-4.7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronUp: '<path d="m6 15 6-6 6 6"/>',
  chevronLeft: '<path d="m15 6-6 6 6 6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  more: `<circle ${F} cx="12" cy="5.5" r="1.7"/><circle ${F} cx="12" cy="12" r="1.7"/><circle ${F} cx="12" cy="18.5" r="1.7"/>`,
  trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="m6 7 .9 12.2A2 2 0 0 0 8.9 21h6.2a2 2 0 0 0 2-1.8L18 7"/><path d="M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/>',
  edit: '<path d="M4 20h4.2L19.3 8.9a2.6 2.6 0 0 0-3.7-3.7L4.5 16.3z"/><path d="m14 6.8 3.7 3.7"/>',
  upload: '<path d="M12 15.5V4"/><path d="m7 8.5 5-5 5 5"/><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  download: '<path d="M12 4v11.5"/><path d="m7 11 5 5 5-5"/><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  check: '<path d="m4.5 12.5 4.8 4.8L19.5 7"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.8 2.8L16.2 9.6"/>',
  checkCircleFill: `<circle ${F} cx="12" cy="12" r="9.5"/><path d="m8 12.3 2.8 2.8L16.2 9.6" stroke="var(--icon-check, #fff)" stroke-width="2.2"/>`,
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  playlist: '<path d="M3.5 6h11M3.5 11h11M3.5 16h6.5"/><path d="M17.5 18V8.5l3.5-1"/><circle cx="15.5" cy="18" r="2"/>',
  chart: '<path d="M3.5 20.5h17"/><rect x="5" y="11" width="3.2" height="7" rx="1"/><rect x="10.4" y="5" width="3.2" height="13" rx="1"/><rect x="15.8" y="8.5" width="3.2" height="9.5" rx="1"/>',
  storage: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v13c0 1.55 3.36 2.8 7.5 2.8s7.5-1.25 7.5-2.8v-13"/><path d="M4.5 12c0 1.55 3.36 2.8 7.5 2.8s7.5-1.25 7.5-2.8"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".9" fill="currentColor"/>',
  alert: '<path d="M10.3 4.2 2.6 17.6A2 2 0 0 0 4.3 20.6h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4.5"/><circle cx="12" cy="17" r=".9" fill="currentColor"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  music: '<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  share: '<path d="M12 3.5v11"/><path d="m8 7.5 4-4 4 4"/><path d="M7 10.5H5.5A1.5 1.5 0 0 0 4 12v7.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V12a1.5 1.5 0 0 0-1.5-1.5H17"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>',
  monitor: '<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  note: '<path d="M5 3.5h14a1 1 0 0 1 1 1V15l-5.5 5.5H5a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z"/><path d="M14.5 20.5V15H20"/><path d="M8 8.5h8M8 12h5"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2.2"/><circle cx="9" cy="9.5" r="1.8"/><path d="m21 15.5-5-5L5.5 20"/>',
  sparkles: '<path d="M12 3.5 13.6 8.4 18.5 10 13.6 11.6 12 16.5 10.4 11.6 5.5 10 10.4 8.4z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
  wifiOff: '<path d="m3 3 18 18"/><path d="M8.6 16.2a4.9 4.9 0 0 1 6.8 0"/><path d="M5.2 12.7a10 10 0 0 1 4.2-2.4M18.8 12.7a10 10 0 0 0-2-1.5"/><path d="M2 9.2a15 15 0 0 1 4.1-2.6M22 9.2A15 15 0 0 0 11 5.1"/><circle cx="12" cy="19.6" r=".8" fill="currentColor"/>',
  scissors: '<circle cx="6" cy="6.5" r="2.7"/><circle cx="6" cy="17.5" r="2.7"/><path d="M8.3 8 20 18.5M8.3 16 20 5.5"/>',
  grip: `<circle ${F} cx="9" cy="6" r="1.5"/><circle ${F} cx="15" cy="6" r="1.5"/><circle ${F} cx="9" cy="12" r="1.5"/><circle ${F} cx="15" cy="12" r="1.5"/><circle ${F} cx="9" cy="18" r="1.5"/><circle ${F} cx="15" cy="18" r="1.5"/>`,
  sort: '<path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M17 20V4M13.5 7.5 17 4l3.5 3.5"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5M4 3.5V8h4.5"/><path d="M4 13a8 8 0 0 0 14.6 4.5M20 20.5V16h-4.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  auto: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>',
  flame: '<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.4 2.6-5.3 3.7-8.3.4 1.6 1.4 2.7 2.4 3.2C11.6 6.4 13 4 15.5 3c-.6 2.6.2 4.3 1.5 6 1 1.4 1.5 2.7 1.5 4.8 0 4-2.6 7.2-6.5 7.2z"/>',
  clock: '<circle cx="12" cy="12" r="8.8"/><path d="M12 7v5.2l3.3 2"/>',
  bookOpen: '<path d="M2.5 5.5c2.3-1.2 6-1.6 9.5 1 3.5-2.6 7.2-2.2 9.5-1v13c-2.3-1.2-6-1.6-9.5 1-3.5-2.6-7.2-2.2-9.5-1z"/><path d="M12 6.5v13"/>',
  headphones: '<path d="M3.5 17.5V12a8.5 8.5 0 0 1 17 0v5.5"/><path d="M20.5 18.5a2 2 0 0 1-2 2H17a1.5 1.5 0 0 1-1.5-1.5v-3.5A1.5 1.5 0 0 1 17 14h3.5zM3.5 18.5a2 2 0 0 0 2 2H7a1.5 1.5 0 0 0 1.5-1.5v-3.5A1.5 1.5 0 0 0 7 14H3.5z"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.9 1.8-1.8 0-1.4-1.3-1.8-1.3-3 0-1 .8-1.7 1.8-1.7h2.2A4.5 4.5 0 0 0 21 10c0-3.9-4-7-9-7z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor"/><circle cx="10.5" cy="7" r="1.2" fill="currentColor"/><circle cx="15" cy="7.5" r="1.2" fill="currentColor"/>',
  rotate: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4v4.5H8"/>',
  tag: '<path d="M3.5 12.3V4.5a1 1 0 0 1 1-1h7.8l8.5 8.5a1.4 1.4 0 0 1 0 2l-6.8 6.8a1.4 1.4 0 0 1-2 0z"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
};

export function iconMarkup(name, size = 24) {
  return `<svg class="icon icon-${name}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name] || ''}</svg>`;
}

export function icon(name, size = 24) {
  const t = document.createElement('template');
  t.innerHTML = iconMarkup(name, size);
  return t.content.firstElementChild;
}
