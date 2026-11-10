"""PersonalTube: a local, personal video front page that works for the viewer.  Run with:  pixi run start"""
import csv
import hashlib
import io
import json
import math
import os
import re
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from pathlib import Path

import numpy as np
import uvicorn
import ytkey
from fastapi import Body, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

ytkey.load()  # env var, else the login keyring
ROOT = Path(__file__).parent
DB = ROOT / "state.db"
META_FILE = ROOT / "youtube_meta.jsonl"
PORT = 8765  # fixed on purpose: tooling outside this repository depends on this exact origin (see CLAUDE.md)

if __name__ == "__main__":
    # The launcher. uvicorn imports this file again as "server" in a worker process and restarts that worker
    # whenever a .py file here changes, so the launcher itself stops before the dataset loads.
    print(f"\n  PersonalTube is at  http://127.0.0.1:{PORT}  (restarts itself when the code changes)\n")
    uvicorn.run("server:app", host="127.0.0.1", port=PORT, log_level="warning", reload=True, reload_dirs=[str(ROOT)])
    raise SystemExit

# Content types in the daily mix by default (interviews, podcasts and news are filter-only).
DEFAULT_TYPES = {"talk", "lecture", "course", "tutorial", "explainer", "documentary",
                 "demo", "comedy", "music", "commentary", "other"}
HOME_CONTINUE, HOME_PLAYLISTS, HOME_UPLOADS = 3, 3, 3   # home page: started videos, then "your queue"
HOME_PICKS, HOME_BRANCH = 6, 3                          # then suggestions near your taste, and a few far from it
BRANCH_MAX_AFFINITY = 0.05  # "branch out" only offers videos the taste model does not already lean towards
MIN_UPLOAD_SECONDS = 180  # skip Shorts / tiny clips from followed channels
NEW_DAYS = 14             # uploads this recent get the NEW! badge
LEN_BUCKETS = {"short": (0, 20 * 60), "medium": (20 * 60, 60 * 60), "long": (60 * 60, 10 ** 9)}
# on/off switches kept in kv as "1"/"0", with the value used until the user first touches one
SETTINGS = {"hide_watched": False, "dearrow": True, "calm": True, "ask_intent": True}
WATCH_WEIGHT = 0.35       # a watched-but-unrated video counts this much of a like when judging taste
TASTE_PULL = 3.0          # mix weight is multiplied by exp(TASTE_PULL * affinity), clipped to 0.2..15
DEARROW_TTL = 7 * 86400   # re-ask DeArrow for a video's title/frame after this long
YT_SEARCH_FRESH = 86400   # a repeated search reuses YouTube's answer for a day (each real search costs 100 quota units)
YT_SEARCH_KEEP = 30 * 86400  # after this long a search and the results nobody touched are forgotten
YT_SEARCH_SHOW = 24
UA = "Mozilla/5.0 (compatible; local-video-app)"

# ---------------------------------------------------------------- dataset

VIDEOS = [json.loads(line) for line in open(ROOT / "videos.jsonl", encoding="utf-8")]
V = {v["vid"]: v for v in VIDEOS}
TAXONOMY = json.load(open(ROOT / "taxonomy.json", encoding="utf-8"))

DUPES = set()  # re-uploads of the same talk: keep the best-scored copy
_seen = set()
for _v in VIDEOS:
    _k = re.sub(r"[^a-z0-9]+", " ", _v["title"].lower()).strip()
    if len(_k) > 12 and _k in _seen:
        DUPES.add(_v["vid"])
    _seen.add(_k)

BY_CHANNEL = defaultdict(list)
BLOB = {}
for _v in VIDEOS:
    BY_CHANNEL[_v["channel"]].append(_v["vid"])
    BLOB[_v["vid"]] = " ".join([_v["title"], _v["channel"], _v.get("primary_topic") or "",
                                " ".join(_v.get("tags") or []),
                                " ".join(c["name"] for c in _v["categories"])]).lower()

RELATED = {}
for _line in open(ROOT / "related.jsonl", encoding="utf-8"):
    _r = json.loads(_line)
    RELATED[_r["vid"]] = [x["vid"] for x in _r["related"]]

# Embeddings drive the recommendations: cosine similarity, rescaled so that 0 is about the closest 10% of
# pairs and 1 the closest 0.03% (measured on this dataset: mean 0.53, p90 0.61, p99.9 0.78). Videos here are
# all fairly alike (tech-heavy), so anything less similar than that says nothing about taste.
EMB = np.load(ROOT / "embeddings.npy").astype(np.float32)
EMB_ROW = {v: i for i, v in enumerate(json.load(open(ROOT / "embedding_ids.json", encoding="utf-8")))}
SIM_FLOOR = float(np.square(EMB.mean(0)).sum()) + 0.09  # mean similarity over all pairs, plus a margin
SIM_SPAN = 0.2

MENTIONS = defaultdict(list)
for _line in open(ROOT / "mentions.jsonl", encoding="utf-8"):
    _m = json.loads(_line)
    MENTIONS[_m["vid"]].append(_m)
LAST_REC = {}   # vid -> "YYYY-MM" of the latest recommending comment (among the mentions kept)
for _vid, _ms in MENTIONS.items():
    _months = [_m["month"] for _m in _ms if _m["stance"] in ("rec", "strong_rec")]
    if _months:
        LAST_REC[_vid] = max(_months)

META = {}       # vid -> {"dur", "cid", "pub", "views"} or {"gone": True}
CHAN_ID = {}    # channel name -> YouTube channel id
_meta_mtime = 0.0
_meta_lock = threading.Lock()


def to_int(x):
    try:
        return int(x)
    except (TypeError, ValueError):
        return None


def parse_dur(iso):
    m = re.fullmatch(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", iso or "")
    if not m:
        return None
    d, h, mi, s = (int(x or 0) for x in m.groups())
    return d * 86400 + h * 3600 + mi * 60 + s


def load_meta():
    """(Re)load youtube_meta.jsonl when it changes, so a fetch shows up without a restart."""
    global _meta_mtime
    if not META_FILE.exists():
        return
    mt = META_FILE.stat().st_mtime
    if mt == _meta_mtime:
        return
    with _meta_lock:
        for line in open(META_FILE, encoding="utf-8"):
            try:
                r = json.loads(line)
            except ValueError:
                continue  # half-written line while a fetch is running
            it = r.get("item")
            if it is None or it.get("status", {}).get("privacyStatus") == "private":
                META[r["vid"]] = {"gone": True}
                continue
            sn = it.get("snippet", {})
            META[r["vid"]] = {"dur": parse_dur(it.get("contentDetails", {}).get("duration")),
                              "cid": sn.get("channelId"), "pub": (sn.get("publishedAt") or "")[:10],
                              "views": to_int(it.get("statistics", {}).get("viewCount"))}
            if r["vid"] in V and sn.get("channelId"):
                CHAN_ID.setdefault(V[r["vid"]]["channel"], sn["channelId"])
        _meta_mtime = mt


load_meta()

# ---------------------------------------------------------------- state (SQLite)

SCHEMA = """
create table if not exists watched(vid text primary key, ts real);
create table if not exists hidden(vid text primary key, ts real);
create table if not exists follows(channel text primary key, channel_id text, ts real, checked_ts real);
create table if not exists extra(vid text primary key, title text, channel text, channel_id text,
                                 dur integer, published text, upload integer default 0);
create table if not exists playlists(id integer primary key, name text, yt_id text, ts real);
create table if not exists items(playlist_id integer, vid text, pos integer, primary key(playlist_id, vid));
create table if not exists kv(k text primary key, v text);
create table if not exists ratings(vid text primary key, rating integer, ts real);
create table if not exists dearrow(vid text primary key, title text, time real, original integer, ts real);
create table if not exists ytsearch(q text primary key, vids text, ts real);
create table if not exists progress(vid text primary key, pos real, dur real, ts real);
create table if not exists watchlog(day text, vid text, secs real, primary key(day, vid));
create table if not exists intents(ts real, intent text);
"""


@contextmanager
def db():
    c = sqlite3.connect(DB, timeout=10)
    c.row_factory = sqlite3.Row
    try:
        yield c
        c.commit()
    finally:
        c.close()


with db() as _c:
    _c.executescript(SCHEMA)
    if "views" not in {r[1] for r in _c.execute("pragma table_info(extra)")}:
        _c.execute("alter table extra add column views integer")
    if "yt_seen" not in {r[1] for r in _c.execute("pragma table_info(playlists)")}:
        # JSON list of the video ids the YouTube playlist held when it was last imported or synced
        _c.execute("alter table playlists add column yt_seen text")


def kv_get(c, k, default=None):
    r = c.execute("select v from kv where k=?", (k,)).fetchone()
    return r[0] if r else default


def kv_set(c, k, v):
    c.execute("insert into kv(k, v) values(?, ?) on conflict(k) do update set v=excluded.v", (k, str(v)))


class State:
    def __init__(self, c):
        self.watched = {r[0]: r[1] for r in c.execute("select vid, ts from watched")}
        self.hidden = {r[0] for r in c.execute("select vid from hidden")}
        self.follows = {r[0]: r[1] for r in c.execute("select channel, channel_id from follows")}
        self.extra = {r["vid"]: dict(r) for r in c.execute("select * from extra")}
        self.ratings = {r[0]: r[1] for r in c.execute("select vid, rating from ratings")}  # 1 liked, -1 disliked
        self.settings = {k: kv_get(c, k, "1" if on else "0") == "1" for k, on in SETTINGS.items()}
        self.progress = {r["vid"]: dict(r) for r in c.execute("select * from progress")}  # started, not finished
        self.hide_watched = self.settings["hide_watched"]
        self.da = {}  # vid -> DeArrow title/frame, only what is cached and fresh; the frontend asks for the rest
        if self.settings["dearrow"]:
            self.da = {r["vid"]: {"title": r["title"], "time": r["time"], "original": bool(r["original"])}
                       for r in c.execute("select * from dearrow where ts > ?", (time.time() - DEARROW_TTL,))}

    def available(self, vid):
        return (vid in V and not META.get(vid, {}).get("gone")) or vid in self.extra

    def dur(self, vid):
        if vid in V:
            return META.get(vid, {}).get("dur")
        return (self.extra.get(vid) or {}).get("dur")

    def is_new(self, vid):
        e = self.extra.get(vid)
        if not e or not e["upload"] or e["channel"] not in self.follows or vid in self.watched:
            return False
        return (e["published"] or "") >= (date.today() - timedelta(days=NEW_DAYS)).isoformat()


def card(vid, st):
    if vid in V:
        v = V[vid]
        cats = v["categories"]
        q = v.get("quote") or {}
        d = {"vid": vid, "title": v["title"], "channel": v["channel"], "why": v["why_hn"],
             "type": v["content_type"], "cat": cats[0]["name"] if cats else None,
             "quote": q.get("text"), "qyear": q.get("year"), "score": v["score"],
             "recs": v["hn"]["recommenders"], "hn": True,
             "pub": META.get(vid, {}).get("pub"), "views": META.get(vid, {}).get("views")}
    else:
        e = st.extra[vid]
        d = {"vid": vid, "title": e["title"], "channel": e["channel"], "pub": e["published"], "views": e["views"],
             "hn": False, "upload": bool(e["upload"]), "new": st.is_new(vid)}
    d["dur"] = st.dur(vid)
    d["watched"] = vid in st.watched
    d["followed"] = d["channel"] in st.follows
    d["rating"] = st.ratings.get(vid, 0)
    pr = st.progress.get(vid)
    if pr and not d["watched"]:
        d["resume"] = int(pr["pos"])
        d["frac"] = round(pr["pos"] / pr["dur"], 3) if pr["dur"] else 0
    if vid in st.da:
        d["da"] = st.da[vid]
    return d


def passes(vid, st, area="", cat="", length="", types=None):
    if length:
        d = st.dur(vid)
        lo, hi = LEN_BUCKETS.get(length, (0, 10 ** 9))
        if d is None or not lo <= d < hi:
            return False
    if vid in V:
        v = V[vid]
        if types and v["content_type"] not in types:
            return False
        if cat and not any(c["id"] == cat for c in v["categories"]):
            return False
        if area and not any(c["area"] == area for c in v["categories"]):
            return False
        return True
    return not (area or cat)  # videos from outside the HN data have no topic


# ---------------------------------------------------------------- YouTube API

def yt(path, **params):
    key = os.environ.get("YOUTUBE_API_KEY")
    if not key:
        raise HTTPException(400, "This needs a YouTube API key: start the app with YOUTUBE_API_KEY set (see Settings).")
    params["key"] = key
    url = f"https://www.googleapis.com/youtube/v3/{path}?{urllib.parse.urlencode(params)}"
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        try:
            msg = json.load(e)["error"]["message"]
        except Exception:
            msg = str(e.reason)
        raise HTTPException(502, f"YouTube API error {e.code}: {msg}")
    except OSError:
        raise HTTPException(502, "Could not reach the YouTube API (network problem?).")


def fetch_video_info(vids):
    out = {}
    for i in range(0, len(vids), 50):
        r = yt("videos", part="snippet,contentDetails,statistics", id=",".join(vids[i:i + 50]))
        for it in r.get("items", []):
            sn = it["snippet"]
            out[it["id"]] = {"title": sn["title"], "channel": sn["channelTitle"], "cid": sn["channelId"],
                             "dur": parse_dur(it["contentDetails"].get("duration")) or 0,
                             "pub": sn["publishedAt"][:10],
                             "views": to_int(it.get("statistics", {}).get("viewCount")),
                             "live": sn.get("liveBroadcastContent", "none") != "none"}
    return out


def add_extra(c, vid, info, upload=0, channel=None):
    c.execute("insert into extra(vid, title, channel, channel_id, dur, published, upload, views) values(?,?,?,?,?,?,?,?) "
              "on conflict(vid) do update set upload=max(upload, excluded.upload), "
              "views=coalesce(excluded.views, views)",
              (vid, info["title"], channel or info["channel"], info["cid"], info["dur"], info["pub"], upload,
               info.get("views")))


def learn_videos(c, vids):
    """Fetch and store YouTube's details for the videos that are neither HN videos nor extras yet.
    Returns the ids YouTube would not describe (deleted or private)."""
    known = {r[0] for r in c.execute("select vid from extra")}
    need = list(dict.fromkeys(v for v in vids if v not in V and v not in known))
    fresh = fetch_video_info(need) if need else {}
    for vid, i in fresh.items():
        add_extra(c, vid, i)
    return {v for v in need if v not in fresh}


def yt_playlist_vids(yt_id, cap=500):
    vids, token = [], None
    while len(vids) < cap:
        extra = {"pageToken": token} if token else {}
        r = yt("playlistItems", part="contentDetails", playlistId=yt_id, maxResults=50, **extra)
        vids += [i["contentDetails"]["videoId"] for i in r.get("items", [])]
        token = r.get("nextPageToken")
        if not token:
            break
    return list(dict.fromkeys(vids))


_refresh_lock = threading.Lock()


def refresh_uploads():
    """Pull recent uploads for every followed channel. ~2 quota units per channel."""
    added, errors = 0, []
    with _refresh_lock:
        with db() as c:
            follows = [tuple(r) for r in c.execute("select channel, channel_id from follows")]
            known = {r[0] for r in c.execute("select vid from extra where upload=1")}
        for name, cid in follows:
            try:
                if not cid:
                    cid = CHAN_ID.get(name)
                    if not cid and BY_CHANNEL.get(name):
                        info = fetch_video_info(BY_CHANNEL[name][:5])
                        cid = next((i["cid"] for i in info.values()), None)
                    if not cid:
                        errors.append(f"{name}: could not find its YouTube channel id")
                        continue
                r = yt("playlistItems", part="contentDetails", playlistId="UU" + cid[2:], maxResults=15)
                ids = [i["contentDetails"]["videoId"] for i in r.get("items", [])]
                new = [v for v in ids if v not in V and v not in known]
                info = fetch_video_info(new) if new else {}
                with db() as c:
                    c.execute("update follows set channel_id=?, checked_ts=? where channel=?", (cid, time.time(), name))
                    for vid, i in info.items():
                        if i["dur"] >= MIN_UPLOAD_SECONDS and not i["live"]:
                            add_extra(c, vid, i, upload=1, channel=name)
                            added += 1
            except HTTPException as e:
                errors.append(f"{name}: {e.detail}")
                if "quota" in str(e.detail).lower() or e.status_code == 400:
                    break
        with db() as c:
            kv_set(c, "last_refresh", time.time())
    return {"added": added, "errors": errors}


def maybe_refresh_in_background():
    if not os.environ.get("YOUTUBE_API_KEY"):
        return
    with db() as c:
        if not c.execute("select 1 from follows limit 1").fetchone():
            return
        if time.time() - float(kv_get(c, "last_refresh", 0)) < 12 * 3600:
            return
        kv_set(c, "last_refresh", time.time())

    def run():
        try:
            refresh_uploads()
        except Exception:
            pass
    threading.Thread(target=run, daemon=True).start()


# ---------------------------------------------------------------- the daily mix

def rnd(seed, vid):
    h = hashlib.blake2b(f"{seed}:{vid}".encode(), digest_size=8).digest()
    return (int.from_bytes(h, "big") + 1) / (2 ** 64 + 2)


def playlist_rows(c):
    pls = [dict(r) for r in c.execute("select * from playlists order by ts")]
    for p in pls:
        p["vids"] = [r[0] for r in c.execute("select vid from items where playlist_id=? order by pos", (p["id"],))]
    return pls


_taste_cache = (None, None)


def taste(st):
    """Affinity of every HN video to what the user liked: {"aff": {vid: float}, "why": {vid: (kind, source vid)}}.
    Affinity is the best rescaled similarity to a liked video (watched ones count WATCH_WEIGHT), plus a bonus
    for sharing HN recommenders with a like or coming from a liked channel, minus closeness to a dislike."""
    global _taste_cache
    sig = (tuple(sorted(st.ratings.items())), tuple(sorted(st.watched)))
    if _taste_cache[0] == sig:
        return _taste_cache[1]
    likes = [v for v, r in st.ratings.items() if r > 0]
    dislikes = [v for v, r in st.ratings.items() if r < 0 and v in EMB_ROW]
    seen = sorted((v for v in st.watched if v not in st.ratings), key=st.watched.get, reverse=True)[:150]
    pos = [(v, 1.0, "liked") for v in likes if v in EMB_ROW] + [(v, WATCH_WEIGHT, "watched") for v in seen if v in EMB_ROW]

    def sims(vids):
        return (EMB @ EMB[[EMB_ROW[v] for v in vids]].T - SIM_FLOOR) / SIM_SPAN

    n = len(EMB)
    best, src = np.zeros(n, np.float32), np.zeros(n, np.int64)
    if pos:
        s = np.clip(sims([p[0] for p in pos]), 0, 1.2) * np.array([p[1] for p in pos], np.float32)
        best, src = s.max(1), s.argmax(1)
    aff = best.copy()
    if dislikes:
        aff -= 0.8 * np.clip(sims(dislikes), 0, 1.2).max(1)
    graph = {}  # videos recommended by the same HN people as a like
    for l in likes:
        for r in RELATED.get(l, []):
            if r in EMB_ROW and r not in graph:
                graph[r] = l
                aff[EMB_ROW[r]] += 0.2
    liked_channels = {V[v]["channel"] if v in V else (st.extra.get(v) or {}).get("channel") for v in likes}
    out, why = {}, {}
    for v in VIDEOS:
        vid = v["vid"]
        i = EMB_ROW.get(vid)
        if i is None:
            continue
        a = float(aff[i]) + (0.1 if v["channel"] in liked_channels else 0)
        out[vid] = a
        if a >= 0.15:
            if pos and (best[i] >= 0.3 or vid not in graph) and best[i] > 0:
                why[vid] = (pos[src[i]][2], pos[src[i]][0])
            elif vid in graph:
                why[vid] = ("graph", graph[vid])
    res = {"aff": out, "why": why}
    _taste_cache = (sig, res)
    return res


def taste_reason(t, vid, weak=True):
    kind, source = t["why"].get(vid, (None, None))
    if not kind or (kind == "watched" and not weak):
        return None
    title = V[source]["title"]
    title = title if len(title) <= 46 else title[:45].rstrip() + "…"
    lead = {"liked": "Because you liked", "watched": "Because you watched", "graph": "Often recommended with"}[kind]
    return {"kind": "taste", "text": f"{lead}: {title}", "vid": source}


def today_tally(c):
    """What has been played today: seconds of playback and how many videos got at least a minute of it."""
    r = c.execute("select coalesce(sum(secs), 0), coalesce(sum(secs >= 60), 0) from watchlog where day=?",
                  (date.today().isoformat(),)).fetchone()
    return {"secs": int(r[0]), "videos": int(r[1])}


def primary_area(vid):
    cats = V[vid]["categories"] if vid in V else None
    return (cats[0]["area"], cats[0]["area_name"]) if cats else ("-", "")


def build_mix(c, area="", cat="", length="", types=None):
    """The home page, in the order the user's own intentions come first: videos they started, their queue (next in
    playlists, uploads from followed channels), a few suggestions near their taste, and a few deliberately far
    from it. It is a fixed, small page, stable for the whole day: each video gets a fixed random draw from
    (date, reshuffle count), so following a channel or watching something only nudges it instead of redealing."""
    st = State(c)
    today = date.today()
    day0 = datetime.combine(today, datetime.min.time()).timestamp()
    seed = f"{today.isoformat()}:{kv_get(c, 'reshuffle:' + today.isoformat(), 0)}"
    done = {v for v, t in st.watched.items() if t < day0} | st.hidden  # watched today stays, shown as visited
    if st.hide_watched:
        done |= set(st.watched)
    done |= {v for v, r in st.ratings.items() if r < 0}
    tst = taste(st)
    flt = dict(area=area, cat=cat, length=length)
    reasons = {}

    # 0. Continue: started and not finished, most recent first.
    cont = [v for v, p in sorted(st.progress.items(), key=lambda x: -x[1]["ts"])
            if v not in st.watched and v not in st.hidden and st.available(v) and passes(v, st, **flt)][:HOME_CONTINUE]
    used = set(cont)

    # 1. Queue, part one: the next unwatched video of saved playlists, a different few each day.
    nexts = []
    for p in playlist_rows(c):
        nxt = next((v for v in p["vids"] if v not in done and st.available(v)), None)
        if nxt and nxt not in used and nxt not in reasons and passes(nxt, st, **flt):
            reasons[nxt] = {"kind": "next", "text": f"Next in: {p['name']}", "playlist": p["id"]}
            nexts.append(nxt)
    nexts = sorted(nexts, key=lambda v: rnd(seed + "pl", v))[:HOME_PLAYLISTS]

    # 2. Queue, part two: uploads from followed channels, recent ones first, one per channel.
    ups = [e for e in st.extra.values() if e["upload"] and e["channel"] in st.follows
           and e["vid"] not in done and e["vid"] not in used and e["vid"] not in reasons and passes(e["vid"], st, **flt)]
    ups.sort(key=lambda e: (not st.is_new(e["vid"]), rnd(seed + "up", e["vid"])))
    uploads, chans = [], set()
    for e in ups:
        if len(uploads) >= HOME_UPLOADS:
            break
        if e["channel"] in chans:
            continue
        chans.add(e["channel"])
        uploads.append(e["vid"])
        reasons[e["vid"]] = {"kind": "upload", "text": "New from a channel you follow" if st.is_new(e["vid"])
                             else "From a channel you follow"}
    queue = nexts + uploads
    used |= set(queue)

    # 3. Picked for you: score-weighted sampling; followed channels get up to ~30% of the weight, and videos
    #    close to the user's likes weigh up to 15x more (close to dislikes: down to 0.2x).
    types = types or DEFAULT_TYPES
    cands = []
    for v in VIDEOS:
        vid = v["vid"]
        if (vid in done or vid in DUPES or vid in used or v["shelf_life"] == "news"
                or v["hn"]["recommenders"] == 0 or META.get(vid, {}).get("gone")
                or not passes(vid, st, types=types, **flt)):
            continue
        pull = min(15.0, max(0.2, math.exp(TASTE_PULL * tst["aff"].get(vid, 0))))
        cands.append((vid, v["score"] ** 1.5 * pull, v["channel"] in st.follows))
    w_f = sum(w for _, w, f in cands if f)
    w_r = sum(w for _, w, f in cands if not f)
    share = min(0.3, 0.08 * len(st.follows))
    boost = min(200.0, max(1.0, share * w_r / w_f)) if w_f else 1.0
    ranked = sorted(cands, key=lambda x: rnd(seed, x[0]) ** (1 / (x[1] * (boost if x[2] else 1))), reverse=True)
    per_channel, per_area, picks = Counter(), Counter(), []
    for vid, _, followed in ranked:
        if len(picks) >= HOME_PICKS:
            break
        ch, a = V[vid]["channel"], primary_area(vid)[0]
        if per_channel[ch] >= 1 or (not (area or cat) and per_area[a] >= 2):
            continue
        per_channel[ch] += 1
        per_area[a] += 1
        picks.append(vid)
        if followed:
            reasons[vid] = {"kind": "following", "text": "You follow this channel"}
        elif tst["aff"].get(vid, 0) >= 0.4 and taste_reason(tst, vid, weak=False):
            reasons[vid] = taste_reason(tst, vid, weak=False)
    used |= set(picks)

    # 4. Branch out: good videos the taste model does not lean towards, from the topic areas the user has
    #    watched and liked least, one per area. Skipped under a topic filter, which already says where to look.
    branch = []
    if not (area or cat):
        seen_areas = Counter(primary_area(v)[0] for v in set(st.watched) | {v for v, r in st.ratings.items() if r > 0}
                             if v in V)
        far = []
        for vid, _, followed in cands:
            if followed or vid in used or tst["aff"].get(vid, 0) > BRANCH_MAX_AFFINITY:
                continue
            w = V[vid]["score"] ** 1.5 / (1 + seen_areas[primary_area(vid)[0]]) ** 2
            far.append((rnd(seed + "br", vid) ** (1 / w), vid))
        got = set()
        for _, vid in sorted(far, reverse=True):
            a, name = primary_area(vid)
            if a in got or a == "-":
                continue
            got.add(a)
            branch.append(vid)
            reasons[vid] = {"kind": "branch", "text": f"Outside your usual: {name}", "area": a}
            if len(branch) >= HOME_BRANCH:
                break

    def out(vids):
        return [dict(card(v, st), reason=reasons.get(v)) for v in vids]
    return {"continue": out(cont), "queue": out(queue), "picks": out(picks), "branch": out(branch),
            "date": today.isoformat(), "today": today_tally(c)}


# ---------------------------------------------------------------- API

app = FastAPI(title="PersonalTube")


def split_types(s):
    t = {x for x in (s or "").split(",") if x}
    return t or None


@app.get("/api/boot")
def boot():
    load_meta()
    with db() as c:
        st = State(c)
        area_n, cat_n = Counter(), Counter()
        for v in VIDEOS:
            for a in {x["area"] for x in v["categories"]}:
                area_n[a] += 1
            for x in v["categories"]:
                cat_n[x["id"]] += 1
        areas = [{"id": a["id"], "name": a["name"], "count": area_n[a["id"]],
                  "categories": [{"id": x["id"], "name": x["name"], "count": cat_n[x["id"]]}
                                 for x in a["categories"]]} for a in TAXONOMY["areas"]]
        new_by = Counter(e["channel"] for e in st.extra.values() if st.is_new(e["vid"]))
        pls = []
        for p in playlist_rows(c):
            vids = [v for v in p["vids"] if st.available(v)]
            pls.append({"id": p["id"], "name": p["name"], "total": len(vids),
                        "done": sum(v in st.watched for v in vids)})
        return {"areas": areas,
                "types": [t for t, _ in Counter(v["content_type"] for v in VIDEOS).most_common()],
                "default_types": sorted(DEFAULT_TYPES),
                "has_meta": sum(1 for m in META.values() if m.get("dur")),
                "has_key": bool(os.environ.get("YOUTUBE_API_KEY")),
                "total": len(VIDEOS), "watched": len(st.watched),
                "settings": st.settings,
                "follows": [{"name": n, "new": new_by[n]} for n in sorted(st.follows, key=str.lower)],
                "playlists": pls, "today": date.today().isoformat(), "tally": today_tally(c)}


@app.get("/api/mix")
def mix(area: str = "", cat: str = "", len: str = "", type: str = ""):
    load_meta()
    maybe_refresh_in_background()
    with db() as c:
        return build_mix(c, area, cat, len, split_types(type))


@app.post("/api/reshuffle")
def reshuffle():
    with db() as c:
        k = "reshuffle:" + date.today().isoformat()
        kv_set(c, k, int(kv_get(c, k, 0)) + 1)
    return {"ok": True}


@app.get("/api/random")
def random_video():
    with db() as c:
        st = State(c)
    seed = str(time.time())
    # score 0 (no HN recommenders) means zero sampling weight: never picked, and 1 / score would divide by zero
    best = max((v for v in VIDEOS if v["score"] > 0 and v["vid"] not in st.watched and v["vid"] not in st.hidden
                and v["vid"] not in DUPES and not META.get(v["vid"], {}).get("gone")),
               key=lambda v: rnd(seed, v["vid"]) ** (1 / v["score"]), default=None)
    return {"vid": best and best["vid"]}


GEM_MIN_RECS, GEM_MAX_VIEWS = 2, 250_000  # a hidden gem: several HN recommenders, few YouTube views


@app.get("/api/videos")
def videos(q: str = "", area: str = "", cat: str = "", len: str = "", type: str = "",
           channel: str = "", unwatched: int = 0, page: int = 1, sort: str = ""):
    load_meta()
    types = split_types(type)
    toks = q.lower().split()
    with db() as c:
        st = State(c)
    hits = []
    for v in VIDEOS:  # already best-scored first
        vid = v["vid"]
        if vid in DUPES or vid in st.hidden or META.get(vid, {}).get("gone"):
            continue
        if channel and v["channel"] != channel:
            continue
        if (unwatched or st.hide_watched) and vid in st.watched:
            continue
        if toks and not all(t in BLOB[vid] for t in toks):
            continue
        if sort == "recent" and vid not in LAST_REC:
            continue
        if sort == "gems" and not (v["hn"]["recommenders"] >= GEM_MIN_RECS
                                   and (META.get(vid, {}).get("views") or GEM_MAX_VIEWS) < GEM_MAX_VIEWS):
            continue
        if passes(vid, st, area, cat, len, types):
            hits.append(vid)
    # sorts are stable, so ties keep the best-scored-first order
    if sort == "recent":
        hits.sort(key=lambda vid: LAST_REC[vid], reverse=True)
    elif sort == "date":  # newest upload first; unknown dates last
        hits.sort(key=lambda vid: META.get(vid, {}).get("pub") or "", reverse=True)
    elif sort == "views":
        hits.sort(key=lambda vid: META.get(vid, {}).get("views") or 0, reverse=True)
    elif sort == "gems":  # much HN love for few YouTube views
        hits.sort(key=lambda vid: V[vid]["score"] / math.log10(META[vid]["views"] + 100) ** 2, reverse=True)
    if channel:  # uploads from outside the HN data, newest first, after the HN picks
        ups = [e for e in st.extra.values() if e["channel"] == channel and e["upload"]
               and e["vid"] not in st.hidden and passes(e["vid"], st, area, cat, len)
               and not ((unwatched or st.hide_watched) and e["vid"] in st.watched)]
        hits += [e["vid"] for e in sorted(ups, key=lambda e: e["published"] or "", reverse=True)]
    per = 48
    pages = max(1, -(-hits.__len__() // per))
    page = max(1, min(page, pages))
    return {"total": hits.__len__(), "page": page, "pages": pages,
            "items": [card(v, st) for v in hits[(page - 1) * per: page * per]],
            "channel": {"name": channel, "followed": channel in st.follows} if channel else None}


def forget_old_searches(c):
    """Drop searches older than YT_SEARCH_KEEP, and the videos only they brought in: extras that are in no
    playlist, were never watched, rated or hidden, and are in no search still kept."""
    old = c.execute("select vids from ytsearch where ts < ?", (time.time() - YT_SEARCH_KEEP,)).fetchall()
    if not old:
        return
    c.execute("delete from ytsearch where ts < ?", (time.time() - YT_SEARCH_KEEP,))
    gone = {v for r in old for v in json.loads(r[0])}
    for r in c.execute("select vids from ytsearch"):
        gone -= set(json.loads(r[0]))
    for t in ("items", "watched", "ratings", "hidden"):
        gone -= {r[0] for r in c.execute(f"select vid from {t}")}
    c.executemany("delete from extra where vid=? and upload=0", [(v,) for v in gone])


def youtube_search(c, q):
    """Video ids YouTube returns for q, best first, without live streams and Shorts-length clips. Results from
    outside the HN data are stored as extras so they can be opened and played like any other video."""
    key = " ".join(q.lower().split())
    row = c.execute("select vids, ts from ytsearch where q=?", (key,)).fetchone()
    if row and row["ts"] > time.time() - YT_SEARCH_FRESH:
        return json.loads(row["vids"])
    r = yt("search", part="id", type="video", q=q, maxResults=50)  # 100 quota units
    ids = list(dict.fromkeys(i["id"]["videoId"] for i in r.get("items", []) if i.get("id", {}).get("videoId")))
    known = {r["vid"]: r["dur"] for r in c.execute("select vid, dur from extra")}
    need = [v for v in ids if v not in V and v not in known]
    for vid, i in (fetch_video_info(need) if need else {}).items():
        if i["dur"] >= MIN_UPLOAD_SECONDS and not i["live"]:
            add_extra(c, vid, i)
            known[vid] = i["dur"]
    vids = [v for v in ids if v in V or (known.get(v) or 0) >= MIN_UPLOAD_SECONDS]
    c.execute("insert into ytsearch(q, vids, ts) values(?,?,?) on conflict(q) do update set vids=excluded.vids, ts=excluded.ts",
              (key, json.dumps(vids), time.time()))
    forget_old_searches(c)
    return vids


@app.get("/api/ytsearch")
def ytsearch(q: str = "", len: str = ""):
    """General YouTube results for a search, shown under the HN results. HN videos that the search above
    already lists (their text matches every word) are left out; other HN videos YouTube finds are kept."""
    q = q.strip()[:200]
    if not q:
        return {"items": []}
    load_meta()
    toks = q.lower().split()
    with db() as c:
        vids = youtube_search(c, q)
        st = State(c)
    items = []
    for vid in vids:
        if vid in st.hidden or (st.hide_watched and vid in st.watched) or not passes(vid, st, length=len):
            continue
        if vid in V:
            if vid in DUPES or META.get(vid, {}).get("gone") or all(t in BLOB[vid] for t in toks):
                continue
        elif vid not in st.extra:
            continue
        items.append(card(vid, st))
    return {"items": items[:YT_SEARCH_SHOW]}


@app.get("/api/video/{vid}")
def video(vid: str):
    load_meta()
    with db() as c:
        st = State(c)
        if not (vid in V or vid in st.extra):
            raise HTTPException(404, "No such video")
        d = card(vid, st)
        d["in_playlists"] = [r[0] for r in c.execute("select playlist_id from items where vid=?", (vid,))]
        d["today"] = today_tally(c)
        for p in playlist_rows(c):  # the one thing offered when this video ends: what the user queued after it
            if vid in p["vids"]:
                nxt = next((x for x in p["vids"][p["vids"].index(vid) + 1:]
                            if x not in st.watched and x not in st.hidden and st.available(x)), None)
                if nxt:
                    d["next_in"] = {"playlist": p["name"], "pid": p["id"], "vid": nxt, "title": card(nxt, st)["title"]}
                    break
    d["url"] = f"https://www.youtube.com/watch?v={vid}"
    d["gone"] = bool(META.get(vid, {}).get("gone"))
    if vid in V:
        v = V[vid]
        order = {"strong_rec": 0, "rec": 1, "reference": 2, "critical": 3, "joke": 4}
        d.update(summary=v["summary"], tags=v.get("tags") or [], categories=v["categories"],
                 level=v["level"], stats=v["hn"], pub=META.get(vid, {}).get("pub"),
                 mentions=[{"author": m["author"], "month": m["month"], "stance": m["stance"],
                            "story": m["story_title"], "url": m["hn_url"], "why": m["why"],
                            "text": m["text"][:700] + ("…" if len(m["text"]) > 700 else "")}
                           for m in sorted(MENTIONS.get(vid, []), key=lambda m: order.get(m["stance"], 9))],
                 related=[card(r, st) for r in RELATED.get(vid, [])
                          if r in V and r not in DUPES and not META.get(r, {}).get("gone")
                          and r not in st.hidden and not (st.hide_watched and r in st.watched)][:8])
    return d


@app.post("/api/watched/{vid}")
def set_watched(vid: str, payload: dict = Body(default={})):
    with db() as c:
        if payload.get("watched", True):
            c.execute("insert or ignore into watched(vid, ts) values(?, ?)", (vid, time.time()))
            c.execute("delete from progress where vid=?", (vid,))
        else:
            c.execute("delete from watched where vid=?", (vid,))
        return {"watched": c.execute("select count(*) from watched").fetchone()[0]}


@app.post("/api/progress/{vid}")
def set_progress(vid: str, payload: dict = Body(default={})):
    """Called by the player every few seconds: where playback is (to resume, and for "Continue watching") and
    how many seconds were actually played since the last call (for today's tally and the weekly review)."""
    try:
        pos, dur = float(payload.get("pos") or 0), float(payload.get("dur") or 0)
        played = min(max(float(payload.get("played") or 0), 0.0), 120.0)
    except (TypeError, ValueError):
        raise HTTPException(400, "pos, dur and played must be numbers")
    with db() as c:
        if dur and 30 < pos < dur * 0.9:
            c.execute("insert into progress(vid, pos, dur, ts) values(?,?,?,?) on conflict(vid) do update set "
                      "pos=excluded.pos, dur=excluded.dur, ts=excluded.ts", (vid, pos, dur, time.time()))
        else:
            c.execute("delete from progress where vid=?", (vid,))
        if played:
            c.execute("insert into watchlog(day, vid, secs) values(?,?,?) on conflict(day, vid) do update set "
                      "secs=secs+excluded.secs", (date.today().isoformat(), vid, played))
        return today_tally(c)


INTENTS = ("learn", "unwind", "one")


@app.post("/api/intent")
def set_intent(payload: dict = Body(default={})):
    if payload.get("intent") not in INTENTS:
        raise HTTPException(400, "unknown intent")
    with db() as c:
        c.execute("insert into intents(ts, intent) values(?, ?)", (time.time(), payload["intent"]))
    return {"ok": True}


@app.get("/api/review")
def review():
    """The last seven days, for the user to judge: time actually played, what was finished and whether it was
    rated worth it, why they came, and where the time went. Compared with the seven days before."""
    load_meta()
    today = date.today()
    days = [(today - timedelta(days=i)).isoformat() for i in range(6, -1, -1)]
    t0 = datetime.combine(today - timedelta(days=6), datetime.min.time()).timestamp()
    with db() as c:
        st = State(c)
        log = [tuple(r) for r in c.execute("select day, vid, secs from watchlog where day >= ?",
                                           ((today - timedelta(days=13)).isoformat(),))]
        intents = Counter(r[0] for r in c.execute("select intent from intents where ts >= ?", (t0,)))
    per_day, by_area, by_channel, prev = Counter(), Counter(), Counter(), 0.0
    for day, vid, secs in log:
        if day < days[0]:
            prev += secs
            continue
        per_day[day] += secs
        ch = V[vid]["channel"] if vid in V else (st.extra.get(vid) or {}).get("channel")
        by_channel[ch or "Unknown"] += secs
        by_area[primary_area(vid)[1] or "Other"] += secs
    done = sorted(((v, t) for v, t in st.watched.items() if t >= t0 and (v in V or v in st.extra)), key=lambda x: -x[1])
    rated = [st.ratings.get(v, 0) for v, _ in done]

    def top(cn):
        return [{"name": n, "secs": int(s)} for n, s in cn.most_common(5)]
    return {"days": [{"day": d, "secs": int(per_day[d])} for d in days], "total": int(sum(per_day.values())),
            "prev": int(prev), "finished": [card(v, st) for v, _ in done],
            "worth": sum(r > 0 for r in rated), "not_worth": sum(r < 0 for r in rated), "unrated": sum(r == 0 for r in rated),
            "intents": {k: intents[k] for k in INTENTS}, "areas": top(by_area), "channels": top(by_channel)}


@app.post("/api/hide/{vid}")
def hide(vid: str, payload: dict = Body(default={})):
    with db() as c:
        if payload.get("hidden", True):
            c.execute("insert or ignore into hidden(vid, ts) values(?, ?)", (vid, time.time()))
        else:
            c.execute("delete from hidden where vid=?", (vid,))
    return {"ok": True}


@app.post("/api/rate/{vid}")
def rate(vid: str, payload: dict = Body(default={})):
    r = payload.get("rating", 0)
    if r not in (1, 0, -1):
        raise HTTPException(400, "rating must be 1, 0 or -1")
    with db() as c:
        if r:
            c.execute("insert into ratings(vid, rating, ts) values(?,?,?) "
                      "on conflict(vid) do update set rating=excluded.rating, ts=excluded.ts", (vid, r, time.time()))
        else:
            c.execute("delete from ratings where vid=?", (vid,))
    return {"rating": r}


@app.get("/api/liked")
def liked():
    load_meta()
    with db() as c:
        st = State(c)
        rows = [tuple(r) for r in c.execute("select vid, rating from ratings order by ts desc")]
    rows = [(v, r) for v, r in rows if v in V or v in st.extra]
    return {"items": [card(v, st) for v, r in rows if r > 0], "disliked": [card(v, st) for v, r in rows if r < 0]}


@app.get("/api/foryou")
def foryou(area: str = "", cat: str = "", len: str = "", type: str = ""):
    """Unwatched HN videos closest to the user's likes, with at most 3 per channel and 6 per liked video."""
    load_meta()
    types = split_types(type)
    with db() as c:
        st = State(c)
    t = taste(st)
    ranked = []
    for v in VIDEOS:
        vid = v["vid"]
        if (vid not in t["why"] or vid in st.watched or vid in st.hidden or vid in st.ratings or vid in DUPES
                or v["shelf_life"] == "news" or v["hn"]["recommenders"] == 0 or META.get(vid, {}).get("gone")
                or not passes(vid, st, area, cat, len, types)):
            continue
        ranked.append((t["aff"][vid] + 0.04 * math.log(max(v["score"], 1)), vid))
    ranked.sort(reverse=True)
    per_channel, per_source, items = Counter(), Counter(), []
    for _, vid in ranked:
        ch, source = V[vid]["channel"], t["why"][vid][1]
        if per_channel[ch] >= 3 or per_source[source] >= 6:
            continue
        per_channel[ch] += 1
        per_source[source] += 1
        items.append(dict(card(vid, st), reason=taste_reason(t, vid)))
        if items.__len__() >= 48:
            break
    return {"items": items, "likes": sum(r > 0 for r in st.ratings.values()), "watched": st.watched.__len__()}


@app.post("/api/settings")
def set_settings(payload: dict = Body(...)):
    with db() as c:
        for k in SETTINGS:
            if k in payload:
                kv_set(c, k, "1" if payload[k] else "0")
        return State(c).settings


# ---- DeArrow: crowdsourced plain titles and a representative frame instead of the uploader's thumbnail

def dearrow_lookup(vid):
    """Ask by hash prefix, so the DeArrow server is not told exactly which video. None means it could not be reached."""
    prefix = hashlib.sha256(vid.encode()).hexdigest()[:4]
    req = urllib.request.Request(f"https://sponsor.ajay.app/api/branding/{prefix}", headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            b = (json.load(r) or {}).get(vid) or {}
    except urllib.error.HTTPError as e:
        if e.code != 404:
            return None
        b = {}
    except (OSError, ValueError):
        return None

    def top(key):  # submissions come best first; trust the first only if locked or not voted down
        x = (b.get(key) or [None])[0]
        return x if x and (x.get("locked") or (x.get("votes") or 0) >= 0) else {}
    title, th = top("titles"), top("thumbnails")
    text = None
    if title.get("title") and not title.get("original"):
        text = re.sub(r"(^|\s)>(?=\S)", r"\1", title["title"]).strip() or None  # ">" marks words for auto-formatters
    return {"title": text, "time": None if th.get("original") else th.get("timestamp"), "original": bool(th.get("original"))}


@app.post("/api/dearrow")
def dearrow(payload: dict = Body(...)):
    with db() as c:
        st = State(c)
    if not st.settings["dearrow"]:
        return {}
    vids = [v for v in dict.fromkeys(payload.get("vids") or [])
            if isinstance(v, str) and (v in V or v in st.extra) and v not in st.da][:60]
    with ThreadPoolExecutor(max_workers=8) as pool:
        got = {v: r for v, r in zip(vids, pool.map(dearrow_lookup, vids)) if r is not None}
    with db() as c:
        c.executemany("insert or replace into dearrow(vid, title, time, original, ts) values(?,?,?,?,?)",
                      [(v, r["title"], r["time"], int(r["original"]), time.time()) for v, r in got.items()])
    return got


@app.get("/api/history")
def history():
    with db() as c:
        st = State(c)
    rows = sorted(st.watched.items(), key=lambda x: -x[1])[:300]
    return {"items": [dict(card(v, st), when=datetime.fromtimestamp(t).strftime("%Y-%m-%d"))
                      for v, t in rows if v in V or v in st.extra],
            "hidden": [card(v, st) for v in st.hidden if v in V or v in st.extra]}


# ---- channels

@app.get("/api/channels")
def channels(q: str = ""):
    ql = q.lower().strip()
    with db() as c:
        st = State(c)
    names = [n for n in BY_CHANNEL if ql in n.lower()] if ql else list(BY_CHANNEL)
    names.sort(key=lambda n: -len(BY_CHANNEL[n]))
    return {"items": [{"name": n, "count": len(BY_CHANNEL[n]), "followed": n in st.follows} for n in names[:30]]}


@app.post("/api/follow")
def follow(payload: dict = Body(...)):
    name = (payload.get("channel") or "").strip()
    if not name:
        raise HTTPException(400, "No channel given")
    with db() as c:
        if payload.get("follow", True):
            c.execute("insert or ignore into follows(channel, channel_id, ts) values(?,?,?)",
                      (name, CHAN_ID.get(name), time.time()))
            kv_set(c, "last_refresh", 0)  # pick up its uploads on the next mix
        else:
            c.execute("delete from follows where channel=?", (name,))
    return {"ok": True}


def find_channel(s):
    """The channels.list item for a channel URL, channel id or @handle (needs the API key)."""
    s = (s or "").strip()
    m = re.search(r"UC[\w-]{22}", s)
    if m:
        r = yt("channels", part="snippet", id=m.group(0))
    else:
        h = re.search(r"@([\w.-]+)", s)
        handle = h.group(1) if h else s
        if not re.fullmatch(r"[\w.-]+", handle):
            raise HTTPException(400, "Paste a channel URL like https://www.youtube.com/@handle")
        r = yt("channels", part="snippet", forHandle="@" + handle)
    if not r.get("items"):
        raise HTTPException(404, "YouTube has no channel matching that")
    return r["items"][0]


@app.post("/api/follow_url")
def follow_url(payload: dict = Body(...)):
    """Follow any YouTube channel by URL, channel id or @handle (needs the API key)."""
    it = find_channel(payload.get("url"))
    with db() as c:
        c.execute("insert into follows(channel, channel_id, ts) values(?,?,?) "
                  "on conflict(channel) do update set channel_id=excluded.channel_id",
                  (it["snippet"]["title"], it["id"], time.time()))
        kv_set(c, "last_refresh", 0)
    return {"channel": it["snippet"]["title"]}


def parse_subs(text):
    """(channel id, title) pairs from a Google Takeout subscriptions.csv. The header is localised, so rows are
    read by shape: the cell that is a channel id, and the last other cell that is not a URL."""
    out = {}
    for row in csv.reader(io.StringIO(text.lstrip("﻿"))):
        cells = [x.strip() for x in row]
        cid = next((x for x in cells if re.fullmatch(r"UC[\w-]{22}", x)), None)
        if cid:
            rest = [x for x in cells if x and x != cid and not re.match(r"https?://", x)]
            out.setdefault(cid, (rest[-1] if rest else cid)[:200])
    return list(out.items())


def subs_names(pairs):
    """Follows are keyed by channel name, so a subscription to a channel in the HN data takes the name used there."""
    by_cid = {cid: n for n, cid in CHAN_ID.items()}
    return [(cid, by_cid.get(cid) or title) for cid, title in pairs]


@app.post("/api/subs/preview")
def subs_preview(payload: dict = Body(...)):
    text = payload.get("csv") or ""
    if len(text) > 2_000_000:
        raise HTTPException(400, "That file is too large to be a subscriptions.csv")
    load_meta()
    subs = subs_names(parse_subs(text))
    if not subs:
        raise HTTPException(400, "No channels found in that file. Pick subscriptions.csv from a Google Takeout export.")
    with db() as c:
        st = State(c)
    ids = set(st.follows.values())
    items = [{"id": cid, "name": n, "hn": sum(v not in DUPES for v in BY_CHANNEL.get(n, [])),
              "followed": n in st.follows or cid in ids} for cid, n in subs]
    items.sort(key=lambda i: (i["followed"], -i["hn"], i["name"].lower()))
    return {"items": items}


@app.post("/api/subs/import")
def subs_import(payload: dict = Body(...)):
    load_meta()
    pairs = [(str(ch.get("id") or ""), str(ch.get("name") or "").strip()[:200])
             for ch in payload.get("channels") or [] if isinstance(ch, dict)]
    subs = subs_names([(cid, n) for cid, n in pairs if re.fullmatch(r"UC[\w-]{22}", cid) and n])
    if not subs:
        raise HTTPException(400, "No channels selected")
    with db() as c:
        st = State(c)
        ids = set(st.follows.values())
        new = {n: cid for cid, n in subs if n not in st.follows and cid not in ids}
        c.executemany("insert or ignore into follows(channel, channel_id, ts) values(?,?,?)",
                      [(n, cid, time.time()) for n, cid in new.items()])
        if new:
            kv_set(c, "last_refresh", 0)  # pick up their uploads on the next mix
    return {"added": len(new), "already": len(subs) - len(new)}


@app.get("/api/following")
def following():
    load_meta()
    with db() as c:
        st = State(c)
        checked = {r[0]: r[1] for r in c.execute("select channel, checked_ts from follows")}
    chans = []
    for n in sorted(st.follows, key=str.lower):
        vids = [v for v in BY_CHANNEL.get(n, []) if v not in DUPES]
        chans.append({"name": n, "hn": len(vids), "unwatched": sum(v not in st.watched for v in vids),
                      "new": sum(st.is_new(e["vid"]) for e in st.extra.values() if e["channel"] == n),
                      "checked": bool(checked.get(n))})
    ups = sorted((e for e in st.extra.values() if e["upload"] and e["channel"] in st.follows
                  and e["vid"] not in st.watched and e["vid"] not in st.hidden),
                 key=lambda e: e["published"] or "", reverse=True)[:60]
    picks = [v["vid"] for v in VIDEOS if v["channel"] in st.follows and v["vid"] not in st.watched
             and v["vid"] not in st.hidden and v["vid"] not in DUPES and not META.get(v["vid"], {}).get("gone")][:60]
    return {"channels": chans, "uploads": [card(e["vid"], st) for e in ups],
            "picks": [card(v, st) for v in picks]}


@app.post("/api/refresh_uploads")
def api_refresh_uploads():
    yt_key_check()
    return refresh_uploads()


def yt_key_check():
    if not os.environ.get("YOUTUBE_API_KEY"):
        raise HTTPException(400, "This needs a YouTube API key: start the app with YOUTUBE_API_KEY set (see Settings).")


# ---- playlists

def playlist_detail(c, pid):
    p = c.execute("select * from playlists where id=?", (pid,)).fetchone()
    if not p:
        raise HTTPException(404, "No such playlist")
    st = State(c)
    vids = [r[0] for r in c.execute("select vid from items where playlist_id=? order by pos", (pid,))]
    pending = sum(v not in V and v not in st.extra for v in vids)  # imported without a key: no details yet
    vids = [v for v in vids if st.available(v)]
    nxt = next((v for v in vids if v not in st.watched), None)
    return {"id": p["id"], "name": p["name"], "yt_id": p["yt_id"], "next": nxt, "pending": pending,
            "done": sum(v in st.watched for v in vids), "items": [card(v, st) for v in vids]}


@app.get("/api/playlists")
def playlists():
    load_meta()
    with db() as c:
        out = []
        for r in c.execute("select id from playlists order by ts").fetchall():
            d = playlist_detail(c, r[0])
            d["next"] = next((i for i in d["items"] if i["vid"] == d["next"]), None)
            d["total"] = len(d.pop("items"))
            out.append(d)
        return {"items": out}


@app.post("/api/playlists")
def playlist_create(payload: dict = Body(...)):
    name = (payload.get("name") or "").strip()[:120]
    if not name:
        raise HTTPException(400, "Give the playlist a name")
    with db() as c:
        pid = c.execute("insert into playlists(name, ts) values(?, ?)", (name, time.time())).lastrowid
        if payload.get("vid"):
            c.execute("insert into items(playlist_id, vid, pos) values(?, ?, 1)", (pid, payload["vid"]))
    return {"id": pid}


def set_items(c, pid, vids):
    c.execute("delete from items where playlist_id=?", (pid,))
    c.executemany("insert into items(playlist_id, vid, pos) values(?,?,?)", [(pid, v, i) for i, v in enumerate(vids, 1)])


def sync_playlist(c, pid):
    """Three-way merge of an imported playlist with YouTube. What YouTube gained since the last sync is added next
    to its YouTube neighbour, what it lost is removed, and local edits stay: videos saved here from elsewhere are
    kept and videos removed here do not come back. Also fills in videos that were imported without a key."""
    p = c.execute("select * from playlists where id=?", (pid,)).fetchone()
    if not p:
        raise HTTPException(404, "No such playlist")
    yt_key_check()
    order = [r[0] for r in c.execute("select vid from items where playlist_id=? order by pos", (pid,))]
    listed, new, drop = [], [], set()
    if p["yt_id"]:
        listed = yt_playlist_vids(p["yt_id"])
        seen = set(json.loads(p["yt_seen"])) if p["yt_seen"] else None  # None: imported before syncing existed
        drop = (seen or set()) - set(listed)
        have = set(order) | (seen or set())
        new = [v for v in listed if v not in have]
    dead = learn_videos(c, order + new)
    new = [v for v in new if v not in dead]
    removed, unavailable = sum(v in drop for v in order), sum(v in dead and v not in drop for v in order)
    order = [v for v in order if v not in drop and v not in dead]
    for v in new:
        before = next((x for x in reversed(listed[:listed.index(v)]) if x in order), None)
        order.insert(order.index(before) + 1 if before else 0, v)
    set_items(c, pid, order)
    if p["yt_id"]:
        c.execute("update playlists set yt_seen=? where id=?", (json.dumps(listed), pid))
    return {"id": pid, "name": p["name"], "added": len(new), "removed": removed, "unavailable": unavailable}


@app.post("/api/playlists/import")
def playlist_import(payload: dict = Body(...)):
    s = (payload.get("url") or "").strip()
    m = re.search(r"[?&]list=([\w-]+)", s) or re.fullmatch(r"([\w-]{13,})", s)
    if not m:
        raise HTTPException(400, "Paste a YouTube playlist URL (it should contain list=...)")
    yt_id = m.group(1)
    with db() as c:
        old = c.execute("select id from playlists where yt_id=?", (yt_id,)).fetchone()
        if old:  # already imported: bring it up to date instead of making a second copy
            return {**sync_playlist(c, old[0]), "synced": True}
    info = yt("playlists", part="snippet", id=yt_id)
    if not info.get("items"):
        raise HTTPException(404, "YouTube has no public playlist with that id")
    name = info["items"][0]["snippet"]["title"]
    vids = yt_playlist_vids(yt_id)
    with db() as c:
        dead = learn_videos(c, vids)
        keep = [v for v in vids if v not in dead]
        pid = c.execute("insert into playlists(name, yt_id, yt_seen, ts) values(?,?,?,?)",
                        (name, yt_id, json.dumps(vids), time.time())).lastrowid
        set_items(c, pid, keep)
    return {"id": pid, "name": name, "count": len(keep), "skipped": len(vids) - len(keep)}


@app.post("/api/playlists/channel")
def channel_playlists(payload: dict = Body(...)):
    """The public playlists of a channel, to pick from; each is then imported through /api/playlists/import."""
    ch = find_channel(payload.get("url"))
    items, token = [], None
    while len(items) < 500:
        extra = {"pageToken": token} if token else {}
        r = yt("playlists", part="snippet,contentDetails", channelId=ch["id"], maxResults=50, **extra)
        items += [{"yt_id": i["id"], "name": i["snippet"]["title"], "total": i["contentDetails"]["itemCount"]}
                  for i in r.get("items", [])]
        token = r.get("nextPageToken")
        if not token:
            break
    with db() as c:
        have = {r[0] for r in c.execute("select yt_id from playlists where yt_id is not null")}
    for i in items:
        i["existing"] = i["yt_id"] in have
    return {"channel": ch["snippet"]["title"], "items": items}


@app.post("/api/playlists/{pid}/sync")
def playlist_sync(pid: int):
    with db() as c:
        return sync_playlist(c, pid)


# Google Takeout puts playlists in "YouTube and YouTube Music/playlists/": one "<title>-videos.csv" per playlist
# (video id, time added) and a playlists.csv index (playlist id, title, ...). Older exports have one "<title>.csv"
# per playlist with the playlist's own row above the videos. Headers are localised, so everything is read by shape.
YT_VID = re.compile(r"[\w-]{11}")
YT_PLAYLIST = re.compile(r"PL[\w-]{16,34}")
TAKEOUT_MAX_VIDEOS = 5000


def loose(s):
    return re.sub(r"[\W_]+", "", s).lower()


def parse_takeout(files):
    lists, ids, empty = [], {}, []
    for f in files:
        fname = str(f.get("name") or "")
        try:
            rows = [[x.strip() for x in row] for row in csv.reader(io.StringIO(str(f.get("csv") or "").lstrip("﻿")))]
        except csv.Error:
            empty.append(fname)
            continue
        vids = list(dict.fromkeys(r[0] for r in rows if r and YT_VID.fullmatch(r[0])))[:TAKEOUT_MAX_VIDEOS]
        own, index = None, False
        for r in rows:
            pl = next((x for x in r if YT_PLAYLIST.fullmatch(x)), None)
            if pl and vids:
                own = own or pl
            elif pl:  # a row of the index: remember the id under every other cell, one of which is the title
                index = True
                for x in r:
                    if x != pl and loose(x):
                        ids.setdefault(loose(x), (pl, x))
        name = re.sub(r"-videos$", "", re.sub(r"\.csv$", "", fname.rsplit("/", 1)[-1], flags=re.I)).strip()[:120]
        if vids:
            lists.append({"name": name or "Imported playlist", "yt_id": own, "vids": vids})
        elif not index:
            empty.append(fname)
    for p in lists:  # file names are sanitised titles; the index has the id and the title as written
        if not p["yt_id"] and loose(p["name"]) in ids:
            p["yt_id"], p["name"] = ids[loose(p["name"])][0], ids[loose(p["name"])][1][:120]
    return lists, empty


def takeout_match(c, p):
    """The playlist a Takeout playlist would be merged into: the same YouTube playlist, else the same name."""
    r = p["yt_id"] and c.execute("select id from playlists where yt_id=?", (p["yt_id"],)).fetchone()
    r = r or c.execute("select id from playlists where lower(name)=lower(?) and (yt_id is null or ? is null) "
                       "order by ts", (p["name"], p["yt_id"])).fetchone()
    return r[0] if r else None


@app.post("/api/playlists/takeout/preview")
def takeout_preview(payload: dict = Body(...)):
    files = [f for f in payload.get("files") or [] if isinstance(f, dict)]
    if sum(len(str(f.get("csv") or "")) for f in files) > 20_000_000:
        raise HTTPException(400, "Those files are too large to be Takeout playlists")
    lists, empty = parse_takeout(files)
    if not lists:
        raise HTTPException(400, "No videos found in those files. Pick the CSV files from the "
                                 "\"YouTube and YouTube Music/playlists\" folder of a Google Takeout export.")
    with db() as c:
        st = State(c)
        for p in lists:
            pid = takeout_match(c, p)
            have = {r[0] for r in c.execute("select vid from items where playlist_id=?", (pid,))} if pid else set()
            p.update(total=len(p["vids"]), hn=sum(v in V for v in p["vids"]),
                     unknown=sum(v not in V and v not in st.extra for v in p["vids"]),
                     existing=pid, new=sum(v not in have for v in p["vids"]))
    lists.sort(key=lambda p: (p["existing"] is not None and not p["new"], p["name"].lower()))
    return {"items": lists, "empty": empty}


@app.post("/api/playlists/takeout/import")
def takeout_import(payload: dict = Body(...)):
    lists = []
    for p in payload.get("playlists") or []:
        if not isinstance(p, dict) or not isinstance(p.get("vids"), list):
            continue
        vids = list(dict.fromkeys(v for v in p["vids"] if isinstance(v, str) and YT_VID.fullmatch(v)))
        yt_id = p.get("yt_id") if isinstance(p.get("yt_id"), str) and YT_PLAYLIST.fullmatch(p["yt_id"]) else None
        name = str(p.get("name") or "").strip()[:120]
        if vids and name:
            lists.append({"name": name, "yt_id": yt_id, "vids": vids[:TAKEOUT_MAX_VIDEOS]})
    if not lists:
        raise HTTPException(400, "No playlists selected")
    has_key = bool(os.environ.get("YOUTUBE_API_KEY"))
    out = {"created": 0, "updated": 0, "videos": 0, "unavailable": 0, "pending": 0, "ids": []}
    with db() as c:
        # Without a key the videos from outside the HN data are stored anyway; they stay out of sight until
        # a later sync (playlist page) fetches their details.
        dead = learn_videos(c, [v for p in lists for v in p["vids"]]) if has_key else set()
        known = {r[0] for r in c.execute("select vid from extra")}
        for p in lists:
            vids = [v for v in p["vids"] if v not in dead]
            out["unavailable"] += len(p["vids"]) - len(vids)
            pid = takeout_match(c, p)
            if pid:
                order = [r[0] for r in c.execute("select vid from items where playlist_id=? order by pos", (pid,))]
                add = [v for v in vids if v not in set(order)]
                if p["yt_id"]:
                    c.execute("update playlists set yt_id=? where id=? and yt_id is null", (p["yt_id"], pid))
                out["updated"] += bool(add)
            else:
                order, add = [], vids
                pid = c.execute("insert into playlists(name, yt_id, yt_seen, ts) values(?,?,?,?)",
                                (p["name"], p["yt_id"], json.dumps(p["vids"]) if p["yt_id"] else None,
                                 time.time())).lastrowid
                out["created"] += 1
            set_items(c, pid, order + add)
            out["videos"] += len(add)
            out["pending"] += sum(v not in V and v not in known for v in add)
            out["ids"].append(pid)
    return out


@app.get("/api/playlists/{pid}")
def playlist_get(pid: int):
    load_meta()
    with db() as c:
        return playlist_detail(c, pid)


@app.delete("/api/playlists/{pid}")
def playlist_delete(pid: int):
    with db() as c:
        c.execute("delete from items where playlist_id=?", (pid,))
        c.execute("delete from playlists where id=?", (pid,))
    return {"ok": True}


@app.post("/api/playlists/{pid}/add")
def playlist_add(pid: int, payload: dict = Body(...)):
    with db() as c:
        if not c.execute("select 1 from playlists where id=?", (pid,)).fetchone():
            raise HTTPException(404, "No such playlist")
        pos = c.execute("select coalesce(max(pos), 0) + 1 from items where playlist_id=?", (pid,)).fetchone()[0]
        c.execute("insert or ignore into items(playlist_id, vid, pos) values(?,?,?)", (pid, payload["vid"], pos))
    return {"ok": True}


@app.post("/api/playlists/{pid}/remove")
def playlist_remove(pid: int, payload: dict = Body(...)):
    with db() as c:
        c.execute("delete from items where playlist_id=? and vid=?", (pid, payload["vid"]))
    return {"ok": True}


@app.post("/api/playlists/{pid}/move")
def playlist_move(pid: int, payload: dict = Body(...)):
    with db() as c:
        vids = [r[0] for r in c.execute("select vid from items where playlist_id=? order by pos", (pid,))]
        if payload["vid"] in vids:
            i = vids.index(payload["vid"])
            j = i + (-1 if payload.get("dir") == "up" else 1)
            if 0 <= j < len(vids):
                vids[i], vids[j] = vids[j], vids[i]
                c.executemany("update items set pos=? where playlist_id=? and vid=?",
                              [(n, pid, v) for n, v in enumerate(vids, 1)])
    return {"ok": True}


@app.get("/")
def index():
    return FileResponse(ROOT / "static" / "index.html", headers={"Cache-Control": "no-cache"})


app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")
