# PersonalTube

A personal YouTube front page that runs on your own computer and is on your side rather than YouTube's. Your own queue comes first, suggestions are few and explained, and the player is built to end instead of keeping you watching. It's a single-user, local-only web app (FastAPI and plain JavaScript), with an Android app that wraps the same pages and adds a native player and downloads.

```bash
pixi run start   # http://127.0.0.1:8765
```

The Android app is released as a signed APK on this repository's releases page (tags `android-v*`). It reads the server code and the library from a folder that Syncthing keeps on the phone.

## Data and credits

The video library (`videos.jsonl`, `mentions.jsonl`, `related.jsonl`, `taxonomy.json`, `embeddings.npy`, `embedding_ids.json`) is the data export of [HackerTube](https://hackertube.org), built from the [open-index/hacker-news](https://huggingface.co/datasets/open-index/hacker-news) dataset. It is released under the [Open Data Commons Attribution License (ODC-By) v1.0](https://opendatacommons.org/licenses/by/1-0/). Hacker News data is provided by Y Combinator, and the comments remain the work of their authors. Video titles and channel names belong to their creators.

When the app runs, it looks up crowd-sourced titles and thumbnails from [DeArrow](https://dearrow.ajay.app) and segments from [SponsorBlock](https://sponsor.ajay.app). Both are CC BY-NC-SA 4.0, and none of their data is stored in this repository. YouTube API data is never committed.

Not affiliated with YouTube, Google, Hacker News or Y Combinator.
