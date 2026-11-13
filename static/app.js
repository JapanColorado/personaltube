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
  pause: svg('M6 19h4V5H6v14zm8-14v14h4V5h-4z'),
  vol: svg('M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z'),
  volOff: svg('M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z'),
  fs: svg('M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z'),
  fsExit: svg('M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z'),
  cc: svg('M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z'),
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
  clock: svg('M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z'),
  minus: svg('M19 13H5v-2h14v2z'),
  home: svg('M4 21V10.08l8-6.96 8 6.96V21h-6v-6h-4v6H4z'),
  grip: svg('M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z'),
  dl: svg('M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z'),
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

// A toast can carry one way back: `undo` is a function, offered as an Undo button for a few seconds.
let toastTimer, toastUndo = null;
function toast(msg, undo) {
  const t = $('#toast');
  toastUndo = undo || null;
  t.innerHTML = `<span>${esc(msg)}</span>` + (undo ? '<button data-act="undo">Undo</button>' : '');
  t.classList.add('on'); t.classList.toggle('act', !!undo);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('on', 'act'); toastUndo = null; }, undo ? 8000 : 4500);
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
// A video's address; opened from a playlist it carries the playlist along, so the end screen offers that one's next
const vhref = (v, play) => {
  const pl = v.pl || (v.reason && v.reason.playlist), q = [play ? 'play=1' : '', pl ? 'pl=' + pl : ''].filter(Boolean).join('&');
  return `#/v/${v.vid}${q ? '?' + q : ''}`;
};
const vt = v => `<a class="vt" data-tt href="${vhref(v)}" title="${esc(tip(v))}">${esc(ttl(v))}</a>`;
const initial = name => esc((String(name || '?').trim()[0] || '?'));
const seenTitle = on => on ? 'Unmark as watched' : 'Mark as watched';
const seenLabel = on => on ? 'Watched' : 'Mark watched';
const laterTitle = on => on ? 'Remove from Watch later' : 'Watch later';
const laterPill = v => `<button class="pill ${v.later ? 'on' : ''}" data-act="later" title="${laterTitle(v.later)}">${I.clock}<span class="lbl">Watch later</span></button>`;
const followBtn = (channel, on) => `<button class="pill ${on ? '' : 'solid'}" data-follow="${esc(channel)}" data-on="${on ? 1 : 0}">${on ? 'Following' : 'Follow'}</button>`;

// ---------------------------------------------------------------- pieces

function badges(v) {
  let h = '';
  if (v.reason) {
    const to = v.reason.playlist ? `#/playlist/${v.reason.playlist}` : v.reason.vid ? `#/v/${v.reason.vid}` : v.reason.area ? `#/a/${v.reason.area}` : v.reason.cat ? `#/c/${v.reason.cat}` : '';
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
  return `<div class="thumb"><a href="${vhref(v)}" tabindex="-1" aria-hidden="true">${timg(v, q)}${v.dur ? `<span class="dur">${fmtDur(v.dur)}</span>` : ''}${v.frac ? `<span class="tprog"><i style="width:${Math.round(v.frac * 100)}%"></i></span>` : ''}</a>
    <button class="tbtn" data-act="seen" title="${seenTitle(v.watched)}" aria-label="${seenTitle(v.watched)}">${I.check}</button>
    <button class="tbtn later ${v.later ? 'on' : ''}" data-act="later" title="${laterTitle(v.later)}" aria-label="${laterTitle(v.later)}">${I.clock}</button></div>`;
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
// with `head` (trusted HTML, usually an <h2>), the bar doubles as the page heading: head on the left, Filters button on the right
function filterBar(base, keep, f, extra = '', head = '') {
  const g = filterGroups();
  const link = (k, v) => href(base, { ...keep, ...f, [k]: f[k] === v ? '' : v });
  const off = (k, v) => !B.has_meta && (k === 'len' || (k === 'sort' && NEEDS_META[v]));
  const chips = Object.keys(f).filter(k => f[k]).map(k =>
    `<a class="chip on" href="${link(k, f[k])}" title="Remove filter">${esc(g[k][1].find(([v]) => v === f[k])[1])}<span>&times;</span></a>`);
  const btn = `<button class="pill" data-act="filters" aria-expanded="false">${I.tune} Filters</button>`;
  return `<div class="filterbar ${head ? 'headed' : ''}">
      ${head || btn}${chips.join('')}
      <span class="grow"></span>${extra}${head ? btn : ''}</div>
    <div class="filters" hidden>${Object.keys(f).map(k => `<div><h4>${g[k][0]}</h4>
      ${g[k][1].map(([v, label]) => off(k, v)
        ? `<span class="off" title="Needs data from YouTube; see Settings">${esc(label)}</span>`
        : `<a href="${link(k, v)}" class="${f[k] === v ? 'on' : ''}">${esc(label)}</a>`).join('')}</div>`).join('')}</div>`;
}

// "More of this" / "less of this" for a topic area or category (Categories page and topic pages). w is the
// topic's own setting; inh is what a category inherits from its area while it has none of its own.
const topicCtl = (id, w, inh = 0) => `<span class="tw" data-topic="${id}" data-w="${w}">
    <button class="${w > 0 ? 'on' : inh > 0 ? 'inh' : ''}" data-act="topic" data-w="1" title="More of this on Home and For You" aria-label="More of this" aria-pressed="${w > 0}">${I.add}</button>
    <button class="${w < 0 ? 'on' : inh < 0 ? 'inh' : ''}" data-act="topic" data-w="-1" title="Less of this on Home and For You" aria-label="Less of this" aria-pressed="${w < 0}">${I.minus}</button></span>`;

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
  const v = d.lead[0];
  let lead = '';
  if (v) {
    CARDS[v.vid] = v;
    lead = `<div class="lead card ${v.watched ? 'seen' : ''}" data-vid="${v.vid}">
      ${thumbBox(v, 'hqdefault')}
      <div class="body"><div class="text">
        <div class="eyebrow">Today's pick</div>
        ${vt(v)}
        <div class="sub">${[chanLink(v), factLine(v)].filter(Boolean).join(' &middot; ')}</div>
        ${v.why ? `<p class="why">${esc(v.why)}</p>` : ''}
        ${badges(v)}
        <div class="actions">
          <button class="pill solid" data-act="watch">${I.play} Watch</button>
          ${laterPill(v)}
          <button class="pill ${v.watched ? 'on' : ''}" data-act="seen" title="${seenTitle(v.watched)}">${I.check}<span class="lbl">${seenLabel(v.watched)}</span></button>
          <button class="pill" data-act="list">${I.save} Save</button>
        </div>
      </div>${kebab}</div></div>`;
  }
  const body = lead + (d.items.length ? grid(d.items) : '');
  main(filterBar('#/', {}, f, `<span class="muted">${esc(tallyText(d.today))}</span>`, '<h2>Home</h2>')
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
  let h = '', head, after = '';
  if (d.channel) {
    pageTitle = channel;
    head = `<div class="avatar big">${initial(channel)}</div><h2>${esc(channel)}</h2>
      ${followBtn(channel, d.channel.followed)}${d.channel.followed ? quietBtn(channel, d.channel.quiet, true) : ''}
      <a class="pill" href="https://www.youtube.com/results?search_query=${enc(channel)}" target="_blank" rel="noopener">${I.out} Find on YouTube</a>`;
  } else if (area) {
    h += `<div class="pagehead"><div class="crumb"><a href="#/explore">Explore</a>${cat ? ` &rsaquo; <a href="#/a/${area.id}">${esc(area.name)}</a>` : ''}</div></div>`;
    pageTitle = cat ? cat.name : area.name;
    head = `<h2>${esc(cat ? cat.name : area.name)}</h2>${cat ? topicCtl(cat.id, cat.w, area.w) : topicCtl(area.id, area.w)}`;
    if (!cat) after = `<div class="catwrap">${area.categories.map(c => `<a class="chip" href="#/c/${c.id}">${esc(c.name)}</a>`).join('')}</div>`;
  } else {
    pageTitle = q || 'All videos';
    head = `<h2>${q ? `Results for &ldquo;${esc(d.corrected || q)}&rdquo;` : 'All videos'}</h2>`;
  }
  const to = n => href(base, { q, ...f, page: n });
  const pager = d.pages > 1 ? `<div class="pager">${page > 1 ? `<a class="pill" href="${to(page - 1)}">Previous</a>` : ''}
      <span>Page ${d.page} of ${d.pages}</span>${page < d.pages ? `<a class="pill" href="${to(page + 1)}">Next</a>` : ''}</div>` : '';
  h += filterBar(base, { q }, f, `<span class="muted">${d.total.toLocaleString()} video${d.total === 1 ? '' : 's'}</span>`, head) + after
    + (d.corrected ? `<p class="note">Nothing matches &ldquo;${esc(q)}&rdquo;, so these are the results for &ldquo;${esc(d.corrected)}&rdquo;.</p>` : '')
    + (f.sort === 'gems' ? '<p class="note">Hidden gems: recommended by several people, yet little watched on YouTube.</p>' : '')
    + (q && !d.items.length ? '<p class="empty">Nothing in the library or among your own videos matches that.</p>' : grid(d.items)) + pager;
  const yts = q && page === 1 && B.has_key;   // general YouTube results under the first page of a search
  if (yts) h += '<section id="ytres" class="ytres"><h3>From YouTube</h3><p class="empty">Searching YouTube…</p></section>';
  main(h);
  if (yts) ytResults(q, f.len);
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

async function pageVideo(vid, autoplay, pl) {
  const v = await api('/video/' + vid + (pl ? '?pl=' + enc(pl) : ''));
  if (pl) v.pl = pl;
  CARDS[v.vid] = v;
  pageTitle = ttl(v);
  let h = `<div class="watch"><div class="primary ${v.watched ? 'seen' : ''}" data-vid="${v.vid}">
    <div id="player" class="player"><a class="poster" href="${vhref(v, true)}" data-act="play" aria-label="Play video">
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
        ${laterPill(v)}
        <button class="pill" data-act="list">${I.save} Save</button>
        ${dlPill(v)}
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
      <p class="why" style="margin:0">This one comes from ${v.upload ? 'a channel you follow' : v.in_playlists.length ? 'one of your playlists' : 'a YouTube search'}.</p>
      ${v.desc ? `<div class="ytdesc ${descLong(v.desc) ? 'clamp' : ''}">${descHtml(v.desc)}</div>
        ${descLong(v.desc) ? '<button class="link" data-act="moredesc">Show more</button>' : ''}` : ''}</div>`;
  }
  h += '</div>';
  if (v.hn && v.related.length) h += `<div class="secondary"><h3>Related</h3>${v.related.map(compact).join('')}</div>`;
  main(h + '</div>');
  if (autoplay) startPlayer(v.vid);
}

// YouTube's description of a video from outside the library: links open in a new tab, and times ("12:34")
// become buttons that jump the player there.
const descLong = t => t.length > 400 || t.split('\n').length > 6;
function descHtml(text) {
  return esc(text)
    .replace(/https?:\/\/[^\s<]*[^\s<.,;:!?)\]]/g, u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`)
    .replace(/(^|[\s(\[])((?:\d{1,2}:)?\d{1,2}:\d{2})(?=$|[\s)\],.])/gm, (m, pre, t) =>
      `${pre}<button class="ts" data-act="seek" data-t="${t.split(':').reduce((a, x) => a * 60 + +x, 0)}">${t}</button>`);
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

// Three ways to play, behind one small interface (time, dur, playing, seek, play, pause, destroy; the two web ones
// also rate, rates, vol, muted, loaded and, for YouTube, captions, which the control bar below uses):
// - the phone's own player (window.PTNative, the Android app's Kotlin side): it sits above the page, keeps playing
//   with the screen off, skips SponsorBlock segments and reports progress to the server itself;
// - a downloaded file (v.dl), in a plain <video>;
// - YouTube's embedded player, for everything else.
// If one fails the next is tried: native, then the file, then YouTube.
let ytApi = null, player = null, pctl = null, progTimer = null, sbTimer = null, uiTimer = null, flushProgress = null, nativeOn = null;
const NATIVE = window.PTNative || null;
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
  clearInterval(progTimer); clearInterval(sbTimer); clearInterval(uiTimer);
  if (pctl) { pctl.off(); pctl = null; }
  if (document.fullscreenElement && document.fullscreenElement.id === 'player') document.exitFullscreen().catch(() => { /* already out */ });
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
    ${v.next_in && !one ? `<p>Next in ${esc(v.next_in.playlist)}: <a href="${vhref({ vid: v.next_in.vid, pl: v.next_in.pid })}">${esc(v.next_in.title)}</a></p>` : ''}
    <div class="actions"><a class="pill solid" href="#/done">Done for now</a><a class="pill" href="#/">Back to home</a>
      ${!one && $('.watch .secondary') ? '<button class="pill" data-act="showrel">Show related</button>' : ''}
      <button class="pill" data-act="play">${I.refresh} Replay</button></div></div>`;
}

function ytBackend(vid, start, on) {
  return loadYT().then(YT => new Promise((res, rej) => {
    if (!$('#yt')) return rej(new Error('gone'));   // navigated away while the player script loaded
    const p = new YT.Player('yt', {
      host: 'https://www.youtube-nocookie.com', videoId: vid, width: '100%', height: '100%',
      // controls=0: the app draws its own bar (playerControls), which also keeps YouTube's "More videos" shelf away
      playerVars: { autoplay: 1, rel: 0, playsinline: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, start: Math.floor(start) },
      events: {
        onReady: () => {
          if (B.speed !== 1) p.setPlaybackRate(B.speed);
          let cc = false;
          res({
            time: () => p.getCurrentTime ? p.getCurrentTime() : 0, dur: () => p.getDuration ? p.getDuration() : 0,
            playing: () => p.getPlayerState && p.getPlayerState() === YT.PlayerState.PLAYING,
            seek: t => p.seekTo(t, true), play: () => p.playVideo(), pause: () => p.pauseVideo(),
            rate: r => r === undefined ? p.getPlaybackRate() : p.setPlaybackRate(r),
            rates: () => p.getAvailablePlaybackRates(),
            vol: x => x === undefined ? p.getVolume() / 100 : p.setVolume(Math.round(x * 100)),
            muted: m => m === undefined ? p.isMuted() : m ? p.mute() : p.unMute(),
            loaded: () => p.getVideoLoadedFraction(),
            // the IFrame API's captions module is undocumented: load it and pick a track, or unload it.
            // Resolves to whether captions are now on (false when the video has none).
            captions: on => {
              if (on === undefined) return cc;
              if (!on) { cc = false; try { p.setOption('captions', 'track', {}); p.unloadModule('captions'); } catch { /* not loaded */ } return Promise.resolve(false); }
              try { p.loadModule('captions'); } catch { return Promise.resolve(false); }
              return new Promise(done => {
                let n = 0;
                const look = setInterval(() => {
                  let list = [];
                  try { list = p.getOption('captions', 'tracklist') || []; } catch { /* not ready */ }
                  if (!list.length && ++n < 24) return;
                  clearInterval(look);
                  const lang = (navigator.language || 'en').slice(0, 2);
                  const t = list.find(x => x.languageCode === lang && !x.kind) || list.find(x => x.languageCode.startsWith(lang)) || list[0];
                  if (t) try { p.setOption('captions', 'track', { languageCode: t.languageCode }); } catch { /* keep the default */ }
                  cc = !!t;
                  done(cc);
                }, 250);
              });
            },
            destroy: () => p.destroy(),
          });
        },
        onStateChange: e => { on.tick(); if (e.data === YT.PlayerState.ENDED) on.ended(); },
        onError: () => on.error("YouTube won't play this one here (the uploader may have turned off embedding, or it is gone)."),
      },
    });
  }));
}

function fileBackend(vid, start, on) {
  $('#yt').outerHTML = `<video id="yt" autoplay playsinline preload="auto" src="/media/${vid}.mp4"></video>`;
  const el = $('#yt');
  return new Promise((res, rej) => {
    el.addEventListener('loadedmetadata', () => {
      if (start) el.currentTime = start;
      el.playbackRate = B.speed;
      res({
        time: () => el.currentTime, dur: () => el.duration || 0, playing: () => !el.paused && !el.ended,
        seek: t => { el.currentTime = t; }, play: () => el.play(), pause: () => el.pause(),
        rate: r => r === undefined ? el.playbackRate : (el.playbackRate = r),
        vol: x => x === undefined ? el.volume : (el.volume = x),
        muted: m => m === undefined ? el.muted : (el.muted = m),
        loaded: () => el.buffered.length && el.duration ? el.buffered.end(el.buffered.length - 1) / el.duration : 0,
        destroy: () => { el.pause(); el.removeAttribute('src'); el.load(); },
      });
    }, { once: true });
    el.addEventListener('error', () => rej(new Error('the downloaded file would not play')), { once: true });
    el.addEventListener('play', on.tick);
    el.addEventListener('pause', on.tick);
    el.addEventListener('ended', on.ended);
  });
}

// The phone's player calls back through window.ptNative(event, data): 'ended' with today's tally, 'error' with why.
window.ptNative = (ev, data) => { if (nativeOn && nativeOn[ev]) nativeOn[ev](data); };
function nativeBackend(vid, start, on) {
  const v = CARDS[vid] || {};
  nativeOn = { ended: today => on.ended(today), error: why => on.error(why) };
  NATIVE.play(JSON.stringify({ vid, start, title: ttl(v), channel: v.channel || '', speed: B.speed, thumb: thumb(v, 'hqdefault') }));
  document.body.classList.add('native-on');
  scrollTo(0, 0);
  return Promise.resolve({
    native: true,
    time: () => NATIVE.position(), dur: () => NATIVE.duration(), playing: () => NATIVE.playing(),
    seek: t => NATIVE.seek(t), play: () => NATIVE.resume(), pause: () => NATIVE.pause(),
    destroy: () => { nativeOn = null; NATIVE.stop(); document.body.classList.remove('native-on'); },
  });
}

async function startPlayer(vid) {
  const box = $('#player');
  if (!box || box.dataset.on) return;
  if (B.settings.ask_intent && !box.dataset.asked) {
    const it = getIntent();
    if (!it || (it.kind === 'one' && it.vid !== vid)) return intentGate(box, !!it);
  }
  const v = CARDS[vid] || (CARDS[vid] = { vid });
  box.dataset.on = 1;
  box.innerHTML = '<div id="yt"></div><div class="pshield"></div><div id="sbask"></div>';
  const watch = $('.watch');
  if (watch) watch.classList.add('playing');
  let start = v.resume || 0;
  try { start = start || +localStorage.getItem('pt-pos-' + vid) || 0; localStorage.removeItem('pt-pos-' + vid); } catch { /* positions used to live here */ }
  let marked = !!v.watched;
  const mark = () => { if (!marked) { marked = true; setWatched(vid, true).catch(fail); } };
  let played = 0, wasPlaying = false, lastTick = Date.now(), lastSent = Date.now(), pos = 0, dur = 0, today = v.today;
  const send = () => {
    const body = { pos, dur, played };
    played = 0; lastSent = Date.now();
    return api('/progress/' + vid, body).then(r => { today = r; }).catch(() => { /* next one will carry on */ });
  };
  const check = () => {
    if (!player || player.native) return;   // the phone's player keeps its own account
    const now = Date.now();
    if (wasPlaying) played += Math.min((now - lastTick) / 1000, 10);
    lastTick = now;
    wasPlaying = player.playing();
    const d = player.dur(), t = player.time();
    if (!d) return;
    pos = t; dur = d;
    if (t >= d * 0.9) mark();
    if (now - lastSent >= 15000 && played > 0) send();
  };
  let done = false;
  const on = {
    tick: check,
    ended: async nativeToday => {
      if (done) return;
      done = true;
      mark();
      flushProgress = null;
      if (player && player.native) today = nativeToday || today; else { check(); await send(); }
      stopPlayer();
      stopScreen(vid, today);
    },
    error: why => {
      if (done || !$('#player') || $('#player') !== box) return;
      const kind = player && player.native ? 'native' : v.dl && !v.noFile && $('video#yt') ? 'file' : 'yt';
      stopPlayer();
      delete box.dataset.on;
      if (kind === 'native') { v.noNative = true; toast("This phone's player couldn't open it; trying another way."); return startPlayer(vid); }
      if (kind === 'file') { v.noFile = true; return startPlayer(vid); }
      box.innerHTML = `<div class="msg"><p>${esc(why)} <a href="https://www.youtube.com/watch?v=${vid}" target="_blank" rel="noopener">Open it on YouTube instead.</a></p></div>`;
    },
  };
  const make = NATIVE && !v.noNative ? nativeBackend : v.dl && !v.noFile ? fileBackend : ytBackend;
  let p;
  try { p = await make(vid, start, on); } catch (e) {
    if (e.message === 'gone') return;
    return on.error(make === ytBackend ? 'Sorry, ' + e.message + '.' : e.message);
  }
  if (!box.isConnected || box.dataset.on !== '1') { p.destroy(); return; }   // navigated away meanwhile
  player = p;
  flushProgress = () => { check(); if (dur) send(); };
  progTimer = setInterval(check, 5000);
  if (p.native) return;
  const ctl = pctl = playerControls(box, p);
  sponsorWatch(vid, p, ctl);
}
// closing the tab mid-video: hand the last position and seconds to the browser to deliver
addEventListener('pagehide', () => { if (flushProgress) flushProgress(); dlFlush(); });

// The web players' own controls. YouTube's are turned off, so its title overlay and "More videos" shelf never
// show, and SponsorBlock segments can be drawn on the seek bar. A transparent shield over the video takes the
// clicks (click: play or pause, double click: fullscreen), which also keeps the keyboard with the page. The bar
// hides while the video plays and the mouse is still. Returns what the keyboard and SponsorBlock need.
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const clock = s => fmtDur(Math.floor(s)) || '0:00';
const rateText = r => r === 1 ? 'Normal' : r + '×';
function playerControls(box, p) {
  box.insertAdjacentHTML('beforeend', `<div class="pbar">
    <div class="pseek"><div class="ptrack"><i class="pbuf"></i><i class="pfill"></i><span class="psegs"></span></div><i class="pknob"></i><span class="ptip" hidden></span></div>
    <div class="prow">
      <button class="pbtn" data-pc="play"></button>
      <button class="pbtn" data-pc="mute"></button>
      <input class="pvol" type="range" min="0" max="100" step="5" aria-label="Volume">
      <span class="ptime"></span><span class="pgrow"></span>
      ${p.captions ? `<button class="pbtn" data-pc="cc" title="Captions (c)" aria-label="Captions">${I.cc}</button>` : ''}
      <button class="pbtn prate" data-pc="rate" title="Speed (&lt; &gt;)" aria-label="Speed"></button>
      <button class="pbtn" data-pc="fs"></button>
    </div><div class="pmenu" hidden></div></div>`);
  const bar = $('.pbar', box), seek = $('.pseek', bar), tip = $('.ptip', bar), menu = $('.pmenu', bar), vol = $('.pvol', bar);
  const btn = k => $(`[data-pc="${k}"]`, bar);
  let segs = [], drawn = false, drag = null, idleT = null, last = {};
  const ac = new AbortController(), sig = { signal: ac.signal };   // the box outlives a player (Replay)
  const dur = () => p.dur() || 0;
  // only touch the DOM when something shown has changed
  const set = (key, val, fn) => { if (last[key] !== val) { last[key] = val; fn(val); } };
  const update = () => {
    if (player !== p) return;
    const d = dur(), t = drag !== null ? drag * d : p.time(), playing = p.playing();
    const f = d ? Math.min(1, t / d) : 0;
    set('f', f.toFixed(4), () => { $('.pfill', bar).style.width = f * 100 + '%'; $('.pknob', bar).style.left = f * 100 + '%'; });
    if (p.loaded) set('b', (p.loaded() || 0).toFixed(3), b => { $('.pbuf', bar).style.width = b * 100 + '%'; });
    set('t', clock(t) + ' / ' + clock(d), x => { $('.ptime', bar).textContent = x; });
    set('play', playing, x => { const b = btn('play'); b.innerHTML = x ? I.pause : I.play; b.title = (x ? 'Pause' : 'Play') + ' (k)'; b.setAttribute('aria-label', x ? 'Pause' : 'Play'); });
    const m = p.muted() || p.vol() === 0;
    set('m', m, x => { const b = btn('mute'); b.innerHTML = x ? I.volOff : I.vol; b.title = (x ? 'Unmute' : 'Mute') + ' (m)'; b.setAttribute('aria-label', x ? 'Unmute' : 'Mute'); });
    if (document.activeElement !== vol) set('v', m ? 0 : Math.round(p.vol() * 100), x => { vol.value = x; });
    set('r', p.rate(), x => { btn('rate').textContent = x === 1 ? '1×' : x + '×'; });
    if (p.captions) set('cc', p.captions(), x => { btn('cc').classList.toggle('on', x); box.classList.toggle('cc', x); });
    const full = document.fullscreenElement === box;
    set('fs', full, x => { const b = btn('fs'); b.innerHTML = x ? I.fsExit : I.fs; b.title = (x ? 'Exit fullscreen' : 'Fullscreen') + ' (f)'; b.setAttribute('aria-label', x ? 'Exit fullscreen' : 'Fullscreen'); });
    if (!playing) wake(true);
    if (d && segs.length && !drawn) {
      drawn = true;
      $('.psegs', bar).innerHTML = segs.map(g => `<i style="left:${100 * g.s / d}%;width:${Math.max(100 * (Math.min(g.e, d) - g.s) / d, 0.4)}%;background:${esc(g.color)}"></i>`).join('');
    }
  };
  // show the bar; unless `stay`, hide it again after a while of playing with the mouse still
  const wake = stay => {
    box.classList.remove('idle');
    clearTimeout(idleT);
    if (!stay) idleT = setTimeout(sleep, 2500);
  };
  const sleep = () => { if (player === p && p.playing() && drag === null && menu.hidden && !bar.matches(':hover')) box.classList.add('idle'); };
  const toggle = () => { p.playing() ? p.pause() : p.play(); setTimeout(update, 50); };
  const seekTo = s => { p.seek(Math.max(0, Math.min(s, dur() - 0.5))); wake(); setTimeout(update, 50); };
  const setVol = x => { x = Math.max(0, Math.min(1, x)); p.vol(x); if (x > 0 && p.muted()) p.muted(false); wake(); setTimeout(update, 50); };
  const rates = () => (p.rates && p.rates().length ? p.rates() : RATES).filter(r => r >= 0.25 && r <= 2);
  const setRate = r => { p.rate(r); setTimeout(update, 50); };
  const fs = () => (document.fullscreenElement === box ? document.exitFullscreen() : box.requestFullscreen()).catch(() => { /* refused */ });
  // the choice is kept (setting "captions") and applied to the next video too
  const cc = async () => {
    if (!p.captions) return;
    const want = !p.captions();
    if (B.settings.captions !== want) api('/settings', { captions: want }).then(s => { B.settings = s; }).catch(() => { /* still on for this video */ });
    B.settings.captions = want;
    const on = await p.captions(want);
    if (want && !on) toast('No captions for this video');
    update();
  };
  const closeMenu = () => { menu.hidden = true; };
  const openMenu = () => {
    const now = p.rate();
    menu.innerHTML = rates().map(r => `<button data-rate="${r}" class="${r === now ? 'on' : ''}">${rateText(r)}</button>`).join('');
    menu.hidden = false;
    wake(true);
  };

  // the shield: a mouse click plays or pauses; a tap shows the bar first if it was hidden
  let touch = false;
  const shield = $('.pshield', box);
  shield.addEventListener('pointerdown', e => { touch = e.pointerType === 'touch'; });
  shield.addEventListener('click', () => {
    if (!menu.hidden) return closeMenu();
    if (touch && box.classList.contains('idle')) return wake();
    toggle();
  });
  shield.addEventListener('dblclick', fs);
  box.addEventListener('mousemove', () => wake(), sig);
  box.addEventListener('mouseleave', () => { if (p.playing() && drag === null && menu.hidden) box.classList.add('idle'); }, sig);
  // buttons don't take the focus from a click, so Space and the other keys stay with the player
  bar.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
  bar.addEventListener('click', e => {
    const r = e.target.closest('[data-rate]');
    if (r) { setRate(+r.dataset.rate); return closeMenu(); }
    const b = e.target.closest('[data-pc]');
    if (!b) return;
    const k = b.dataset.pc;
    if (k !== 'rate') closeMenu();
    if (k === 'play') toggle();
    else if (k === 'mute') { p.muted(!(p.muted() || p.vol() === 0)); if (!p.muted() && p.vol() === 0) p.vol(0.5); setTimeout(update, 50); }
    else if (k === 'rate') menu.hidden ? openMenu() : closeMenu();
    else if (k === 'fs') fs();
    else if (k === 'cc') cc();
  });
  vol.addEventListener('input', () => setVol(vol.value / 100));
  vol.addEventListener('change', () => vol.blur());
  document.addEventListener('fullscreenchange', update, sig);

  // the seek bar: drag to seek, hover for the time (and the segment) under the pointer
  const frac = e => { const r = seek.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
  const showTip = e => {
    const d = dur();
    if (!d) return;
    const x = frac(e), s = x * d, g = segs.find(g => s >= g.s && s < g.e);
    tip.textContent = clock(s) + (g ? ' · ' + g.name : '');
    tip.hidden = false;
    const w = seek.clientWidth, half = tip.offsetWidth / 2;
    tip.style.left = Math.max(half, Math.min(w - half, x * w)) + 'px';
  };
  seek.addEventListener('pointerdown', e => {
    if (e.button) return;
    e.preventDefault();
    seek.setPointerCapture(e.pointerId);
    seek.classList.add('drag');
    drag = frac(e);
    showTip(e); update();
  });
  seek.addEventListener('pointermove', e => {
    showTip(e);
    if (drag !== null) { drag = frac(e); update(); }
  });
  const endDrag = e => {
    if (drag === null) return;
    const to = e.type === 'pointerup' ? frac(e) : null;
    drag = null;
    seek.classList.remove('drag');
    if (to !== null) seekTo(to * dur());
    if (e.pointerType !== 'mouse') tip.hidden = true;
  };
  seek.addEventListener('pointerup', endDrag);
  seek.addEventListener('pointercancel', endDrag);
  seek.addEventListener('pointerleave', () => { if (drag === null) tip.hidden = true; });

  if (p.captions && B.settings.captions) p.captions(true).then(update);
  update();
  wake();
  clearInterval(uiTimer);
  uiTimer = setInterval(update, 250);
  return {
    off: () => { ac.abort(); clearTimeout(idleT); box.classList.remove('idle', 'cc'); },
    marks: list => { segs = list; drawn = false; update(); },
    toggle, fs, cc,
    seekBy: s => seekTo(p.time() + s),
    jump: x => seekTo(x * dur()),
    volBy: dx => setVol((p.muted() ? 0 : p.vol()) + dx),
    mute: () => btn('mute').click(),
    rateBy: dir => {
      const rs = rates(), i = rs.indexOf(p.rate()), r = rs[Math.max(0, Math.min(rs.length - 1, (i < 0 ? rs.indexOf(1) : i) + dir))];
      setRate(r); wake(); toast('Speed: ' + rateText(r));
    },
  };
}

// SponsorBlock in the web player: segments set to "skip" are skipped with an undo; "ask" ones show a Skip button
// while they play. The seek bar shows where they are. (The phone's player does all this itself.)
async function sponsorWatch(vid, p, ctl) {
  if (!B.settings.sponsorblock) return;
  let segs;
  try { segs = (await api('/sponsor/' + vid)).segs; } catch { return; }
  if (!segs.length || player !== p) return;
  const ask = $('#sbask');
  ctl.marks(segs);
  const tick = () => {
    if (player !== p) return clearInterval(sbTimer);
    const t = p.time();
    const g = segs.find(x => t >= x.s && t < x.e - 0.5);
    if (g && g.act === 'skip' && !g.done) {
      g.done = true;
      p.seek(g.e);
      return toast(`Skipped: ${g.name}`, () => p.seek(g.s));
    }
    const want = g && g.act === 'ask' ? g : null;
    if (ask && (ask.dataset.s || '') !== String(want ? want.s : '')) {
      ask.dataset.s = want ? want.s : '';
      ask.innerHTML = want ? `<button class="pill" data-act="sbskip" data-t="${want.e}">Skip ${esc(want.name.toLowerCase())} &rsaquo;</button>` : '';
    }
  };
  sbTimer = setInterval(tick, 400);
}

// ---- downloads. The server keeps the files (DL_DIR) and runs the jobs; the desktop's go through yt-dlp, the phone's
// through its native player. Pills and the Downloads tab follow the jobs by asking /api/downloads every two seconds
// while one is under way. A removal waits for the toast's Undo to pass before the file is deleted.
const DLJOBS = {};                  // vid -> {state: queued | running | error, frac, error}
const DLDEL = new Map();            // vid -> timer of a removal still waiting out its Undo
let dlPoll = null;
const fmtSize = b => b >= 1e9 ? trim1(b / 1e9) + ' GB' : Math.max(1, Math.round(b / 1e6)) + ' MB';
function dlPill(v) {
  const j = DLJOBS[v.vid];
  let h;
  if (v.dl) h = `<button class="pill on" data-act="dlrm" title="Remove the download">${I.dl}<span class="lbl">Downloaded</span></button>`;
  else if (j && j.state !== 'error') h = `<button class="pill" data-act="dlstop" title="Stop the download">${I.dl}<span class="lbl">${j.state === 'running' ? `Downloading ${Math.round(j.frac * 100)}%` : 'Waiting to download'}</span></button>`;
  else h = `<button class="pill" data-act="dl" title="${j ? esc('The last try failed: ' + j.error) : 'Save it to watch offline'}">${I.dl}<span class="lbl">${j ? 'Try the download again' : 'Download'}</span></button>`;
  return `<span class="dlp" data-dlv="${v.vid}">${h}</span>`;
}
const onDownloads = () => /^#\/library\/downloads/.test(location.hash);
function dlPaint() {
  document.querySelectorAll('.dlp[data-dlv]').forEach(el => { const v = CARDS[el.dataset.dlv]; if (v) el.outerHTML = dlPill(v); });
  for (const [vid, j] of Object.entries(DLJOBS)) {
    const row = $(`#dlpending [data-vid="${vid}"]`);
    if (!row) continue;
    $('.progress i', row).style.width = Math.round((j.frac || 0) * 100) + '%';
    $('.dlstate', row).textContent = dlState(j);
  }
}
const dlState = j => j.state === 'error' ? 'Failed: ' + j.error : j.state === 'running' ? `Downloading, ${Math.round(j.frac * 100)}%` : 'Waiting';
function dlWatch() {
  if (dlPoll) return;
  dlPoll = setInterval(async () => {
    let d;
    try { d = await api('/downloads'); } catch { return; }
    const before = new Set(Object.keys(DLJOBS));
    for (const k of before) delete DLJOBS[k];
    for (const p of d.pending) DLJOBS[p.vid] = p.job;
    const finished = d.items.filter(i => before.has(i.vid));
    for (const i of finished) if (CARDS[i.vid]) CARDS[i.vid].dl = true;
    if (finished.length === 1) toast('Downloaded: ' + ttl(finished[0]));
    else if (finished.length) toast(`${finished.length} downloads finished`);
    const changed = finished.length || d.pending.length !== before.size;
    if (onDownloads() && changed) renderDownloads(d); else dlPaint();
    if (!d.pending.some(p => p.job.state !== 'error')) { clearInterval(dlPoll); dlPoll = null; }
  }, 2000);
}
async function dlStart(vid) {
  const r = await api('/download/' + vid, {});
  if (r.state === 'done') { CARDS[vid].dl = true; } else { DLJOBS[vid] = { state: r.state, frac: 0 }; dlWatch(); }
  dlPaint();
  if (onDownloads()) return route();
  toast(r.state === 'done' ? 'Already downloaded' : 'Downloading. It will play from the file once it is done.');
}
async function dlRemove(vid, running) {
  const v = CARDS[vid] || {};
  if (running) {
    await api('/download/' + vid, undefined, 'DELETE');
    delete DLJOBS[vid];
    dlPaint();
    if (onDownloads()) route();
    return toast('Download stopped');
  }
  const gone = () => { DLDEL.delete(vid); api('/download/' + vid, undefined, 'DELETE').catch(fail); };
  DLDEL.set(vid, setTimeout(gone, 8500));
  v.dl = false;
  dlPaint();
  document.querySelectorAll(`#dlgrid [data-vid="${vid}"]`).forEach(x => { x.hidden = true; });
  toast('Download removed', () => {
    clearTimeout(DLDEL.get(vid)); DLDEL.delete(vid);
    v.dl = true;
    dlPaint();
    document.querySelectorAll(`#dlgrid [data-vid="${vid}"]`).forEach(x => { x.hidden = false; });
  });
}
function dlFlush() {                // leaving the page: removals still in their Undo window go through now
  for (const [vid, timer] of DLDEL) { clearTimeout(timer); fetch('/api/download/' + vid, { method: 'DELETE', keepalive: true }); }
  DLDEL.clear();
}
function renderDownloads(d) {
  for (const k of Object.keys(DLJOBS)) delete DLJOBS[k];
  for (const p of d.pending) DLJOBS[p.vid] = p.job;
  const total = d.items.reduce((a, i) => a + i.size, 0);
  let h = libraryHead('downloads');
  if (d.pending.length) h += `<h3 class="sechead">Under way</h3><div class="rows" id="dlpending">${d.pending.map(v => { CARDS[v.vid] = v; return `<div class="r" data-vid="${v.vid}">
      <div class="name"><a href="#/v/${v.vid}"><b>${esc(ttl(v))}</b></a><div class="sub dlstate">${esc(dlState(v.job))}</div>
        <span class="progress"><i style="width:${Math.round((v.job.frac || 0) * 100)}%"></i></span></div>
      ${v.job.state === 'error' ? '<button class="pill" data-act="dl">Try again</button><button class="pill" data-act="dlstop">Forget it</button>' : '<button class="pill" data-act="dlstop">Stop</button>'}</div>`; }).join('')}</div>`;
  if (d.items.length) {
    h += `<p class="fine dlsum">${d.items.length} video${d.items.length === 1 ? '' : 's'}, ${fmtSize(total)}${d.free != null ? ` &middot; ${fmtSize(d.free)} free` : ''}. They play from the file, without a connection.</p>
      <div id="dlgrid" class="grid">${d.items.map(v => card(v).replace('</div>' + kebab, `<div class="dlmeta">${[v.height ? v.height + 'p' : '', fmtSize(v.size)].filter(Boolean).join(' &middot; ')}
        ${NATIVE ? '' : `<a class="link" href="/media/${v.vid}.mp4?save=1" download>Save a copy</a>`}
        <button class="link" data-act="dlrm">Remove</button></div></div>${kebab}`)).join('')}</div>`;
  } else if (!d.pending.length) {
    h += '<p class="empty">Nothing downloaded. Use Download on a video\'s page or in the three-dot menu of any card; downloaded videos play from the file, without a connection.</p>';
  }
  main(h);
  if (d.pending.some(p => p.job.state !== 'error')) dlWatch();
}

// Followed channels can be kept off the home page: still followed, still on Following and their own page.
const quietTitle = q => q ? 'Kept off the home page. Click to let it back.' : 'Shown on the home page. Click to keep it off.';
const quietBtn = (name, q, pill) => pill
  ? `<button class="pill" data-act="quiet" data-ch="${esc(name)}" data-q="${q ? 1 : 0}" title="${quietTitle(q)}">${I.home} ${q ? 'Off Home' : 'On Home'}</button>`
  : `<button class="quiet ${q ? 'off' : ''}" data-act="quiet" data-ch="${esc(name)}" data-q="${q ? 1 : 0}" title="${quietTitle(q)}" aria-label="${quietTitle(q)}">${I.home}</button>`;

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
  const chans = tab === 'channels';
  const total = d.channels.length;
  let h = `<div class="pagehead"><h2>Following</h2></div>
    <div class="tabs"><a href="#/following" class="${chans ? '' : 'on'}">Videos</a><a href="#/following/channels" class="${chans ? 'on' : ''}">Channels <span class="muted">${total}</span></a>
      <span class="grow"></span>${chans || !B.has_key ? '' : `<button class="pill" data-act="refresh">${I.refresh} Check for new uploads</button>`}</div>`;
  if (chans) {
    h += `<div class="forms">
      <form id="chanfind"><input class="field" type="text" name="q" placeholder="Find a channel in the library" aria-label="Find a channel"><button class="pill">Find</button></form>
      ${B.has_key ? '<form id="chanurl"><input class="field" type="text" name="url" placeholder="Or any @handle / channel URL" aria-label="Channel URL or handle"><button class="pill">Follow</button></form>' : ''}
    </div><div id="chanresults"></div>`;
    if (total) {
      const list = [...d.channels].sort((x, y) => y.new - x.new);   // stable: alphabetical within equal counts
      h += `<h3 class="sechead">Your channels</h3>
        ${total > 12 ? `<input class="field" id="chanfilter" type="search" placeholder="Filter your ${total} channels" aria-label="Filter your channels" value="${esc(chanFilter)}">` : ''}
        <div class="chlist" id="chanlist">${list.map(c => `<div class="ch" data-name="${esc(c.name.toLowerCase())}">
          <a class="name" href="#/channel/${enc(c.name)}"><b>${esc(c.name)}</b>
            <span class="sub">${c.hn ? `${c.hn} in the library, ${c.unwatched} unwatched` : (c.checked ? 'Uploads only' : 'Not checked yet')}</span></a>
          ${c.new ? `<span class="new">${c.new} new</span>` : ''}
          ${quietBtn(c.name, c.quiet)}
          <button class="unf" data-follow="${esc(c.name)}" data-on="1" title="Unfollow ${esc(c.name)}" aria-label="Unfollow ${esc(c.name)}">${I.close}</button></div>`).join('')}</div>
        <p class="empty" id="channone" hidden>No followed channel matches that.</p>`;
    } else {
      h += '<p class="empty">You are not following anyone yet. Find a channel above, use the Follow button on any video, or bring your YouTube subscriptions in from <a class="link" href="#/setup">Settings</a>.</p>';
    }
  } else {
    if (d.uploads.length) h += '<h3 class="sechead">Uploads</h3>' + grid(d.uploads);
    if (d.picks.length) h += '<h3 class="sechead">From the library</h3>' + grid(d.picks);
    if (!d.uploads.length && !d.picks.length) h += total
      ? '<p class="empty">Nothing unwatched from the channels you follow right now.</p>'
      : '<p class="empty">You are not following anyone yet. Add channels on the <a class="link" href="#/following/channels">Channels</a> tab, use the Follow button on any video, or bring your YouTube subscriptions in from <a class="link" href="#/setup">Settings</a>.</p>';
  }
  main(h);
  if (chans) applyChanFilter();
}

async function pagePlaylists() {
  const d = await api('/playlists');
  let h = `<div class="pagehead"><h2>Playlists</h2></div>
    <div class="forms">
      <form id="plnew"><input class="field" type="text" name="name" placeholder="New playlist name" aria-label="New playlist name"><button class="pill">Create</button></form>
      ${B.has_key ? `<form id="plimport"><input class="field" type="text" name="url" placeholder="YouTube playlist or channel URL" aria-label="YouTube playlist URL, or a channel URL or @handle to pick from its playlists" title="A playlist URL imports that playlist. A channel URL or @handle lists the channel's public playlists to pick from."><button class="pill">Import</button></form>` : ''}
    </div><div id="plresults"></div>`;
  if (d.items.length) {
    h += `<div class="pgrid">${d.items.map(p => `<a class="plcard" href="#/playlist/${p.id}" ${p.next ? `data-vid="${(CARDS[p.next.vid] = p.next).vid}"` : ''}>
      <div class="thumb ${p.next ? '' : 'blank'}">${p.next ? timg(p.next) : I.list}<span class="plcount">${p.done}/${p.total} watched</span></div>
      <div class="progress"><i style="width:${p.total ? 100 * p.done / p.total : 0}%"></i></div>
      <div class="vt">${esc(p.name)}</div>
      <div class="sub">${p.next ? 'Up next: ' + esc(ttl(p.next)) : (p.total ? 'All done' : p.pending ? 'Waiting for video details' : 'Empty: use Save on any video')}${p.yt_id ? ' &middot; imported' : ''}</div></a>`).join('')}</div>`;
  } else {
    h += '<p class="empty">No playlists yet. Create one here and use Save on any video, or bring your YouTube playlists in from <a class="link" href="#/setup">Settings</a>.</p>';
  }
  main(h);
}

async function pagePlaylist(id) {
  const p = await api('/playlists/' + id);
  pageTitle = p.name;
  let h = `<div class="pagehead headrow"><div><h2>${esc(p.name)}</h2><p class="sub">${p.done} of ${p.items.length} watched</p></div>
    <span class="progress"><i style="width:${p.items.length ? 100 * p.done / p.items.length : 0}%"></i></span><span style="flex:1"></span>
    ${p.next && p.items.length > 12 ? `<button class="pill" data-act="jumpnext">${I.down} Up next</button>` : ''}
    ${p.yt_id ? `${B.has_key ? `<button class="pill" data-act="plsync" data-id="${p.id}" title="Add what is new on YouTube, drop what was removed there; your own changes here are kept">${I.refresh} Sync with YouTube</button>` : ''}
      <a class="pill" href="https://www.youtube.com/playlist?list=${esc(p.yt_id)}" target="_blank" rel="noopener">${I.out} On YouTube</a>` : ''}
    <button class="pill danger" data-act="delpl" data-id="${p.id}">${I.trash} Delete playlist</button></div>`;
  if (p.pending) h += `<p class="note">${p.pending} video${p.pending === 1 ? ' is' : 's are'} not shown: imported without a YouTube API key, so there are no titles for them yet. ${B.has_key
    ? `<button class="pill" data-act="plsync" data-id="${p.id}">${I.refresh} Fetch details</button>` : 'See <a href="#/setup">Settings</a>.'}</p>`;
  if (!p.items.length) h += '<p class="empty">Empty. Use Save on any video to add it here.</p>';
  else h += `<ol class="plrows">${p.items.map((v, i) => {
    CARDS[v.vid] = v;
    v.pl = p.id;
    const facts = factLine(v);
    return `<li class="row ${v.watched ? 'seen' : ''} ${v.vid === p.next ? 'nextup' : ''}" data-vid="${v.vid}" data-pl="${p.id}" draggable="true">
      <span class="grip" title="Drag to reorder" aria-hidden="true">${I.grip}</span>
      <span class="num">${i + 1}</span>
      <div class="thumb"><a href="${vhref(v)}" tabindex="-1" aria-hidden="true">${timg(v)}${v.dur ? `<span class="dur">${fmtDur(v.dur)}</span>` : ''}</a></div>
      <div class="text">${vt(v)}
        <div class="sub">${[chanLink(v), facts].filter(Boolean).join(' &middot; ')}</div>
        ${v.vid === p.next ? '<span class="via next">Up next</span>' : ''}</div>
      <div class="tools">
        <button class="ibtn" data-act="watch" title="Play" aria-label="Play">${I.play}</button>
        <button class="ibtn ${v.watched ? 'on' : ''}" data-act="seen" title="${seenTitle(v.watched)}" aria-label="${seenTitle(v.watched)}">${I.check}</button>
        <button class="ibtn" data-act="up" title="Move up (Shift-click: to the top)" aria-label="Move up">${I.up}</button>
        <button class="ibtn" data-act="down" title="Move down (Shift-click: to the bottom)" aria-label="Move down">${I.down}</button>
        <button class="ibtn" data-act="unlist" title="Remove from playlist" aria-label="Remove from playlist">${I.close}</button>
      </div></li>`;
  }).join('')}</ol>`;
  main(h);
}

// "Today", "Yesterday", a weekday within the last week, then the month; '' (an imported row without a date) is "Earlier"
function dayLabel(when) {
  if (!when) return 'Earlier';
  const d = new Date(when + 'T12:00'), now = new Date(B.today + 'T12:00'), days = Math.round((now - d) / 864e5);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, d.getFullYear() === now.getFullYear() ? { month: 'long' } : { month: 'long', year: 'numeric' });
}
const libraryHead = tab => `<div class="pagehead"><h2>Library</h2></div>
    <div class="tabs"><a href="#/library" class="${tab ? '' : 'on'}">History</a><a href="#/library/liked" class="${tab === 'liked' ? 'on' : ''}">Liked</a><a href="#/library/downloads" class="${tab === 'downloads' ? 'on' : ''}">Downloads</a></div>`;
async function pageLibrary(tab) {
  if (tab === 'downloads') { pageTitle = 'Downloads'; return renderDownloads(await api('/downloads')); }
  const liked = tab === 'liked';
  const d = await api(liked ? '/liked' : '/history');
  pageTitle = liked ? 'Liked' : 'History';
  let h = libraryHead(liked ? 'liked' : '');
  if (liked) {
    h += d.items.length ? grid(d.items) : '<p class="empty">No likes yet. Use the thumbs-up on a video\'s page, or the three-dot menu on any card.</p>';
    if (d.disliked.length) h += `<h3 class="sechead">Disliked</h3><div class="rows">${d.disliked.map(v => `<div class="r plain" data-vid="${v.vid}">
      <div class="name"><a href="#/v/${v.vid}">${esc(v.title)}</a></div><button class="pill" data-act="unrate">Remove dislike</button></div>`).join('')}</div>`;
  } else {
    const groups = [];                // consecutive videos under the same label; the list comes newest first
    for (const v of d.items) {
      const label = dayLabel(v.when);
      if (!groups.length || groups[groups.length - 1][0] !== label) groups.push([label, []]);
      groups[groups.length - 1][1].push(v);
    }
    h += groups.map(([label, items]) => `<h3 class="sechead">${esc(label)}</h3>${grid(items)}`).join('') || '<p class="empty">Nothing watched yet.</p>';
    if (d.hidden.length) h += `<h3 class="sechead">Hidden videos</h3><div class="rows">${d.hidden.map(v => `<div class="r plain" data-vid="${v.vid}">
      <div class="name">${esc(v.title)}</div><button class="pill" data-act="unhide">Bring back</button></div>`).join('')}</div>`;
  }
  main(h);
}

async function pageForYou(p) {
  const f = filterParams(p, ['len', 'type', 'area']);
  const d = await api('/foryou?' + qs(f));
  let h = filterBar('#/foryou', {}, f, d.items.length ? `<span class="muted">from ${d.likes} like${d.likes === 1 ? '' : 's'}${d.topics ? ', your topics' : ''} and your history</span>` : '', '<h2>For You</h2>');
  if (d.items.length) h += grid(d.items);
  else if (!d.likes && !d.watched && !d.topics) h += `<p class="empty">Nothing to go on yet. Like a few videos (the thumbs-up on a video's page, or the three-dot menu on any card), mark the topics you want more of on <a class="link" href="#/explore">Explore</a>, or bring your YouTube history in from <a class="link" href="#/setup">Settings</a>.</p>`;
  else h += '<p class="empty">No close matches. Like a few more videos, ask for more of a topic on <a class="link" href="#/explore">Explore</a>, or remove a filter.</p>';
  main(h);
}

// every topic area with its categories, plus quick ways into the whole collection
function pageExplore() {
  main(`<div class="explore">
    <div class="pagehead"><h2>Explore</h2></div>
    <div class="quick">
      <a class="pill" href="#/browse">All videos</a>
      <a class="pill" href="#/browse?sort=recent">Recently recommended</a>
      ${B.has_meta ? '<a class="pill" href="#/browse?len=long">Longs</a><a class="pill" href="#/browse?sort=gems">Hidden gems</a>' : ''}
    </div>
    <div class="areas">${B.areas.map(a => `<section class="areacard">
      <div class="areaname"><a href="#/a/${a.id}">${esc(a.name)}</a><span class="count">${a.count}</span>${topicCtl(a.id, a.w)}</div>
      <div class="cats">${a.categories.map(c => `<div><a href="#/c/${c.id}">${esc(c.name)}</a><span class="count">${c.count}</span>${topicCtl(c.id, c.w, a.w)}</div>`).join('')}</div>
    </section>`).join('')}</div>
  </div>`);
}

// Settings of the phone's own player, kept on the phone (they would make no sense on the desktop).
function nativeSettings() {
  let p = {};
  try { p = JSON.parse(NATIVE.prefs()); } catch { /* an older app: none to show */ }
  const nsw = (key, name, text) => `<label class="setting"><span><b>${name}</b><span>${text}</span></span>
      <input type="checkbox" class="switch" data-nat="${key}" ${p[key] ? 'checked' : ''}></label>`;
  return `<h3 class="sechead">On this phone</h3>
    ${nsw('pip', 'Picture in picture', 'Leaving the app while a video plays keeps it going in a small window. Off, it keeps playing as sound only; lock the screen and it plays on either way, with controls on the lock screen.')}
    ${nsw('gestures', 'Swipe and double-tap', 'In the player: double-tap the left or right side to go back or ahead 10 seconds, and swipe up or down on the left for brightness, on the right for volume.')}
    ${nsw('audio_only', 'Sound only', 'Fetch the sound alone, without the picture: less data, and good for talks you only listen to. The player has a button to switch for one video.')}
    <label class="setting"><span><b>Picture quality</b><span>The tallest picture the phone's player picks to start with; the player's menu changes it for one video.</span></span>
      <select class="field" data-nat="quality" aria-label="Picture quality">${[360, 480, 720, 1080, 1440, 2160].map(v => `<option value="${v}" ${+p.quality === v ? 'selected' : ''}>${v}p</option>`).join('')}</select></label>`;
}

function pageSetup() {
  const n = x => x.toLocaleString();
  const sw = (key, name, text) => `<label class="setting"><span><b>${name}</b><span>${text}</span></span>
      <input type="checkbox" class="switch" data-set="${key}" ${B.settings[key] ? 'checked' : ''}></label>`;
  const imp = B.imported;
  main(`<div class="pagehead"><h2>Settings</h2></div>
    <div class="about">
    ${sw('ask_intent', 'Ask what I am here for', 'Before the first video of a sitting, one tap: learn something, unwind, or just this video. The answer is shown back when a video ends, counted on the Review page, and "just this video" checks with you before playing a second one.')}
    ${sw('calm', 'Calm presentation', 'No view counts, and no "new" dots or badges asking for attention. Uploads from followed channels still arrive in your queue.')}
    ${sw('hide_watched', 'Hide played videos', 'Watched videos disappear from the home page, Explore, search, channel pages and related videos instead of showing dimmed. The Library and playlists still list them.')}
    ${sw('dearrow', 'Video frames and plain titles (DeArrow)', 'Show a frame from the video instead of the uploader\'s thumbnail, and the community-written title from <a href="https://dearrow.ajay.app" target="_blank" rel="noopener">DeArrow</a> where one exists. Hover a title to see the original. Video ids are looked up on DeArrow\'s servers (by hash prefix).')}
    ${NATIVE ? '' : sw('captions', 'Captions', 'Show captions in the player, where the video has them. The CC button and the c key in the player change this too.')}
    ${sw('sponsorblock', 'Skip sponsor segments (SponsorBlock)', 'Sponsor reads, intros, reminders to subscribe and the like, as marked by viewers on <a href="https://sponsor.ajay.app" target="_blank" rel="noopener">SponsorBlock</a>. Each kind is skipped (with an undo), offered with a Skip button, or left alone, as set below. Video ids are looked up by hash prefix; nothing is sent back.')}
    <details class="howto sbcats"><summary>What to do with each kind of segment</summary>
      ${Object.entries(B.sb_cats).map(([k, c]) => `<label class="setting"><span><b><i class="sbdot" style="background:${esc(c.color)}"></i>${esc(c.name)}</b></span>
        <select class="field" data-sb="${k}" aria-label="${esc(c.name)}">${[['skip', 'Skip it'], ['ask', 'Show a Skip button'], ['off', 'Leave it']].map(([v, t]) => `<option value="${v}" ${B.sb[k] === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`).join('')}
    </details>
    <label class="setting"><span><b>Playback speed</b><span>The speed every video starts at. You can still change it in the player.</span></span>
      <select class="field" data-num="speed" aria-label="Playback speed">${[1, 1.25, 1.5, 1.75, 2].map(v => `<option value="${v}" ${B.speed === v ? 'selected' : ''}>${v === 1 ? 'Normal' : v + '×'}</option>`).join('')}</select></label>
    <label class="setting"><span><b>Download quality</b><span>The tallest picture a download may have. Higher takes more space: an hour at 720p is about 1 GB.</span></span>
      <select class="field" data-num="dl_quality" aria-label="Download quality">${[360, 480, 720, 1080].map(v => `<option value="${v}" ${B.dl_quality === v ? 'selected' : ''}>${v}p</option>`).join('')}</select></label>
    ${NATIVE ? nativeSettings() : ''}
    <label class="setting"><span><b>Keep long uploads off Home</b><span>New videos from channels you follow that run longer than this stay on the Following page and never enter the home page queue. To keep one channel off Home altogether, use the house button next to it on Following.</span></span>
      <select class="field" data-num="home_max_len" aria-label="Longest upload shown on Home">${[[0, 'No limit'], [3600, 'Over 1 hour'], [7200, 'Over 2 hours'], [10800, 'Over 3 hours']].map(([v, t]) => `<option value="${v}" ${B.home_max_len === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>

    <h3 class="sechead">Bring in your YouTube data</h3>
    <p class="fine">Watch history, likes, subscriptions and playlists, from a Google Takeout export. You see what is in it before anything changes. Nothing leaves this computer.</p>
    <div class="drop" id="todrop">
      <span>Drop the Takeout .zip or folder here, or</span>
      <label class="pill solid">Choose .zip<input type="file" id="tofiles" accept=".zip,.csv,.json,.html" multiple hidden></label>
      <label class="pill">Choose folder<input type="file" id="todir" webkitdirectory hidden></label>
    </div>
    <details class="howto"><summary>How to get the export</summary><ol>
      <li>On <a href="https://takeout.google.com/" target="_blank" rel="noopener">takeout.google.com</a>, click <b>Deselect all</b>, then tick <b>YouTube and YouTube Music</b>.</li>
      <li>Under <b>All YouTube data included</b>, untick <b>videos</b> so the download stays small.</li>
      <li><b>Next step &rarr; Create export</b>. Google emails a link when it is ready.</li>
      <li>Drop the downloaded .zip here as it is; no need to unzip it.</li>
    </ol></details>
    <div id="takeoutres"></div>
    ${imp.watched || imp.ratings ? `<p class="fine undoimp">${n(imp.watched)} watched marks and ${n(imp.ratings)} likes here came from Takeout.
      <button class="pill danger" data-act="forgetimport" title="What you did in this app stays. Followed channels and playlists stay too.">Take them back</button></p>` : ''}

    <h3 class="sechead">YouTube API key</h3>
    <p class="fine">${B.has_key
      ? `Connected.${B.has_meta < B.total * .99 ? ` ${n(B.has_meta)} of ${n(B.total)} library videos have lengths; <code>pixi run fetch-meta</code> fetches the rest.` : ''}`
      : 'Not set. A free key adds video lengths, new uploads from channels you follow, playlists and channels by link, and YouTube results under searches. Everything else works without one.'}</p>
    <details class="howto"><summary>How to get a key</summary>
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
      Re-run <code>pixi run fetch-meta --refresh</code> every few months to keep durations and deletions current.</p></details>

    <h3 class="sechead">Other devices</h3>
    <p class="fine" id="syncinfo">What you do here is written to the <code>sync</code> folder, and what other devices write there is taken in.</p>

    <h3 class="sechead">Keyboard</h3>
    <p class="fine">Press <code>?</code> anywhere for the list of shortcuts.</p></div>`);
  api('/sync').then(d => {
    const el = $('#syncinfo');
    if (!el) return;
    const seen = d.others.map(o => `<code>${esc(o.dev)}</code> (last change taken in ${esc(new Date(o.ts * 1000).toLocaleString())})`).join(', ');
    el.innerHTML = `What you do here is written to <code>${esc(d.folder)}</code> as <code>${esc(d.dev)}.jsonl</code>, and what other devices write there is taken in. Let Syncthing share that folder; each device keeps its own state file outside it. `
      + (d.error ? `<b>The folder could not be used: ${esc(d.error)}</b>` : d.others.length ? `Seen so far: ${seen}.` : 'No other device has written there yet.');
  }).catch(() => {});
}

// The last seven days, laid out for you to judge rather than to keep you going.
async function pageReview() {
  const d = await api('/review');
  const max = Math.max(...d.days.map(x => x.secs), 1);
  const rated = d.worth + d.not_worth;
  const diff = d.total - d.prev;
  const came = Object.entries(d.intents).filter(([, n]) => n).map(([k, n]) => `${n}&times; ${INTENT_TEXT[k]}`).join(', ');
  const list = (title, rows) => rows.length ? `<div><h4>${title}</h4>${rows.map(r => `<div class="rrow"><span>${esc(r.name)}</span><span class="muted">${fmtMin(r.secs)}</span></div>`).join('')}</div>` : '';
  main(`<div class="pagehead"><h2>Review</h2></div>
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

const notFound = () => main('<div class="pagehead"><h2>Page not found</h2><p class="sub">There is nothing at this address. <a class="link" href="#/">Back to home</a></p></div>');
const routeName = () => location.hash.replace(/^#\/?/, '').split(/[/?]/)[0];

// The tab title: a page sets pageTitle for a name of its own (a video, a channel, a playlist); the rest are fixed.
let pageTitle = '';
const TITLES = { foryou: 'For You', explore: 'Explore', categories: 'Explore', following: 'Following', playlists: 'Playlists', review: 'Review', setup: 'Settings', done: 'Done for now' };

async function route() {
  stopPlayer();
  closePopup();
  pageTitle = '';
  const slow = setTimeout(() => document.body.classList.add('loading'), 150);   // a thin bar, only when a page is slow to arrive
  document.body.classList.remove('drawer');
  const [path, qs = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const p = Object.fromEntries(new URLSearchParams(qs));
  const [name, ...rest] = path.split('/');
  const arg = decodeURIComponent(rest.join('/'));
  const tab = { '': 'mix', foryou: 'foryou', explore: 'explore', categories: 'explore', browse: 'explore', a: 'explore', c: 'explore', channel: 'following', following: 'following', playlists: 'playlists', playlist: 'playlists', library: 'library', history: 'library', liked: 'library', review: 'review', setup: 'setup' }[name];
  document.querySelectorAll('#side .nav a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  $('#search input').value = name === 'browse' ? (p.q || '') : '';
  try {
    if (name === '') await pageMix(p);
    else if (name === 'browse') await pageBrowse(p);
    else if (name === 'channel') await pageBrowse(p, { channel: arg });
    else if (name === 'a') await pageBrowse(p, { area: arg });
    else if (name === 'c') await pageBrowse(p, { cat: arg });
    else if (name === 'v') await pageVideo(arg, !!p.play, p.pl);
    else if (name === 'following') await pageFollowing(arg);
    else if (name === 'playlists') await pagePlaylists();
    else if (name === 'playlist') await pagePlaylist(arg);
    else if (name === 'library') await pageLibrary(arg);
    else if (name === 'history') await pageLibrary('');      // older addresses
    else if (name === 'liked') await pageLibrary('liked');
    else if (name === 'foryou') await pageForYou(p);
    else if (name === 'review') await pageReview();
    else if (name === 'done') await pageDone();
    else if (name === 'explore' || name === 'categories') pageExplore();
    else if (name === 'setup') pageSetup();
    else notFound();
  } catch (e) {
    main(`<p class="note err">${esc(e.message)}</p>`);
  }
  clearTimeout(slow);
  document.body.classList.remove('loading');
  const title = pageTitle || TITLES[routeName()];
  document.title = title ? `${title} · PersonalTube` : 'PersonalTube';
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
function markLater(vid, on) {
  if (CARDS[vid]) CARDS[vid].later = on;
  document.querySelectorAll(`[data-vid="${vid}"] [data-act="later"]`).forEach(b => {
    b.classList.toggle('on', on);
    b.title = laterTitle(on);
    if (b.hasAttribute('aria-label')) b.setAttribute('aria-label', laterTitle(on));
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
const hidesWatched = () => B.settings.hide_watched && !/^#\/(v|playlist|library|history|liked|review|setup)/.test(location.hash);
async function setWatched(vid, on) {
  const r = await api('/watched/' + vid, { watched: on });
  if (on && hidesWatched()) {
    toast('Marked watched and hidden.', async () => { await api('/watched/' + vid, { watched: false }); await refresh(); });
    return refresh();
  }
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
    <button class="mi" data-act="later">${I.clock}<span>${laterTitle(!!(CARDS[vid] && CARDS[vid].later))}</span></button>
    <button class="mi" data-act="list">${I.save}<span>Save to playlist</span></button>
    ${CARDS[vid] && CARDS[vid].dl ? `<button class="mi" data-act="dlrm">${I.dl}<span>Remove the download</span></button>`
      : DLJOBS[vid] && DLJOBS[vid].state !== 'error' ? '' : `<button class="mi" data-act="dl">${I.dl}<span>Download</span></button>`}
    <button class="mi" data-act="hide">${I.hide}<span>Hide forever</span></button>`, vid, anchor, host);
}
// The picker ticks the playlists that already hold the video; clicking one adds or removes it and the picker stays.
async function listPopup(vid, anchor, host) {
  let ids = [];
  try { ids = (await api('/playlists/of/' + vid)).ids; } catch { /* no ticks this time */ }
  openPopup(`<div class="mh">Save to playlist</div>
    ${B.playlists.map(p => { const on = ids.includes(p.id); return `<button class="mi ${on ? 'in' : ''}" data-addto="${p.id}" role="menuitemcheckbox" aria-checked="${on}">${on ? I.check : I.list}<span>${esc(p.name)}</span></button>`; }).join('') || '<div class="mnone">No playlists yet</div>'}
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
      const on = !t.classList.contains('in'), pid = +t.dataset.addto, pv = pop.dataset.pv, at = popAnchor, ph = popHost;
      await api(`/playlists/${pid}/${on ? 'add' : 'remove'}`, { vid: pv });
      if (pid === B.watch_later) markLater(pv, on);
      toast(on ? 'Saved to playlist' : 'Removed from playlist');
      await reboot();
      if (!pop.hidden && pop.dataset.pv === pv) await listPopup(pv, at, ph);
      return;
    }
    switch (t.dataset.act) {
      case 'undo': {
        const fn = toastUndo;
        toastUndo = null; $('#toast').classList.remove('on', 'act');
        if (fn) await fn();
        return;
      }
      case 'later': {
        const on = !(CARDS[vid] && CARDS[vid].later);
        const set = async to => {
          B.watch_later = (await api('/later/' + vid, { on: to })).id;
          markLater(vid, to);
          await (location.hash === '#/playlist/' + B.watch_later ? refresh() : reboot());
        };
        await set(on);
        return toast(on ? 'Saved to Watch later' : 'Removed from Watch later', () => set(!on));
      }
      case 'topic': {
        const box = t.closest('.tw'), id = box.dataset.topic, w = +box.dataset.w === +t.dataset.w ? 0 : +t.dataset.w;
        await api('/topic', { id, w });
        for (const a of B.areas) for (const x of [a, ...a.categories]) if (x.id === id) x.w = w;
        toast(w > 0 ? 'More of this on Home and For You.' : w < 0 ? 'Less of this on Home and For You.' : 'Back to normal.');
        return route();
      }
      case 'quiet': {
        const quiet = t.dataset.q !== '1';
        await api('/follow/quiet', { channel: t.dataset.ch, quiet });
        toast(quiet ? `${t.dataset.ch} stays off the home page. Still on Following.` : `${t.dataset.ch} is back on the home page.`);
        return route();
      }
      case 'seek': {
        const secs = +t.dataset.t;
        $('#player').scrollIntoView({ block: 'nearest' });
        if (player) { player.seek(secs); player.play(); return; }
        if (CARDS[vid]) CARDS[vid].resume = secs;
        return startPlayer(vid);
      }
      case 'moredesc': {
        const box = $('#main .ytdesc'), open = box.classList.toggle('clamp');
        t.textContent = open ? 'Show more' : 'Show less';
        return;
      }
      case 'jumpnext': { const li = $('#main .plrows .nextup'); if (li) li.scrollIntoView({ block: 'center' }); return; }
      case 'closekeys': $('#keys').close(); return;
      case 'takeoutgo': return takeoutImport(t);
      case 'takeoutcancel': $('#takeoutres').innerHTML = ''; return;
      case 'forgetimport':
        if (t.dataset.sure) {
          const r = await api('/takeout/forget', {});
          toast(`Took back ${r.watched.toLocaleString()} watched marks and ${r.ratings.toLocaleString()} likes`);
          await reboot(); return route();
        }
        t.dataset.sure = 1; t.textContent = 'Really take it back? Click again';
        return;
      case 'menu':
        e.stopPropagation();
        if (!pop.hidden && popAnchor === t) return closePopup();
        return menuPopup(vid, t, host);
      case 'watch': location.hash = vhref({ vid, pl: host && host.dataset.pl }, true); return;
      case 'play': e.preventDefault(); return startPlayer(vid);
      case 'intent': {
        api('/intent', { intent: t.dataset.kind }).catch(() => { /* only a count for the Review page */ });
        setIntent(t.dataset.kind, vid);
        $('#player').dataset.asked = 1;
        return startPlayer(vid);
      }
      case 'sbskip': if (player) player.seek(+t.dataset.t); t.remove(); return;
      case 'dl': return dlStart(vid);
      case 'dlstop': return dlRemove(vid, true);
      case 'dlrm': return dlRemove(vid, false);
      case 'showrel': t.remove(); $('.watch').classList.remove('playing'); return;
      case 'seen': return setWatched(vid, !(CARDS[vid] && CARDS[vid].watched));
      case 'list': e.stopPropagation(); return listPopup(vid, anchor, host);
      case 'like': case 'dislike': case 'unrate': {
        const want = { like: 1, dislike: -1, unrate: 0 }[t.dataset.act];
        const r = (CARDS[vid] && CARDS[vid].rating) === want ? 0 : want;
        await api('/rate/' + vid, { rating: r });
        markRated(vid, r);
        toast(r > 0 ? 'Liked. Recommendations will lean this way.' : r < 0 ? 'Disliked. You will see fewer like it.' : 'Rating removed.');
        if (/^#\/(library\/liked|liked|foryou)/.test(location.hash) || (r < 0 && routeName() === '')) return route();
        return;
      }
      case 'hide':
        await api('/hide/' + vid, { hidden: true });
        toast('Hidden. It is listed at the end of History.', async () => { await api('/hide/' + vid, { hidden: false }); await route(); });
        if (location.hash.startsWith('#/v/')) history.back(); else if (host) host.remove();
        return;
      case 'unhide': await api('/hide/' + vid, { hidden: false }); return route();
      case 'filters': {
        const panel = $('#main .filters');
        panel.hidden = !panel.hidden;
        t.classList.toggle('on', !panel.hidden); t.setAttribute('aria-expanded', !panel.hidden);
        return;
      }
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
        const picked = [...document.querySelectorAll('#plresults .plpick:checked')].map(b => chanLists[b.dataset.i]);
        t.disabled = true; t.textContent = 'Importing…';
        let ok = 0, videos = 0, last, err;            // a channel's playlists: fetched from YouTube one at a time
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
      case 'plsync': {
        t.disabled = true; t.textContent = 'Syncing…';
        const r = await api(`/playlists/${t.dataset.id}/sync`, {});
        toast(syncMsg(r));
        return refresh();
      }
      case 'up': case 'down':
        await api(`/playlists/${host.dataset.pl}/move`, { vid, dir: e.shiftKey ? (t.dataset.act === 'up' ? 'top' : 'bottom') : t.dataset.act });
        return route();
      case 'unlist': {
        const pl = host.dataset.pl, next = host.nextElementSibling, before = next ? next.dataset.vid : null;
        await api(`/playlists/${pl}/remove`, { vid });
        if (+pl === B.watch_later) markLater(vid, false);
        toast('Removed from the playlist.', async () => {   // back where it was
          await api(`/playlists/${pl}/add`, { vid });
          await api(`/playlists/${pl}/move`, { vid, before });
          await refresh();
        });
        return refresh();
      }
      case 'delpl':
        if (t.dataset.sure) { await api('/playlists/' + t.dataset.id, undefined, 'DELETE'); await reboot(); location.hash = '#/playlists'; }
        else { t.dataset.sure = 1; t.textContent = 'Really delete? Click again'; }
        return;
    }
  } catch (err) { fail(err); if (['refresh', 'plsync', 'plgo'].includes(t.dataset.act)) route(); }
});

let chanLists = [];                 // a channel's playlists, offered in #plresults to pick from
const plCount = () => {
  const n = document.querySelectorAll('#plresults .plpick:checked').length;
  const b = $('#plgo');
  b.textContent = `Import ${n} selected`; b.disabled = !n;
};
const syncMsg = r => {
  const bits = [r.added && `${r.added} added`, r.removed && `${r.removed} removed`, r.unavailable && `${r.unavailable} no longer on YouTube`].filter(Boolean);
  return `"${r.name}": ` + (bits.join(', ') || 'already up to date');
};

document.addEventListener('change', async e => {
  if (e.target.id === 'tofiles' || e.target.id === 'todir') {
    const picked = [...e.target.files].map(f => ({ file: f, path: f.webkitRelativePath || f.name }));
    e.target.value = '';
    return takeoutScan(picked);
  }
  if (e.target.classList.contains('tokind')) {      // a whole part on or off: its channels or playlists follow
    document.querySelectorAll(`#takeoutres .topick[data-part="${e.target.dataset.part}"]:not(:disabled)`).forEach(b => { b.checked = e.target.checked; });
    return takeoutCount();
  }
  if (e.target.classList.contains('topick')) {
    const k = $(`#to-${e.target.dataset.part}`);
    k.checked = !!document.querySelector(`#takeoutres .topick[data-part="${e.target.dataset.part}"]:checked`);
    return takeoutCount();
  }
  if (e.target.dataset.num) {
    const k = e.target.dataset.num, n = +e.target.value;
    try { await api('/settings', { [k]: n }); B[k] = n; toast('Saved.'); } catch (err) { fail(err); }
    return;
  }
  if (e.target.dataset.sb) {
    const k = e.target.dataset.sb, a = e.target.value;
    try { await api('/settings', { sb: { [k]: a } }); B.sb[k] = a; toast('Saved.'); } catch (err) { fail(err); }
    return;
  }
  if (e.target.dataset.nat) {
    NATIVE.setPref(e.target.dataset.nat, e.target.type === 'checkbox' ? String(e.target.checked) : e.target.value);
    return toast('Saved.');
  }
  if (e.target.classList.contains('plpick')) return plCount();
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
      chanLists = d.items;
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
// ---- keyboard. j / k walk the videos on a page (focus moves to the title, so Enter opens it); the letter keys
// act on the focused video, or on the video of a video page; "g" then a letter goes to a page. "?" lists them.
const GO = { h: '#/', y: '#/foryou', e: '#/explore', f: '#/following', p: '#/playlists', l: '#/library', r: '#/review', s: '#/setup' };
const KEY_ACT = { w: 'later', m: 'seen', l: 'like', p: 'watch' };
let goAt = 0;
// While a video plays, its keys are YouTube's: they take over j, k, l and m from the page until it stops.
const PLAYER_KEYS = {
  ' ': ['toggle'], k: ['toggle'], j: ['seekBy', -10], l: ['seekBy', 10], ArrowLeft: ['seekBy', -10], ArrowRight: ['seekBy', 10],
  ArrowUp: ['volBy', 0.05], ArrowDown: ['volBy', -0.05], m: ['mute'], f: ['fs'], c: ['cc'], '<': ['rateBy', -1], '>': ['rateBy', 1],
};
function playerKey(k) {
  // the phone's player has no bar here; give it the basic ones
  const c = pctl || {
    toggle: () => player.playing() ? player.pause() : player.play(),
    seekBy: s => player.seek(Math.max(0, player.time() + s)),
    jump: x => player.seek(x * player.dur()),
  };
  const [fn, arg] = PLAYER_KEYS[k] || (/^[0-9]$/.test(k) ? ['jump', k / 10] : []);
  if (!fn || !c[fn]) return false;
  c[fn](arg);
  return true;
}
// run a data-act on a video as if a button inside its card had been clicked
function runAct(act, host) {
  const b = document.createElement('button');
  b.dataset.act = act; b.hidden = true;
  host.appendChild(b); b.click(); b.remove();
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closePopup(); document.body.classList.remove('drawer'); return; }
  const el = document.activeElement, k = e.key;
  if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || $('#keys').open) return;
  if (k === '/') { e.preventDefault(); $('#search input').focus(); return; }
  if (k === '?') { $('#keys').showModal(); return; }
  if (Date.now() - goAt < 1500) {
    goAt = 0;
    if (GO[k] !== undefined) { e.preventDefault(); location.hash = GO[k]; return; }
  }
  if (k === 'g') { goAt = Date.now(); return; }
  const onVideo = routeName() === 'v', host = el.closest('#main [data-vid]') || (onVideo && $('#main .primary[data-vid]'));
  if (onVideo && (el === document.body || el.closest('#player'))) {   // the player, while nothing else has the focus
    if (k === ' ' && !player) { e.preventDefault(); return host && startPlayer(host.dataset.vid); }
    if (player && playerKey(k)) { e.preventDefault(); return; }
  }
  if (k === 'j' || k === 'k') {
    const all = [...document.querySelectorAll('#main a.vt')].filter(a => a.offsetParent);
    if (!all.length) return;
    let i = all.indexOf(el);
    if (i < 0) i = Math.max(0, all.findIndex(a => a.getBoundingClientRect().bottom > 64)) - (k === 'j' ? 1 : 0);   // start at the first one in view
    const to = all[Math.max(0, Math.min(all.length - 1, i + (k === 'j' ? 1 : -1)))];
    to.focus({ preventScroll: true });
    (to.closest('[data-vid]') || to).scrollIntoView({ block: 'nearest' });
    return;
  }
  if (!host) return;
  if (k === 's') { e.preventDefault(); return listPopup(host.dataset.vid, el === document.body ? $('[data-act="list"]', host) || host : el, host); }
  if (KEY_ACT[k]) {
    e.preventDefault();
    if (k === 'p' && onVideo && host.classList.contains('primary')) return startPlayer(host.dataset.vid);
    runAct(KEY_ACT[k], host);
  }
});
$('#keys').addEventListener('click', e => { if (e.target.id === 'keys') e.target.close(); });   // a click on the backdrop

// ---- reordering a playlist by dragging a row's handle
let dragVid = null, onGrip = false;
const dropMarks = () => document.querySelectorAll('.dropbefore, .dropafter, .dragging').forEach(x => x.classList.remove('dropbefore', 'dropafter', 'dragging'));
document.addEventListener('mousedown', e => { onGrip = !!e.target.closest('.grip'); });
document.addEventListener('dragstart', e => {
  const li = e.target.closest && e.target.closest('.plrows li');
  if (!li) return;
  if (!onGrip) { e.preventDefault(); return; }
  dragVid = li.dataset.vid;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragVid);
  setTimeout(() => li.classList.add('dragging'));
});
document.addEventListener('dragover', e => {
  const li = dragVid && e.target.closest && e.target.closest('.plrows li');
  if (!li) return;
  e.preventDefault();
  const r = li.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
  document.querySelectorAll('.dropbefore, .dropafter').forEach(x => x.classList.remove('dropbefore', 'dropafter'));
  if (li.dataset.vid !== dragVid) li.classList.add(after ? 'dropafter' : 'dropbefore');
});
document.addEventListener('drop', async e => {
  const li = dragVid && e.target.closest && e.target.closest('.plrows li');
  if (!li) return;
  e.preventDefault();
  const vid = dragVid, after = li.classList.contains('dropafter');
  const next = after ? li.nextElementSibling : li, before = next ? next.dataset.vid : null;
  dragVid = null; dropMarks();
  if (li.dataset.vid === vid || before === vid) return;
  try { await api(`/playlists/${li.dataset.pl}/move`, { vid, before }); await route(); } catch (err) { fail(err); }
});
document.addEventListener('dragend', () => { dragVid = null; dropMarks(); });

// ---------------------------------------------------------------- Google Takeout import (Settings)
// The export arrives as a .zip (or the parts of a split one), its unzipped folder, or single files from it. The
// files go to the server one at a time under one token; it says what they hold, and nothing changes until Import.
const TO_WANT = /\.(csv|json|html?)$/i;
const TO_MAX = 300e6;                // the server's limit for one file

// The entries of a zip worth sending, as { path, size, open() -> Blob }. The archive is read in place from its
// central directory, so only those entries are inflated (an export can hold gigabytes of uploaded videos).
async function zipEntries(file) {
  const view = async (at, len) => new DataView(await file.slice(at, at + len).arrayBuffer());
  const tl = Math.min(file.size, 65557), tail = await view(file.size - tl, tl);
  let e = -1;
  for (let i = tl - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error(`${file.name} is not a zip file, or is not complete`);
  let count = tail.getUint16(e + 10, true), size = tail.getUint32(e + 12, true), off = tail.getUint32(e + 16, true);
  if (e >= 20 && tail.getUint32(e - 20, true) === 0x07064b50) {     // zip64: over 4 GB or 65,535 entries
    const z = await view(Number(tail.getBigUint64(e - 12, true)), 56);
    count = Number(z.getBigUint64(32, true)); size = Number(z.getBigUint64(40, true)); off = Number(z.getBigUint64(48, true));
  }
  const cd = await view(off, size), dec = new TextDecoder(), out = [];
  for (let at = 0, k = 0; k < count && at + 46 <= size && cd.getUint32(at, true) === 0x02014b50; k++) {
    const method = cd.getUint16(at + 10, true), nl = cd.getUint16(at + 28, true), xl = cd.getUint16(at + 30, true);
    let csize = cd.getUint32(at + 20, true), usize = cd.getUint32(at + 24, true), local = cd.getUint32(at + 42, true);
    const path = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + at + 46, nl));
    for (let x = at + 46 + nl; x + 4 <= at + 46 + nl + xl; x += 4 + cd.getUint16(x + 2, true)) {
      if (cd.getUint16(x, true) !== 1) continue;                    // the zip64 field: the sizes that did not fit
      let y = x + 4;
      if (usize === 0xFFFFFFFF) { usize = Number(cd.getBigUint64(y, true)); y += 8; }
      if (csize === 0xFFFFFFFF) { csize = Number(cd.getBigUint64(y, true)); y += 8; }
      if (local === 0xFFFFFFFF) local = Number(cd.getBigUint64(y, true));
    }
    at += 46 + nl + xl + cd.getUint16(at + 32, true);
    if (!TO_WANT.test(path) || (method !== 0 && method !== 8)) continue;
    out.push({ path, size: usize, open: async () => {
      const h = await view(local, 30), start = local + 30 + h.getUint16(26, true) + h.getUint16(28, true);
      const raw = file.slice(start, start + csize);
      return method === 0 ? raw : new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
    } });
  }
  return out;
}

// picked: [{ file, path }] from a file picker or a drop. Zips are opened up; a whole Google export holds other
// products too, so when there is a YouTube folder only its files are kept.
async function takeoutFiles(picked) {
  let out = [];
  for (const { file, path } of picked) {
    if (/\.zip$/i.test(file.name)) out.push(...await zipEntries(file));
    else if (TO_WANT.test(file.name)) out.push({ path, size: file.size, open: async () => file });
  }
  if (out.some(f => /youtube/i.test(f.path))) out = out.filter(f => /youtube/i.test(f.path));
  return out.filter(f => f.size <= TO_MAX);
}

async function takeoutScan(picked) {
  const box = $('#takeoutres');
  if (!picked.length || !box) return;
  box.innerHTML = '<p class="note">Reading…</p>';
  try {
    const files = await takeoutFiles(picked);
    if (!files.length) throw new Error('nothing from YouTube in there. Pick the Takeout .zip, its unzipped folder, or files from its "YouTube and YouTube Music" folder.');
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    for (const [i, f] of files.entries()) {
      box.innerHTML = `<p class="note">Reading ${i + 1} of ${files.length} files…</p>`;
      const r = await fetch('/api/takeout/file?' + qs({ token, name: f.path }), { method: 'POST', body: await f.open() });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(typeof d.detail === 'string' ? d.detail : r.statusText); }
    }
    takeoutShow(token, await api('/takeout/summary?' + qs({ token })));
  } catch (err) { box.innerHTML = ''; fail(err); }
}

// One row per kind of data found, ticked when it would bring something new; channels and playlists can be
// picked one by one under "Choose".
function takeoutShow(token, d) {
  const n = x => x.toLocaleString(), s = (x, one, many) => `${n(x)} ${x === 1 ? one : many}`;
  const mon = day => new Date(day + 'T12:00').toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  const part = (key, title, bits, fresh, picks) => `<div class="r plain">
    <input type="checkbox" class="tokind" id="to-${key}" data-part="${key}" ${fresh ? 'checked' : 'disabled'}>
    <div class="name"><label for="to-${key}"><b>${title}</b></label><div class="sub">${bits.filter(Boolean).join(' &middot; ')}</div>
      ${picks && fresh ? `<details><summary>Choose</summary><div class="topicks">${picks}</div></details>` : ''}</div></div>`;
  const pick = (key, v, on, name, note) => `<label><input type="checkbox" class="topick" data-part="${key}" data-v="${esc(v)}" ${on ? 'checked' : 'disabled'}>
    <span>${esc(name)}</span><span class="muted">${note}</span></label>`;
  let h = '';
  if (d.history) {
    const x = d.history;
    h += part('history', 'Watch history', [s(x.videos, 'video', 'videos') + (x.first ? `, ${mon(x.first)} to ${mon(x.last)}` : ''),
      `${n(x.library)} in the library`, x.new ? `${n(x.new)} not marked watched here yet` : 'all marked watched already'], x.new);
  }
  if (d.likes) {
    const x = d.likes;
    h += part('likes', 'Liked videos', [s(x.videos, 'video', 'videos'), x.new ? `${n(x.new)} not liked here yet` : 'all liked already'], x.new);
  }
  if (d.subs) {
    const fresh = d.subs.filter(c => !c.followed);
    h += part('subs', 'Subscriptions', [s(d.subs.length, 'channel', 'channels'), fresh.length ? `${n(fresh.length)} not followed yet` : 'all followed already'],
      fresh.length, d.subs.map(c => pick('subs', c.id, !c.followed, c.name, c.followed ? 'following' : c.hn ? `${c.hn} in the library` : '')).join(''));
  }
  if (d.playlists) {
    const fresh = d.playlists.filter(p => p.new), videos = fresh.reduce((t, p) => t + p.new, 0);
    const unknown = !B.has_key && fresh.reduce((t, p) => t + p.unknown, 0);
    h += part('playlists', 'Playlists', [s(d.playlists.length, 'playlist', 'playlists'), fresh.length ? `${s(videos, 'video', 'videos')} to add` : 'all here already',
      unknown && `${n(unknown)} from outside the library show once a YouTube key is set`], fresh.length,
      d.playlists.map(p => pick('playlists', p.i, p.new, p.name, !p.new ? 'here already' : p.existing ? `adds ${p.new} to yours` : s(p.total, 'video', 'videos'))).join(''));
  }
  const box = $('#takeoutres');
  box.dataset.token = token;
  box.innerHTML = `<div class="rows takeout">${h}
    <div class="r plain"><button class="pill solid" data-act="takeoutgo" id="takeoutgo">Import</button><button class="pill" data-act="takeoutcancel">Cancel</button></div></div>`;
  takeoutCount();
}
const takeoutCount = () => { $('#takeoutgo').disabled = !document.querySelector('#takeoutres .tokind:checked'); };

async function takeoutImport(btn) {
  const box = $('#takeoutres'), on = k => !!(box.querySelector(`#to-${k}`) || {}).checked;
  const picks = k => on(k) ? [...box.querySelectorAll(`.topick[data-part="${k}"]:checked`)].map(b => b.dataset.v) : [];
  btn.disabled = true; btn.textContent = 'Importing…';
  let r;
  try {
    r = await api('/takeout/import', { token: box.dataset.token, history: on('history'), likes: on('likes'),
      subs: picks('subs'), playlists: picks('playlists').map(Number) });
  } catch (err) { btn.disabled = false; btn.textContent = 'Import'; throw err; }
  const n = x => x.toLocaleString(), pl = r.playlists;
  const bits = [r.watched && `${n(r.watched)} marked watched`, r.liked && `${n(r.liked)} liked`,
    r.followed && `following ${n(r.followed)} more channel${r.followed === 1 ? '' : 's'}`,
    pl && pl.videos && `${n(pl.videos)} video${pl.videos === 1 ? '' : 's'} in ${n(pl.ids.length)} playlist${pl.ids.length === 1 ? '' : 's'}`].filter(Boolean);
  toast(bits.length ? 'Brought in: ' + bits.join(', ') + '.' + (pl && pl.pending ? ` ${n(pl.pending)} playlist videos wait for a YouTube key.` : '') : 'Nothing new to bring in.');
  await reboot();
  return route();
}

// dropping a zip, files or a folder on the Settings drop area
const readDir = async rd => { const all = []; for (;;) { const b = await new Promise((ok, no) => rd.readEntries(ok, no)); if (!b.length) return all; all.push(...b); } };
const dropWalk = async en => en.isFile
  ? [await new Promise((ok, no) => en.file(file => ok({ file, path: en.fullPath.replace(/^\//, '') }), no))]
  : (await Promise.all((await readDir(en.createReader())).map(dropWalk))).flat();
for (const ev of ['dragenter', 'dragover']) document.addEventListener(ev, e => {
  const zone = e.target.closest && e.target.closest('#todrop');
  if (!zone || dragVid) return;
  e.preventDefault(); zone.classList.add('over');
});
document.addEventListener('dragleave', e => { const z = $('#todrop'); if (z && e.target === z && !z.contains(e.relatedTarget)) z.classList.remove('over'); });
document.addEventListener('drop', async e => {
  const zone = e.target.closest && e.target.closest('#todrop');
  if (!zone || dragVid) return;
  e.preventDefault(); zone.classList.remove('over');
  const entries = [...e.dataTransfer.items].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  try {
    takeoutScan(entries.length ? (await Promise.all(entries.map(dropWalk))).flat()
      : [...e.dataTransfer.files].map(file => ({ file, path: file.name })));
  } catch (err) { fail(err); }
});

document.addEventListener('input', e => {
  if (e.target.id === 'chanfilter') { chanFilter = e.target.value; applyChanFilter(); }
});

// Scroll positions are kept per history entry, so Back returns to where you were on a long page and a new page
// starts at the top (once it has arrived, not before). Without the Navigation API every page starts at the top.
try { history.scrollRestoration = 'manual'; } catch { /* old browser */ }
const SCROLLS = new Map();
const navKey = () => (window.navigation && navigation.currentEntry && navigation.currentEntry.key) || null;
let curKey = navKey();
addEventListener('scroll', () => { if (curKey) SCROLLS.set(curKey, scrollY); }, { passive: true });
window.addEventListener('hashchange', async () => {
  curKey = navKey();
  const y = (curKey && SCROLLS.get(curKey)) || 0;
  await route();
  scrollTo(0, y);
});

(async () => {
  try {
    await reboot();
    api('/downloads').then(d => {   // downloads left running by an earlier visit
      for (const p of d.pending) DLJOBS[p.vid] = p.job;
      dlPaint();
      if (d.pending.some(p => p.job.state !== 'error')) dlWatch();
    }).catch(() => {});
    await route();
  } catch (e) { main(`<p class="note err">Could not reach the PersonalTube server: ${esc(e.message)}</p>`); }
})();
