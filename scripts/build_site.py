"""Stage only public static assets. Never run TTS or include local generation state."""
from pathlib import Path
import json
import shutil
from generate_voice_index import ROOT, build_index, load


def main():
    index = build_index()
    if load(ROOT / "data/voices.json", None) != index:
        raise ValueError("Committed index is stale; regenerate before deployment")
    dest = ROOT / "_site"
    # Refuse a nonempty staging folder, avoiding stale files and recursive deletion.
    if dest.exists() and any(dest.iterdir()):
        raise ValueError("_site is not empty. Use a fresh checkout or rename the old _site before building.")
    dest.mkdir(exist_ok=True)
    for name in ["index.html", ".nojekyll", "THIRD_PARTY.md"]:
        shutil.copy2(ROOT / name, dest / name)
    for name in ["assets", "data", "output"]:
        source = ROOT / name
        for path in source.rglob("*"):
            if path.is_symlink():
                raise ValueError(f"Symlinks are not allowed in deployment: {path}")
        shutil.copytree(source, dest / name)
    paths = [p for p in dest.rglob("*") if p.is_file()]
    size = sum(p.stat().st_size for p in paths)
    if size >= 1_000_000_000:
        raise ValueError(f"Site exceeds conservative GitHub Pages 1 GB budget: {size} bytes")
    result = {"wav_count": index["total"], "site_bytes": size, "file_count": len(paths),
              "max_wav_bytes": max(v["bytes"] for v in index["voices"]), "index_paths_verified": True}
    print(json.dumps(result, indent=2))
    return result


if __name__ == "__main__":
    main()
