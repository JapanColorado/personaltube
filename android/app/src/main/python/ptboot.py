"""Starts the PersonalTube server inside the Android app, from the project folder that Syncthing keeps on the phone."""
import os
import socket
import sys
import threading
import time

_started = False


def start(folder, state, downloads=None, native=None):
    """folder: the synced project folder (server.py, static/, the library, sync/). state: this phone's own state.db.
    downloads: where this phone keeps downloaded videos. native: the app's Kotlin side, which downloads them
    (server.NATIVE)."""
    global _started
    if _started:
        return
    os.environ["PT_STATE"] = state
    if downloads:
        os.environ["PT_DOWNLOADS"] = downloads
    sys.dont_write_bytecode = True  # no __pycache__ in the synced folder
    if folder not in sys.path:
        sys.path.insert(0, folder)
    for name in ("server", "sync", "ytkey"):  # a failed earlier try must not leave half a module behind
        sys.modules.pop(name, None)
    import server
    import uvicorn
    server.NATIVE = native
    cfg = uvicorn.Config(server.app, host="127.0.0.1", port=server.PORT, log_level="warning")
    threading.Thread(target=uvicorn.Server(cfg).run, daemon=True, name="server").start()
    for _ in range(100):
        try:
            socket.create_connection(("127.0.0.1", server.PORT), timeout=1).close()
            break
        except OSError:
            time.sleep(0.1)
    _started = True
