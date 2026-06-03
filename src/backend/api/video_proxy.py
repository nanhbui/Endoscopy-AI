"""Low-bitrate playback proxy for library videos.

Library recordings are ~15 Mbps. Streaming them to the browser over a slow
remote link (VPN / ngrok, ~7 Mbps measured) stutters because the link is far
slower than the video bitrate. We transcode a lightweight ~2.5 Mbps 720p H.264
"proxy" (with +faststart for progressive streaming) and serve THAT to the
<video> element.

Detection still runs on the ORIGINAL full-resolution file on the server, so AI
accuracy is unaffected — only the human preview uses the proxy. Bounding-box
overlays are resolution-independent (drawn as % of a 1920x1080 virtual canvas),
so they still align with the lower-resolution proxy.
"""
from __future__ import annotations

import subprocess
import threading
from pathlib import Path

from loguru import logger

_PROXY_SUFFIX = "_proxy.mp4"
_PROXY_HEIGHT = 720          # downscale to 720p (keeps aspect via scale=-2)
_PROXY_VBITRATE = "2500k"    # ~2.5 Mbps << ~7 Mbps link → smooth playback

# De-dupe concurrent builds of the same file.
_building: set[str] = set()
_lock = threading.Lock()


def proxy_path(original: Path) -> Path:
    """Sibling proxy path, e.g. data/library/<id>.mp4 → data/library/<id>_proxy.mp4."""
    return original.with_name(f"{original.stem}{_PROXY_SUFFIX}")


def is_proxy(path: Path) -> bool:
    return path.name.endswith(_PROXY_SUFFIX)


def proxy_ready(original: Path) -> bool:
    p = proxy_path(original)
    return p.exists() and p.stat().st_size > 0


def build_proxy(original: Path) -> bool:
    """Blocking ffmpeg transcode. Writes to a .part file then atomically renames,
    so a half-finished proxy is never served. Returns True on success."""
    if not original.exists() or is_proxy(original):
        return False
    out = proxy_path(original)
    tmp = out.with_name(out.stem + ".part.mp4")
    cmd = [
        "ffmpeg", "-y", "-i", str(original),
        "-vf", f"scale=-2:{_PROXY_HEIGHT}",
        "-c:v", "libx264", "-preset", "veryfast",
        "-b:v", _PROXY_VBITRATE, "-maxrate", "3000k", "-bufsize", "6000k",
        "-movflags", "+faststart",
        "-an",                                  # drop audio (endoscopy has none useful)
        str(tmp),
    ]
    try:
        logger.info("Building playback proxy: {} → {}", original.name, out.name)
        r = subprocess.run(cmd, stdout=subprocess.DEVNULL,
                           stderr=subprocess.PIPE, timeout=3600)
        if r.returncode != 0:
            logger.error("Proxy transcode failed ({}): {}",
                         original.name, r.stderr.decode(errors="ignore")[-500:])
            tmp.unlink(missing_ok=True)
            return False
        tmp.replace(out)
        logger.info("Proxy ready: {} ({:.1f} MB)", out.name, out.stat().st_size / 1e6)
        return True
    except Exception as e:
        logger.error("Proxy transcode error ({}): {}", original.name, e)
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        return False


def ensure_proxy_async(original: Path) -> None:
    """Build the proxy in a background thread if missing. De-duped so the same
    file isn't transcoded twice concurrently."""
    if not original.exists() or is_proxy(original) or proxy_ready(original):
        return
    key = str(original)
    with _lock:
        if key in _building:
            return
        _building.add(key)

    def _run() -> None:
        try:
            build_proxy(original)
        finally:
            with _lock:
                _building.discard(key)

    threading.Thread(target=_run, daemon=True).start()


def playback_path(original: Path) -> Path:
    """Path to serve to the <video> element: the proxy when ready, otherwise the
    original (and kick off a background build so the next playback is smooth)."""
    if proxy_ready(original):
        return proxy_path(original)
    ensure_proxy_async(original)
    return original


def remove_proxy(original: Path) -> None:
    """Delete the proxy alongside its original (used when a library video is deleted)."""
    try:
        proxy_path(original).unlink(missing_ok=True)
    except OSError:
        pass
