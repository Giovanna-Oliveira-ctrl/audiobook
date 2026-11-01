/* Estado em memória + barramento de eventos.
 * Os dados persistentes vivem no IndexedDB (ver db.js / repo.js);
 * aqui ficam apenas caches síncronos para renderização rápida. */

export const DEFAULT_SETTINGS = Object.freeze({
  name: '',
  theme: 'auto', // 'light' | 'dark' | 'auto'
  defaultSpeed: 1,
  defaultSleep: 0, // 0 = desligado | minutos | 'chapter'
  autosave: true, // salvar progresso a cada 5 s durante a reprodução
  smartRewind: true, // retroceder alguns segundos ao retomar após pausa longa
  autoResume: true, // carregar o último livro ao abrir o app
  autoplayNext: true, // iniciar o próximo capítulo automaticamente
  libraryView: 'grid', // 'grid' | 'list'
  librarySort: 'added', // 'added' | 'title' | 'author' | 'recent' | 'progress' | 'genre'
  skipBack: 15,
  skipForward: 30,
  installDismissed: false,
});

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
export const SLEEP_OPTIONS = [
  { value: 5, label: '5 minutos' },
  { value: 10, label: '10 minutos' },
  { value: 15, label: '15 minutos' },
  { value: 30, label: '30 minutos' },
  { value: 45, label: '45 minutos' },
  { value: 60, label: '1 hora' },
  { value: 'chapter', label: 'Final do capítulo atual' },
];

export const state = {
  settings: { ...DEFAULT_SETTINGS },
  session: {}, // { lastBookId }
  books: new Map(), // id -> book
  chapters: new Map(), // bookId -> chapters[] (ordenados; carregados sob demanda)
  progress: new Map(), // bookId -> progress
  history: new Map(), // bookId -> history entry
  playlists: new Map(), // id -> playlist
  installPrompt: null, // evento beforeinstallprompt
  swRegistration: null,
  pendingImportFiles: null, // arquivos recebidos via share target / file handler
};

const listeners = new Map();

export const bus = {
  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event)?.delete(fn);
  },
  emit(event, data) {
    const set = listeners.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(data);
      } catch (err) {
        console.error(`[bus] erro em "${event}"`, err);
      }
    }
  },
};
