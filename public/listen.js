import { sendVocabularyAction } from './sync.js';

/** One card of the recording: the word starts, the translation starts, the card ends (seconds), and its number. @typedef {[start:number, answer:number, end:number, card:number]} Segment */
/** @typedef {{version:string, seconds:number, cards:{key:string, lemma:string, translation:string}[], segments:Segment[]}} Mix */

const pendingKey = 'vocabulary-heard:pending';
// Half a second without sound. Playing it inside the click lets Safari start the recording once it has loaded.
const silence = silentClip(0.5);

/** @param {number} seconds */
function silentClip(seconds) {
  const samples = Math.round(8000 * seconds);
  const bytes = new Uint8Array(44 + samples).fill(128, 44);
  const view = new DataView(bytes.buffer);
  /** @param {number} at @param {string} text */
  const ascii = (at, text) => [...text].forEach((letter, i) => view.setUint8(at + i, letter.charCodeAt(0)));
  ascii(0, 'RIFF'); view.setUint32(4, 36 + samples, true); ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true); view.setUint32(28, 8000, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true);
  ascii(36, 'data'); view.setUint32(40, samples, true);
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
}

/** @param {Date} [now] */
function localDay(now = new Date()) {
  const pad = /** @param {number} number */ number => String(number).padStart(2, '0');
  return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
}

/** Expressions heard on this device that the server has not confirmed yet. @returns {Record<string, string[]>} */
function readPending() {
  try { return JSON.parse(localStorage.getItem(pendingKey) ?? 'null') ?? {}; }
  catch { return {}; }
}

/** @param {HTMLElement} section */
function initListen(section) {
  /** @param {string} name */
  const part = name => /** @type {HTMLElement} */ (section.querySelector('[data-listen-' + name + ']'));
  const audio = /** @type {HTMLAudioElement} */ (section.querySelector('audio'));
  const summary = part('summary');
  const start = /** @type {HTMLButtonElement} */ (part('start'));
  const player = part('player');
  const word = part('word');
  const translation = part('translation');
  const toggle = part('toggle');
  const status = part('status');
  /** @type {Mix | null} */
  let mix = null;
  let source = '';
  let loading = false;
  let day = localDay();
  /** Cards counted on this day, and those heard before it in the same recording. @type {Set<number>} */
  let heard = new Set();
  /** @type {Set<number>} */
  let earlier = new Set();
  let flushing = false;
  let shown = '';

  async function refresh() {
    if (source && !audio.paused) return;
    const res = await fetch('/api/vocabulary-audio').catch(() => null);
    // A new recording waits until the current one has stopped.
    if (!res?.ok || loading || (source && !audio.paused)) return;
    /** @type {Mix} */
    const next = await res.json();
    if (next.version === mix?.version) return;
    mix = next;
    unload();
    section.hidden = false;
    const count = mix.cards.length;
    summary.textContent = count + (count === 1 ? ' word' : ' words') + ' · repeats until you pause';
  }

  function unload() {
    if (source) {
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(source);
    }
    source = '';
    shown = '';
    heard = new Set();
    earlier = new Set();
    player.hidden = true;
    start.hidden = false;
    start.disabled = false;
    start.textContent = 'Play';
  }

  /** Downloads the whole recording first, so it keeps playing without a connection. @param {Mix} current */
  async function download(current) {
    const res = await fetch('/vocabulary-audio/' + current.version + '.mp3');
    if (!res.ok || !res.body) throw new Error('No recording');
    const total = Number(res.headers.get('content-length'));
    const reader = res.body.getReader();
    /** @type {BlobPart[]} */
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(/** @type {BlobPart} */ (value));
      size += value.length;
      if (total) start.textContent = 'Loading ' + Math.floor(size / total * 100) + '%';
    }
    return URL.createObjectURL(new Blob(chunks, { type: 'audio/mpeg' }));
  }

  async function play() {
    if (!mix || loading) return;
    status.textContent = '';
    if (source) {
      await audio.play().catch(() => { status.textContent = 'Press play again to start.'; });
      return;
    }
    const current = mix;
    loading = true;
    start.disabled = true;
    start.textContent = 'Loading…';
    audio.src = silence;
    void audio.play().catch(() => {});
    try {
      source = await download(current);
      audio.src = source;
      day = localDay();
      player.hidden = false;
      start.hidden = true;
      render();
      await audio.play();
      toggle.focus({ preventScroll: true });
    } catch (error) {
      if (source) status.textContent = 'Press play to start.';
      else {
        audio.removeAttribute('src');
        audio.load();
        start.disabled = false;
        start.textContent = 'Play';
        status.textContent = 'Couldn’t load the recording. Check the connection and try again.';
      }
    } finally { loading = false; }
  }

  function position() {
    if (!mix) return -1;
    const time = audio.currentTime + 0.05;
    const next = mix.segments.findIndex(([from]) => from > time);
    return next < 0 ? mix.segments.length - 1 : Math.max(0, next - 1);
  }

  /** @param {number} step */
  function move(step) {
    if (!mix || !source) return;
    const count = mix.segments.length;
    audio.currentTime = mix.segments[(position() + step + count) % count][0];
    render();
  }

  function render() {
    if (!mix || !source) return;
    const [, answer, , number] = mix.segments[position()];
    const card = mix.cards[number];
    // The screen gives the same pause for recall as the recording.
    const answered = audio.currentTime >= answer;
    const next = number + ':' + answered + ':' + audio.paused;
    if (next === shown) return;
    shown = next;
    word.textContent = card.lemma;
    translation.textContent = answered ? card.translation : '';
    toggle.textContent = audio.paused ? 'Play' : 'Pause';
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: card.lemma, artist: answered ? card.translation : ' ', album: 'Vocabulary' });
    navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
  }

  /** Cards whose word and translation have played since the recording was loaded. */
  function played() {
    const { played } = audio;
    const result = new Set(/** @type {number[]} */ ([]));
    if (!mix || !source) return result;
    for (const [from, answer, , card] of mix.segments) {
      for (let i = 0; i < played.length; i++) {
        if (played.start(i) <= from + 0.5 && played.end(i) >= answer + 0.5) result.add(card);
      }
    }
    return result;
  }

  function count() {
    if (!mix || !source) return;
    const now = localDay();
    if (now !== day) {
      // Playing through midnight, or a paused page resumed the next day.
      earlier = new Set([...earlier, ...heard, ...played()]);
      heard = new Set();
      day = now;
    }
    const fresh = [...played()].filter(card => !heard.has(card) && !earlier.has(card));
    if (!fresh.length) return;
    const { cards } = mix;
    const pending = readPending();
    pending[day] = [...new Set([...pending[day] ?? [], ...fresh.map(card => cards[card].key)])];
    try { localStorage.setItem(pendingKey, JSON.stringify(pending)); }
    catch { return; }
    for (const card of fresh) heard.add(card);
  }

  async function flush() {
    if (flushing) return;
    flushing = true;
    try {
      for (const [from, keys] of Object.entries(readPending()).sort(([a], [b]) => a.localeCompare(b))) {
        const batch = keys.slice(0, 200);
        await sendVocabularyAction({ type: 'heard', day: from, keys: batch });
        const pending = readPending();
        const left = (pending[from] ?? []).filter(key => !batch.includes(key));
        if (left.length) pending[from] = left;
        else delete pending[from];
        localStorage.setItem(pendingKey, JSON.stringify(pending));
      }
    } catch { /* Kept on this device until the reader can be reached. */ }
    finally { flushing = false; }
  }

  let counted = Date.now();
  audio.addEventListener('timeupdate', () => {
    render();
    if (Date.now() - counted < 20_000) return;
    counted = Date.now();
    count();
    void flush();
  });
  for (const type of ['play', 'pause', 'seeked']) {
    audio.addEventListener(type, () => {
      render();
      count();
      void flush();
    });
  }
  start.addEventListener('click', () => void play());
  toggle.addEventListener('click', () => { if (audio.paused) void play(); else audio.pause(); });
  part('previous').addEventListener('click', () => move(-1));
  part('next').addEventListener('click', () => move(1));
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => void play());
    navigator.mediaSession.setActionHandler('pause', () => audio.pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => move(-1));
    navigator.mediaSession.setActionHandler('nexttrack', () => move(1));
  }
  document.addEventListener('visibilitychange', () => {
    count();
    void flush();
    if (!document.hidden) void refresh();
  });
  window.addEventListener('pagehide', count);
  window.addEventListener('online', () => void flush());
  void refresh();
  void flush();
}

const section = document.querySelector('.listen');
if (section instanceof HTMLElement) initListen(section);
