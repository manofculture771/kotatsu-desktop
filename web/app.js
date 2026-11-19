'use strict';

/* ------------------------------------------------------------------ utils */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const view = $('#view');

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const enc = encodeURIComponent;
const dec = decodeURIComponent;

const LS = {
  favorites: 'kotatsu.favorites.v1',
  history: 'kotatsu.history.v1',
  read: 'kotatsu.read.v1',
  settings: 'kotatsu.settings.v1',
  source: 'kotatsu.source.v1',
};

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* full */ }
  },
};

const state = {
  sources: [],
  source: localStorage.getItem(LS.source) || 'MANGADEX',
  nsfw: localStorage.getItem('kotatsu.nsfw.v1') === '1',
  favorites: store.get(LS.favorites, {}),
  history: store.get(LS.history, []),
  read: store.get(LS.read, {}),
  settings: Object.assign({ mode: 'vertical', width: 900, gap: true }, store.get(LS.settings, {})),
};

const detailCache = new Map();
const listCache = new Map();
const SESSION_BUST = Date.now();

function bust(url) {
  if (!url) return url;
  return `${url}${url.includes('?') ? '&' : '?'}b=${SESSION_BUST}`;
}

function saveFavorites() { store.set(LS.favorites, state.favorites); }
function saveHistory() { store.set(LS.history, state.history); }
function saveRead() { store.set(LS.read, state.read); }
function saveSettings() { store.set(LS.settings, state.settings); }

function toast(message) {
  const box = $('#toast');
  const item = document.createElement('div');
  item.className = 'toast-item';
  item.textContent = message;
  box.appendChild(item);
  setTimeout(() => { item.style.opacity = '0'; item.style.transition = 'opacity .25s'; }, 2600);
  setTimeout(() => item.remove(), 3000);
}

function timeAgo(ms) {
  if (!ms) return '';
  const diff = Date.now() - Number(ms);
  if (!Number.isFinite(diff) || diff < 0) return '';
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function chapterLabel(ch) {
  if (!ch) return 'Chapter';
  if (ch.title && ch.title.trim()) return ch.title.trim();
  if (Number(ch.number) > 0) return `Chapter ${ch.number}`;
  return ch.volume > 0 ? `Volume ${ch.volume}` : 'Chapter';
}

function numberLabel(ch) {
  if (!ch) return '';
  if (Number(ch.number) > 0) return String(ch.number);
  if (ch.volume > 0) return `v${ch.volume}`;
  return '—';
}

function mangaKey(source, manga) { return `${source}|${manga.url}`; }
function readKey(source, manga) { return `${source}|${manga.url}`; }

/** History and favourites keep a catalogue row, never the chapter list. */
function slimManga(manga) {
  return {
    id: manga.id || 0,
    title: manga.title || '',
    url: manga.url,
    publicUrl: manga.publicUrl || '',
    source: manga.source,
    cover: manga.cover || null,
    largeCover: manga.largeCover || null,
    rating: manga.rating || 0,
    state: manga.state || null,
    contentRating: manga.contentRating || null,
    authors: manga.authors || [],
  };
}

async function api(path) {
  const response = await fetch(path, { headers: { Accept: 'application/json' } });
  const text = await response.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* not json */ }
  if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
  return json;
}

function skeletonGrid(count = 18) {
  return `<div class="grid">${Array.from({ length: count }, () => `
    <div><div class="skeleton sk-card"></div><div class="skeleton sk-line" style="width:82%"></div><div class="skeleton sk-line" style="width:44%;margin-top:6px"></div></div>
  `).join('')}</div>`;
}

function errorBox(message, retry) {
  return `<div class="error-box"><strong>Could not load this.</strong><div style="margin-top:6px;color:#ff9aa5">${esc(message)}</div>
    ${retry ? `<button class="btn" style="margin-top:12px" onclick="${retry}">Try again</button>` : ''}</div>`;
}

/* ------------------------------------------------------------------ routing */
function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean).map(dec);
  return { parts, q: new URLSearchParams(queryPart || '') };
}

let renderToken = 0;

async function render() {
  const token = ++renderToken;
  const { parts, q } = parseHash();
  const name = parts[0] || 'home';

  document.body.classList.toggle('reading', name === 'read');
  $$('.nav a').forEach((a) => a.classList.toggle('active',
    a.dataset.nav === name || (name === 'home' && a.dataset.nav === 'home')));

  try {
    if (name === 'home' || name === '') await viewHome(token);
    else if (name === 'browse') await viewBrowse(token, parts[1] || state.source, q);
    else if (name === 'manga') await viewManga(token, parts[1] || state.source, q);
    else if (name === 'read') { viewReader(q); return; }
    else if (name === 'library') viewLibrary();
    else if (name === 'history') viewHistory();
    else if (name === 'sources') openSourcePicker();
    else await viewHome(token);
  } catch (error) {
    if (token === renderToken) view.innerHTML = `<div class="view-pad">${errorBox(error.message)}</div>`;
  }
}

window.addEventListener('hashchange', () => { if (document.body.classList.contains('reading')) cleanupReader(); render().catch(() => {}); });

function go(hash) { location.hash = hash; }

/* ------------------------------------------------------------------ sidebar */
function sourceTitle(name) {
  const found = state.sources.find((s) => s.name === name);
  return found ? found.title : name;
}

function setActiveSource(name) {
  state.source = name;
  localStorage.setItem(LS.source, name);
  $('#active-source').textContent = sourceTitle(name);
  const input = $('#search-input');
  if (input) input.placeholder = `Search ${sourceTitle(name)}…`;
}

/* ------------------------------------------------------------------ home */
async function loadTrending() {
  const preferred = [state.source, 'MANGADEX', 'COMICK', 'MANGAPARK', 'MANGAFIRE', 'ATSUSU'].filter(Boolean);
  const tried = new Set();
  for (const source of preferred) {
    if (tried.has(source)) continue;
    tried.add(source);
    const key = `${source}|trending`;
    try {
      if (listCache.has(key)) return { source, items: listCache.get(key) };
      const data = await api(`/api/sources/${enc(source)}/list?order=POPULARITY&page=1`);
      const items = (data.items || []).filter((m) => state.nsfw || !m.nsfw);
      if (items.length) {
        listCache.set(key, items);
        return { source, items };
      }
    } catch { /* next */ }
  }
  return { source: null, items: [] };
}

function cardHtml(m, source, extra = '') {
  const showSource = !source;
  const src = m.cover || m.largeCover || '';
  const initial = esc((m.title || '?').trim().charAt(0).toUpperCase());
  const href = `#/manga/${enc(source || m.source)}?u=${enc(m.url)}&id=${m.id || 0}&t=${enc(m.title || '')}`;
  return `<a class="card" href="${href}">
    <div class="cover">
      <div class="fallback">${initial}</div>
      ${src ? `<img src="${esc(bust(src))}" alt="" loading="eager" onerror="__imgRetry(this)">` : ''}
      ${m.nsfw ? '<span class="badge red">18+</span>' : (m.state === 'FINISHED' ? '<span class="badge done">Complete</span>' : '')}
      ${extra}
    </div>
    <div class="card-title">${esc(m.title)}</div>
    <div class="card-meta">
      ${m.rating > 0 ? `<span class="rating">${Number(m.rating * 10).toFixed(1)}</span><span class="sep"></span>` : ''}
      <span>${showSource ? esc(m.source) : esc(m.state ? m.state.toLowerCase() : '')}</span>
    </div>
  </a>`;
}

/* A cover that failed while the local server was restarting is retried, not left grey forever. */
window.__imgRetry = (img) => {
  const attempt = Number(img.dataset.retry || 0);
  if (attempt >= 2) { img.style.display = 'none'; return; }
  img.dataset.retry = String(attempt + 1);
  const url = new URL(img.getAttribute('src'), location.origin);
  url.searchParams.set('r', String(attempt + 1));
  setTimeout(() => { img.src = url.toString(); }, 500 * (attempt + 1));
};

function continueCard(entry) {
  const m = entry.manga;
  const ch = entry.chapter;
  const pct = entry.pct ? Math.round(entry.pct * 100) : (entry.pages ? Math.round(((entry.page || 0) / entry.pages) * 100) : 0);
  const src = m.cover || m.largeCover || '';
  return `<a class="cont-card" href="#/read?s=${enc(m.source)}&m=${enc(m.url)}&mt=${enc(m.title)}&mid=${m.id || 0}&c=${enc(ch.url)}&ct=${enc(ch.title || '')}&n=${ch.number || 0}">
    <div class="cover"><div class="fallback">${esc((m.title || '?').charAt(0))}</div>${src ? `<img src="${esc(bust(src))}" alt="" loading="eager" onerror="__imgRetry(this)">` : ''}</div>
    <div class="info">
      <div class="t">${esc(m.title)}</div>
      <div class="c">${esc(chapterLabel(ch))}</div>
      <div class="p">${pct > 0 ? `${pct}% read` : 'continue'}</div>
    </div>
  </a>`;
}

async function viewHome(token) {
  const recent = state.history.slice(0, 8);
  const sources = state.sources;
  const topSources = ['MANGAGEKO', 'MANGAGO', 'MANGADEX', 'MANGAPARK', 'MANGAKAKALOT', 'SUSHISCAN', 'MANGAFIRE', 'MANGANATO']
    .map((n) => sources.find((s) => s.name === n)).filter(Boolean).slice(0, 8);

  view.innerHTML = `<div class="view-pad">
    <div class="page-head">
      <div>
        <p class="eyebrow">Kotatsu-Redo parsers · ${sources.length || '—'} sources</p>
        <h1 class="h1">Read something.</h1>
        <p class="sub">The Android app's source engine, running natively on this laptop. Search a source, keep a library, read in the browser.</p>
      </div>
      <button class="btn" onclick="openSourcePicker()">Browse sources</button>
    </div>

    ${recent.length ? `<div class="section-head"><h2>Continue reading</h2><a class="link" href="#/history">History</a></div>
      <div class="row-scroll">${recent.map(continueCard).join('')}</div>` : ''}

    <div class="section-head"><h2>Popular on ${esc(sourceTitle(state.source))}</h2><a class="link" href="#/browse/${enc(state.source)}">Open source</a></div>
    <div id="trending">${skeletonGrid(12)}</div>

    <div class="section-head"><h2>Fresh updates</h2><span class="link" style="color:var(--muted)">new chapters today</span></div>
    <div id="fresh">${skeletonGrid(8)}</div>

    <div class="section-head"><h2>Sources</h2><a class="link" href="#/sources">All ${sources.length}</a></div>
    <div class="chips">
      ${topSources.map((s) => `<button class="chip" onclick="setActiveSource('${esc(s.name)}');go('#/browse/${enc(s.name)}')">${esc(s.title)} <span style="opacity:.5">${esc(s.locale)}</span></button>`).join('')}
    </div>
  </div>`;

  const { source, items } = await loadTrending();
  if (token !== renderToken) return;
  const box = $('#trending');
  if (!box) return;
  if (!items.length) {
    box.innerHTML = errorBox('No source answered. Open the source list and try another one.');
  } else {
    box.innerHTML = `<div class="grid">${items.slice(0, 24).map((m) => cardHtml(m, source)).join('')}</div>`;
  }

  // A preview shelf of what updated today, in the same source.
  try {
    const fresh = await api(`/api/sources/${enc(source || state.source)}/list?order=UPDATED&page=1`);
    if (token !== renderToken) return;
    const list = (fresh.items || []).filter((m) => state.nsfw || !m.nsfw).slice(0, 14);
    const shelf = $('#fresh');
    if (shelf) {
      shelf.innerHTML = list.length
        ? `<div class="row-covers">${list.map((m) => cardHtml(m, source || state.source)).join('')}</div>`
        : '<div class="empty" style="padding:24px"><p>No recent chapters from this source.</p></div>';
    }
  } catch { /* shelf is optional */ }
}

/* ------------------------------------------------------------------ browse */
async function viewBrowse(token, source, q) {
  setActiveSource(source);
  const query = q.get('q') || '';
  const tags = (q.get('tags') || '').split(',').filter(Boolean);
  const order = q.get('order') || '';
  const meta = state.sources.find((s) => s.name === source);
  const title = meta ? meta.title : source;

  view.innerHTML = `<div class="view-pad">
    <div class="page-head">
      <div>
        <p class="eyebrow">${esc(meta ? `${meta.language} · ${meta.contentType.toLowerCase()}` : 'source')}</p>
        <h1 class="h1">${esc(title)}</h1>
        <p class="sub" id="browse-sub">Loading catalogue…</p>
      </div>
      <button class="btn" onclick="openSourcePicker()">Change source</button>
    </div>
    <div class="toolbar">
      <div class="searchbox">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></svg>
        <input id="browse-search" type="search" placeholder="Search in ${esc(title)}" value="${esc(query)}">
      </div>
      <span class="grow"></span>
      <select class="select" id="browse-order"><option value="">Default order</option></select>
      <button class="btn btn-ghost" id="browse-filter-btn">Genres</button>
    </div>
    <div id="filter-slot"></div>
    <div id="browse-results">${skeletonGrid(18)}</div>
    <div id="browse-more" style="text-align:center;margin:28px 0"></div>
  </div>`;

  const searchInput = $('#browse-search');
  let debounce = 0;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const value = searchInput.value.trim();
      go(`#/browse/${enc(source)}?${new URLSearchParams({ ...(value ? { q: value } : {}), ...(order ? { order } : {}), ...(tags.length ? { tags: tags.join(',') } : {}) })}`);
    }, 420);
  });
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const value = searchInput.value.trim();
      go(`#/browse/${enc(source)}?${new URLSearchParams({ ...(value ? { q: value } : {}), ...(order ? { order } : {}), ...(tags.length ? { tags: tags.join(',') } : {}) })}`);
    }
  });

  const filtersPromise = api(`/api/sources/${enc(source)}/filters`).catch(() => null);

  const filterBtn = $('#browse-filter-btn');
  filterBtn.addEventListener('click', () => {
    const slot = $('#filter-slot');
    if (slot.dataset.open === '1') { slot.innerHTML = ''; slot.dataset.open = '0'; return; }
    slot.dataset.open = '1';
    const available = (filterData?.options?.tags || []).slice(0, 90);
    slot.innerHTML = `<div class="filter-panel">
      <div class="group"><div class="group-label">Genres</div>
        <div class="chips">${available.map((t) => `<button class="chip ${tags.includes(t.key) ? 'on' : ''}" data-tag="${esc(t.key)}">${esc(t.title)}</button>`).join('') || '<span style="color:var(--muted);font-size:12px">This source has no genre list.</span>'}</div>
      </div>
    </div>`;
    $$('[data-tag]', slot).forEach((btn) => btn.addEventListener('click', () => {
      const key = btn.dataset.tag;
      const next = tags.includes(key) ? tags.filter((t) => t !== key) : [...tags, key];
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (order) params.set('order', order);
      if (next.length) params.set('tags', next.join(','));
      go(`#/browse/${enc(source)}?${params}`);
    }));
  });

  const results = $('#browse-results');
  const more = $('#browse-more');
  let page = 1;
  let loading = false;

  async function loadPage() {
    if (loading) return;
    loading = true;
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (query) params.set('q', query);
      if (order) params.set('order', order);
      if (tags.length) params.set('tags', tags.join(','));
      const data = await api(`/api/sources/${enc(source)}/list?${params}`);
      if (token !== renderToken) return;
      const items = (data.items || []).filter((m) => state.nsfw || !m.nsfw);
      const sub = $('#browse-sub');
      if (sub) sub.textContent = `${items.length ? `${items.length} titles on page ${page}` : 'No titles'}${query ? ` for “${query}”` : ''} · ${sourceTitle(source)}`;
      if (page === 1) results.innerHTML = '';
      if (!items.length && page === 1) {
        results.innerHTML = `<div class="empty"><h3>Nothing here</h3><p>${query ? `No match for “${query}” in ${sourceTitle(source)}. It only searches the source you picked.` : `${sourceTitle(source)} came back empty. The source may be down or geo-blocked.`}</p><button class="btn" style="margin-top:16px" onclick="openSourcePicker()">Try another source</button></div>`;
        more.innerHTML = '';
        return;
      }
      results.insertAdjacentHTML('beforeend', `<div class="grid" style="margin-top:${page === 1 ? 0 : 22}px">${items.map((m) => cardHtml(m, source)).join('')}</div>`);
      more.innerHTML = items.length ? `<button class="btn" id="more-btn">Load more</button>` : '';
      const btn = $('#more-btn');
      if (btn) btn.addEventListener('click', () => { page += 1; loadPage(); });
    } catch (error) {
      if (token !== renderToken) return;
      if (page === 1) results.innerHTML = errorBox(error.message);
      more.innerHTML = '';
      const sub = $('#browse-sub');
      if (sub) sub.textContent = 'Could not load this source.';
    } finally {
      loading = false;
    }
  }

  loadPage();

  const filterData = await filtersPromise;
  if (token !== renderToken) return;
  const orderSelect = $('#browse-order');
  if (filterData && filterData.orders) {
    orderSelect.innerHTML = `<option value="">Default order</option>` +
      filterData.orders.map((o) => `<option value="${o}" ${o === order ? 'selected' : ''}>${orderName(o)}</option>`).join('');
  }
  orderSelect.addEventListener('change', () => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (orderSelect.value) params.set('order', orderSelect.value);
    if (tags.length) params.set('tags', tags.join(','));
    go(`#/browse/${enc(source)}?${params}`);
  });
}

function orderName(order) {
  return ({
    UPDATED: 'Recently updated', UPDATED_ASC: 'Oldest update', POPULARITY: 'Most popular',
    POPULARITY_ASC: 'Least popular', RATING: 'Top rated', RATING_ASC: 'Lowest rated',
    NEWEST: 'Newest', NEWEST_ASC: 'Oldest', ALPHABETICAL: 'A → Z', ALPHABETICAL_DESC: 'Z → A',
    ADDED: 'Recently added', ADDED_ASC: 'First added', RELEVANCE: 'Best match',
    POPULARITY_HOUR: 'Trending now', POPULARITY_TODAY: 'Popular today',
    POPULARITY_WEEK: 'Popular this week', POPULARITY_MONTH: 'Popular this month',
    POPULARITY_YEAR: 'Popular this year',
  })[order] || order;
}

/* ------------------------------------------------------------------ manga page */
async function loadDetails(source, url, id, title) {
  const key = `${source}|${url}`;
  if (detailCache.has(key)) return detailCache.get(key);
  const params = new URLSearchParams({ u: url });
  if (id) params.set('id', id);
  if (title) params.set('t', title);
  const data = await api(`/api/sources/${enc(source)}/manga?${params}`);
  if (!data.manga) throw new Error('Empty response');
  detailCache.set(key, data.manga);
  return data.manga;
}

async function viewManga(token, source, q) {
  const url = q.get('u');
  const id = q.get('id') || 0;
  const title = q.get('t') || '';
  if (!url) { go('#/'); return; }

  view.innerHTML = `<div class="view-pad"><div class="detail"><div class="detail-inner">
    <div class="skeleton detail-cover"></div>
    <div style="flex:1"><div class="skeleton sk-line" style="width:50%;height:28px"></div><div class="skeleton sk-line" style="width:30%"></div><div class="skeleton sk-line" style="width:72%;margin-top:22px"></div><div class="skeleton sk-line" style="width:66%"></div></div>
  </div></div></div>`;

  let manga;
  try {
    manga = await loadDetails(source, url, id, title);
  } catch (error) {
    if (token === renderToken) view.innerHTML = `<div class="view-pad">${errorBox(error.message)}</div>`;
    return;
  }
  if (token !== renderToken) return;

  const chapters = (manga.chapters || []).slice().sort((a, b) => (a.number - b.number) || (a.uploadDate - b.uploadDate));
  const key = mangaKey(source, manga);
  const isFav = Boolean(state.favorites[key]);
  const readChapters = new Set(state.read[readKey(source, manga)] || []);
  const progress = state.history.find((h) => h.manga.source === source && h.manga.url === manga.url);
  const startChapter = progress?.chapter || chapters[0];
  const backdrop = manga.largeCover || manga.cover || '';

  const chaptersHtml = chapters.length ? chapters.slice().reverse().map((ch) => {
    const isRead = readChapters.has(ch.url);
    return `<div class="chapter-row ${isRead ? 'read' : ''}" data-ch="${enc(ch.url)}" data-id="${ch.id || 0}" data-t="${enc(ch.title || '')}" data-n="${ch.number || 0}">
      <div class="ch-num">${esc(numberLabel(ch))}</div>
      <div class="ch-title">${esc(chapterLabel(ch))}${ch.scanlator ? `<span class="scan">${esc(ch.scanlator)}</span>` : ''}</div>
      <div class="ch-meta">${timeAgo(ch.uploadDate)} ${isRead ? '<span class="ch-read">✓</span>' : ''}</div>
    </div>`;
  }).join('') : '<div class="empty" style="padding:40px"><p>This source returned no chapters for this title.</p></div>';

  view.innerHTML = `<div class="view-pad detail">
    <div class="detail-backdrop" style="${backdrop ? `background-image:url('${esc(bust(backdrop))}')` : ''}"></div>
    <div class="detail-inner">
      <div class="detail-cover">${backdrop ? `<img src="${esc(bust(backdrop))}" alt="" onerror="__imgRetry(this)">` : ''}</div>
      <div class="detail-body">
        <h1>${esc(manga.title)}</h1>
        ${manga.altTitles?.length ? `<div class="alt">${esc(manga.altTitles.slice(0, 3).join(' · '))}</div>` : ''}
        <div class="meta-row">
          <span class="pill accent">${esc(sourceTitle(source))}</span>
          ${manga.state ? `<span class="pill">${esc(manga.state.toLowerCase())}</span>` : ''}
          ${manga.contentRating ? `<span class="pill">${esc(manga.contentRating.toLowerCase())}</span>` : ''}
          ${manga.rating > 0 ? `<span class="pill" style="color:#ffb347">★ ${Number(manga.rating * 10).toFixed(1)}</span>` : ''}
          ${manga.authors?.length ? `<span class="pill">${esc(manga.authors.slice(0, 2).join(', '))}</span>` : ''}
          <span class="pill">${chapters.length} chapters</span>
        </div>
        ${manga.description ? `<div class="desc clamped" id="desc">${esc(manga.description.replace(/<[^>]+>/g, ' '))}</div><button class="more-btn" id="desc-more">More</button>` : ''}
        <div class="detail-actions">
          ${startChapter ? `<button class="btn btn-primary" id="read-start">
            <svg viewBox="0 0 24 24"><path d="M5 4.5 19 12 5 19.5z"/></svg>
            ${progress ? `Continue · ${chapterLabel(progress.chapter)}` : 'Start reading'}
          </button>` : ''}
          <button class="btn ${isFav ? 'on' : ''}" id="fav-btn">
            <svg viewBox="0 0 24 24"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg>
            ${isFav ? 'In library' : 'Add to library'}
          </button>
          <a class="btn btn-ghost" href="${esc(manga.publicUrl)}" target="_blank" rel="noreferrer">Open on site ↗</a>
        </div>
        ${manga.tags?.length ? `<div class="tag-row">${manga.tags.slice(0, 14).map((t) => `<span class="tag">${esc(t.title)}</span>`).join('')}</div>` : ''}
      </div>
    </div>

    <div class="chapters">
      <div class="ch-head"><h2>Chapters</h2><span class="grow"></span><span style="font-size:11.5px;color:var(--muted)">${chapters.length} total</span></div>
      <div class="chapter-list">${chaptersHtml}</div>
    </div>
  </div>`;

  const more = $('#desc-more');
  if (more) more.addEventListener('click', () => {
    const desc = $('#desc');
    desc.classList.toggle('clamped');
    more.textContent = desc.classList.contains('clamped') ? 'More' : 'Less';
  });

  const favBtn = $('#fav-btn');
  favBtn?.addEventListener('click', () => {
    if (state.favorites[key]) delete state.favorites[key];
    else state.favorites[key] = { manga: slimManga(manga), added: Date.now() };
    saveFavorites();
    favBtn.classList.toggle('on', Boolean(state.favorites[key]));
    favBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg>${state.favorites[key] ? 'In library' : 'Add to library'}`;
    toast(state.favorites[key] ? 'Added to library' : 'Removed from library');
  });

  const openChapter = (chapter) => {
    if (!chapter) return;
    go(`#/read?s=${enc(source)}&m=${enc(manga.url)}&mt=${enc(manga.title)}&mid=${manga.id || 0}&c=${enc(chapter.url)}&ct=${enc(chapter.title || '')}&n=${chapter.number || 0}`);
  };
  $('#read-start')?.addEventListener('click', () => openChapter(startChapter));
  $$('.chapter-row').forEach((row) => row.addEventListener('click', () => {
    openChapter(chapters.find((c) => c.url === dec(row.dataset.ch)) || null);
  }));
}

/* ------------------------------------------------------------------ reader */
let readerState = null;

function cleanupReader() {
  readerState = null;
  document.body.classList.remove('reading');
}

function historyKey(source, manga) { return `${source}|${manga.url}`; }

function rememberReading(source, manga, chapter, page, pages, pct) {
  const entry = {
    manga: slimManga(manga),
    chapter: { url: chapter.url, title: chapter.title || '', number: chapter.number || 0, id: chapter.id || 0 },
    page: page || 0,
    pages: pages || 0,
    pct: pct || 0,
    ts: Date.now(),
  };
  state.history = [entry, ...state.history.filter((h) => !(h.manga.source === manga.source && h.manga.url === manga.url))].slice(0, 60);
  saveHistory();
  const key = readKey(source, manga);
  const list = new Set(state.read[key] || []);
  list.add(chapter.url);
  state.read[key] = [...list].slice(-400);
  saveRead();
}

function viewReader(q) {
  const source = q.get('s');
  const mangaUrl = q.get('m');
  const mangaTitle = q.get('mt') || '';
  const mangaId = q.get('mid') || 0;
  const chapterUrl = q.get('c');
  const chapterTitle = q.get('ct') || '';
  const chapterNumber = Number(q.get('n') || 0);
  if (!source || !chapterUrl) { go('#/'); return; }

  view.innerHTML = `<div class="reader">
    <div class="reader-progress" id="reader-progress"></div>
    <div class="reader-bar" id="reader-bar">
      <button class="icon-btn" id="reader-back" title="Back (Esc)"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>
      <div class="grow">
        <div class="title">${esc(mangaTitle)}</div>
        <div class="sub" id="reader-sub">${esc(chapterTitle || (chapterNumber ? `Chapter ${chapterNumber}` : 'Chapter'))}</div>
      </div>
      <span id="reader-counter" style="font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums"></span>
      <button class="icon-btn" id="reader-mode" title="Reading mode"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="7" rx="1"/><rect x="3" y="14" width="18" height="6" rx="1"/></svg></button>
      <button class="icon-btn" id="reader-width" title="Width"><svg viewBox="0 0 24 24"><path d="M4 12h16M4 12l3-3M4 12l3 3M20 12l-3-3M20 12l-3 3"/></svg></button>
      <button class="icon-btn" id="reader-next-ch" title="Next chapter"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>
    </div>
    <div class="reader-scroll" id="reader-scroll">
      <div style="padding:64px 20px 40px" id="reader-pages">
        <div class="empty"><p>Loading pages…</p></div>
      </div>
    </div>
  </div>`;

  const scroll = $('#reader-scroll');
  const bar = $('#reader-bar');
  const progress = $('#reader-progress');
  const counter = $('#reader-counter');
  let hideTimer = 0;

  const showBar = () => {
    bar.classList.remove('hidden');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => bar.classList.add('hidden'), 2600);
  };
  showBar();
  scroll.addEventListener('mousemove', showBar);
  scroll.addEventListener('scroll', () => { shots(); }, { passive: true });

  const close = () => {
    cleanupReader();
    if (history.length > 1) history.back();
    else go(`#/manga/${enc(source)}?u=${enc(mangaUrl)}&id=${mangaId}&t=${enc(mangaTitle)}`);
  };
  $('#reader-back').addEventListener('click', close);

  const nextChBtn = $('#reader-next-ch');
  nextChBtn.addEventListener('click', () => {
    if (readerState?.next) openReaderChapter(readerState.next);
    else toast('This is the last chapter.');
  });

  const state0 = { source, mangaUrl, mangaTitle, mangaId, chapterUrl, chapterTitle, chapterNumber };
  readerState = state0;
  let chapter = { url: chapterUrl, title: chapterTitle, number: chapterNumber };
  let pages = [];
  let mode = state.settings.mode || 'vertical';
  let index = 0;
  let maxReached = 0;

  const applyWidth = () => {
    const width = state.settings.width || 900;
    $('#reader-pages').style.setProperty('--reader-width', `${width}px`);
    $$('.reader-strip img').forEach((img) => { img.style.maxWidth = `${width}px`; });
  };

  const setMode = (next) => {
    mode = next;
    state.settings.mode = next;
    saveSettings();
    draw();
  };

  const imageUrl = (page) => bust(`/api/img?s=${enc(source)}&p=${enc(page.url)}`);

  function drawVertical() {
    const strip = document.createElement('div');
    strip.className = `reader-strip${state.settings.gap ? ' gap' : ''}`;
    pages.forEach((page, i) => {
      const img = document.createElement('img');
      img.loading = i < 3 ? 'eager' : 'lazy';
      img.decoding = 'async';
      img.src = imageUrl(page);
      img.dataset.i = String(i);
      img.addEventListener('error', () => {
        img.replaceWith(errorPage(i));
      });
      img.addEventListener('load', () => {
        clearTimeout(shotsTimer);
        shotsTimer = setTimeout(shots, 150);
      });
      strip.appendChild(img);
    });
    const host = $('#reader-pages');
    host.innerHTML = '';
    host.appendChild(strip);
    host.appendChild(buildEndCard());
    applyWidth();
    restoreScroll();
  }

  function errorPage(i) {
    const box = document.createElement('div');
    box.style.cssText = `max-width:${state.settings.width}px;width:100%;margin:0 auto;padding:60px 20px;text-align:center;color:var(--muted);border:1px dashed var(--border);border-radius:10px`;
    box.innerHTML = `<div style="font-size:13px">Page ${i + 1} did not load.</div>
      <button class="btn" style="margin-top:10px">Retry</button>`;
    box.querySelector('button').addEventListener('click', () => location.reload());
    return box;
  }

  function drawPaged() {
    const host = $('#reader-pages');
    host.style.padding = '0';
    host.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'reader-paged';
    wrap.style.height = `${Math.max(320, window.innerHeight - 120)}px`;
    const img = document.createElement('img');
    img.src = imageUrl(pages[index]);
    img.alt = '';
    img.addEventListener('error', () => { wrap.innerHTML = ''; wrap.appendChild(errorPage(index)); });
    wrap.appendChild(img);
    wrap.insertAdjacentHTML('beforeend', '<div class="page-zone left" id="zone-left"></div><div class="page-zone right" id="zone-right"></div>');
    host.appendChild(wrap);
    $('#zone-left').addEventListener('click', () => pagedStep(-1));
    $('#zone-right').addEventListener('click', () => pagedStep(1));
    counter.textContent = `${index + 1} / ${pages.length}`;
    progress.style.width = `${((index + 1) / pages.length) * 100}%`;
    paintEnd(host);
    // preload neighbours
    for (const offset of [1, -1, 2]) {
      const n = index + offset;
      if (pages[n]) { const pre = new Image(); pre.src = imageUrl(pages[n]); }
    }
  }

  function paintEnd(host) {
    if (index >= pages.length - 1) {
      if (!host.querySelector('.reader-end')) host.appendChild(buildEndCard());
    }
  }

  function buildEndCard() {
    const end = document.createElement('div');
    end.className = 'reader-end';
    end.innerHTML = `<div style="font-size:13px">End of ${esc(chapterLabel(chapter))}.</div>
      <div class="actions">
        ${readerState.prev ? '<button class="btn" id="end-prev">Previous chapter</button>' : ''}
        ${readerState.next ? '<button class="btn btn-primary" id="end-next">Next chapter</button>' : ''}
      </div>`;
    end.querySelector('#end-prev')?.addEventListener('click', () => openReaderChapter(readerState.prev));
    end.querySelector('#end-next')?.addEventListener('click', () => openReaderChapter(readerState.next));
    return end;
  }

  function draw() {
    if (!pages.length) return;
    if (mode === 'paged') drawPaged();
    else { $('#reader-pages').style.padding = '64px 20px 40px'; drawVertical(); }
    $('#reader-mode').classList.toggle('on', mode === 'paged');
  }

  function pagedStep(delta) {
    index = Math.min(pages.length - 1, Math.max(0, index + delta));
    drawPaged();
    remember(index);
  }

  let shotsTimer = 0;
  function shots() {
    if (mode !== 'vertical') return;
    const images = $$('.reader-strip img');
    if (!images.length) return;
    const max = scroll.scrollHeight - scroll.clientHeight;
    const pct = max > 0 ? Math.min(1, Math.max(0, scroll.scrollTop / max)) : 0;
    const measured = images.filter((img) => img.offsetHeight > 0);
    let current;
    if (measured.length > 1) {
      const middle = scroll.scrollTop + scroll.clientHeight * 0.4;
      current = 0;
      images.forEach((img, i) => { if (img.offsetHeight > 0 && img.offsetTop <= middle) current = i; });
    } else {
      current = Math.min(images.length - 1, Math.floor(pct * images.length));
    }
    index = current;
    progress.style.width = `${pct * 100}%`;
    counter.textContent = `${Math.min(images.length, current + 1)} / ${images.length}`;
    maxReached = Math.max(maxReached, current);
    remember(current, pct);
  }

  let saveTimer = 0;
  function remember(i, pctOverride) {
    if (!pages.length) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const pct = pctOverride ?? ((i + 1) / pages.length);
      rememberReading(source, { ...(readerState.manga || { source, url: mangaUrl, title: mangaTitle, id: mangaId, cover: '' }) }, chapter, i, pages.length, pct);
    }, 700);
  }

  let restorePct = 0;
  function restoreScroll() {
    if (!restorePct) return;
    requestAnimationFrame(() => {
      const max = scroll.scrollHeight - scroll.clientHeight;
      scroll.scrollTop = max * restorePct;
      restorePct = 0;
    });
  }

  $('#reader-mode').addEventListener('click', () => setMode(mode === 'paged' ? 'vertical' : 'paged'));
  $('#reader-width').addEventListener('click', () => {
    const widths = [720, 900, 1100, 1280];
    const current = widths.indexOf(state.settings.width);
    state.settings.width = widths[(current + 1) % widths.length];
    saveSettings();
    applyWidth();
    if (mode === 'vertical') $$('.reader-strip img').forEach((img) => { img.style.maxWidth = `${state.settings.width}px`; });
    toast(`Reader width · ${state.settings.width}px`);
  });

  document.addEventListener('keydown', readerKeys);
  function readerKeys(event) {
    if (!readerState) { document.removeEventListener('keydown', readerKeys); return; }
    if (event.key === 'Escape') { close(); return; }
    if (mode !== 'paged') return;
    if (event.key === 'ArrowRight' || event.key === ' ') { event.preventDefault(); pagedStep(1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); pagedStep(-1); }
  }

  function openReaderChapter(ch) {
    if (!ch) return;
    go(`#/read?s=${enc(source)}&m=${enc(mangaUrl)}&mt=${enc(mangaTitle)}&mid=${mangaId}&c=${enc(ch.url)}&ct=${enc(ch.title || '')}&n=${ch.number || 0}`);
  }

  (async () => {
    try {
      const [details, pageData] = await Promise.all([
        loadDetails(source, mangaUrl, mangaId, mangaTitle),
        api(`/api/sources/${enc(source)}/pages?u=${enc(chapterUrl)}&id=${q.get('cid') || 0}&t=${enc(chapterTitle)}&n=${chapterNumber}`),
      ]);
      readerState.manga = details;
      const chapters = (details.chapters || []).slice().sort((a, b) => (a.number - b.number) || (a.uploadDate - b.uploadDate));
      chapter = chapters.find((c) => c.url === chapterUrl) || { url: chapterUrl, title: chapterTitle, number: chapterNumber };
      const position = chapters.findIndex((c) => c.url === chapter.url);
      readerState.prev = position > 0 ? chapters[position - 1] : null;
      readerState.next = position >= 0 && position < chapters.length - 1 ? chapters[position + 1] : null;
      nextChBtn.disabled = !readerState.next;

      const previous = state.history.find((h) => h.manga.source === source && h.manga.url === mangaUrl && h.chapter.url === chapterUrl);
      restorePct = previous?.pct || 0;

      pages = pageData.pages || [];
      if (!pages.length) throw new Error('This source returned no pages for the chapter.');
      $('#reader-sub').textContent = chapterLabel(chapter);
      draw();
      document.title = `${chapterLabel(chapter)} · ${mangaTitle}`;
      rememberReading(source, details, chapter, previous?.page || 0, pages.length, restorePct);
      shots();
    } catch (error) {
      $('#reader-pages').innerHTML = `<div class="view-pad">${errorBox(error.message)}</div>`;
    }
  })();
}

/* ------------------------------------------------------------------ library / history */
function viewLibrary() {
  const entries = Object.values(state.favorites).sort((a, b) => (b.added || 0) - (a.added || 0));
  view.innerHTML = `<div class="view-pad">
    <div class="page-head"><div><p class="eyebrow">Library</p><h1 class="h1">${entries.length} saved</h1><p class="sub">Stored on this laptop, in this browser profile.</p></div></div>
    ${entries.length ? `<div class="grid">${entries.map((e) => cardHtml(e.manga, e.manga.source)).join('')}</div>`
      : `<div class="empty"><h3>Nothing saved yet</h3><p>Open a manga and press “Add to library”. It stays here until you remove it.</p><a class="btn" style="margin-top:16px" href="#/">Find something</a></div>`}
  </div>`;
}

function viewHistory() {
  const rows = state.history.map((entry) => {
    const manga = entry.manga;
    const pct = entry.pct ? Math.round(entry.pct * 100) : (entry.pages ? Math.round((entry.page / entry.pages) * 100) : 0);
    const cover = manga.cover || manga.largeCover || '';
    return `<a class="lib-row" href="#/read?s=${enc(manga.source)}&m=${enc(manga.url)}&mt=${enc(manga.title)}&mid=${manga.id || 0}&c=${enc(entry.chapter.url)}&ct=${enc(entry.chapter.title || '')}&n=${entry.chapter.number || 0}">
      <div class="cover">${cover ? `<img src="${esc(bust(cover))}" alt="" loading="eager" onerror="__imgRetry(this)">` : ''}</div>
      <div class="grow"><div class="t">${esc(manga.title)}</div><div class="c">${esc(chapterLabel(entry.chapter))} · ${pct}%</div></div>
      <div class="time">${timeAgo(entry.ts)}</div>
    </a>`;
  }).join('');
  view.innerHTML = `<div class="view-pad">
    <div class="page-head"><div><p class="eyebrow">History</p><h1 class="h1">Recent reading</h1></div>
      ${state.history.length ? '<button class="btn" id="clear-history">Clear history</button>' : ''}</div>
    ${rows || `<div class="empty"><h3>No reading yet</h3><p>Anything you open lands here with its progress.</p></div>`}
  </div>`;
  $('#clear-history')?.addEventListener('click', () => {
    state.history = [];
    saveHistory();
    viewHistory();
    toast('History cleared');
  });
}

/* ------------------------------------------------------------------ source picker */
function openSourcePicker() {
  const overlay = $('#overlay');
  overlay.hidden = false;
  overlay.innerHTML = `<div class="modal">
    <div class="modal-head">
      <div class="searchbox">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></svg>
        <input id="picker-search" placeholder="Filter ${state.sources.length} sources…" autofocus>
      </div>
      <button class="icon-btn" id="picker-close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <div class="lang-row" id="lang-row"></div>
    <div class="source-list" id="source-list"></div>
  </div>`;

  const close = () => { overlay.hidden = true; overlay.innerHTML = ''; overlay.onclick = null; };
  $('#picker-close').addEventListener('click', close);
  overlay.onclick = (event) => { if (event.target === overlay) close(); };
  document.addEventListener('keydown', function escClose(event) {
    if (event.key === 'Escape') { close(); document.removeEventListener('keydown', escClose); }
  });

  const languages = ['all', ...new Set(state.sources.map((s) => s.locale))].slice(0, 40);
  let lang = 'all';
  let query = '';

  const paintLangs = () => {
    $('#lang-row').innerHTML = languages.map((code) => `<button class="chip ${lang === code ? 'on' : ''}" data-lang="${esc(code)}">${code === 'all' ? 'All' : (code === '' ? 'Multi' : esc(code.toUpperCase()))}</button>`).join('')
      + `<button class="chip ${state.nsfw ? 'on' : ''}" id="nsfw-toggle" title="Show adult sources">18+</button>`;
    $$('[data-lang]').forEach((btn) => btn.addEventListener('click', () => { lang = btn.dataset.lang; paintLangs(); paintList(); }));
    $('#nsfw-toggle').addEventListener('click', () => {
      state.nsfw = !state.nsfw;
      localStorage.setItem('kotatsu.nsfw.v1', state.nsfw ? '1' : '0');
      paintLangs();
      paintList();
    });
  };

  const paintList = () => {
    const needle = query.toLowerCase();
    const filtered = state.sources
      .filter((s) => (lang === 'all' || s.locale === lang) && (!needle || s.title.toLowerCase().includes(needle) || s.name.toLowerCase().includes(needle)))
      .filter((s) => state.nsfw || !s.nsfw)
      .slice(0, 220);
    $('#source-list').innerHTML = filtered.map((s) => `<button class="source-item ${s.name === state.source ? 'active' : ''}" data-name="${esc(s.name)}">
      <span class="n">${esc(s.title)}</span>
      ${s.broken ? '<span class="bad">broken</span>' : ''}
      <span class="l">${esc(s.locale)}</span>
    </button>`).join('') || '<div class="empty" style="padding:30px"><p>No source matches.</p></div>';
    $$('.source-item').forEach((btn) => btn.addEventListener('click', () => {
      setActiveSource(btn.dataset.name);
      close();
      go(`#/browse/${enc(btn.dataset.name)}`);
    }));
  };

  $('#picker-search').addEventListener('input', (event) => { query = event.target.value.trim(); paintList(); });
  paintLangs();
  paintList();
}

/* ------------------------------------------------------------------ top bar */
$('#search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const value = $('#search-input').value.trim();
  const target = state.source || 'MANGADEX';
  go(value ? `#/browse/${enc(target)}?q=${enc(value)}` : `#/browse/${enc(target)}`);
});

$('#pick-source').addEventListener('click', openSourcePicker);

$('#open-random').addEventListener('click', async () => {
  try {
    const page = 1 + Math.floor(Math.random() * 4);
    const data = await api(`/api/sources/${enc(state.source)}/list?order=POPULARITY&page=${page}`);
    const items = (data.items || []).filter((m) => state.nsfw || !m.nsfw);
    if (!items.length) throw new Error('Nothing to pick from');
    const pick = items[Math.floor(Math.random() * items.length)];
    go(`#/manga/${enc(state.source)}?u=${enc(pick.url)}&id=${pick.id || 0}&t=${enc(pick.title || '')}`);
  } catch (error) { toast(error.message); }
});

/* ------------------------------------------------------------------ boot */
(async function boot() {
  try {
    const data = await api('/api/sources');
    state.sources = data.sources || [];
    if (!state.sources.some((s) => s.name === state.source)) {
      state.source = data.default || state.sources[0]?.name || 'MANGADEX';
    }
    $('#source-count').textContent = String(state.sources.length);
    setActiveSource(state.source);
    $('#server-state').innerHTML = '<i></i> connected';
  } catch (error) {
    $('#server-state').classList.add('bad');
    $('#server-state').innerHTML = '<i></i> server not reachable';
  }
  const q = parseHash().q;
  if (q.get('q')) $('#search-input').value = q.get('q');
  render().catch((error) => { view.innerHTML = `<div class="view-pad">${errorBox(error.message)}</div>`; });
  checkBuild();
})();

/* After the server is rebuilt, an open window picks the new UI up by itself. */
let serverBuild = null;
async function checkBuild() {
  try {
    const health = await api('/api/health');
    const build = health.build ? String(health.build) : null;
    if (serverBuild && build && build !== serverBuild) { location.reload(); return; }
    if (build) serverBuild = build;
  } catch { /* server restarting */ }
}
setInterval(checkBuild, 15000);

window.addEventListener('hashchange', () => {
  const q = parseHash().q;
  if (q.get('q') !== null) $('#search-input').value = q.get('q') || '';
});
