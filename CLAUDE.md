# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

PersonalTube is a single-user, local-only web app: a personal YouTube front page that is on the viewer's side rather than YouTube's. The user's own queue comes first, suggestions are few and explained, and the player is built to end (see "Design stance"). Its video library is the HackerTube data export (videos recommended on Hacker News), but that is a silent backbone: the UI calls it "the library" and does not mention HN outside the attribution footer and the collapsed "What people said" section of a video.

## Commands

Dependencies are managed with pixi (`pixi.toml`, top-level table `[workspace]`).

```bash
pixi run start        # serve the app at http://127.0.0.1:8765
pixi run fetch-meta   # fetch/resume YouTube metadata into youtube_meta.jsonl (add --refresh to refetch all)
```

There are no tests, linter or build step. The frontend is plain files served from `static/`; reload the browser to see changes. The server reloads itself when a `.py` file changes (uvicorn `reload`, via watchfiles); it loads the dataset at import time, so each reload takes a few seconds.

The YouTube API key is read from `YOUTUBE_API_KEY`, falling back to the login keyring through `secret-tool` (`ytkey.py` has the store command). The app runs without a key; only following channels by URL, refreshing uploads and importing playlists need one.

## Architecture

Three layers of data, all keyed by the 11-character YouTube id `vid`:

1. **Read-only dataset** (`videos.jsonl`, `mentions.jsonl`, `related.jsonl`, `taxonomy.json`): loaded into module-level dicts at the top of `server.py` (`VIDEOS`, `V`, `MENTIONS`, `RELATED`, `BY_CHANNEL`, `BLOB`, `DUPES`). `embeddings.npy` is loaded with numpy as `EMB` (rows indexed by `EMB_ROW`) and used only for recommendations. Search is word matching, not embeddings: `relevance()` matches whole words and word beginnings against the per-video word sets in `WORDS` and ranks title over channel over topic and tags; `match()` extends it to the user's own videos from outside the library (`own_extra()`: uploads of followed channels, playlist entries, anything watched or rated), and `respell()` retries a search that found nothing with the closest known words (`difflib`), reported to the frontend as `corrected`.
2. **YouTube metadata cache** (`youtube_meta.jsonl`, gitignored, written by `fetch_youtube_meta.py`): raw `videos.list` items. `load_meta()` reduces them to `META` (duration, channel id, publish date, views, or `{"gone": True}`) and re-reads the file whenever its mtime changes, so endpoints call it first and a running fetch shows up without a restart.
3. **User state** (`state.db`, SQLite, gitignored): `watched`, `hidden`, `follows`, `playlists`/`items`, `kv`, `ratings` (1 liked, -1 disliked), `dearrow` and `ytsearch` (caches), `progress` (position of started, unfinished videos), `watchlog` (seconds actually played per day and video), `intents` (answers to "what are you here for?"), `topics` (area or category id to 1 "more of this" / -1 "less of this"), `descs` (YouTube descriptions of extras, fetched when a video is first opened) and `extra`. `follows.quiet` marks a followed channel that is kept off the home page; `watched.src` and `ratings.src` are `'takeout'` for rows from a Takeout import, so `/api/takeout/forget` can take the import back. `extra` holds videos from outside the HN dataset (uploads of followed channels with `upload=1`, imported playlist entries, and YouTube search results). The schema is `SCHEMA` in `server.py`, created with `create table if not exists`; new columns need an explicit `alter table` migration next to it, as done for `extra.views`.

A video is therefore either an "HN video" (`vid in V`) or an "extra" (`vid in st.extra`), and code that handles a vid must cover both: `State` snapshots the user tables per request, `card(vid, st)` builds the JSON the frontend renders for either kind, and `passes()` applies the filters (extras have no topic, so they fail any area/category filter).

Recurring exclusion rules for HN videos, applied separately in each endpoint: `DUPES` (re-uploads, by normalised title), `META[vid]["gone"]`, hidden, and for the mix also `shelf_life == "news"` and `hn.recommenders == 0`.

`taste(st)` turns likes, dislikes and (weakly) watch history into a per-video affinity: the best rescaled embedding similarity to a liked video, a bonus for sharing HN recommenders (`RELATED`) or a channel with a like, and a penalty near dislikes. It is cached on the ratings/watched snapshot. `/api/foryou` ranks by it, and `build_mix()` multiplies its sampling weights by `exp(TASTE_PULL * affinity)`. Videos outside the HN data have no embedding, so they only count through their channel. Topic interests are applied on top, outside `taste()`: `topic_weight()` (a category's setting overrides its area's) multiplies mix weights through `topic_pull()`, lets For You list videos the taste model has no opinion on, and keeps "less of this" topics out of the branch-out picks. They are set with the plus/minus buttons on the Categories page and on topic pages (`topicCtl()`, `/api/topic`).

The on/off settings (`SETTINGS`, a dict of name to default: `hide_watched`, `dearrow`, `calm`, `ask_intent`) live in `kv`, are read into `State` and reach the frontend as `B.settings`. One setting is a number: `home_max_len` (seconds, one of `HOME_MAX_LEN_CHOICES`, `B.home_max_len`), the length above which uploads of followed channels stay off the home page. `calm` (frontend only) drops view counts and the "new" dots and badges; `ask_intent` turns on the question before the first video of a sitting. `hide_watched` is applied in each list endpoint (not history, liked or playlists). With `dearrow` on, `card()` attaches cached DeArrow data as `da`; the frontend asks `/api/dearrow` for the videos on screen that lack it and patches titles and frames in, falling back to YouTube's automatic frame (`mq2.jpg`) when DeArrow has none or its thumbnail service fails.

`build_mix()` builds the home page ("Home", `/api/mix`, rendered by `pageMix()`): `lead`, one pick drawn large as "Today's pick", and `items`, a single grid in this order: started videos (rows of `progress`), the next unwatched video of a few playlists (the "Watch later" one always among them), uploads from followed channels (not quiet ones, not over `home_max_len`), picks (score-weighted sampling with per-channel and per-area caps and weight boosts for followed channels and for taste) and a few "branch out" videos (ones the taste model does not lean towards, from the areas the user has watched least, one per area; none under a topic filter). There are no section headings; each card's `reason` badge says why it is there. On every page with filters the heading and the filter bar share one row (`filterBar()` with a `head`), Filters button on the right; pages carry no explanatory subtitle under their heading. It is deterministic for the day: every random draw is `rnd(seed, vid)`, a hash of (date, reshuffle count, vid), so state changes nudge the page instead of redealing it. Keep new randomness on that scheme rather than using `random`. Every suggestion carries a `reason` in personal terms.

## Design stance

The app should serve what the user came for and then let them go. Concretely, and to be kept when adding features:

- The home page is small and has an end; no infinite lists, no autoplay of a next video, nothing that plays without a click.
- The player (`startPlayer()` in `app.js`): asks once per sitting what the user came for (`intentGate()`, remembered three hours in `localStorage`, logged through `/api/intent`); hides the related list while a video plays; and on the end of a video destroys the YouTube player (so its end screen never shows) and renders `stopScreen()`: rate it, today's tally, the next video of the user's own playlist if there is one, "Done for now". After "just this video", a second video asks first.
- While playing it posts to `/api/progress/{vid}` every 15 seconds: the position (resume, "Continue watching") and the seconds actually played (today's tally, `/api/review` and the Review page).
- Limits are nudges, by the user's choice: nothing is blocked inside the app.
- Wording stays plain and quiet: no counts or badges that ask for attention, no HN vocabulary.

"Watch later" is an ordinary playlist that the clock button on every card fills in one click (`/api/later/{vid}`, `later_id()`: the playlist remembered in `kv`, else the one named "Watch later", else a new one). The Save picker (`listPopup()`) ticks the playlists that hold the video and toggles membership.

Watch history and liked videos come in from Google Takeout on the Settings page: `/api/takeout/history/preview` takes the file itself as the request body (`watch-history.json` or `.html`, parsed by `parse_history()`; the parsed rows wait in memory under a token until `/import`), and `/api/takeout/likes` takes a playlist CSV. Imported history rows are stored for every video, known or not, so code that counts or ranks watched videos must filter to `V` or `st.extra` first.

Subscription import (`/api/subs/preview`, `/api/subs/import`) reads a Google Takeout `subscriptions.csv` picked on the Following page; it needs no API key, and channels found in the HN data (by channel id, through `CHAN_ID`) are followed under their HN name so their picks stay linked.

Playlists arrive three ways: made here, imported by URL (`/api/playlists/import`, needs the key; a channel URL in the same box lists the channel's public playlists through `/api/playlists/channel` and imports the ticked ones one by one), or from Google Takeout playlist CSVs picked on the Playlists page (`/api/playlists/takeout/preview` and `/import`, parsed by shape in `parse_takeout()`; same-named playlists are merged). Takeout needs no key, but videos outside the HN data then sit in `items` with no `extra` row ("pending") and stay invisible until a sync. `sync_playlist()` fills those in and, for playlists with a `yt_id`, three-way merges against `playlists.yt_seen` (the ids YouTube listed last time) so local additions and removals survive.

A search (`#/browse?q=`) also shows a "From YouTube" section under the first page of HN results: `ytResults()` asks `/api/ytsearch` after the page is drawn. `youtube_search()` spends 100 quota units per new query, so answers are cached in `ytsearch` for a day (`YT_SEARCH_FRESH`); results are stored as extras so they open and play in the app like any other video, minus live streams and clips under `MIN_UPLOAD_SECONDS`. `forget_old_searches()` deletes searches after 30 days together with the extras only they brought in (in no playlist, never watched, rated or hidden).

YouTube API calls go through `yt()`, which turns failures into `HTTPException`s whose `detail` the frontend shows in a toast. Upload refresh runs at most every 12 hours in a background thread triggered from `/api/mix`.

**Frontend** (`static/app.js`, no framework, no build): a hash router (`route()`) dispatching to `page*` functions that fetch from `/api/*` and set `#main` via template strings. Everything interpolated into HTML must go through `esc()`. `B` is the boot payload from `/api/boot` (sidebar, counts, taxonomy); Filters (`len`, `type`, `sort`, and `area` on the home page and For You) are per page and live in the hash query string (`#/browse?len=long&sort=gems`): `filterParams()` reads them, `filterBar()` renders the Filters button, active chips and collapsed panel as plain links, and nothing about them is stored. Topics have their own pages, `#/a/<area>` and `#/c/<category>`, reached from `#/categories` and rendered by `pageBrowse()` like `#/browse` and `#/channel/<name>`. Actions that remove something from view (hide, mark watched with "hide played" on, remove from a playlist, Watch later) pass an undo function to `toast()` rather than pointing at another page. `route()` sets the tab title (`pageTitle`, `TITLES`) and shows a thin bar when a page is slow; scroll positions are kept per history entry (`SCROLLS`, Navigation API) so Back returns to the same place. Keyboard shortcuts are one `keydown` handler (`GO`, `KEY_ACT`, `runAct()`), listed in the `#keys` dialog in `index.html`; keep the two in step. `localStorage` holds only theme, sidebar state and the current sitting's intent (`pt-intent`); resume positions are in `state.db`. Playback uses the YouTube IFrame API on the `youtube-nocookie.com` host.

## Constraints

- **Do not change the port (8765) or bind address, and do not add a second way to play videos that avoids this origin.** All playback must happen in a page served from `http://127.0.0.1:8765`; tooling outside this repository depends on that exact origin.
- YouTube API data must not be redistributed: `youtube_meta.jsonl` and `state.db` stay gitignored, and the key never goes in a file.
- The server uses only the standard library plus FastAPI/uvicorn and numpy; the fetch script is standard library only. Add new dependencies through `pixi.toml`.
- For DeArrow data, look videos up by hash prefix, and never submit to its API.

s
