#!/usr/bin/env python3
"""
Strip all metadata (EXIF, GPS, XMP, ICC) from images in gallery/images/.

Usage:
    python strip-meta.py            # process all images
    python strip-meta.py -n         # dry run — show what would change, no writes
    python strip-meta.py photo.jpg  # process a single file

Requires: pip install Pillow
"""

import os
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Pillow not installed.  Run:  pip install Pillow")
    sys.exit(1)

GALLERY_IMAGES = Path(__file__).parent / "gallery" / "images"
SUPPORTED = {".jpg", ".jpeg", ".png", ".webp"}


def strip_file(path: Path, dry_run: bool = False) -> None:
    img = Image.open(path)
    orig_mode = img.mode

    # JPEG can't store alpha; flatten if needed
    ext = path.suffix.lower()
    if ext in (".jpg", ".jpeg") and orig_mode in ("RGBA", "LA", "P"):
        img = img.convert("RGB")
        orig_mode = "RGB"

    # Re-build pixel data with no metadata attached
    clean = Image.new(orig_mode, img.size)
    clean.putdata(list(img.getdata()))

    if dry_run:
        print(f"  [dry-run]  {path.name}")
        return

    save_kw: dict = {}
    if ext in (".jpg", ".jpeg"):
        save_kw = dict(format="JPEG", quality=92, optimize=True, progressive=True)
    elif ext == ".png":
        save_kw = dict(format="PNG", optimize=True)
    elif ext == ".webp":
        save_kw = dict(format="WEBP", quality=92, method=6)

    clean.save(path, **save_kw)
    print(f"  stripped   {path.name}")


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    dry_run = "-n" in sys.argv or "--dry-run" in sys.argv

    if args:
        # Single-file mode
        targets = [Path(a) for a in args]
        # If just a filename, assume it's in gallery/images/
        targets = [GALLERY_IMAGES / p if not p.is_absolute() and not p.exists() else p
                   for p in targets]
    else:
        if not GALLERY_IMAGES.exists():
            print(f"Directory not found: {GALLERY_IMAGES}")
            sys.exit(1)
        targets = sorted(p for p in GALLERY_IMAGES.iterdir()
                         if p.suffix.lower() in SUPPORTED)

    if not targets:
        print("No supported images found.")
        return

    label = "[dry-run] " if dry_run else ""
    print(f"{label}Processing {len(targets)} file(s)…\n")

    errors = 0
    for p in targets:
        try:
            strip_file(p, dry_run=dry_run)
        except FileNotFoundError:
            print(f"  NOT FOUND  {p}")
            errors += 1
        except Exception as exc:
            print(f"  ERROR      {p.name}: {exc}")
            errors += 1

    status = "no files written" if dry_run else "done"
    print(f"\n{status}  ({len(targets) - errors} ok, {errors} error(s))")


if __name__ == "__main__":
    main()
