"""Fetch YouTube metadata (durations, channel ids, availability) for every video in videos.jsonl.

Usage:  YOUTUBE_API_KEY=... pixi run fetch-meta

Standard library only. Resumable: videos already in youtube_meta.jsonl are skipped.
Costs about 130 quota units for the whole dataset (free daily quota: 10,000).
Pass --refresh to throw the cache away and fetch everything again.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import ytkey

ROOT = Path(__file__).parent
OUT = ROOT / "youtube_meta.jsonl"

ytkey.load()  # env var, else the login keyring
key = os.environ.get("YOUTUBE_API_KEY")
if not key:
    sys.exit("No YouTube API key found. Store one in the keyring (see ytkey.py) or export YOUTUBE_API_KEY.")

if "--refresh" in sys.argv and OUT.exists():
    OUT.unlink()

vids = [json.loads(line)["vid"] for line in open(ROOT / "videos.jsonl", encoding="utf-8")]
done = set()
if OUT.exists():
    for line in open(OUT, encoding="utf-8"):
        try:
            done.add(json.loads(line)["vid"])
        except ValueError:
            pass
todo = [v for v in vids if v not in done]
print(f"{len(done)} cached, {len(todo)} to fetch")

gone = 0
with open(OUT, "a", encoding="utf-8") as f:
    for i in range(0, len(todo), 50):
        ids = todo[i:i + 50]
        q = urllib.parse.urlencode({"part": "snippet,contentDetails,statistics,status",
                                    "id": ",".join(ids), "key": key})
        try:
            with urllib.request.urlopen(f"https://www.googleapis.com/youtube/v3/videos?{q}", timeout=30) as r:
                items = json.load(r)["items"]
        except urllib.error.HTTPError as e:
            try:
                msg = json.load(e)["error"]["message"]
            except Exception:
                msg = e.reason
            sys.exit(f"YouTube API error {e.code}: {msg}\n"
                     "(Progress so far is saved; fix the problem and re-run to continue.)")
        got = {it["id"]: it for it in items}
        for v in ids:  # ids missing from the response were deleted or made private
            gone += v not in got
            f.write(json.dumps({"vid": v, "item": got.get(v)}) + "\n")
        f.flush()
        print(f"\r{min(i + 50, len(todo))}/{len(todo)}", end="", flush=True)
        time.sleep(0.2)
print(f"\ndone: {len(vids)} videos ({gone} newly found deleted/private)")
