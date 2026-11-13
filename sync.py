"""Keeps the user's state in step between devices through a folder that Syncthing (or anything like it) copies.

state.db itself is never shared: two devices writing one SQLite file would lose changes. Instead every device
appends its own changes to its own file, <folder>/<device id>.jsonl, and reads the files of the others. A file
has one writer, so the folder never holds a conflict.

Changes are caught by triggers, so the code that writes to the tables does not know about any of this:

  put   a row was inserted or updated; the line carries the whole row
  del   a row was deleted
  max   watchlog: seconds played of a video on a day; the larger number wins
  ins   intents: an answer was logged; added unless it is already there

put and del are settled per row by time: the latest change wins (sync_seen remembers the time of the last
change to each row, local or not). Every operation can be applied twice without harm, so a device that starts
over simply reads every file from the top.
"""
import json
import os
import secrets
import sqlite3
import threading
import time
from pathlib import Path

# table -> primary key columns, for the tables whose rows are settled by "latest change wins"
TABLES = {"watched": ("vid",), "hidden": ("vid",), "follows": ("channel",), "extra": ("vid",), "descs": ("vid",),
          "playlists": ("id",), "items": ("playlist_id", "vid"), "ratings": ("vid",), "progress": ("vid",),
          "topics": ("id",), "kv": ("k",)}
NOW = "((julianday('now') - 2440587.5) * 86400.0)"
INTERVAL = 5  # seconds between passes

SCHEMA = """
create table if not exists sync_ctl(id integer primary key check (id = 1), dev text, applying integer default 0);
create table if not exists sync_out(seq integer primary key autoincrement, tbl text, op text, pk text, data text, ts real);
create table if not exists sync_seen(tbl text, pk text, ts real, dev text, primary key(tbl, pk)) without rowid;
create table if not exists sync_in(dev text primary key, off integer, seq integer, ts real);
"""


class Sync:
    def __init__(self, db_path, folder, kv_keys=(), kv_prefixes=()):
        """kv_keys and kv_prefixes say which rows of kv are shared; the rest (caches, timers) stay on the device."""
        self.db_path, self.folder = str(db_path), Path(folder)
        self.kv_where = " or ".join([f"{{r}}.k in ({','.join(repr(k) for k in kv_keys)})"] * bool(kv_keys)
                                    + [f"{{r}}.k like '{p}%'" for p in kv_prefixes]) or "0"
        self.lock = threading.Lock()
        self.cols = {}
        self.error = None
        c = self.connect()
        try:
            c.executescript(SCHEMA)
            if not c.execute("select 1 from sync_ctl").fetchone():
                c.execute("insert into sync_ctl(id, dev) values(1, ?)", (secrets.token_hex(4),))
            c.execute("update sync_ctl set applying=0")
            self.dev = c.execute("select dev from sync_ctl").fetchone()[0]
            self.install(c)
            c.commit()
        finally:
            c.close()

    def connect(self):
        return sqlite3.connect(self.db_path, timeout=30)

    @property
    def mine(self):
        return self.folder / f"{self.dev}.jsonl"

    # ---- catching local changes

    def row_sql(self, t, r):
        """SQL for the key and the contents of a row of t, as JSON text; r is new, old or the table's name."""
        pk = "json_array(" + ", ".join(f"{r}.{k}" for k in TABLES[t]) + ")"
        data = "json_object(" + ", ".join(f"'{k}', {r}.{k}" for k in self.cols[t]) + ")"
        return pk, data

    def install(self, c):
        """(Re)create the triggers from the tables as they are now, so a new column is carried without more work."""
        for (name,) in c.execute("select name from sqlite_master where type='trigger' and name like 'sync!_%' escape '!'").fetchall():
            c.execute(f"drop trigger {name}")
        local = "(select applying from sync_ctl) = 0"
        # an upsert, not "insert or replace": a statement's own conflict rule overrides the one in its triggers,
        # so a trigger fired by "insert ... on conflict do update" would turn the replace into a failure
        seen = ("insert into sync_seen(tbl, pk, ts, dev) "
                "select tbl, pk, ts, (select dev from sync_ctl) from sync_out where seq = (select max(seq) from sync_out) "
                "on conflict(tbl, pk) do update set ts = excluded.ts, dev = excluded.dev;")
        for t in TABLES:
            self.cols[t] = [r[1] for r in c.execute(f"pragma table_info({t})")]
            cond = {r: local + (f" and ({self.kv_where.format(r=r)})" if t == "kv" else "") for r in ("new", "old")}
            pk, data = self.row_sql(t, "new")
            for ev in ("insert", "update"):
                c.execute(f"create trigger sync_{t}_{ev} after {ev} on {t} when {cond['new']} begin "
                          f"insert into sync_out(tbl, op, pk, data, ts) values('{t}', 'put', {pk}, {data}, {NOW}); {seen} end")
            pk, _ = self.row_sql(t, "old")
            c.execute(f"create trigger sync_{t}_delete after delete on {t} when {cond['old']} begin "
                      f"insert into sync_out(tbl, op, pk, ts) values('{t}', 'del', {pk}, {NOW}); {seen} end")
        for ev, extra in (("insert", ""), ("update", " and new.secs > old.secs")):
            c.execute(f"create trigger sync_watchlog_{ev} after {ev} on watchlog when {local}{extra} begin "
                      "insert into sync_out(tbl, op, data, ts) values('watchlog', 'max', "
                      f"json_object('day', new.day, 'vid', new.vid, 'secs', new.secs), {NOW}); end")
        c.execute(f"create trigger sync_intents_insert after insert on intents when {local} begin "
                  "insert into sync_out(tbl, op, data, ts) values('intents', 'ins', "
                  f"json_object('ts', new.ts, 'intent', new.intent), {NOW}); end")

    def snapshot(self, c):
        """Write everything this device holds as changes made now: how a device introduces itself to the others."""
        c.execute("delete from sync_out where op != 'del'")  # everything else is retold below
        for t in TABLES:
            pk, data = self.row_sql(t, t)
            where = f" where {self.kv_where.format(r='kv')}" if t == "kv" else ""
            # a row that came from another device keeps the time of that change, so re-telling it overrides nothing
            c.execute(f"insert into sync_out(tbl, op, pk, data, ts) select '{t}', 'put', {pk}, {data}, "
                      f"coalesce((select ts from sync_seen s where s.tbl = '{t}' and s.pk = {pk}), {NOW}) from {t}{where}")
        c.execute("insert or ignore into sync_seen(tbl, pk, ts, dev) select tbl, pk, ts, (select dev from sync_ctl) "
                  "from sync_out where op = 'put'")
        c.execute("insert into sync_out(tbl, op, data, ts) select 'watchlog', 'max', "
                  f"json_object('day', day, 'vid', vid, 'secs', secs), {NOW} from watchlog")
        c.execute("insert into sync_out(tbl, op, data, ts) select 'intents', 'ins', "
                  f"json_object('ts', ts, 'intent', intent), {NOW} from intents")

    # ---- writing our file, reading the others

    def push(self, c):
        if not self.mine.exists():
            self.snapshot(c)
            self.mine.touch()  # so a device with nothing to tell yet does not introduce itself again later
        rows = c.execute("select seq, tbl, op, pk, data, ts from sync_out order by seq").fetchall()
        if not rows:
            return 0
        with open(self.mine, "a", encoding="utf-8") as f:
            for seq, tbl, op, pk, data, ts in rows:
                f.write(json.dumps({"seq": seq, "tbl": tbl, "op": op, "pk": pk, "ts": ts,
                                    "data": json.loads(data) if data else None}, separators=(",", ":")) + "\n")
            f.flush()
            os.fsync(f.fileno())
        c.execute("delete from sync_out where seq <= ?", (rows[-1][0],))
        return len(rows)

    def apply(self, c, ch, dev):
        t, op, d = ch["tbl"], ch["op"], ch.get("data") or {}
        if op == "max":
            c.execute("insert into watchlog(day, vid, secs) values(?,?,?) on conflict(day, vid) do update set "
                      "secs = max(secs, excluded.secs)", (d["day"], d["vid"], d["secs"]))
        elif op == "ins":
            c.execute("insert into intents(ts, intent) select ?, ? where not exists "
                      "(select 1 from intents where ts = ? and intent = ?)", (d["ts"], d["intent"]) * 2)
        elif t in TABLES and op in ("put", "del"):
            seen = c.execute("select ts, dev from sync_seen where tbl = ? and pk = ?", (t, ch["pk"])).fetchone()
            if seen and (seen[0], seen[1] or "") >= (ch["ts"], dev):
                return False
            if op == "put":
                cols = [k for k in d if k in self.cols[t]]
                c.execute(f"insert or replace into {t}({', '.join(cols)}) values({', '.join('?' * len(cols))})",
                          [d[k] for k in cols])
            else:
                keys = TABLES[t]
                c.execute(f"delete from {t} where " + " and ".join(f"{k} = ?" for k in keys), json.loads(ch["pk"]))
            c.execute("insert or replace into sync_seen(tbl, pk, ts, dev) values(?,?,?,?)", (t, ch["pk"], ch["ts"], dev))
        return True

    def pull(self, c):
        n = 0
        for f in sorted(self.folder.glob("*.jsonl")):
            dev = f.stem
            if dev == self.dev or ".sync-conflict" in dev:
                continue
            row = c.execute("select off, seq from sync_in where dev = ?", (dev,)).fetchone()
            off, seq = row or (0, 0)
            size = f.stat().st_size
            if size == off:
                continue
            if size < off:  # the file was started over
                off = seq = 0
            with open(f, "rb") as fh:
                fh.seek(off)
                data = fh.read()
            end = data.rfind(b"\n") + 1  # whole lines only
            if not end:
                continue
            c.execute("update sync_ctl set applying = 1")
            for line in data[:end].splitlines():
                try:
                    ch = json.loads(line)
                    if ch["seq"] <= seq:
                        continue
                    n += bool(self.apply(c, ch, dev))
                    seq = ch["seq"]
                except (ValueError, KeyError, TypeError, sqlite3.Error):
                    continue  # a line this version cannot read is skipped, not fatal
            c.execute("update sync_ctl set applying = 0")
            c.execute("insert or replace into sync_in(dev, off, seq, ts) values(?,?,?,?)", (dev, off + end, seq, time.time()))
        return n

    def run_once(self):
        """One pass: write our new changes, then take in the others'. Returns (sent, received)."""
        with self.lock:
            try:
                self.folder.mkdir(parents=True, exist_ok=True)
                c = self.connect()
                try:
                    out = self.push(c)
                    c.commit()
                    got = self.pull(c)
                    c.commit()
                finally:
                    c.close()
                self.error = None
                return out, got
            except (OSError, sqlite3.Error) as e:
                self.error = str(e)
                return 0, 0

    def start(self):
        self.run_once()

        def loop():
            while True:
                time.sleep(INTERVAL)
                self.run_once()
        threading.Thread(target=loop, daemon=True, name="sync").start()

    def status(self):
        c = self.connect()
        try:
            others = [{"dev": r[0], "ts": r[1]} for r in c.execute("select dev, ts from sync_in order by ts desc")]
        finally:
            c.close()
        return {"dev": self.dev, "folder": str(self.folder), "others": others, "error": self.error}
