"""
Find near-duplicate PHOTOS (not poses) and remove their records from
images-metadata.json.

Why: comparing poses missed your duplicates, because a resized/cropped copy
makes MediaPipe estimate a noticeably different pose. Comparing the pictures
themselves (a "perceptual hash") catches resized, re-compressed, slightly
cropped and mirrored copies.

It never deletes or changes images. It only rewrites the JSON (with a backup).

Usage (run from the python/ folder):
  python remove_image_duplicates.py --report
  python remove_image_duplicates.py --dry-run
  python remove_image_duplicates.py
Options:
  --max-dist 14   two photos are duplicates if their hashes differ by at most
                  this many bits out of 256 (0 = identical, ~128 = unrelated)
  --images DIR    default: ../assets/image_set
  --json PATH     default: ../assets/metadata/images-metadata.json
"""
import argparse
import csv
import json
import shutil
from pathlib import Path

import cv2
import numpy as np

EXTS = (".png", ".jpg", ".jpeg", ".webp")
SIZE = 16  # 16x16 difference hash = 256 bits


def dhash(gray):
    small = cv2.resize(gray, (SIZE + 1, SIZE), interpolation=cv2.INTER_AREA)
    return (small[:, 1:] > small[:, :-1]).flatten()


def hashes_for(path):
    data = np.fromfile(str(path), dtype=np.uint8)  # works with odd Windows paths
    img = cv2.imdecode(data, cv2.IMREAD_GRAYSCALE)
    if img is None:
        return None
    return dhash(img), dhash(cv2.flip(img, 1))  # normal + mirrored


def find_image(folder, image_id):
    for ext in EXTS:
        p = folder / f"{image_id}{ext}"
        if p.exists():
            return p
    return None


def main():
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default=str(here.parent / "assets" / "metadata" / "images-metadata.json"))
    ap.add_argument("--images", default=str(here.parent / "assets" / "image_set"))
    ap.add_argument("--max-dist", type=int, default=14)
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    jpath = Path(args.json)
    folder = Path(args.images)
    records = json.loads(jpath.read_text(encoding="utf-8"))
    print(f"Loaded {len(records)} records; reading photos from {folder}")

    idx, plain, mirror, missing = [], [], [], []
    for k, r in enumerate(records):
        p = find_image(folder, r["id"])
        h = hashes_for(p) if p else None
        if h is None:
            missing.append(r["id"])
            continue
        idx.append(k)
        plain.append(h[0])
        mirror.append(h[1])
    if missing:
        print(f"Could not read {len(missing)} photos (skipped from comparison): {missing[:10]}{' ...' if len(missing) > 10 else ''}")

    P = np.array(plain, dtype=np.uint8)
    M = np.array(mirror, dtype=np.uint8)
    n = len(idx)
    pairs = []
    for a in range(n - 1):
        d_same = (P[a + 1:] != P[a]).sum(axis=1)
        d_flip = (P[a + 1:] != M[a]).sum(axis=1)
        d = np.minimum(d_same, d_flip)
        for off in np.nonzero(d <= 40)[0]:
            pairs.append((int(d[off]), a, a + 1 + int(off), bool(d_flip[off] < d_same[off])))
    pairs.sort()

    if args.report:
        print("\nClosest 40 pairs (bits different out of 256):")
        for d, a, b, flipped in pairs[:40]:
            print(f"  {records[idx[a]]['id']} vs {records[idx[b]]['id']}   distance {d:3d}{'   (mirrored)' if flipped else ''}")
        print("\nOpen a few of these photos side by side. Pick --max-dist just below the "
              "point where the pairs stop being the same picture.")
        return

    removed = {}
    for d, a, b, flipped in pairs:
        if d > args.max_dist:
            break
        ra, rb = idx[a], idx[b]
        if ra in removed or rb in removed:
            continue
        # keep the record with more parts; tie -> lower id
        keep, drop = (ra, rb) if (len(records[ra]["pose_vector"]), -ra) >= (len(records[rb]["pose_vector"]), -rb) else (rb, ra)
        removed[drop] = (keep, d)

    print(f"\nNear-duplicate photos found: {len(removed)} (distance <= {args.max_dist})")
    for drop, (keep, d) in sorted(removed.items()):
        print(f"  remove {records[drop]['id']}  (copy of {records[keep]['id']}, distance {d})")

    if args.dry_run or not removed:
        print("\nDry run / nothing to do: no files changed.")
        return

    backup = jpath.with_name(jpath.stem + "-before-image-dedup.json")
    shutil.copy2(jpath, backup)
    kept = [r for k, r in enumerate(records) if k not in removed]
    jpath.write_text(json.dumps(kept, indent=2), encoding="utf-8")
    with open(here / "image_duplicates_removed.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["removed_id", "kept_id", "hash_distance"])
        for drop, (keep, d) in sorted(removed.items()):
            w.writerow([records[drop]["id"], records[keep]["id"], d])
    print(f"\nWrote {len(kept)} records (was {len(records)}). Backup: {backup.name}. Log: image_duplicates_removed.csv")


if __name__ == "__main__":
    main()