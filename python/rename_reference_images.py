"""
Give a folder of new reference photos the numbered names the project uses
(000091.jpg, 000092.jpg, ...), so extract_pose_references.py can use them and
they can be uploaded to Cloudinary under the same numbers.

Your ORIGINAL photos are never touched: this makes numbered COPIES.

Usage (run from the python/ folder):

    python rename_reference_images.py "C:\\path\\to\\new photos" --dry-run
    python rename_reference_images.py "C:\\path\\to\\new photos"

What it does:
  - looks inside the folder you give it (and its sub-folders) for .png, .jpg,
    .jpeg and .webp files
  - copies them, in alphabetical order, into assets/image_set/ as
    <number>.<same extension>, continuing after the highest number already
    there (override with --start)
  - writes python/rename_map.csv: new number -> original file name, so you can
    always find (or credit) the source of any photo
"""

import argparse
import csv
import os
import shutil
import sys

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DEST = os.path.join(PROJECT_DIR, "assets", "image_set")
MAP_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rename_map.csv")
IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp")
DIGITS = 6  # 000091


def highest_existing_number(dest):
    highest = -1
    for root, _dirs, files in os.walk(dest):
        for name in files:
            stem, ext = os.path.splitext(name)
            if ext.lower() in IMAGE_EXTENSIONS and stem.isdigit():
                highest = max(highest, int(stem))
    return highest


def already_copied():
    """Original file names listed in rename_map.csv from earlier runs."""
    done = set()
    if os.path.exists(MAP_PATH):
        with open(MAP_PATH, newline="", encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                done.add(row["original_file"])
    return done


def find_source_images(source):
    found = []
    for root, dirs, files in os.walk(source):
        dirs.sort()
        for name in sorted(files):
            if name.lower().endswith(IMAGE_EXTENSIONS):
                found.append(os.path.join(root, name))
    return found


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", help="folder with the new, oddly named photos")
    parser.add_argument("--dest", default=DEFAULT_DEST,
                        help="where the numbered copies go (default: assets/image_set)")
    parser.add_argument("--start", type=int, default=None,
                        help="first number to use (default: highest existing + 1)")
    parser.add_argument("--dry-run", action="store_true",
                        help="show what would happen without copying anything")
    args = parser.parse_args()

    source = os.path.abspath(args.source)
    dest = os.path.abspath(args.dest)

    if not os.path.isdir(source):
        sys.exit(f"Source folder not found: {source}")
    if os.path.commonpath([source, dest]) == dest:
        sys.exit("The source folder is inside the destination. Put the new photos "
                 "in a separate folder (for example on your Desktop).")

    images = find_source_images(source)
    if not images:
        sys.exit(f"No .png/.jpg/.jpeg/.webp files found in {source}")

    # Skip photos that an earlier run already copied (so running this twice,
    # or adding more photos to the same folder later, never makes duplicates)
    done = already_copied()
    fresh = [p for p in images if os.path.relpath(p, source) not in done]
    if len(fresh) < len(images):
        print(f"Skipping {len(images) - len(fresh)} photos already copied earlier.")
    images = fresh
    if not images:
        sys.exit("Nothing new to copy.")

    start = args.start if args.start is not None else highest_existing_number(dest) + 1
    last = start + len(images) - 1
    print(f"Found {len(images)} photos.")
    print(f"They will be numbered {start:0{DIGITS}d} to {last:0{DIGITS}d}.")

    plan = []
    for offset, path in enumerate(images):
        ext = os.path.splitext(path)[1].lower()
        new_name = f"{start + offset:0{DIGITS}d}{ext}"
        plan.append((new_name, path))

    # Never overwrite anything that is already there
    clashes = [n for n, _ in plan if os.path.exists(os.path.join(dest, n))]
    if clashes:
        sys.exit(f"{len(clashes)} target names already exist (e.g. {clashes[0]}). "
                 "Nothing was copied. Use --start with a higher number.")

    print("\nFirst few:")
    for new_name, path in plan[:5]:
        print(f"  {new_name}  <-  {os.path.relpath(path, source)}")

    if args.dry_run:
        print("\nDry run only: nothing was copied.")
        return

    os.makedirs(dest, exist_ok=True)
    new_file = not os.path.exists(MAP_PATH)
    with open(MAP_PATH, "a", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        if new_file:
            writer.writerow(["new_file", "original_file"])
        for new_name, path in plan:
            shutil.copy2(path, os.path.join(dest, new_name))
            writer.writerow([new_name, os.path.relpath(path, source)])

    print(f"\nCopied {len(plan)} photos into {dest}")
    print(f"Name list saved to {MAP_PATH}")
    print("\nNext: upload the numbered copies to Cloudinary, then run "
          "python extract_pose_references.py")


if __name__ == "__main__":
    main()