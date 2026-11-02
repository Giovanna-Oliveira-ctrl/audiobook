/* Camada fina sobre o IndexedDB.
 *
 * Banco "audiobook" — stores:
 *  books      { id, title, author, narrator, genre, synopsis, chapterIds[], ... }
 *  chapters   { id, bookId, title, audioId, start, duration, ... }      índice: bookId
 *  audio      { id, bookId, blob | buffer, size, type, name }           índice: bookId
 *  covers     { id (= bookId), blob | buffer, size, generated }
 *  progress   { bookId, chapterId, chapterIndex, position, bookPosition, rate, listened, ... }
 *  bookmarks  { id, bookId, chapterId, position, note, createdAt }      índice: bookId
 *  history    { bookId, lastPlayedAt, chapterIndex, chapterTitle, position, plays }
 *  playlists  { id, name, description, bookIds[] }
 *  stats      { date: 'YYYY-MM-DD', seconds, books: { [bookId]: seconds } }
 *  settings   { key, value }   (key: 'app' | 'session')
 *  conversions { id, status, meta, chapters[{ title, paragraphs, state }], voiceId, bookId, ... }  (v2)
 *
 * O áudio fica no IndexedDB (não no Cache Storage), separado do cache do app:
 * atualizar ou limpar o cache do Service Worker nunca apaga a biblioteca.
 */

const DB_NAME = 'audiobook';
const DB_VERSION = 2;
let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in self)) {
      reject(new Error('Este navegador não oferece IndexedDB (armazenamento local).'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => migrate(req.result, event.oldVersion);
    req.onsuccess = () => {
      const db = req.result;
      // Outra aba abriu uma versão mais nova: liberar a conexão para a migração.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
    req.onblocked = () => console.warn('[db] atualização aguardando outra aba fechar');
  });
  return dbPromise;
}

/** Migrações incrementais. Nunca remova stores com dados do usuário. */
function migrate(db, oldVersion) {
  if (oldVersion < 1) {
    db.createObjectStore('books', { keyPath: 'id' });
    db.createObjectStore('chapters', { keyPath: 'id' }).createIndex('bookId', 'bookId');
    db.createObjectStore('audio', { keyPath: 'id' }).createIndex('bookId', 'bookId');
    db.createObjectStore('covers', { keyPath: 'id' });
    db.createObjectStore('progress', { keyPath: 'bookId' });
    db.createObjectStore('bookmarks', { keyPath: 'id' }).createIndex('bookId', 'bookId');
    db.createObjectStore('history', { keyPath: 'bookId' });
    db.createObjectStore('playlists', { keyPath: 'id' });
    db.createObjectStore('stats', { keyPath: 'date' });
    db.createObjectStore('settings', { keyPath: 'key' });
  }
  if (oldVersion < 2) {
    // v2: conversões de ebook em audiolivro (texto dos capítulos + estado de cada um)
    db.createObjectStore('conversions', { keyPath: 'id' });
  }
  // Próximas migrações: if (oldVersion < 3) { ... }
}

async function run(storeNames, mode, work) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(storeNames, mode);
    } catch (err) {
      reject(err);
      return;
    }
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transação cancelada'));
    try {
      const out = work(tx);
      if (out instanceof IDBRequest) out.onsuccess = () => (result = out.result);
      else result = out;
    } catch (err) {
      try {
        tx.abort();
      } catch {}
      reject(err);
    }
  });
}

export const get = (store, key) => run(store, 'readonly', (tx) => tx.objectStore(store).get(key));
export const getAll = (store) => run(store, 'readonly', (tx) => tx.objectStore(store).getAll());
export const getAllByIndex = (store, index, value) =>
  run(store, 'readonly', (tx) => tx.objectStore(store).index(index).getAll(value));
export const getKeysByIndex = (store, index, value) =>
  run(store, 'readonly', (tx) => tx.objectStore(store).index(index).getAllKeys(value));
/** Conta registros com a chave informada (não carrega o valor — útil para verificar áudio). */
export const has = (store, key) =>
  run(store, 'readonly', (tx) => tx.objectStore(store).count(key)).then((n) => n > 0);
export const countAll = (store) => run(store, 'readonly', (tx) => tx.objectStore(store).count());
export const put = (store, value) =>
  run(store, 'readwrite', (tx) => {
    tx.objectStore(store).put(value);
    return value;
  });
export const del = (store, key) => run(store, 'readwrite', (tx) => void tx.objectStore(store).delete(key));
export const clear = (store) => run(store, 'readwrite', (tx) => void tx.objectStore(store).clear());

/** Executa várias operações em uma única transação atômica. */
export function batch(ops) {
  const stores = [...new Set(ops.map((o) => o.store))];
  if (!stores.length) return Promise.resolve();
  return run(stores, 'readwrite', (tx) => {
    for (const op of ops) {
      const s = tx.objectStore(op.store);
      if (op.type === 'put') s.put(op.value);
      else if (op.type === 'delete') s.delete(op.key);
      else if (op.type === 'clear') s.clear();
    }
  });
}

export const ALL_STORES = [
  'books', 'chapters', 'audio', 'covers', 'progress', 'bookmarks', 'history', 'playlists', 'stats', 'settings', 'conversions',
];
