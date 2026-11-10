'use strict';
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = encodeURIComponent;

let B = null;                       // boot data: topics, follows, playlists, counts
const CARDS = {};                   // vid -> last card object rendered
try { localStorage.removeItem('pt-filters'); } catch { /* filters used to be global and remembered; now they live in each page's address */ }

const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const I = {
  play: svg('M8 5v14l11-7z'),
  check: svg('M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z'),
  add: svg('M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z'),
  save: svg('M14 10H3v2h11v-2zm0-4H3v2h11V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM3 16h7v-2H3v2z'),
  hide: svg('M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.804 11.804 0 0 0 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78 3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z'),
  more: svg('M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z'),
  close: svg('M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'),
  out: svg('M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z'),
  up: svg('M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z'),
  down: svg('M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z'),
  trash: svg('M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z'),
  refresh: svg('M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z'),
  list: svg('M3 6h12v2H3zm0 4h12v2H3zm0 4h8v2H3zm12 0v6l5-3z'),
  tune: svg('M15 17h6v1h-6v-1zm-4 0H3v1h8v2h1v-5h-1v2zm3-9h1V3h-1v2H3v1h11v2zm4-3v1h3V5h-3zM6 14h1V9H6v2H3v1h3v2zm4-2h11v-1H10v1z'),
  like: svg('M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z'),
  dislike: svg('M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z'),
};

async function api(path, body, method) {
  const opts = (body !== undefined || method)
    ? { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}), keepalive: path.startsWith('/progress/') }
    : undefined;
  const r = await fetch('/api' + path, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : r.statusText);
  return j;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 4500);
}
const fail = e => toast('Something went wrong: ' + e.message);

function fmtDur(s) {
  if (!s) return '';
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
}
// "a=1&b=2" from an object, skipping empty values; href() puts it after a hash path
const qs = o => Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${enc(v)}`).join('&');
const href = (base, o) => { const q = qs(o); return base + (q ? '?' + q : ''); };
const yti = (vid, f) => `https://i.ytimg.com/vi/${vid}/${f}.jpg`;
const frameOf = q => q === 'hqdefault' ? 'hq2' : 'mq2';   // YouTube's automatic mid-video frame
// With the DeArrow setting on: the community-picked frame if there is one, else YouTube's automatic frame.
// v.da is DeArrow's answer for the video ({title, time, original}); undefined until dearrow() has asked.
function thumb(v, q = 'mqdefault') {
  if (!B.settings.dearrow) return yti(v.vid, q);
  const da = v.da;
  if (da && da.original) return yti(v.vid, q);
  if (da && da.time != null) return `https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=${v.vid}&time=${da.time}`;
  return yti(v.vid, frameOf(q));
}
const timg = (v, q = 'mqdefault', lazy = true) => `<img ${lazy ? 'loading="lazy" ' : ''}src="${thumb(v, q)}" data-tv="${v.vid}" data-q="${q}" alt="">`;
const ttl = v => (B.settings.dearrow && v.da && v.da.title) || v.title;
const tip = v => ttl(v) === v.title ? v.title : 'Original title: ' + v.title;
const vt = v => `<a class="vt" data-tt href="#/v/${v.vid}" title="${esc(tip(v))}">${esc(ttl(v))}</a>`;
const initial = name => esc((String(name || '?').trim()[0] || '?'));
const seenTitle = on => on ? 'Unmark as watched' : 'Mark as watched';
const seenLabel = on => on ? 'Watched' : 'Mark watched';
const followBtn = (channel, on) => `<button class="pill ${on ? '' : 'solid'}" data-follow="${esc(channel)}" data-on="${on ? 1 : 0}">${on ? 'Following' : 'Follow'}</button>`;

// ---------------------------------------------------------------- pieces

function badges(v) {
  let h = '';
  if (v.reason) {
    const to = v.reason.playlist ? `#/playlist/${v.reason.playlist}` : v.reason.vid ? `#/v/${v.reason.vid}` : v.reason.area ? `#/a/${v.reason.area}` : '';
    h += `<span class="via ${esc(v.reason.kind)}">${to ? `<a href="${to}">${esc(v.reason.text)}</a>` : esc(v.reason.text)}</span>`;
  }
  if (v.new && !B.settings.calm) h += '<span class="via new">New</span>';
  return h;
}
const chanLink = v => `<a href="#/channel/${enc(v.channel)}">${esc(v.channel)}</a>`;
const trim1 = n => n.toFixed(1).replace(/\.0$/, '');
function fmtViews(n) {
  if (n == null) return '';
  if (n >= 1e9) return trim1(n / 1e9) + 'B views';
  if (n >= 1e6) return trim1(n / 1e6) + 'M views';
  if (n >= 1e4) return Math.round(n / 1e3) + 'K views';
  if (n >= 1e3) return trim1(n / 1e3) + 'K views';
  return n === 1 ? '1 view' : n + ' views';
}
function ago(iso) {             // "8 years ago", as YouTube writes it
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(iso + 'T00:00:00')) / 864e5);
  if (!(days >= 1)) return 'today';
  for (const [unit, len] of [['year', 365], ['month', 30], ['week', 7], ['day', 1]]) {
    const n = Math.floor(days / len);
    if (n >= 1) return `${n} ${unit}${n > 1 ? 's' : ''} ago`;
  }
}
// "1.2M views · 8 years ago"; the calm setting leaves the view count out
function factLine(v) {
  return [B.settings.calm ? '' : fmtViews(v.views), v.pub ? `<span title="${esc(v.pub)}">${ago(v.pub)}</span>` : ''].filter(Boolean).join(' &middot; ');
}
const fmtMin = s => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
// "Today: 2 videos, 47 min" from the server's tally of actual playback; empty until a minute has been played
const tallyText = t => t && t.secs >= 60 ? `Today: ${t.videos} video${t.videos === 1 ? '' : 's'}, ${fmtMin(t.secs)}` : '';
function thumbBox(v, q) {
  return `<div class="thumb"><a href="#/v/${v.vid}" tabindex="-1" aria-hidden="true">${timg(v, q)}${v.dur ? `<span class="dur">${fmtDur(v.dur)}</span>` : ''}${v.frac ? `<span class="tprog"><i style="width:${Math.round(v.frac * 100)}%"></i></span>` : ''}</a>
    <button class="tbtn" data-act="seen" title="${seenTitle(v.watched)}" aria-label="${seenTitle(v.watched)}">${I.check}</button></div>`;
}
const kebab = '<button class="ibtn kebab" data-act="menu" aria-label="More actions" title="More actions">' + I.more + '</button>';
function card(v) {
  CARDS[v.vid] = v;
  const facts = factLine(v);
  return `<div class="card ${v.watched ? 'seen' : ''}" data-vid="${v.vid}">
    ${thumbBox(v)}
    <div class="info"><div class="text">
      ${vt(v)}
      <div class="sub">${chanLink(v)}</div>
      ${facts ? `<div class="sub">${facts}</div>` : ''}
      ${badges(v)}
    </div>${kebab}</div></div>`;
}
function compact(v) {
  CARDS[v.vid] = v;
  const facts = factLine(v);
  return `<div class="next ${v.watched ? 'seen' : ''}" data-vid="${v.vid}">
    ${thumbBox(v)}
    <div class="text">${vt(v)}
      <div class="sub">${chanLink(v)}</div>${facts ? `<div class="sub">${facts}</div>` : ''}</div></div>`;
}
const grid = items => items.length ? `<div class="grid">${items.map(card).join('')}</div>` : '<p class="empty">Nothing here yet.</p>';

// Filters, as on hackertube.org: a Filters button, a chip per active filter, and a collapsed panel of options.
// Every option is a link that sets one parameter in the page's own address (clicking the active one clears it),
// so filters belong to one page, show in its URL and are gone when you leave.
const filterGroups = () => ({
  len: ['Duration', [['short', 'Under 20 minutes'], ['medium', '20–60 minutes'], ['long', 'Over 1 hour']], !B.has_meta],
  type: ['Type', B.types.map(t => [t, t[0].toUpperCase() + t.slice(1)])],
  area: ['Topic', B.areas.map(a => [a.id, a.name])],
  sort: ['Sort by', [['', 'Best first'], ['recent', 'Recently recommended'], ['gems', 'Hidden gems'], ['date', 'Upload date'], ['views', 'View count']]],
});
const NEEDS_META = { gems: 1, date: 1, views: 1 };
// the filter parameters of this page that hold a known value; anything else in the address is ignored
function filterParams(p, keys) {
  const g = filterGroups();
  return Object.fromEntries(keys.map(k => [k, g[k][1].some(([v]) => v === p[k]) ? p[k] : '']));
}
// base: the page's hash path; keep: parameters to carry along (the search query); f: filterParams() of the page
function filterBar(base, keep, f, extra = '') {
  const g = filterGroups();
  const link = (k, v) => href(base, { ...keep, ...f, [k]: f[k] === v ? '' : v });
  const off = (k, v) => !B.has_meta && (k === 'len' || (k === 'sort' && NEEDS_META[v]));
  const chips = Object.keys(f).filter(k => f[k]).map(k =>
    `<a class="chip on" href="${link(k, f[k])}" title="Remove filter">${esc(g[k][1].find(([v]) => v === f[k])[1])}<span>&times;</span></a>`);
  return `<div class="filterbar">
      <button class="pill" data-act="filters" aria-expanded="false">${I.tune} Filters</button>${chips.join('')}
      <span class="grow"></span>${extra}</div>
    <div class="filters" hidden>${Object.keys(f).map(k => `<div><h4>${g[k][0]}</h4>
      ${g[k][1].map(([v, label]) => off(k, v)
        ? `<span class="off" title="Needs data from YouTube; see Settings">${esc(label)}</span>`
        : `<a href="${link(k, v)}" class="${f[k] === v ? 'on' : ''}">${esc(label)}</a>`).join('')}</div>`).join('')}</div>`;
}

const SIDE_FOLLOWS = 8;             // sidebar shows this many followed channels, new uploads first
function renderSide() {
  $('#sidemore').innerHTML = `
    <h4>Following</h4>
    ${[...B.follows].sort((x, y) => y.new - x.new).slice(0, SIDE_FOLLOWS).map(f => `<a class="item" href="#/channel/${enc(f.name)}"><span class="name">${esc(f.name)}</span>${f.new && !B.settings.calm ? `<span class="dot" title="${f.new} new"></span><span class="n">${f.new}</span>` : ''}</a>`).join('') || '<a class="item muted" href="#/following"><span class="name">Follow a channel</span></a>'}
    ${B.follows.length > SIDE_FOLLOWS ? `<a class="item muted" href="#/following/channels"><span class="name">Show all ${B.follows.length}</span></a>` : ''}
    <h4>Playlists</h4>
    ${B.playlists.map(p => `<a class="item" href="#/playlist/${p.id}"><span class="name">${esc(p.name)}</span><span class="n">${p.done}/${p.total}</span></a>`).join('') || '<a class="item muted" href="#/playlists"><span class="name">Make a playlist</span></a>'}`;
}
function renderCounter() {
  $('#counter').innerHTML = `<b>${B.watched.toLocaleString()}</b> of ${B.total.toLocaleString()} videos watched`;
}
async function reboot() { B = await api('/boot'); renderSide(); renderCounter(); }

// ---------------------------------------------------------------- pages

const main = html => { $('#main').innerHTML = html; };

// Home: what you already chose first (started videos, your queue), then a few suggestions, then a few from
// outside your usual topics. A short page with an end, not a feed.
async function pageMix(p) {
  const f = filterParams(p, ['len', 'type', 'area']);
  const d = await api('/mix?' + qs(f));
  const nice = new Date(d.date + 'T12:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const sec = (title, sub, items) => items.length ? `<section class="hsec"><h3 class="sechead">${title}</h3><p class="sub">${sub}</p>${grid(items)}</section>` : '';
  const body = sec('Continue watching', 'Started and not finished.', d.continue)
    + sec('Your queue', 'Next in your playlists, and uploads from channels you follow.', d.queue)
    + sec('Picked for you', 'A few suggestions close to what you liked and watched.', d.picks)
    + sec('Branch out', 'Well-regarded videos from topics you rarely watch.', d.branch);
  main(`<div class="pagehead"><h2>Today <small>${esc(nice)}</small></h2></div>`
    + filterBar('#/', {}, f, `<span class="muted">${esc(tallyText(d.today))}</span>`)
    + (body ? body + `<div class="endnote"><p>That is everything for today.</p>
        <button class="chip" data-act="reshuffle" title="Deal different suggestions for today">${I.refresh} Different suggestions</button></div>`
      : '<p class="empty">Nothing matches these filters. Try removing one.</p>'));
}

// One listing page for four addresses: #/browse (everything, or search results), #/channel/<name>,
// #/a/<area id> and #/c/<category id>. o says which: { channel }, { area } or { cat }.
async function pageBrowse(p, o = {}) {
  const channel = o.channel || '';
  const area = B.areas.find(a => a.id === o.area || a.categories.some(c => c.id === o.cat));
  const cat = area && area.categories.find(c => c.id === o.cat);
  if ((o.area || o.cat) && !area) return notFound();
  const q = channel || area ? '' : (p.q || '').trim();
  const page = +p.page || 1;
  const f = filterParams(p, ['len', 'type', 'sort']);
  const base = channel ? `#/channel/${enc(channel)}` : cat ? `#/c/${cat.id}` : area ? `#/a/${area.id}` : '#/browse';
  const d = await api('/videos?' + qs({ ...f, q, channel, area: cat ? '' : o.area, cat: o.cat, page }));
  let h = '';
  if (d.channel) {
    h += `<div class="pagehead headrow"><div class="avatar big">${initial(channel)}</div>
      <div><h2>${esc(channel)}</h2><p class="sub">${d.total.toLocaleString()} video${d.total === 1 ? '' : 's'}</p></div>
      ${followBtn(channel, d.channel.followed)}
      <a class="pill" href="https://www.youtube.com/results?search_query=${enc(channel)}" target="_blank" rel="noopener">${I.out} Find on YouTube</a></div>`;
  } else if (area) {
    h += `<div class="pagehead"><div class="crumb"><a href="#/categories">Categories</a>${cat ? ` &rsaquo; <a href="#/a/${area.id}">${esc(area.name)}</a>` : ''}</div>
      <h2>${esc(cat ? cat.name : area.name)}</h2></div>
      ${cat ? '' : `<div class="catwrap">${area.categories.map(c => `<a class="chip" href="#/c/${c.id}">${esc(c.name)}</a>`).join('')}</div>`}`;
  } else {
    h += `<div class="pagehead"><h2>${q ? `Results for &ldquo;${esc(q)}&rdquo;` : 'Browse'}</h2></div>`;
  }
  const to = n => href(base, { q, ...f, page: n });
  const pager = d.pages > 1 ? `<div class="pager">${page > 1 ? `<a class="pill" href="${to(page - 1)}">Previous</a>` : ''}
      <span>Page ${d.page} of ${d.pages}</span>${page < d.pages ? `<a class="pill" href="${to(page + 1)}">Next</a>` : ''}</div>` : '';
  h += filterBar(base, { q }, f, `<span class="muted">${d.total.toLocaleString()} video${d.total === 1 ? '' : 's'}</span>`)
    + (f.sort === 'gems' ? '<p class="note">Hidden gems: recommended by several people, yet little watched on YouTube.</p>' : '')
    + grid(d.items) + pager;
  const yts = q && page === 1;   // general YouTube results under the first page of a search
  if (yts) h += `<section id="ytres" class="ytres"><h3>From YouTube</h3>${B.has_key
    ? '<p class="empty">Searching YouTube…</p>'
    : '<p class="note">Add a YouTube API key to see results from the rest of YouTube here. See <a href="#/setup">Settings</a>.</p>'}</section>`;
  main(h);
  if (yts && B.has_key) ytResults(q, f.len);
}
// Fills the "From YouTube" section after the library results are on screen; does nothing if the page changed meanwhile.
async function ytResults(q, len) {
  const at = location.hash;
  let h;
  try {
    const d = await api('/ytsearch?' + qs({ q, len }));
    if (location.hash !== at) return;
    h = d.items.length ? `<div class="grid">${d.items.map(card).join('')}</div>` : '<p class="empty">YouTube has nothing more for this search.</p>';
  } catch (e) {
    h = `<p class="note err">${esc(e.message)}</p>`;
  }
  const el = $('#ytres');
  if (location.hash !== at || !el) return;
  el.innerHTML = '<h3>From YouTube</h3>' + h;
  dearrow();
}

async function pageVideo(vid, autoplay) {
  const v = await api('/video/' + vid);
  CARDS[v.vid] = v;
  let h = `<div class="watch"><div class="primary ${v.watched ? 'seen' : ''}" data-vid="${v.vid}">
    <div id="player" class="player"><a class="poster" href="#/v/${v.vid}?play=1" data-act="play" aria-label="Play video">
      ${timg(v, 'hqdefault', false)}<span class="play">${I.play}</span>${v.dur ? `<span class="dur">${fmtDur(v.dur)}</span>` : ''}</a></div>
    <h1 data-tt title="${esc(tip(v))}">${esc(ttl(v))}</h1>
    ${v.gone ? '<p class="note err" style="margin:0 0 12px">YouTube says this video has been deleted or made private.</p>' : ''}
    <div class="owner">
      <div class="who"><div class="avatar">${initial(v.channel)}</div>
        <a href="#/channel/${enc(v.channel)}"><b>${esc(v.channel)}</b></a>
        ${followBtn(v.channel, v.followed)}</div>
      <div class="actions">
        <span class="rate"><button class="pill ${v.rating > 0 ? 'on' : ''}" data-act="like" title="I like this: recommend more like it">${I.like} Like</button><button
          class="pill ${v.rating < 0 ? 'on' : ''}" data-act="dislike" title="Not for me: recommend fewer like it" aria-label="Dislike">${I.dislike}</button></span>
        <button class="pill ${v.watched ? 'on' : ''}" data-act="seen" title="${seenTitle(v.watched)}">${I.check}<span class="lbl">${seenLabel(v.watched)}</span></button>
        <button class="pill" data-act="list">${I.save} Save</button>
        <button class="pill" data-act="hide" title="Hide this video forever">${I.hide} Hide</button>
        <a class="pill" href="${esc(v.url)}" target="_blank" rel="noopener">${I.out} YouTube</a>
      </div>
    </div>`;
  if (v.hn) {
    h += `<div class="desc">
        <div class="top-line">${factLine(v)}</div>
        <div class="top-line muted">${esc(v.type)} &middot; ${esc(v.level)}</div>
        <p>${esc(v.summary)}</p>
        <div class="tags">${v.categories.map(c => `<a class="tag" href="#/c/${c.id}">${esc(c.name)}</a>`).join('')}
          ${v.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      </div>
      <details class="comments"><summary>What people said about it <span class="muted">${v.mentions.length}</span></summary>
      <p class="why">${esc(v.why)}</p>
      ${v.mentions.map(m => `<div class="cmt"><div class="avatar">${initial(m.author)}</div><div>
        <div class="meta"><b>${esc(m.author)}</b>${esc(m.month)}</div>
        <div class="body">${esc(m.text)}</div>
        <div class="foot"><a href="${esc(m.url)}" target="_blank" rel="noopener">in &ldquo;${esc(m.story)}&rdquo; &nearr;</a></div></div></div>`).join('')}</details>`;
  } else {
    h += `<div class="desc">${factLine(v) ? `<div class="top-line">${factLine(v)}</div>` : ''}
      <p class="why" style="margin:0">This one comes from ${v.upload ? 'a channel you follow' : v.in_playlists.length ? 'one of your playlists' : 'a YouTube search'}.</p></div>`;
  }
  h += '</div>';
  if (v.hn && v.related.length) h += `<div class="secondary"><h3>Related</h3>${v.related.map(compact).join('')}</div>`;
  main(h + '</div>');
  if (autoplay) startPlayer(v.vid);
}

// ---- embedded player. It is built to end: it asks once per sitting what you came for, hides the related
// videos while one plays, and when the video ends it takes YouTube's end screen away and shows a stop point
// (rate it, done for now) instead of more videos. It also reports progress to the server every 15 seconds:
// the position (to resume, and for "Continue watching") and the seconds actually played (today's tally, Review).

const INTENT_TTL = 3 * 3600e3;      // a sitting: the answer is remembered this long
const INTENT_TEXT = { learn: 'to learn something', unwind: 'to unwind', one: 'for one video' };
function getIntent() {
  try { const i = JSON.parse(localStorage.getItem('pt-intent')); return i && Date.now() - i.ts < INTENT_TTL ? i : null; } catch { return null; }
}
function setIntent(kind, vid) {
  try { localStorage.setItem('pt-intent', JSON.stringify({ kind, vid, ts: Date.now() })); } catch { /* private mode */ }
}
// Shown in place of the player before it starts: the first time in a sitting, and when "just this video" is over.
function intentGate(box, again) {
  box.innerHTML = again
    ? `<div class="gate"><h3>You came for one video.</h3><p>Play this one too?</p><div class="actions">
        <button class="pill" data-act="intent" data-kind="one">Yes, this one too</button>
        <a class="pill solid" href="#/done">No, I'm done</a></div></div>`
    : `<div class="gate"><h3>What are you here for?</h3><div class="actions">
        <button class="pill" data-act="intent" data-kind="learn">Learn something</button>
        <button class="pill" data-act="intent" data-kind="unwind">Unwind</button>
        <button class="pill" data-act="intent" data-kind="one">Just this video</button></div></div>`;
}

let ytApi = null, player = null, progTimer = null, flushProgress = null;
function loadYT() {
  if (!ytApi) ytApi = new Promise((res, rej) => {
    window.onYouTubeIframeAPIReady = () => res(window.YT);
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { ytApi = null; rej(new Error('could not load the YouTube player')); };
    document.head.appendChild(s);
  });
  return ytApi;
}
function stopPlayer() {
  clearInterval(progTimer);
  if (flushProgress) { flushProgress(); flushProgress = null; }
  if (player) { try { player.destroy(); } catch { /* already gone */ } player = null; }
}
// The stop point: replaces the player when a video ends.
function stopScreen(vid, today) {
  const box = $('#player'), v = CARDS[vid] || {}, it = getIntent();
  if (!box) return;
  delete box.dataset.on;
  v.resume = 0;                     // Replay starts from the beginning
  const one = it && it.kind === 'one';
  const line = [tallyText(today), it ? 'You came ' + INTENT_TEXT[it.kind] : ''].filter(Boolean).join(' &middot; ');
  box.innerHTML = `<div class="gate">
    <h3>Finished.</h3>${line ? `<p>${line}</p>` : ''}
    <p class="ask">Was it worth your time?</p>
    <div class="actions"><button class="pill ${v.rating > 0 ? 'on' : ''}" data-act="like">${I.like} Worth it</button>
      <button class="pill ${v.rating < 0 ? 'on' : ''}" data-act="dislike">${I.dislike} Not really</button></div>
    ${v.next_in && !one ? `<p>Next in ${esc(v.next_in.playlist)}: <a href="#/v/${v.next_in.vid}">${esc(v.next_in.title)}</a></p>` : ''}
    <div class="actions"><a class="pill solid" href="#/done">Done for now</a><a class="pill" href="#/">Back to today</a>
      ${!one && $('.watch .secondary') ? '<button class="pill" data-act="showrel">Show related</button>' : ''}
      <button class="pill" data-act="play">${I.refresh} Replay</button></div></div>`;
}
async function startPlayer(vid) {
  const box = $('#player');
  if (!box || box.dataset.on) return;
  if (B.settings.ask_intent && !box.dataset.asked) {
    const it = getIntent();
    if (!it || (it.kind === 'one' && it.vid !== vid)) return intentGate(box, !!it);
  }
  box.dataset.on = 1;
  box.innerHTML = '<div id="yt"></div>';
  const watch = $('.watch');
  if (watch) watch.classList.add('playing');
  const giveUp = why => {
    stopPlayer();
    box.innerHTML = `<div class="msg"><p>${esc(why)} <a href="https://www.youtube.com/watch?v=${vid}" target="_blank" rel="noopener">Open it on YouTube instead.</a></p></div>`;
  };
  let YT;
  try { YT = await loadYT(); } catch (e) { return giveUp('Sorry, ' + e.message + '.'); }
  if (!$('#yt')) return;  // navigated away while the player script loaded
  let start = (CARDS[vid] && CARDS[vid].resume) || 0;
  try { start = start || +localStorage.getItem('pt-pos-' + vid) || 0; localStorage.removeItem('pt-pos-' + vid); } catch { /* positions used to live here */ }
  let marked = !!(CARDS[vid] && CARDS[vid].watched);
  const mark = () => { if (!marked) { marked = true; setWatched(vid, true).catch(fail); } };
  let played = 0, wasPlaying = false, lastTick = Date.now(), lastSent = Date.now(), pos = 0, dur = 0;
  let today = CARDS[vid] && CARDS[vid].today;
  const send = () => {
    const body = { pos, dur, played };
    played = 0; lastSent = Date.now();
    return api('/progress/' + vid, body).then(r => { today = r; }).catch(() => { /* next one will carry on */ });
  };
  const check = () => {
    if (!player || !player.getDuration) return;
    const now = Date.now();
    if (wasPlaying) played += Math.min((now - lastTick) / 1000, 10);
    lastTick = now;
    wasPlaying = player.getPlayerState() === YT.PlayerState.PLAYING;
    const d = player.getDuration(), t = player.getCurrentTime();
    if (!d) return;
    pos = t; dur = d;
    if (t >= d * 0.9) mark();
    if (now - lastSent >= 15000 && played > 0) send();
  };
  flushProgress = () => { check(); if (dur) send(); };
  player = new YT.Player('yt', {
    host: 'https://www.youtube-nocookie.com', videoId: vid, width: '100%', height: '100%',
    playerVars: { autoplay: 1, rel: 0, playsinline: 1, start },
    events: {
      onStateChange: async e => {
        check();
        if (e.data !== YT.PlayerState.ENDED) return;
        mark();
        flushProgress = null;
        await send();
        stopPlayer();
        stopScreen(vid, today);
      },
      onError: () => giveUp("YouTube won't play this one here (the uploader may have turned off embedding, or it is gone)."),
    },
  });
  progTimer = setInterval(check, 5000);
}
// closing the tab mid-video: hand the last position and seconds to the browser to deliver
addEventListener('pagehide', () => { if (flushProgress) flushProgress(); });

function channelRow(c, right) {
  return `<div class="r"><div class="avatar">${initial(c.name)}</div>
    <div class="name"><a href="#/channel/${enc(c.name)}"><b>${esc(c.name)}</b></a><div class="sub">${c.sub}</div></div>${right}</div>`;
}

let chanFilter = '';                // survives the re-render after an unfollow
function applyChanFilter() {
  const q = chanFilter.trim().toLowerCase();
  let n = 0;
  document.querySelectorAll('#chanlist .ch').forEach(el => { el.hidden = !el.dataset.name.includes(q); n += !el.hidden; });
  const none = $('#channone');
  if (none) none.hidden = n > 0;
}

async function pageFollowing(tab) {
  const d = await api('/following');
  const noKey = B.has_key ? '' : 'disabled title="Needs a YouTube API key"';
  const chans = tab === 'channels';
  const total = d.channels.length;
  let h = `<div class="pagehead"><h2>Following</h2>
    <p class="sub">Followed channels show up more often among your suggestions, and (with a YouTube key) their new uploads land here and in your queue.</p></div>
    <div class="tabs"><a href="#/following" class="${chans ? '' : 'on'}">Videos</a><a href="#/following/channels" class="${chans ? 'on' : ''}">Channels <span class="muted">${total}</span></a>
      <span class="grow"></span>${chans ? '' : `<button class="pill" data-act="refresh" ${noKey}>${I.refresh} Check for new uploads</button>`}</div>`;
  if (!B.has_key) h += '<p class="note">No YouTube API key in this session, so new uploads can\'t be fetched. Library videos from followed channels still work. See <a href="#/setup">Settings</a>.</p>';
  if (chans) {
    h += `<div class="forms">
      <form id="chanfind"><input class="field" type="text" name="q" placeholder="Find a channel in the library" aria-label="Find a channel"><button class="pill">Find</button></form>
      <form id="chanurl"><input class="field" type="text" name="url" placeholder="Or any @handle / channel URL" aria-label="Channel URL or handle" ${B.has_key ? '' : 'disabled'}><button class="pill" ${noKey}>Follow</button></form>
      <label class="pill" title="Pick subscriptions.csv from a Google Takeout export of YouTube">Import subscriptions<input type="file" id="subsfile" accept=".csv,text/csv" hidden></label>
    </div><div id="chanresults"></div>`;
    if (total) {
      const list = [...d.channels].sort((x, y) => y.new - x.new);   // stable: alphabetical within equal counts
      h += `<h3 class="sechead">Your channels</h3>
        ${total > 12 ? `<input class="field" id="chanfilter" type="search" placeholder="Filter your ${total} channels" aria-label="Filter your channels" value="${esc(chanFilter)}">` : ''}
        <div class="chlist" id="chanlist">${list.map(c => `<div class="ch" data-name="${esc(c.name.toLowerCase())}">
          <a class="name" href="#/channel/${enc(c.name)}"><b>${esc(c.name)}</b>
            <span class="sub">${c.hn ? `${c.hn} in the library, ${c.unwatched} unwatched` : (c.checked ? 'Uploads only' : 'Not checked yet')}</span></a>
          ${c.new ? `<span class="new">${c.new} new</span>` : ''}
          <button class="unf" data-follow="${esc(c.name)}" data-on="1" title="Unfollow ${esc(c.name)}" aria-label="Unfollow ${esc(c.name)}">${I.close}</button></div>`).join('')}</div>
        <p class="empty" id="channone" hidden>No followed channel matches that.</p>`;
    } else {
      h += '<p class="empty">You are not following anyone yet. Try the search box, or the Follow button on any video.</p>';
    }
  } else {
    if (d.uploads.length) h += '<h3 class="sechead">Uploads</h3>' + grid(d.uploads);
    if (d.picks.length) h += '<h3 class="sechead">From the library</h3>' + grid(d.picks);
    if (!d.uploads.length && !d.picks.length) h += total
      ? '<p class="empty">Nothing unwatched from the channels you follow right now.</p>'
      : '<p class="empty">You are not following anyone yet. Add channels on the <a class="link" href="#/following/channels">Channels</a> tab, or use the Follow button on any video.</p>';
  }
  main(h);
  if (chans) applyChanFilter();
}

async function pagePlaylists() {
  const d = await api('/playlists');
  const noKey = B.has_key ? '' : 'disabled title="Needs a YouTube API key"';
  let h = `<div class="pagehead"><h2>Playlists</h2>
    <p class="sub">The next unwatched video of a few playlists is put in your queue on the home page each day.</p></div>
    <div class="forms">
      <form id="plnew"><input class="field" type="text" name="name" placeholder="New playlist name" aria-label="New playlist name"><button class="pill">Create</button></form>
      <form id="plimport"><input class="field" type="text" name="url" placeholder="YouTube playlist or channel URL" aria-label="YouTube playlist URL, or a channel URL or @handle to pick from its playlists" title="A playlist URL imports that playlist. A channel URL or @handle lists the channel's public playlists to pick from." ${B.has_key ? '' : 'disabled'}><button class="pill" ${noKey}>Import</button></form>
      <label class="pill" title="Pick the CSV files in the &quot;YouTube and YouTube Music/playlists&quot; folder of a Google Takeout export (select them all at once)">Import from Takeout<input type="file" id="plfiles" accept=".csv,text/csv" multiple hidden></label>
    </div><div id="plresults"></div>`;
  if (!B.has_key) h += '<p class="note">Importing playlists by playlist or channel URL needs a YouTube API key in this session, and so do the details of Takeout videos from outside the library. See <a href="#/setup">Settings</a>.</p>';
  if (d.items.length) {
    h += `<div class="pgrid">${d.items.map(p => `<a class="plcard" href="#/playlist/${p.id}" ${p.next ? `data-vid="${(CARDS[p.next.vid] = p.next).vid}"` : ''}>
      <div class="thumb ${p.next ? '' : 'blank'}">${p.next ? timg(p.next) : I.list}<span class="plcount">${p.done}/${p.total} watched</span></div>
      <div class="progress"><i style="width:${p.total ? 100 * p.done / p.total : 0}%"></i></div>
      <div class="vt">${esc(p.name)}</div>
      <div class="sub">${p.next ? 'Up next: ' + esc(ttl(p.next)) : (p.total ? 'All done' : p.pending ? 'Waiting for video details' : 'Empty: use Save on any video')}${p.yt_id ? ' &middot; imported' : ''}</div></a>`).join('')}</div>`;
  } else {
    h += '<p class="empty">No playlists yet. Create one here, then use Save on any video.</p>';
  }
  main(h);
}

async function pagePlaylist(id) {
  const p = await api('/playlists/' + id);
  let h = `<div class="pagehead headrow"><div><h2>${esc(p.name)}</h2><p class="sub">${p.done} of ${p.items.length} watched</p></div>
    <span class="progress"><i style="width:${p.items.length ? 100 * p.done / p.items.length : 0}%"></i></span><span style="flex:1"></span>
    ${p.yt_id ? `<button class="pill" data-act="plsync" data-id="${p.id}" ${B.has_key ? 'title="Add what is new on YouTube, drop what was removed there; your own changes here are kept"' : 'disabled title="Needs a YouTube API key"'}>${I.refresh} Sync with YouTube</button>
      <a class="pill" href="https://www.youtube.com/playlist?list=${esc(p.yt_id)}" target="_blank" rel="noopener">${I.out} On YouTube</a>` : ''}
    <button class="pill danger" data-act="delpl" data-id="${p.id}">${I.trash} Delete playlist</button></div>`;
  if (p.pending) h += `<p class="note">${p.pending} video${p.pending === 1 ? ' is' : 's are'} not shown: imported without a YouTube API key, so there are no titles for them yet. ${B.has_key
    ? `<button class="pill" data-act="plsync" data-id="${p.id}">${I.refresh} Fetch details</button>` : 'See <a href="#/setup">Settings</a>.'}</p>`;
  if (!p.items.length) h += '<p class="empty">Empty. Use Save on any video to add it here.</p>';
  else h += `<ol class="plrows">${p.items.map((v, i) => {
    CARDS[v.vid] = v;
    const facts = factLine(v);
    return `<li class="row ${v.watched ? 'seen' : ''} ${v.vid === p.next ? 'nextup' : ''}" data-vid="${v.vid}" data-pl="${p.id}">
      <span class="num">${i + 1}</span>
      <div class="thumb"><a href="#/v/${v.vid}" tabindex="-1" aria-hidden="true">${timg(v)}${v.dur ? `<span class="dur">${fmtDur(v.dur)}</span>` : ''}</a></div>
      <div class="text">${vt(v)}
        <div class="sub">${[chanLink(v), facts].filter(Boolean).join(' &middot; ')}</div>
        ${v.vid === p.next ? '<span class="via next">Up next</span>' : ''}</div>
      <div class="tools">
        <button class="ibtn" data-act="watch" title="Play" aria-label="Play">${I.play}</button>
        <button class="ibtn ${v.watched ? 'on' : ''}" data-act="seen" title="${seenTitle(v.watched)}" aria-label="${seenTitle(v.watched)}">${I.check}</button>
        <button class="ibtn" data-act="up" title="Move up" aria-label="Move up">${I.up}</button>
        <button class="ibtn" data-act="down" title="Move down" aria-label="Move down">${I.down}</button>
        <button class="ibtn" data-act="unlist" title="Remove from playlist" aria-label="Remove from playlist">${I.close}</button>
      </div></li>`;
  }).join('')}</ol>`;
  main(h);
}

async function pageHistory() {
  const d = await api('/history');
  let h = `<div class="pagehead"><h2>History</h2><p class="sub">${d.items.length ? 'Everything you have marked as watched, newest first.' : 'Nothing watched yet.'}</p></div>` + (d.items.length ? grid(d.items) : '');
  if (d.hidden.length) h += `<h3 class="sechead">Hidden videos</h3><div class="rows">${d.hidden.map(v => `<div class="r plain" data-vid="${v.vid}">
    <div class="name">${esc(v.title)}</div><button class="pill" data-act="unhide">Bring back</button></div>`).join('')}</div>`;
  main(h);
}

async function pageForYou(p) {
  const f = filterParams(p, ['len', 'type', 'area']);
  const d = await api('/foryou?' + qs(f));
  let h = `<div class="pagehead"><h2>For You</h2>
    <p class="sub">Unwatched videos closest to what you liked. Each one says which like it comes from; the suggestions on the home page lean the same way.</p></div>`
    + filterBar('#/foryou', {}, f, d.items.length ? `<span class="muted">from ${d.likes} like${d.likes === 1 ? '' : 's'} and your history</span>` : '');
  if (d.items.length) h += grid(d.items);
  else if (!d.likes && !d.watched) h += `<p class="empty">Nothing to go on yet. Like a few videos (the thumbs-up on a video's page, or the three-dot menu on any card) and recommendations will show up here.</p>`;
  else h += '<p class="empty">No close matches. Like a few more videos, or remove a filter.</p>';
  main(h);
}

async function pageLiked() {
  const d = await api('/liked');
  let h = `<div class="pagehead"><h2>Liked</h2><p class="sub">${d.items.length ? 'Videos you gave a thumbs-up, newest first. These steer For You and the suggestions on the home page.' : 'No likes yet. Use the thumbs-up on a video\'s page, or the three-dot menu on any card.'}</p></div>` + (d.items.length ? grid(d.items) : '');
  if (d.disliked.length) h += `<h3 class="sechead">Disliked</h3><div class="rows">${d.disliked.map(v => `<div class="r plain" data-vid="${v.vid}">
    <div class="name"><a href="#/v/${v.vid}">${esc(v.title)}</a></div><button class="pill" data-act="unrate">Remove dislike</button></div>`).join('')}</div>`;
  main(h);
}

// every topic area with its categories, plus quick ways into the whole collection
function pageCategories() {
  const meta = (to, label) => B.has_meta ? `<a class="pill" href="${to}">${label}</a>`
    : `<button class="pill" disabled title="Needs data from YouTube; see Settings">${label}</button>`;
  main(`<div class="explore">
    <div class="pagehead"><h2>Categories</h2></div>
    <div class="quick">
      <a class="pill" href="#/browse?sort=recent">Recently recommended</a>
      ${meta('#/browse?len=long', 'Longs')}
      ${meta('#/browse?sort=gems', 'Hidden gems')}
      <a class="pill" href="#/browse">All videos</a>
    </div>
    <div class="areas">${B.areas.map(a => `<section class="areacard">
      <a class="areaname" href="#/a/${a.id}">${esc(a.name)}<span class="count">${a.count}</span></a>
      <div class="cats">${a.categories.map(c => `<a href="#/c/${c.id}">${esc(c.name)}<span class="count">${c.count}</span></a>`).join('')}</div>
    </section>`).join('')}</div>
  </div>`);
}

function pageSetup() {
  const sw = (key, name, text) => `<label class="setting"><span><b>${name}</b><span>${text}</span></span>
      <input type="checkbox" class="switch" data-set="${key}" ${B.settings[key] ? 'checked' : ''}></label>`;
  main(`<div class="pagehead"><h2>Settings</h2></div>
    <div class="about">
    ${sw('ask_intent', 'Ask what I am here for', 'Before the first video of a sitting, one tap: learn something, unwind, or just this video. The answer is shown back when a video ends, counted on the Review page, and "just this video" checks with you before playing a second one.')}
    ${sw('calm', 'Calm presentation', 'No view counts, and no "new" dots or badges asking for attention. Uploads from followed channels still arrive in your queue.')}
    ${sw('hide_watched', 'Hide played videos', 'Watched videos disappear from the home page, Browse, search, channel pages and related videos instead of showing dimmed. History, Liked and playlists still list them.')}
    ${sw('dearrow', 'Video frames and plain titles (DeArrow)', 'Show a frame from the video instead of the uploader\'s thumbnail, and the community-written title from <a href="https://dearrow.ajay.app" target="_blank" rel="noopener">DeArrow</a> where one exists. Hover a title to see the original. Video ids are looked up on DeArrow\'s servers (by hash prefix).')}
    <h3 class="sechead">YouTube API key</h3>
    <p class="fine" style="margin-top:4px">For durations, new uploads and playlist import.</p>
    <div class="stats">
      <div class="stat"><b>${B.has_meta.toLocaleString()}</b><span>of ${B.total.toLocaleString()} videos have durations</span></div>
      <div class="stat"><b>${B.has_key ? 'Connected' : 'Not set'}</b><span>YouTube API key in this session</span></div>
    </div>
    <p>The video library ships without YouTube's own metadata. A free key (no credit card, about 5 minutes) unlocks the length filter, new uploads from followed channels, and playlist import.</p>
    <ol class="steps">
      <li>Open <a href="https://console.cloud.google.com/" target="_blank" rel="noopener">console.cloud.google.com</a> and sign in.</li>
      <li>Top bar &rarr; project picker &rarr; <b>New project</b> (any name, e.g. "personaltube").</li>
      <li><b>APIs &amp; Services &rarr; Library</b>, search <b>YouTube Data API v3</b>, click <b>Enable</b>.</li>
      <li><b>APIs &amp; Services &rarr; Credentials &rarr; Create credentials &rarr; API key</b>. Copy the key.</li>
      <li>Click the new key &rarr; <b>API restrictions &rarr; Restrict key &rarr; YouTube Data API v3</b> &rarr; Save.</li>
      <li>Store it in your login keyring (it prompts for the key, so it stays out of files and shell history):
        <pre>secret-tool store --label="PersonalTube YouTube API key" service personaltube name YOUTUBE_API_KEY
pixi run fetch-meta     # once: durations for every video, ~130 quota units
pixi run start          # restart the app; it reads the key from the keyring</pre></li>
    </ol>
    <p class="fine">Free quota is 10,000 units a day. Checking uploads costs about 2 units per followed channel, twice a day at most.
      Re-run <code>pixi run fetch-meta --refresh</code> every few months to keep durations and deletions current.</p></div>`);
}

// The last seven days, laid out for you to judge rather than to keep you going.
async function pageReview() {
  const d = await api('/review');
  const max = Math.max(...d.days.map(x => x.secs), 1);
  const rated = d.worth + d.not_worth;
  const diff = d.total - d.prev;
  const came = Object.entries(d.intents).filter(([, n]) => n).map(([k, n]) => `${n}&times; ${INTENT_TEXT[k]}`).join(', ');
  const list = (title, rows) => rows.length ? `<div><h4>${title}</h4>${rows.map(r => `<div class="rrow"><span>${esc(r.name)}</span><span class="muted">${fmtMin(r.secs)}</span></div>`).join('')}</div>` : '';
  main(`<div class="pagehead"><h2>Review</h2><p class="sub">Your last seven days here: how long you watched, and whether it was worth it.</p></div>
    <div class="review">
    <div class="stats">
      <div class="stat"><b>${fmtMin(d.total)}</b><span>played this week${d.prev ? ` &middot; ${fmtMin(Math.abs(diff))} ${diff >= 0 ? 'more' : 'less'} than the week before` : ''}</span></div>
      <div class="stat"><b>${d.finished.length}</b><span>video${d.finished.length === 1 ? '' : 's'} finished</span></div>
      <div class="stat"><b>${rated ? `${d.worth} of ${rated}` : '&ndash;'}</b><span>rated worth your time${d.unrated ? ` &middot; ${d.unrated} not rated` : ''}</span></div>
    </div>
    ${d.total ? '' : '<p class="note">Playback time is counted from now on, so this fills in as you watch.</p>'}
    <div class="days">${d.days.map(x => `<div class="rrow"><span>${new Date(x.day + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</span>
      <span class="progress"><i style="width:${100 * x.secs / max}%"></i></span><span class="muted">${x.secs ? fmtMin(x.secs) : '&ndash;'}</span></div>`).join('')}</div>
    ${came ? `<p class="came">You came ${came}.</p>` : ''}
    <div class="where">${list('Where the time went', d.areas)}${list('Channels', d.channels)}</div>
    </div>
    ${d.finished.length ? '<h3 class="sechead">Finished this week</h3>' + grid(d.finished) : ''}`);
}

// Where "Done for now" leads: nothing to click on.
async function pageDone() {
  await reboot();
  main(`<div class="donepage"><h2>That's it for now.</h2>
    ${tallyText(B.tally) ? `<p>${esc(tallyText(B.tally))}.</p>` : ''}
    <p class="muted">Your queue will still be here. You can close this tab.</p>
    <p><a class="link" href="#/review">This week in review</a></p></div>`);
}

// ---------------------------------------------------------------- router

const notFound = () => main('<div class="pagehead"><h2>Page not found</h2><p class="sub">There is nothing at this address. <a class="link" href="#/">Back to today</a></p></div>');
const routeName = () => location.hash.replace(/^#\/?/, '').split(/[/?]/)[0];

async function route() {
  stopPlayer();
  closePopup();
  document.body.classList.remove('drawer');
  const [path, qs = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const p = Object.fromEntries(new URLSearchParams(qs));
  const [name, ...rest] = path.split('/');
  const arg = decodeURIComponent(rest.join('/'));
  const tab = { '': 'mix', foryou: 'foryou', liked: 'liked', browse: 'browse', categories: 'categories', a: 'categories', c: 'categories', channel: 'following', following: 'following', playlists: 'playlists', playlist: 'playlists', history: 'history', review: 'review', setup: 'setup' }[name];
  document.querySelectorAll('#side .nav a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  $('#search input').value = name === 'browse' ? (p.q || '') : '';
  try {
    if (name === '') await pageMix(p);
    else if (name === 'browse') await pageBrowse(p);
    else if (name === 'channel') await pageBrowse(p, { channel: arg });
    else if (name === 'a') await pageBrowse(p, { area: arg });
    else if (name === 'c') await pageBrowse(p, { cat: arg });
    else if (name === 'v') await pageVideo(arg, !!p.play);
    else if (name === 'following') await pageFollowing(arg);
    else if (name === 'playlists') await pagePlaylists();
    else if (name === 'playlist') await pagePlaylist(arg);
    else if (name === 'history') await pageHistory();
    else if (name === 'foryou') await pageForYou(p);
    else if (name === 'liked') await pageLiked();
    else if (name === 'review') await pageReview();
    else if (name === 'done') await pageDone();
    else if (name === 'categories') pageCategories();
    else if (name === 'setup') pageSetup();
    else notFound();
  } catch (e) {
    main(`<p class="note err">${esc(e.message)}</p>`);
  }
  dearrow();
}

// Ask the server for DeArrow titles/frames of the videos on screen that it has not cached yet, then patch them in.
async function dearrow() {
  if (!B.settings.dearrow) return;
  const vids = [...new Set([...document.querySelectorAll('#main [data-vid]')].map(el => el.dataset.vid))]
    .filter(v => CARDS[v] && CARDS[v].da === undefined);
  for (let i = 0; i < vids.length; i += 50) {
    let r;
    try { r = await api('/dearrow', { vids: vids.slice(i, i + 50) }); } catch { return; }
    for (const [vid, da] of Object.entries(r)) {
      const v = CARDS[vid];
      if (!v) continue;
      v.da = da;
      document.querySelectorAll(`#main [data-vid="${vid}"]`).forEach(el => {
        el.querySelectorAll(`img[data-tv="${vid}"]`).forEach(im => { const u = thumb(v, im.dataset.q); if (im.getAttribute('src') !== u) im.src = u; });
        if (da.title) el.querySelectorAll('[data-tt]').forEach(t => { if (t.closest('[data-vid]') === el) { t.textContent = ttl(v); t.title = tip(v); } });
      });
    }
  }
}
// A frame that fails to load falls back: DeArrow's frame -> YouTube's automatic frame -> the normal thumbnail.
document.addEventListener('error', e => {
  const im = e.target;
  if (!(im instanceof HTMLImageElement) || !im.dataset.tv) return;
  const frame = yti(im.dataset.tv, frameOf(im.dataset.q)), orig = yti(im.dataset.tv, im.dataset.q);
  const cur = im.getAttribute('src');
  if (cur.includes('dearrow-thumb')) im.src = frame;
  else if (cur === frame) im.src = orig;
}, true);
const refresh = async () => { await reboot(); await route(); };

// ---------------------------------------------------------------- actions

function markSeen(vid, on) {
  if (CARDS[vid]) CARDS[vid].watched = on;
  document.querySelectorAll(`[data-vid="${vid}"]`).forEach(el => {
    el.classList.toggle('seen', on);
    el.querySelectorAll('[data-act="seen"]').forEach(b => {
      b.title = seenTitle(on);
      if (b.hasAttribute('aria-label')) b.setAttribute('aria-label', seenTitle(on));
      if (!b.classList.contains('tbtn')) b.classList.toggle('on', on);
      const lbl = $('.lbl', b);
      if (lbl) lbl.textContent = seenLabel(on);
    });
  });
}
function markRated(vid, r) {
  if (CARDS[vid]) CARDS[vid].rating = r;
  document.querySelectorAll(`[data-vid="${vid}"]`).forEach(el => {
    el.querySelectorAll('[data-act="like"]').forEach(b => b.classList.toggle('on', r > 0));
    el.querySelectorAll('[data-act="dislike"]').forEach(b => b.classList.toggle('on', r < 0));
  });
}
// pages where the "hide played videos" setting removes a video as soon as it is marked watched
const hidesWatched = () => B.settings.hide_watched && !/^#\/(v|playlist|history|liked|review|setup)/.test(location.hash);
async function setWatched(vid, on) {
  const r = await api('/watched/' + vid, { watched: on });
  if (on && hidesWatched()) { toast('Marked watched and hidden. Undo from History.'); return refresh(); }
  markSeen(vid, on);
  await reboot().catch(() => { B.watched = r.watched; renderCounter(); });
}

// ---- popup: the per-video menu and the "save to playlist" picker share one floating panel

let popHost = null, popAnchor = null;
function closePopup() { $('#popup').hidden = true; popHost = popAnchor = null; }
function openPopup(html, vid, anchor, host) {
  const pop = $('#popup');
  pop.innerHTML = html;
  pop.dataset.pv = vid;
  popHost = host; popAnchor = anchor;
  pop.hidden = false;
  const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, ht = pop.offsetHeight;
  let left = r.left;
  if (left + w > innerWidth - 8) left = r.right - w;
  let top = r.bottom + 4;
  if (top + ht > innerHeight - 8 && r.top - ht - 4 > 60) top = r.top - ht - 4;
  pop.style.left = Math.max(8, left) + scrollX + 'px';
  pop.style.top = top + scrollY + 'px';
}
function menuPopup(vid, anchor, host) {
  const on = !!(CARDS[vid] && CARDS[vid].watched), r = (CARDS[vid] && CARDS[vid].rating) || 0;
  openPopup(`<button class="mi" data-act="watch">${I.play}<span>Play now</span></button>
    <button class="mi" data-act="like">${I.like}<span>${r > 0 ? 'Remove like' : 'Like: more like this'}</span></button>
    <button class="mi" data-act="dislike">${I.dislike}<span>${r < 0 ? 'Remove dislike' : 'Dislike: fewer like this'}</span></button>
    <button class="mi" data-act="seen">${I.check}<span>${seenTitle(on)}</span></button>
    <button class="mi" data-act="list">${I.save}<span>Save to playlist</span></button>
    <button class="mi" data-act="hide">${I.hide}<span>Hide forever</span></button>`, vid, anchor, host);
}
function listPopup(vid, anchor, host) {
  openPopup(`<div class="mh">Save to playlist</div>
    ${B.playlists.map(p => `<button class="mi" data-addto="${p.id}">${I.list}<span>${esc(p.name)}</span></button>`).join('') || '<div class="mnone">No playlists yet</div>'}
    <form id="popnew"><input class="field" type="text" name="name" placeholder="New playlist" aria-label="New playlist name"><button class="pill">Add</button></form>`, vid, anchor, host);
}

document.addEventListener('click', async e => {
  const pop = $('#popup');
  const t = e.target.closest('[data-act],[data-follow],[data-addto]');
  if (!t) { if (!e.target.closest('#popup')) closePopup(); return; }
  const inPop = pop.contains(t);
  const host = inPop ? popHost : t.closest('[data-vid]');
  const vid = inPop ? pop.dataset.pv : host && host.dataset.vid;
  const anchor = inPop ? popAnchor : t;
  if (inPop && t.dataset.act && t.dataset.act !== 'list') closePopup();
  else if (!inPop && !pop.hidden && t.dataset.act !== 'menu' && t.dataset.act !== 'list') closePopup();
  try {
    if (t.dataset.follow !== undefined) {
      const on = t.dataset.on !== '1';
      await api('/follow', { channel: t.dataset.follow, follow: on });
      toast(on ? `Following ${t.dataset.follow}` : `Unfollowed ${t.dataset.follow}`);
      if (!location.hash.startsWith('#/v/')) return refresh();
      t.dataset.on = on ? 1 : 0;           // keep the player running: update in place
      t.textContent = on ? 'Following' : 'Follow';
      t.classList.toggle('solid', !on);
      return reboot();
    }
    if (t.dataset.addto !== undefined) {
      await api(`/playlists/${t.dataset.addto}/add`, { vid: pop.dataset.pv });
      closePopup(); toast('Saved to playlist'); return reboot();
    }
    switch (t.dataset.act) {
      case 'subsall': case 'subsnone': case 'subshn':
        document.querySelectorAll('#chanresults .subpick:not(:disabled)').forEach(b => {
          b.checked = t.dataset.act === 'subsall' || (t.dataset.act === 'subshn' && b.dataset.hn !== '0');
        });
        return subsCount();
      case 'subsgo': {
        const channels = [...document.querySelectorAll('#chanresults .subpick:checked')].map(b => ({ id: b.dataset.id, name: b.dataset.name }));
        const r = await api('/subs/import', { channels });
        toast(`Following ${r.added} more channel${r.added === 1 ? '' : 's'}`);
        return refresh();
      }
      case 'menu':
        e.stopPropagation();
        if (!pop.hidden && popAnchor === t) return closePopup();
        return menuPopup(vid, t, host);
      case 'watch': location.hash = `#/v/${vid}?play=1`; return;
      case 'play': e.preventDefault(); return startPlayer(vid);
      case 'intent': {
        api('/intent', { intent: t.dataset.kind }).catch(() => { /* only a count for the Review page */ });
        setIntent(t.dataset.kind, vid);
        $('#player').dataset.asked = 1;
        return startPlayer(vid);
      }
      case 'showrel': t.remove(); $('.watch').classList.remove('playing'); return;
      case 'seen': return setWatched(vid, !(CARDS[vid] && CARDS[vid].watched));
      case 'list': e.stopPropagation(); return listPopup(vid, anchor, host);
      case 'like': case 'dislike': case 'unrate': {
        const want = { like: 1, dislike: -1, unrate: 0 }[t.dataset.act];
        const r = (CARDS[vid] && CARDS[vid].rating) === want ? 0 : want;
        await api('/rate/' + vid, { rating: r });
        markRated(vid, r);
        toast(r > 0 ? 'Liked. Recommendations will lean this way.' : r < 0 ? 'Disliked. You will see fewer like it.' : 'Rating removed.');
        if (/^#\/(liked|foryou)/.test(location.hash) || (r < 0 && routeName() === '')) return route();
        return;
      }
      case 'hide':
        await api('/hide/' + vid, { hidden: true });
        toast('Hidden. Undo from the History page.');
        if (location.hash.startsWith('#/v/')) history.back(); else if (host) host.remove();
        return;
      case 'unhide': await api('/hide/' + vid, { hidden: false }); return route();
      case 'filters': {
        const panel = $('#main .filters');
        panel.hidden = !panel.hidden;
        t.classList.toggle('on', !panel.hidden); t.setAttribute('aria-expanded', !panel.hidden);
        return;
      }
      case 'random': { const r = await api('/random'); if (r.vid) location.hash = '#/v/' + r.vid; return; }
      case 'reshuffle':
        await api('/reshuffle', {});
        if (routeName() === '') await route(); else location.hash = '#/';
        return toast('Different suggestions dealt.');
      case 'refresh': {
        t.disabled = true; t.textContent = 'Checking…';
        const r = await api('/refresh_uploads', {});
        toast(`${r.added} new upload${r.added === 1 ? '' : 's'} found` + (r.errors.length ? `; ${r.errors.length} problem(s): ${r.errors[0]}` : ''));
        return refresh();
      }
      case 'plall': case 'plnone':
        document.querySelectorAll('#plresults .plpick:not(:disabled)').forEach(b => { b.checked = t.dataset.act === 'plall'; });
        return plCount();
      case 'plgo': {
        const picked = [...document.querySelectorAll('#plresults .plpick:checked')].map(b => takeout[b.dataset.i]);
        t.disabled = true; t.textContent = 'Importing…';
        if (!picked[0].vids) {          // a channel's playlists: fetched from YouTube one at a time
          let ok = 0, videos = 0, last, err;
          for (const [i, p] of picked.entries()) {
            t.textContent = `Importing ${i + 1} of ${picked.length}…`;
            try { const r = await api('/playlists/import', { url: p.yt_id }); ok++; videos += r.count; last = r.id; }
            catch (e2) { err = e2.message; if (/key|quota/i.test(err)) break; }
          }
          toast(`Imported ${ok} playlist${ok === 1 ? '' : 's'}: ${videos} videos` + (err ? `. ${picked.length - ok} failed: ${err}` : ''));
          await reboot();
          if (ok === 1 && picked.length === 1) location.hash = '#/playlist/' + last; else await route();
          return;
        }
        const playlists = picked.map(p => ({ name: p.name, yt_id: p.yt_id, vids: p.vids }));
        const r = await api('/playlists/takeout/import', { playlists });
        const n = r.created + r.updated;
        toast(`${r.videos} video${r.videos === 1 ? '' : 's'} added to ${n} playlist${n === 1 ? '' : 's'}`
          + (r.unavailable ? `; ${r.unavailable} no longer on YouTube` : '') + (r.pending ? `; ${r.pending} waiting for a YouTube key` : ''));
        await reboot();
        if (r.ids.length === 1) location.hash = '#/playlist/' + r.ids[0]; else await route();
        return;
      }
      case 'plsync': {
        t.disabled = true; t.textContent = 'Syncing…';
        const r = await api(`/playlists/${t.dataset.id}/sync`, {});
        toast(syncMsg(r));
        return refresh();
      }
      case 'up': case 'down':
        await api(`/playlists/${host.dataset.pl}/move`, { vid, dir: t.dataset.act }); return route();
      case 'unlist':
        await api(`/playlists/${host.dataset.pl}/remove`, { vid }); return refresh();
      case 'delpl':
        if (t.dataset.sure) { await api('/playlists/' + t.dataset.id, undefined, 'DELETE'); await reboot(); location.hash = '#/playlists'; }
        else { t.dataset.sure = 1; t.textContent = 'Really delete? Click again'; }
        return;
    }
  } catch (err) { fail(err); if (['refresh', 'plsync', 'plgo'].includes(t.dataset.act)) route(); }
});

let takeout = [];                   // playlists offered in #plresults: from Takeout files (with vids) or a channel (without)
const plCount = () => {
  const n = document.querySelectorAll('#plresults .plpick:checked').length;
  const b = $('#plgo');
  b.textContent = `Import ${n} selected`; b.disabled = !n;
};
const syncMsg = r => {
  const bits = [r.added && `${r.added} added`, r.removed && `${r.removed} removed`, r.unavailable && `${r.unavailable} no longer on YouTube`].filter(Boolean);
  return `"${r.name}": ` + (bits.join(', ') || 'already up to date');
};

const subsCount = () => {
  const n = document.querySelectorAll('#chanresults .subpick:checked').length;
  const b = $('#subsgo');
  b.textContent = `Follow ${n} selected`; b.disabled = !n;
};

document.addEventListener('change', async e => {
  if (e.target.id === 'subsfile') {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const d = await api('/subs/preview', { csv: await file.text() });
      const fresh = d.items.filter(c => !c.followed);
      $('#chanresults').innerHTML = `<div class="rows">
        <div class="r plain subhead"><div class="name"><b>${d.items.length} subscription${d.items.length === 1 ? '' : 's'} in ${esc(file.name)}</b>
          <div class="sub">${fresh.length} not followed yet &middot; ${fresh.filter(c => c.hn).length} of those are in the library</div></div>
          <button class="pill" data-act="subsall">All</button><button class="pill" data-act="subshn">Only those in the library</button><button class="pill" data-act="subsnone">None</button>
          <button class="pill solid" data-act="subsgo" id="subsgo"></button></div>
        ${d.items.map(c => `<label class="r plain"><input type="checkbox" class="subpick" data-id="${esc(c.id)}" data-name="${esc(c.name)}" data-hn="${c.hn}" ${c.followed ? 'disabled' : 'checked'}>
          <div class="name"><b>${esc(c.name)}</b><div class="sub">${c.hn ? `${c.hn} in the library` : 'Not in the library'}</div></div>
          ${c.followed ? '<span class="muted">Already following</span>' : ''}</label>`).join('')}</div>`;
      subsCount();
    } catch (err) { fail(err); }
    e.target.value = '';
    return;
  }
  if (e.target.id === 'plfiles') {
    const picked = [...e.target.files];
    if (!picked.length) return;
    try {
      const d = await api('/playlists/takeout/preview', { files: await Promise.all(picked.map(async f => ({ name: f.name, csv: await f.text() }))) });
      takeout = d.items;
      const unknown = d.items.reduce((n, p) => n + p.unknown, 0);
      $('#plresults').innerHTML = `<div class="rows">
        <div class="r plain subhead"><div class="name"><b>${d.items.length} playlist${d.items.length === 1 ? '' : 's'} found</b>
          <div class="sub">${[d.empty.length && `${d.empty.length} file${d.empty.length === 1 ? '' : 's'} without videos skipped`,
            unknown && !B.has_key && `${unknown} videos from outside the library will stay hidden until you sync with a YouTube key`].filter(Boolean).join(' &middot; ')}</div></div>
          <button class="pill" data-act="plall">All</button><button class="pill" data-act="plnone">None</button>
          <button class="pill solid" data-act="plgo" id="plgo"></button></div>
        ${d.items.map((p, i) => { const done = p.existing && !p.new; return `<label class="r plain"><input type="checkbox" class="plpick" data-i="${i}" ${done ? 'disabled' : 'checked'}>
          <div class="name"><b>${esc(p.name)}</b><div class="sub">${p.total} video${p.total === 1 ? '' : 's'} &middot; ${p.hn} in the library</div></div>
          ${done ? '<span class="muted">Already imported</span>' : p.existing ? `<span class="muted">Adds ${p.new} to your existing playlist</span>` : ''}</label>`; }).join('')}</div>`;
      plCount();
    } catch (err) { fail(err); }
    e.target.value = '';
    return;
  }
  if (e.target.classList.contains('plpick')) return plCount();
  if (e.target.classList.contains('subpick')) return subsCount();
  if (e.target.dataset.set) {
    try { B.settings = await api('/settings', { [e.target.dataset.set]: e.target.checked }); renderSide(); toast('Saved.'); }
    catch (err) { e.target.checked = !e.target.checked; fail(err); }
  }
});

document.addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, data = Object.fromEntries(new FormData(f));
  try {
    if (f.id === 'search') { location.hash = '#/browse?q=' + enc(data.q.trim()); }
    else if (f.id === 'plnew') { await api('/playlists', { name: data.name }); await refresh(); }
    else if (f.id === 'popnew') {
      await api('/playlists', { name: data.name, vid: $('#popup').dataset.pv });
      closePopup(); toast('Playlist created'); await reboot();
    } else if (f.id === 'plimport' && !/[?&]list=/.test(data.url) && /@|\/(channel|c|user)\/|^\s*UC[\w-]{22}\s*$/.test(data.url)) {
      const d = await api('/playlists/channel', { url: data.url });
      takeout = d.items;
      $('#plresults').innerHTML = d.items.length ? `<div class="rows">
        <div class="r plain subhead"><div class="name"><b>${d.items.length} public playlist${d.items.length === 1 ? '' : 's'} by ${esc(d.channel)}</b>
          <div class="sub">Tick the ones to import</div></div>
          <button class="pill" data-act="plall">All</button><button class="pill" data-act="plnone">None</button>
          <button class="pill solid" data-act="plgo" id="plgo"></button></div>
        ${d.items.map((p, i) => `<label class="r plain"><input type="checkbox" class="plpick" data-i="${i}" ${p.existing ? 'disabled' : ''}>
          <div class="name"><b>${esc(p.name)}</b><div class="sub">${p.total} video${p.total === 1 ? '' : 's'}</div></div>
          ${p.existing ? '<span class="muted">Already imported</span>' : ''}</label>`).join('')}</div>`
        : `<p class="empty">${esc(d.channel)} has no public playlists.</p>`;
      if (d.items.length) plCount();
    } else if (f.id === 'plimport') {
      toast('Importing from YouTube…');
      const r = await api('/playlists/import', { url: data.url });
      toast(r.synced ? 'Already imported. ' + syncMsg(r) : `Imported "${r.name}": ${r.count} videos` + (r.skipped ? ` (${r.skipped} unavailable)` : ''));
      await reboot(); location.hash = '#/playlist/' + r.id;
    } else if (f.id === 'chanurl') {
      const r = await api('/follow_url', { url: data.url }); toast('Following ' + r.channel); await refresh();
    } else if (f.id === 'chanfind') {
      const r = await api('/channels?q=' + enc(data.q));
      $('#chanresults').innerHTML = r.items.length ? `<div class="rows">${r.items.map(c => channelRow(
        { name: c.name, sub: `${c.count} video${c.count === 1 ? '' : 's'} in the library` },
        `<button class="pill ${c.followed ? '' : 'solid'}" data-follow="${esc(c.name)}" data-on="${c.followed ? 1 : 0}">${c.followed ? 'Unfollow' : 'Follow'}</button>`)).join('')}</div>`
        : '<p class="empty">No channel by that name in the library.</p>';
    }
  } catch (err) { fail(err); }
});

// ---------------------------------------------------------------- chrome: menu, theme, shortcuts

$('#menu').addEventListener('click', () => {
  if (matchMedia('(max-width: 800px)').matches) { document.body.classList.toggle('drawer'); return; }
  const on = document.documentElement.classList.toggle('collapsed');
  try { localStorage.setItem('pt-collapsed', on ? '1' : '0'); } catch { /* ignore */ }
});
$('#scrim').addEventListener('click', () => document.body.classList.remove('drawer'));
$('#theme').addEventListener('click', () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('pt-theme', root.dataset.theme); } catch { /* ignore */ }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closePopup(); document.body.classList.remove('drawer'); return; }
  if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
    e.preventDefault(); $('#search input').focus();
  }
});

document.addEventListener('input', e => {
  if (e.target.id === 'chanfilter') { chanFilter = e.target.value; applyChanFilter(); }
});

window.addEventListener('hashchange', () => { scrollTo(0, 0); route(); });

(async () => {
  try {
    await reboot();
    await route();
  } catch (e) { main(`<p class="note err">Could not reach the PersonalTube server: ${esc(e.message)}</p>`); }
})();
