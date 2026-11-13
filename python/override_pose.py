"""
Replace one reference photo's pose_vector with a hand-made one
(for example, copied from the mannequin).

Usage (from the python/ folder):
  python override_pose.py 000123 my_pose.json

my_pose.json must contain the pose_vector array copied from the browser
console, e.g. the output of:  copy(JSON.stringify(currentUserPose.pose_vector))

It checks the new pose has all 14 parts with numeric angles, saves a backup
of the metadata, and notes the override in python/manual_overrides.txt so you
remember it (re-running the extractor would overwrite it).
"""
import json
import shutil
import sys
from datetime import date
from pathlib import Path

PARTS = [
    "torso", "neck",
    "left_shoulder", "left_elbow", "left_wrist",
    "right_shoulder", "right_elbow", "right_wrist",
    "left_hip", "left_knee", "left_ankle",
    "right_hip", "right_knee", "right_ankle",
]
AXES = ("x-plane-angle", "y-plane-angle", "z-plane-angle")


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    image_id, pose_file = sys.argv[1], Path(sys.argv[2])
    here = Path(__file__).resolve().parent
    meta = here.parent / "assets" / "metadata" / "images-metadata.json"

    # utf-8-sig also accepts files that PowerShell saved with a BOM
    new_pose = json.loads(pose_file.read_text(encoding="utf-8-sig"))
    if isinstance(new_pose, dict) and "pose_vector" in new_pose:
        new_pose = new_pose["pose_vector"]

    names = [p.get("name") for p in new_pose]
    if sorted(names) != sorted(PARTS):
        sys.exit(f"The pose must have exactly these 14 parts.\nFound: {names}")
    for p in new_pose:
        for a in AXES:
            if not isinstance(p.get(a), (int, float)):
                sys.exit(f"{p['name']} is missing a numeric {a}")
    new_pose = [
        {"name": p["name"], **{a: round(float(p[a]), 1) for a in AXES}}
        for p in sorted(new_pose, key=lambda p: PARTS.index(p["name"]))
    ]

    records = json.loads(meta.read_text(encoding="utf-8"))
    target = next((r for r in records if r["id"] == image_id), None)
    if target is None:
        sys.exit(f"No record with id {image_id} in {meta}")

    shutil.copy2(meta, meta.with_name(meta.stem + "-before-override.json"))
    target["pose_vector"] = new_pose
    meta.write_text(json.dumps(records, indent=2), encoding="utf-8")

    with open(here / "manual_overrides.txt", "a", encoding="utf-8") as f:
        f.write(f"{date.today()}  {image_id}  pose replaced by hand\n")
    print(f"Replaced the pose for {image_id}. Backup: {meta.stem}-before-override.json")


if __name__ == "__main__":
    main()