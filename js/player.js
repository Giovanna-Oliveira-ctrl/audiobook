/* Motor de reprodução.
 *
 * - Um único <audio> que vive fora das telas: navegar não interrompe o som.
 * - Áudio lido do IndexedDB e tocado via Object URL (sem streaming, 100% offline).
 *   As URLs são revogadas ao trocar de arquivo para não vazar memória.
 * - O próximo arquivo é pré-carregado: no evento "ended" a troca de fonte é síncrona,
 *   o que mantém a continuidade em segundo plano (inclusive no iOS).
 * - Media Session: controles na tela de bloqueio/central de notificações.
 * - Capítulos podem ser arquivos inteiros ou trechos (start + duration) de um mesmo arquivo.
 */

import { state, bus } from './state.js';
import * as repo from './repo.js';
import { artworkDataURL } from './covers.js';
import { clamp, debounce } from './utils.js';

const SAVE_INTERVAL_MS = 5000;
const SNAPSHOT_KEY = 'audiobook:snapshot';
const SILENT_SRC = makeSilentWav();
const hasMediaSession = typeof navigator !== 'undefined' && 'mediaSession' in navigator;

function makeSilentWav() {
  const sr = 8000, n = 400;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 2, true);
  let bin = '';
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return 'data:audio/wav;base64,' + btoa(bin);
}

class Player {
  constructor() {
    this.audio = null;
    this.book = null;
    this.chapters = [];
    this.index = 0;
    this.completed = new Set();
    this.loadedAudioId = null;
    this.objectUrl = null;
    this.preloaded = null; // { audioId, url }
    this.loading = false;
    this.wantPlay = false;
    this.pendingSeek = null; // posição absoluta no arquivo
    this.pendingPosition = 0; // posição no capítulo enquanto carrega
    this.seekAttempts = 0;
    this.loadToken = 0;
    this.chapterToken = 0;
    this.rate = 1;
    this.lastTick = 0;
    this.listenAcc = 0;
    this.lastSave = 0;
    this.pausedAt = 0;
    this.playlist = null; // { id }
    this.sessionCounted = false;
    this.memoryRetry = false;
    this.silentActive = false;
    this.everPlayed = false;
    this.autoSleepArmed = true;
    this.sleep = { mode: null, value: null, remainingMs: 0, totalMs: 0 };
    this.lastTimeEmit = 0;
    this.debouncedSave = debounce(() => this.save({ force: true }), 600);
  }

  /* ---------------------------------------------------------------- */
  /* Inicialização                                                     */
  /* ---------------------------------------------------------------- */

  init(audio) {
    this.audio = audio;
    audio.preload = 'auto';
    if ('preservesPitch' in audio) audio.preservesPitch = true;
    else if ('webkitPreservesPitch' in audio) audio.webkitPreservesPitch = true;
    this.rate = state.settings.defaultSpeed || 1;

    const on = (e, fn) => audio.addEventListener(e, fn);
    on('play', () => this.onPlay());
    on('pause', () => this.onPause());
    on('timeupdate', () => this.onTimeUpdate());
    on('ended', () => this.onEnded());
    on('loadedmetadata', () => this.onLoadedMetadata());
    on('canplay', () => this.onCanPlay());
    on('seeked', () => this.onSeeked());
    on('error', () => this.onError());
    on('waiting', () => this.emitState());
    on('playing', () => this.emitState());
    on('ratechange', () => {
      if (!this.silentActive && Math.abs(audio.playbackRate - this.rate) > 0.001) audio.playbackRate = this.rate;
    });

    this.setupMediaSession();
    setInterval(() => this.tick(), 1000);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.save({ force: true });
    });
    window.addEventListener('pagehide', () => this.writeSnapshot());

    bus.on('book:deleting', (id) => {
      if (id === '*' || this.book?.id === id) this.unload();
    });
    bus.on('book:structure', (id) => this.onStructureChanged(id));
    bus.on('library', (e) => {
      if (this.book && e?.id === this.book.id && state.books.has(e.id)) {
        this.book = repo.getBook(e.id);
        this.updateMetadata();
      }
    });
  }

  /** Restaura o último livro (pausado) e aplica o snapshot síncrono salvo no pagehide. */
  async restore() {
    try {
      const s = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || 'null');
      if (s?.bookId && state.books.has(s.bookId)) {
        const p = repo.getProgress(s.bookId);
        if (!p || s.t > (p.updatedAt || 0) + 500) await repo.saveProgress({ ...(p || {}), ...s });
      }
    } catch {}
    const id = state.session.lastBookId;
    if (state.settings.autoResume && id && state.books.has(id)) {
      await this.loadBook(id, { autoplay: false });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Estado derivado                                                   */
  /* ---------------------------------------------------------------- */

  get chapter() {
    return this.chapters[this.index] || null;
  }
  get playing() {
    return !!this.audio && !this.audio.paused && !this.silentActive;
  }
  isActive() {
    return this.playing || (this.loading && this.wantPlay);
  }
  chapterStart() {
    return this.chapter?.start || 0;
  }
  chapterDuration(c = this.chapter) {
    if (!c) return 0;
    if (c.duration > 0) return c.duration;
    const d = this.audio?.duration;
    return c === this.chapter && Number.isFinite(d) ? Math.max(0, d - (c.start || 0)) : 0;
  }
  get position() {
    if (!this.chapter) return 0;
    if (this.loading || this.silentActive) return this.pendingPosition;
    const d = this.chapterDuration();
    return clamp(this.audio.currentTime - this.chapterStart(), 0, d > 0 ? d : Infinity);
  }
  bookPosition() {
    return this.chapters.slice(0, this.index).reduce((s, c) => s + (c.duration || 0), 0) + this.position;
  }
  bookDuration() {
    return this.chapters.reduce((s, c) => s + (c.duration || 0), 0) || this.book?.totalDuration || 0;
  }
  snapshot() {
    return {
      book: this.book,
      chapter: this.chapter,
      index: this.index,
      count: this.chapters.length,
      position: this.position,
      duration: this.chapterDuration(),
      playing: this.playing,
      buffering: (this.loading && this.wantPlay) || (this.playing && this.audio.readyState < 3),
      rate: this.rate,
      bookPosition: this.bookPosition(),
      bookDuration: this.bookDuration(),
      sleep: this.sleepInfo(),
      completed: this.completed,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Carregamento                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * Ponto de entrada para ações do usuário ("Ouvir agora", tocar capítulo...).
   * Deve ser chamado de forma síncrona dentro do gesto (clique/toque).
   */
  playBook(bookId, opts = {}) {
    const same = this.book?.id === bookId;
    if (same && opts.chapterIndex == null) {
      this.play();
      return Promise.resolve(true);
    }
    if (this.book && !same) this.save({ force: true });
    this.unlockWithSilence();
    if (same) return this.loadChapter(opts.chapterIndex, opts.position || 0, true);
    return this.loadBook(bookId, { ...opts, autoplay: true });
  }

  /** iOS exige que o primeiro play() de um elemento aconteça dentro de um gesto.
   *  Como o áudio vem do IndexedDB (assíncrono), "destravamos" o elemento com um
   *  clipe silencioso durante o toque; depois a fonte real pode tocar normalmente. */
  unlockWithSilence() {
    if (this.everPlayed || !this.audio) return;
    this.pendingPosition = this.position;
    this.silentActive = true;
    this.loadedAudioId = null;
    this.audio.src = SILENT_SRC;
    this.everPlayed = true;
    this.audio.play()?.catch(() => {});
  }

  async loadBook(bookId, { chapterIndex = null, position = 0, autoplay = false, playlistId = null } = {}) {
    const book = repo.getBook(bookId);
    if (!book) return false;
    const token = ++this.loadToken;
    this.wantPlay = autoplay;
    const chapters = await repo.getChapters(bookId);
    if (token !== this.loadToken) return false;
    if (!chapters.length) {
      this.toast('Este audiolivro não tem capítulos.', 'error');
      return false;
    }
    const prog = repo.getProgress(bookId);
    let idx = 0, pos = 0;
    if (chapterIndex != null) {
      idx = clamp(chapterIndex, 0, chapters.length - 1);
      pos = position || 0;
    } else if (prog) {
      idx = chapters.findIndex((c) => c.id === prog.chapterId);
      if (idx < 0) idx = clamp(prog.chapterIndex || 0, 0, chapters.length - 1);
      pos = prog.position || 0;
      const c = chapters[idx];
      const atEnd = idx === chapters.length - 1 && c.duration > 0 && pos >= c.duration - 2;
      if (atEnd && autoplay) {
        idx = 0;
        pos = 0;
      }
    }

    this.book = book;
    this.chapters = chapters;
    this.index = idx;
    this.completed = new Set(prog?.completed || []);
    this.rate = prog?.rate || state.settings.defaultSpeed || 1;
    if (playlistId) this.playlist = { id: playlistId };
    else if (!(this.playlist && state.playlists.get(this.playlist.id)?.bookIds.includes(bookId))) this.playlist = null;
    this.sessionCounted = false;
    this.autoSleepArmed = true;
    this.waitingForChapter = false;
    this.releasePreload();
    if (!this.silentActive) this.loadedAudioId = null;
    repo.setSession({ lastBookId: bookId }).catch(() => {});
    bus.emit('player:book', book);
    return this.loadChapter(idx, pos, autoplay);
  }

  async loadChapter(index, position = 0, autoplay = false) {
    const c = this.chapters[index];
    if (!c) return false;
    const token = ++this.chapterToken;
    this.waitingForChapter = false;
    this.index = index;
    this.wantPlay = autoplay;
    const abs = (c.start || 0) + Math.max(0, position);

    // Mesmo arquivo (capítulos como trechos): apenas reposiciona.
    if (c.audioId === this.loadedAudioId && !this.silentActive && this.audio.getAttribute('src')) {
      if (this.loading) {
        this.pendingSeek = abs;
        this.pendingPosition = position;
      } else {
        this.audio.currentTime = abs;
      }
      if (autoplay) this.play();
      this.afterChapterChange();
      return true;
    }

    this.loading = true;
    this.pendingSeek = abs;
    this.pendingPosition = Math.max(0, position);
    this.seekAttempts = 0;
    this.memoryRetry = false;
    this.emitState();

    let url = null;
    if (this.preloaded?.audioId === c.audioId) {
      // Caminho síncrono (troca de capítulo em segundo plano).
      url = this.preloaded.url;
      this.preloaded = null;
    } else {
      let blob = null;
      try {
        blob = await repo.getAudioBlob(c.audioId);
      } catch (err) {
        console.error('[player] falha ao ler áudio', err);
      }
      if (token !== this.chapterToken) return false;
      if (!blob) {
        this.loading = false;
        this.wantPlay = false;
        this.emitState();
        this.toast('O áudio deste capítulo não está armazenado neste dispositivo. Abra “Editar livro” para reimportar o arquivo.', 'error');
        bus.emit('player:missing', c);
        return false;
      }
      url = URL.createObjectURL(blob);
    }
    this.setSource(url, c.audioId);
    if (autoplay) this.play();
    this.afterChapterChange();
    this.preloadNext();
    return true;
  }

  setSource(url, audioId) {
    const a = this.audio;
    const old = this.objectUrl;
    this.silentActive = false;
    this.objectUrl = url;
    this.loadedAudioId = audioId;
    a.src = url;
    a.defaultPlaybackRate = this.rate;
    a.playbackRate = this.rate;
    if (old && old !== url) URL.revokeObjectURL(old);
  }

  async preloadNext() {
    const cur = this.chapter;
    if (!cur) return;
    const next = this.chapters.slice(this.index + 1).find((c) => c.audioId !== cur.audioId);
    if (!next || this.preloaded?.audioId === next.audioId) return;
    const token = this.chapterToken;
    const blob = await repo.getAudioBlob(next.audioId).catch(() => null);
    if (!blob || token !== this.chapterToken) return;
    this.releasePreload();
    this.preloaded = { audioId: next.audioId, url: URL.createObjectURL(blob) };
  }

  releasePreload() {
    if (this.preloaded?.url) URL.revokeObjectURL(this.preloaded.url);
    this.preloaded = null;
  }

  finishLoading() {
    this.loading = false;
    this.pendingSeek = null;
    this.lastTick = performance.now();
    this.updatePositionState();
    this.emitState();
    this.emitTime(true);
  }

  unload() {
    const a = this.audio;
    a.pause();
    a.removeAttribute('src');
    a.load();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
    this.releasePreload();
    this.book = null;
    this.chapters = [];
    this.index = 0;
    this.loadedAudioId = null;
    this.loading = false;
    this.cancelSleep();
    if (hasMediaSession) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
    }
    try {
      localStorage.removeItem(SNAPSHOT_KEY);
    } catch {}
    bus.emit('player:book', null);
    this.emitState();
  }

  async onStructureChanged(id) {
    if (this.book?.id !== id) return;
    const active = this.isActive();
    const cid = this.chapter?.id;
    const pos = this.position;
    this.book = repo.getBook(id);
    this.chapters = await repo.getChapters(id);
    this.releasePreload();
    let idx = this.chapters.findIndex((c) => c.id === cid);
    if (idx < 0) {
      this.audio.pause();
      this.loadedAudioId = null;
      await this.loadChapter(0, 0, false);
      return;
    }
    this.index = idx;
    if (this.waitingForChapter && this.chapters.length > idx + 1) {
      this.waitingForChapter = false;
      await this.loadChapter(idx + 1, 0, true);
      return;
    }
    if (this.chapters[idx].audioId !== this.loadedAudioId) {
      this.loadedAudioId = null;
      await this.loadChapter(idx, pos, active);
    } else {
      this.afterChapterChange();
      this.preloadNext();
    }
  }

  /* ---------------------------------------------------------------- */
  /* Controles                                                         */
  /* ---------------------------------------------------------------- */

  play() {
    const a = this.audio;
    if (!this.book || !this.chapter) return;
    this.wantPlay = true;
    if (!a.getAttribute('src') || this.silentActive) {
      this.loadChapter(this.index, this.position, true);
      return;
    }
    if (this.waitingForChapter) {
      this.wantPlay = false;
      this.toast('O próximo capítulo ainda está sendo convertido. Ele começa sozinho quando ficar pronto.');
      return;
    }
    // Livro terminado: recomeçar do início.
    const d = this.chapterDuration();
    if (!this.loading && this.index === this.chapters.length - 1 && d > 0 && this.position >= d - 0.5) {
      this.loadChapter(0, 0, true);
      return;
    }
    // Retrocesso inteligente após pausas longas.
    if (state.settings.smartRewind && this.pausedAt && !this.loading) {
      const away = Date.now() - this.pausedAt;
      const back = away > 3600e3 ? 20 : away > 300e3 ? 10 : away > 60e3 ? 3 : 0;
      if (back) this.seek(Math.max(0, this.position - back), { silent: true });
    }
    this.pausedAt = 0;
    a.playbackRate = this.rate;
    a.play()?.catch((err) => {
      this.wantPlay = false;
      if (err.name === 'NotAllowedError') this.toast('Toque em reproduzir para iniciar o áudio.');
      else if (err.name !== 'AbortError') console.warn('[player] play()', err);
      this.emitState();
    });
  }

  pause() {
    this.wantPlay = false;
    this.audio.pause();
    this.emitState();
  }

  toggle() {
    this.isActive() ? this.pause() : this.play();
  }

  seek(pos, { silent = false } = {}) {
    if (!this.chapter) return;
    const d = this.chapterDuration();
    pos = clamp(pos, 0, d > 0 ? Math.max(0, d - 0.25) : Math.max(0, pos));
    if (this.loading || this.silentActive) {
      this.pendingPosition = pos;
      this.pendingSeek = this.chapterStart() + pos;
    } else {
      this.audio.currentTime = this.chapterStart() + pos;
    }
    this.updatePositionState();
    this.emitTime(true);
    if (!silent) this.debouncedSave();
  }

  skip(delta) {
    if (!this.chapter) return;
    const target = this.position + delta;
    const d = this.chapterDuration();
    if (target < 0 && this.index > 0) {
      const prev = this.chapters[this.index - 1];
      return this.loadChapter(this.index - 1, Math.max(0, (prev.duration || 0) + target), this.isActive());
    }
    if (d > 0 && target >= d && this.index < this.chapters.length - 1) {
      this.markCompleted(this.chapter);
      return this.loadChapter(this.index + 1, Math.max(0, target - d), this.isActive());
    }
    this.seek(target);
  }

  nextChapter() {
    if (!this.book) return;
    if (this.index < this.chapters.length - 1) this.loadChapter(this.index + 1, 0, this.isActive());
    else this.toast('Este é o último capítulo.');
  }

  prevChapter() {
    if (!this.book) return;
    if (this.position > 3 || this.index === 0) this.seek(0);
    else this.loadChapter(this.index - 1, 0, this.isActive());
  }

  setRate(rate) {
    this.rate = rate;
    this.audio.defaultPlaybackRate = rate;
    this.audio.playbackRate = rate;
    this.updatePositionState();
    this.save({ force: true });
    bus.emit('player:rate', rate);
    this.emitState();
  }

  /* ---------------------------------------------------------------- */
  /* Eventos do <audio>                                                */
  /* ---------------------------------------------------------------- */

  onPlay() {
    if (this.silentActive) return;
    this.lastTick = performance.now();
    if (!this.sessionCounted && this.book) {
      this.sessionCounted = true;
      const c = this.chapter;
      repo
        .touchHistory(this.book.id, { chapterIndex: this.index, chapterId: c?.id, chapterTitle: c?.title, position: this.position }, { countPlay: true })
        .catch(() => {});
    }
    if (this.autoSleepArmed && state.settings.defaultSleep && !this.sleep.mode) {
      this.startSleep(state.settings.defaultSleep, { auto: true });
    }
    this.autoSleepArmed = false;
    if (hasMediaSession) navigator.mediaSession.playbackState = 'playing';
    this.updateMetadata();
    this.updatePositionState();
    this.emitState();
  }

  onPause() {
    if (this.silentActive) return;
    this.accountTime();
    if (!this.audio.ended) this.pausedAt = Date.now();
    this.save({ force: true });
    if (hasMediaSession) navigator.mediaSession.playbackState = 'paused';
    this.updatePositionState();
    this.emitState();
  }

  onLoadedMetadata() {
    if (this.silentActive) return;
    const a = this.audio;
    a.playbackRate = this.rate;
    const c = this.chapter;
    if (c && this.book && Number.isFinite(a.duration) && a.duration > 0) {
      const shared = this.chapters.some((x) => x !== c && x.audioId === c.audioId);
      if (!shared && !(c.start > 0)) {
        if (!(c.duration > 0) || Math.abs(c.duration - a.duration) > 1.5) {
          repo.updateChapterDuration(this.book.id, c.id, a.duration).then(() => bus.emit('player:durations'));
        }
      } else if (!(c.duration > 0)) {
        repo.updateChapterDuration(this.book.id, c.id, Math.max(0, a.duration - (c.start || 0)));
      }
      if (this.pendingSeek != null) this.pendingSeek = Math.min(this.pendingSeek, Math.max(0, a.duration - 0.5));
    }
    if (this.pendingSeek != null && this.pendingSeek > 0.05) {
      try {
        a.currentTime = this.pendingSeek;
      } catch {}
    } else {
      this.finishLoading();
    }
  }

  onCanPlay() {
    if (this.silentActive || !this.loading || this.pendingSeek == null) return;
    if (Math.abs(this.audio.currentTime - this.pendingSeek) > 1 && this.seekAttempts++ < 2) {
      this.audio.currentTime = this.pendingSeek;
    } else this.finishLoading();
  }

  onSeeked() {
    if (this.silentActive) return;
    if (this.loading && this.pendingSeek != null && Math.abs(this.audio.currentTime - this.pendingSeek) <= 1) {
      this.finishLoading();
    }
    this.updatePositionState();
  }

  onTimeUpdate() {
    if (this.silentActive || this.loading) return;
    this.accountTime();
    const c = this.chapter;
    const a = this.audio;
    if (c && c.duration > 0 && !a.paused) {
      const end = (c.start || 0) + c.duration;
      if (a.currentTime >= end - 0.15 && Number.isFinite(a.duration) && a.duration - end > 0.5) {
        this.onSegmentEnd();
        return;
      }
    }
    if (state.settings.autosave && !a.paused && Date.now() - this.lastSave > SAVE_INTERVAL_MS) this.save();
    this.emitTime();
  }

  /** Fim de um capítulo que é trecho de um arquivo maior. */
  onSegmentEnd() {
    const cur = this.chapter;
    this.markCompleted(cur);
    const next = this.index + 1;
    if (next >= this.chapters.length) {
      this.audio.pause();
      this.finishBook();
      return;
    }
    if (this.sleep.mode === 'chapter' || !state.settings.autoplayNext) {
      const bySleep = this.sleep.mode === 'chapter';
      this.audio.pause();
      if (bySleep) this.sleepDone('Temporizador: reprodução pausada no fim do capítulo.');
      this.loadChapter(next, 0, false);
      return;
    }
    const nc = this.chapters[next];
    const contiguous = nc.audioId === this.loadedAudioId && Math.abs((nc.start || 0) - ((cur.start || 0) + cur.duration)) < 1.5;
    if (contiguous) {
      this.index = next;
      this.afterChapterChange();
    } else this.loadChapter(next, 0, true);
  }

  onEnded() {
    if (this.silentActive) return;
    const c = this.chapter;
    if (!c) return;
    this.markCompleted(c);
    const next = this.index + 1;
    if (next >= this.chapters.length) {
      this.finishBook();
      return;
    }
    if (this.sleep.mode === 'chapter') {
      this.sleepDone('Temporizador: reprodução pausada no fim do capítulo.');
      this.loadChapter(next, 0, false);
      return;
    }
    this.loadChapter(next, 0, state.settings.autoplayNext);
  }

  async onError() {
    if (this.silentActive) return;
    const err = this.audio.error;
    const c = this.chapter;
    if (!err || !c) return;
    console.warn('[player] erro de mídia', err.code, err.message);
    // Safari pode falhar ao ler Blobs do IndexedDB ("WebKitBlobResource"):
    // tenta uma vez com uma cópia em memória.
    if (!this.memoryRetry) {
      this.memoryRetry = true;
      try {
        const blob = await repo.getAudioBlob(c.audioId);
        if (blob && blob.size < 600 * 1024 * 1024) {
          const copy = new Blob([await blob.arrayBuffer()], { type: blob.type || c.type || 'audio/mpeg' });
          const pos = this.position;
          this.loading = true;
          this.pendingPosition = pos;
          this.pendingSeek = this.chapterStart() + pos;
          this.setSource(URL.createObjectURL(copy), c.audioId);
          this.memoryRetry = true;
          if (this.wantPlay) this.audio.play()?.catch(() => {});
          return;
        }
      } catch {}
    }
    this.loading = false;
    this.wantPlay = false;
    const msg =
      err.code === 4
        ? 'Formato de áudio não suportado por este navegador.'
        : err.code === 3
          ? 'Não foi possível decodificar o áudio (arquivo corrompido?).'
          : 'Erro ao reproduzir o áudio.';
    this.toast(msg, 'error');
    this.emitState();
  }

  markCompleted(c) {
    if (c && !this.completed.has(c.id)) {
      this.completed.add(c.id);
      bus.emit('player:completed', c.id);
    }
  }

  async finishBook() {
    const book = this.book;
    if (!book) return;
    if (repo.getBook(book.id)?.conversion) {
      // Livro ainda sendo convertido: aguarda o próximo capítulo em vez de concluir.
      this.waitingForChapter = true;
      this.wantPlay = false;
      this.save({ force: true });
      this.toast('Você chegou ao último capítulo convertido. O próximo começa sozinho assim que ficar pronto.');
      this.emitState();
      return;
    }
    if (this.sleep.mode === 'chapter') this.sleepDone();
    this.wantPlay = false;
    this.save({ force: true });
    await repo.setFinished(book.id, true);
    this.toast(`Você concluiu “${book.title}”.`, 'success');
    bus.emit('player:finished', book.id);
    if (this.playlist) {
      const pl = state.playlists.get(this.playlist.id);
      const i = pl ? pl.bookIds.indexOf(book.id) : -1;
      const nextId = i >= 0 ? pl.bookIds.slice(i + 1).find((id) => state.books.has(id)) : null;
      if (nextId) {
        await this.loadBook(nextId, { autoplay: true, playlistId: pl.id, chapterIndex: null });
        this.toast(`Playlist: tocando “${repo.getBook(nextId)?.title}”.`);
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Persistência                                                      */
  /* ---------------------------------------------------------------- */

  buildProgress() {
    if (!this.book || !this.chapter) return null;
    const book = this.book, c = this.chapter;
    const prev = repo.getProgress(book.id) || { bookId: book.id, listened: 0, startedAt: Date.now() };
    const listened = this.listenAcc;
    return {
      ...prev,
      bookId: book.id,
      chapterId: c.id,
      chapterIndex: this.index,
      chapterTitle: c.title,
      position: this.position,
      bookPosition: this.bookPosition(),
      rate: this.rate,
      completed: [...this.completed],
      listened: (prev.listened || 0) + listened,
      lastPlayedAt: this.playing || listened > 0 ? Date.now() : prev.lastPlayedAt || null,
    };
  }

  /** Salva o progresso. O registro é montado de forma síncrona (antes de qualquer await). */
  save({ force = false } = {}) {
    if (!this.book || !this.chapter) return;
    if ((this.loading || this.silentActive) && !force) return;
    this.accountTime();
    this.lastSave = Date.now();
    const rec = this.buildProgress();
    const listened = this.listenAcc;
    this.listenAcc = 0;
    this.writeSnapshot(rec);
    const bookId = rec.bookId;
    repo.saveProgress(rec).catch((err) => console.error('[player] falha ao salvar progresso', err));
    if (listened > 0) repo.addListening(bookId, listened).catch(() => {});
    if (this.sessionCounted) {
      repo
        .touchHistory(bookId, { chapterIndex: rec.chapterIndex, chapterId: rec.chapterId, chapterTitle: rec.chapterTitle, position: rec.position, bookPosition: rec.bookPosition }, { silent: true })
        .catch(() => {});
    }
  }

  /** Cópia síncrona no localStorage (sobrevive a fechamentos abruptos). Não contém áudio. */
  writeSnapshot(rec = this.buildProgress()) {
    if (!rec) return;
    try {
      const { bookId, chapterId, chapterIndex, chapterTitle, position, bookPosition, rate } = rec;
      localStorage.setItem(
        SNAPSHOT_KEY,
        JSON.stringify({ bookId, chapterId, chapterIndex, chapterTitle, position, bookPosition, rate, t: Date.now() }),
      );
    } catch {}
  }

  accountTime() {
    const now = performance.now();
    if (!this.audio || this.audio.paused || this.loading || this.silentActive) {
      this.lastTick = now;
      return;
    }
    const dt = now - this.lastTick;
    this.lastTick = now;
    if (dt > 0 && dt < 5000) {
      this.listenAcc += dt / 1000;
      this.sleepTick(dt);
    }
  }

  tick() {
    this.accountTime();
    if (this.sleep.mode === 'time') bus.emit('player:sleep', this.sleepInfo());
  }

  /* ---------------------------------------------------------------- */
  /* Temporizador de desligamento                                      */
  /* ---------------------------------------------------------------- */

  startSleep(value, { auto = false } = {}) {
    if (value === 'chapter') this.sleep = { mode: 'chapter', value, remainingMs: 0, totalMs: 0 };
    else {
      const ms = Number(value) * 60000;
      this.sleep = { mode: 'time', value: Number(value), remainingMs: ms, totalMs: ms };
    }
    this.restoreVolume();
    bus.emit('player:sleep', this.sleepInfo());
    if (auto) this.toast('Temporizador padrão ativado.');
  }

  restartSleep() {
    if (this.sleep.value != null) this.startSleep(this.sleep.value);
  }

  cancelSleep() {
    this.sleep = { mode: null, value: this.sleep.value, remainingMs: 0, totalMs: 0 };
    this.restoreVolume();
    bus.emit('player:sleep', this.sleepInfo());
  }

  sleepDone(message) {
    this.cancelSleep();
    this.autoSleepArmed = true;
    if (message) this.toast(message);
  }

  sleepTick(ms) {
    if (this.sleep.mode !== 'time') return;
    this.sleep.remainingMs -= ms;
    const r = this.sleep.remainingMs;
    // Diminui o volume nos últimos 10 s (no iOS o volume é somente leitura; apenas pausa).
    if (r > 0 && r <= 10000) {
      try {
        this.audio.volume = Math.max(0.08, r / 10000);
      } catch {}
    }
    if (r <= 0) {
      this.audio.pause();
      this.sleepDone('Temporizador concluído: reprodução pausada.');
    }
  }

  restoreVolume() {
    try {
      this.audio.volume = 1;
    } catch {}
  }

  sleepInfo() {
    const s = this.sleep;
    return { ...s, active: !!s.mode };
  }

  /* ---------------------------------------------------------------- */
  /* Media Session (tela de bloqueio / notificações)                   */
  /* ---------------------------------------------------------------- */

  setupMediaSession() {
    if (!hasMediaSession) return;
    const ms = navigator.mediaSession;
    const set = (action, handler) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        /* ação não suportada neste navegador */
      }
    };
    set('play', () => this.play());
    set('pause', () => this.pause());
    set('stop', () => this.pause());
    set('seekbackward', (d) => this.skip(-(d?.seekOffset || state.settings.skipBack || 15)));
    set('seekforward', (d) => this.skip(d?.seekOffset || state.settings.skipForward || 30));
    set('previoustrack', () => this.prevChapter());
    set('nexttrack', () => this.nextChapter());
    set('seekto', (d) => {
      if (d?.seekTime != null) this.seek(d.seekTime);
    });
  }

  async updateMetadata() {
    if (!hasMediaSession || !this.book || !this.chapter || typeof MediaMetadata === 'undefined') return;
    const book = this.book, c = this.chapter;
    const fallback = [{ src: new URL('icons/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' }];
    const build = (art) =>
      new MediaMetadata({
        title: book.title,
        artist: `${c.title} · ${book.author || 'Autor desconhecido'}`,
        album: book.title,
        artwork: art ? [{ src: art, sizes: '512x512', type: 'image/jpeg' }] : fallback,
      });
    try {
      navigator.mediaSession.metadata = build(null);
      const art = await artworkDataURL(book.id);
      if (art && this.book === book && this.chapter === c) navigator.mediaSession.metadata = build(art);
    } catch (err) {
      console.warn('[player] MediaMetadata', err);
    }
  }

  updatePositionState() {
    if (!hasMediaSession || !navigator.mediaSession.setPositionState) return;
    const d = this.chapterDuration();
    try {
      if (!this.chapter || !(d > 0)) return;
      navigator.mediaSession.setPositionState({
        duration: d,
        playbackRate: this.audio.playbackRate || this.rate || 1,
        position: clamp(this.position, 0, d),
      });
    } catch {}
  }

  /* ---------------------------------------------------------------- */
  /* Notificações para a UI                                            */
  /* ---------------------------------------------------------------- */

  afterChapterChange() {
    this.save({ force: true });
    this.updateMetadata();
    this.updatePositionState();
    bus.emit('player:chapter', this.index);
    this.emitState();
    this.emitTime(true);
  }

  emitState() {
    const snap = this.snapshot();
    document.title = snap.book && snap.playing ? `▶ ${snap.book.title} — AUDIOBOOK` : 'AUDIOBOOK';
    bus.emit('player:state', snap);
  }

  emitTime(force = false) {
    const now = performance.now();
    if (!force && now - this.lastTimeEmit < 200) return;
    this.lastTimeEmit = now;
    bus.emit('player:time', this.snapshot());
  }

  toast(message, tone) {
    bus.emit('toast', { message, tone });
  }
}

export const player = new Player();
