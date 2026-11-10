"""Find the YouTube API key: the YOUTUBE_API_KEY env var if set, else the login keyring.

Store it once with:
    secret-tool store --label="PersonalTube YouTube API key" service personaltube name YOUTUBE_API_KEY
"""
import os
import subprocess


def load():
    """Put the key in os.environ if it can be found. Returns True when a key is available."""
    if os.environ.get("YOUTUBE_API_KEY"):
        return True
    try:
        out = subprocess.run(["secret-tool", "lookup", "service", "personaltube", "name", "YOUTUBE_API_KEY"],
                             capture_output=True, text=True, timeout=10).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return False
    if out:
        os.environ["YOUTUBE_API_KEY"] = out
    return bool(out)
