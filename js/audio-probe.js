/* Descobre a duração de um arquivo e se o navegador consegue reproduzi-lo. */

export function canPlayType(type) {
  const a = document.createElement('audio');
  return a.canPlayType(type || '') !== '';
}

/**
 * @returns {Promise<{ duration: number, playable: boolean|null }>}
 *   playable = null quando não foi possível determinar (ex.: iOS adia o carregamento).
 */
export function probeAudio(blob, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('audio');
    a.preload = 'metadata';
    a.muted = true;
    let done = false;
    const finish = (duration, playable) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      a.removeAttribute('src');
      try {
        a.load();
      } catch {}
      URL.revokeObjectURL(url);
      resolve({ duration: Number.isFinite(duration) && duration > 0 ? duration : 0, playable });
    };
    a.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(a.duration) && a.duration > 0) finish(a.duration, true);
      else {
        // Alguns arquivos (webm/MP3 VBR sem cabeçalho) informam Infinity: força o cálculo.
        a.addEventListener('durationchange', () => {
          if (Number.isFinite(a.duration) && a.duration > 0) finish(a.duration, true);
        });
        try {
          a.currentTime = 1e7;
        } catch {
          finish(0, true);
        }
      }
    });
    a.addEventListener('error', () => finish(0, false));
    const timer = setTimeout(() => finish(0, null), timeoutMs);
    a.src = url;
    try {
      a.load();
    } catch {}
  });
}
