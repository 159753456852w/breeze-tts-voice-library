"""Build/check the public index from actual WAV filenames. Python standard library only."""
from pathlib import Path
from urllib.parse import quote
import argparse
import hashlib
import json
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = 1000
MAX_FILE_BYTES = 100 * 1024 * 1024


def load(path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def wav_info(path):
    """Read PCM / IEEE float RIFF headers without transcoding or changing bytes."""
    size = path.stat().st_size
    if size > MAX_FILE_BYTES:
        raise ValueError(f"Exceeds GitHub 100 MiB file limit: {path.name} ({size} bytes)")
    with path.open("rb") as stream:
        header = stream.read(12)
        if len(header) != 12 or header[:4] != b"RIFF" or header[8:] != b"WAVE":
            raise ValueError(f"Not a RIFF WAV: {path.name}")
        fmt = None
        data_bytes = 0
        while stream.tell() + 8 <= size:
            kind, length = struct.unpack("<4sI", stream.read(8))
            start = stream.tell()
            if start + length > size:
                raise ValueError(f"Truncated WAV chunk: {path.name}")
            if kind == b"fmt ":
                chunk = stream.read(length)
                if len(chunk) < 16:
                    raise ValueError(f"Invalid WAV format: {path.name}")
                fmt = struct.unpack("<HHIIHH", chunk[:16])
                if fmt[0] not in (1, 3, 65534):
                    raise ValueError(f"Unsupported WAV encoding: {path.name}")
            elif kind == b"data":
                data_bytes += length
            stream.seek(start + length + length % 2)
    if not fmt or fmt[1] <= 0 or fmt[2] != 24000 or fmt[4] <= 0 or data_bytes <= 0:
        raise ValueError(f"Invalid or empty 24 kHz WAV: {path.name}")
    if data_bytes % fmt[4]:
        raise ValueError(f"Incomplete audio frame: {path.name}")
    return {"duration": round(data_bytes / fmt[4] / fmt[2], 5),
            "sample_rate": fmt[2], "channels": fmt[1], "bytes": size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def build_index(root=ROOT, expected=EXPECTED):
    files = sorted((root / "output").glob("*"), key=lambda p: p.name.casefold())
    files = [p for p in files if p.is_file() and p.suffix.lower() == ".wav"]
    if len(files) != expected:
        raise ValueError(f"Expected {expected} WAVs, found {len(files)}")
    source = load(root / "metadata/voices-source.json", [])
    by_file = {r["filename"]: r for r in source if r.get("filename")}
    by_id = {str(r["id"]): r for r in source if r.get("id")}
    manifest = {r["filename"]: r for r in load(root / "metadata/audio-manifest.json", [])}
    voices = []
    for path in files:
        if path.is_symlink() or not path.resolve().is_relative_to((root / "output").resolve()):
            raise ValueError(f"Audio must be a real file inside output/: {path.name}")
        info = wav_info(path)
        baseline = manifest.get(path.name)
        if baseline and (baseline["sha256"] != info["sha256"] or baseline["bytes"] != info["bytes"]):
            raise ValueError(f"Original WAV changed: {path.name}")
        row = by_file.get(path.name, by_id.get(path.stem, {}))
        voices.append({"id": str(row.get("id") or path.stem), "filename": path.name,
                       "audio": "output/" + quote(path.name, safe=""),
                       "description": row.get("description") or "尚未提供聲音描述。",
                       "original_description": row.get("original_description") or "",
                       "voice_profile": row.get("voice_profile") or {},
                       "coverage_category": row.get("coverage_category") or "",
                       "media_type": row.get("media_type") or "", "available": True, **info})
    if len({v["id"] for v in voices}) != len(voices):
        raise ValueError("Duplicate voice IDs")
    return {"schema_version": 1, "total": len(voices), "available": len(voices),
            "format": "WAV", "sample_rate": 24000, "total_bytes": sum(v["bytes"] for v in voices),
            "test_text": "你好，我是你的專屬虛擬角色，很高興認識你！", "voices": voices}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Validate every WAV and compare committed index")
    args = parser.parse_args()
    try:
        index = build_index()
        dest = ROOT / "data/voices.json"
        if args.check:
            if load(dest, None) != index:
                raise ValueError("Index is stale; run python scripts/generate_voice_index.py and commit data/voices.json")
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        print(f"OK: {index['total']} WAVs; {index['total_bytes']:,} bytes; all paths and hashes verified.")
    except (ValueError, OSError, KeyError, json.JSONDecodeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
