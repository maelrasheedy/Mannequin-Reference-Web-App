
import os
import json
import uuid
import math
from urllib.parse import quote

import numpy as np
import cv2
import mediapipe as mp

from mediapipe.tasks import python
from mediapipe.tasks.python import vision

# Directory containing this Python script
SCRIPT_DIR = os.path.dirname(
    os.path.abspath(__file__)
)

# Parent directory: Mannequin-Reference-Web-App
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)

# Reference image directories
IMAGE_SET_DIR = os.path.join(
    PROJECT_DIR,
    "assets",
    "image_set"
)

# Metadata output
OUTPUT_DIR = os.path.join(
    PROJECT_DIR,
    "assets",
    "metadata"
)

OUTPUT_JSON = os.path.join(
    OUTPUT_DIR,
    "images-metadata.json"
)

# MediaPipe model stored alongside the Python script
MODEL_PATH = os.path.join(
    SCRIPT_DIR,
    "pose_landmarker_full.task"
)


# ---------------------------------------------------------------------------
# Every image in Cloudinary lives in ONE folder and is named by a number,
# like 000082.jpg
# the script will:
#   - use the number as the image's id        -> "000082"
#   - build the Cloudinary URL from the name  -> .../upload/000082.jpg
# The version part of the URL (v1793512555) is left out on purpose: Cloudinary
# serves the latest version without it, so re-uploading never breaks a link.
CLOUDINARY_BASE_URL = "https://res.cloudinary.com/mb8u8ybo/image/upload/"
CLOUDINARY_EXTENSION = ".jpg"

IMAGE_EXTENSIONS = (
    ".png",
    ".jpg",
    ".jpeg",
    ".webp"
)

# ---------------------------------------------------------------------------
# HOW STRICT TO BE  (lower numbers = more images kept, but noisier angles)
# ---------------------------------------------------------------------------
# "Visibility" is MediaPipe's own confidence (0 to 1) that a body point is
# really visible. Below that, the point is partly a guess.

# 1) Is there a person at all?  (fixes "NO POSE DETECTED")
MIN_DETECTION_CONFIDENCE = 0.3
MIN_PRESENCE_CONFIDENCE = 0.3

# 2) Main body points: ears, shoulders, elbows, wrists, hips, knees, ankles
MIN_VISIBILITY = 0.35

# 3) Hands and feet are small, so MediaPipe is less sure about them
MIN_EXTREMITY_VISIBILITY = 0.2

LANDMARK_NAMES = {
    7: "left ear", 8: "right ear",
    11: "left shoulder", 12: "right shoulder",
    13: "left elbow", 14: "right elbow",
    15: "left wrist", 16: "right wrist",
    17: "left pinky", 18: "right pinky",
    19: "left index finger", 20: "right index finger",
    23: "left hip", 24: "right hip",
    25: "left knee", 26: "right knee",
    27: "left ankle", 28: "right ankle",
    31: "left foot tip", 32: "right foot tip"
}

# ---------------------------------------------------------------------------
# POSE VECTOR SPEC  !!!must stay identical to mannequin/pose-vector.js!!!
# ---------------------------------------------------------------------------
# One entry per body part: the direction of the segment that STARTS at that
# joint. Same 14 names, same order, as SEGMENTS in pose-vector.js.
#
# MediaPipe landmark numbers used:
#   7/8 ears, 11/12 shoulders, 13/14 elbows, 15/16 wrists,
#   17/18 pinkies, 19/20 index fingers, 23/24 hips, 25/26 knees,
#   27/28 ankles, 31/32 foot tips.
# "left" = the PERSON'S left (MediaPipe's convention).

JOINT_SEGMENTS = {
    "torso": ("pelvis_mid", "neck_base"),
    "neck": ("neck_base", "head_center"),

    "left_shoulder": (11, 13),
    "left_elbow": (13, 15),
    "left_wrist": (15, "left_hand_tip"),

    "right_shoulder": (12, 14),
    "right_elbow": (14, 16),
    "right_wrist": (16, "right_hand_tip"),

    "left_hip": (23, 25),
    "left_knee": (25, 27),
    "left_ankle": (27, 31),

    "right_hip": (24, 26),
    "right_knee": (26, 28),
    "right_ankle": (28, 32),
}

REQUIRED_LANDMARKS = [
    7, 8,
    11, 12, 13, 14, 15, 16,
    23, 24, 25, 26, 27, 28
]

EXTREMITY_LANDMARKS = [
    17, 18, 19, 20,
    31, 32
]

# Which MediaPipe points each body part depends on. A part is only written
# to the JSON if ALL of its points are visible enough (see thresholds above).
PART_LANDMARKS = {
    "torso": (11, 12, 23, 24),
    "neck": (11, 12, 7, 8),

    "left_shoulder": (11, 13),
    "left_elbow": (13, 15),
    "left_wrist": (15, 17, 19),

    "right_shoulder": (12, 14),
    "right_elbow": (14, 16),
    "right_wrist": (16, 18, 20),

    "left_hip": (23, 25),
    "left_knee": (25, 27),
    "left_ankle": (27, 31),

    "right_hip": (24, 26),
    "right_knee": (26, 28),
    "right_ankle": (28, 32),
}

#newest addition to keep more images (maryam)
# Shoulders and hips decide which way the body faces (viewpoint
# normalisation), so a photo is dropped if any of them is hidden.
CORE_LANDMARKS = (11, 12, 23, 24)

#newest addition to keep more images (maryam)
# The torso and neck must always be present.
CORE_PARTS = ("torso", "neck")

#newest addition to keep more images (maryam)
# A photo is kept only if at least this many of the 14 parts are reliable.
# Lower = more photos but less to compare. 14 = old behaviour (all or nothing).
MIN_PARTS = 10


def calculate_plane_angles(vector):

    x, y, z = vector

    norm = np.linalg.norm(vector)

    if norm < 1e-8:
        return None

    angle_x = math.degrees(
        math.asin(
            np.clip(x / norm, -1.0, 1.0)
        )
    )

    angle_y = math.degrees(
        math.asin(
            np.clip(y / norm, -1.0, 1.0)
        )
    )

    angle_z = math.degrees(
        math.asin(
            np.clip(z / norm, -1.0, 1.0)
        )
    )

    # "+ 0.0" turns -0.0 into 0.0 so the JSON never contains "-0.0"
    return (
        round(angle_x, 1) + 0.0,
        round(angle_y, 1) + 0.0,
        round(angle_z, 1) + 0.0
    )


def threshold_for(index):
    if index in EXTREMITY_LANDMARKS:
        return MIN_EXTREMITY_VISIBILITY
    return MIN_VISIBILITY


def is_visible(landmarks, index):
    return landmarks[index].visibility >= threshold_for(index)


def reliable_parts(landmarks):
    """Split the 14 parts into (kept, omitted) by visibility of their points."""
    kept = []
    omitted = []

    for part, indices in PART_LANDMARKS.items():
        if all(is_visible(landmarks, i) for i in indices):
            kept.append(part)
        else:
            omitted.append(part)

    return kept, omitted


def core_missing(landmarks):
    """Names of core points (shoulders, hips) that are not visible."""
    return [
        LANDMARK_NAMES[i]
        for i in CORE_LANDMARKS
        if not is_visible(landmarks, i)
    ]


def build_landmark_dictionary(landmarks):
    lm_dict = {
        i: np.array(
            [lm.x, lm.y, lm.z],
            dtype=np.float64
        )
        for i, lm in enumerate(landmarks)
    }

    # Neck midpoint
    lm_dict["neck_base"] = (
        lm_dict[11] + lm_dict[12]
    ) / 2.0

    # Pelvis midpoint
    lm_dict["pelvis_mid"] = (
        lm_dict[23] + lm_dict[24]
    ) / 2.0

    # Head center approximation
    lm_dict["head_center"] = (
        lm_dict[7] + lm_dict[8]
    ) / 2.0

    # Hand direction: halfway between the pinky and index-finger points
    lm_dict["left_hand_tip"] = (
        lm_dict[17] + lm_dict[19]
    ) / 2.0

    lm_dict["right_hand_tip"] = (
        lm_dict[18] + lm_dict[20]
    ) / 2.0

    return lm_dict


# ---------------------------------------------------------------------------
# VIEWPOINT NORMALISATION  !!!must stay identical to bodyYaw/rotateYaw in
# mannequin/pose-vector.js!!!
# ---------------------------------------------------------------------------
# A photo's numbers depend on where the photographer stood. To make matching
# independent of the viewpoint, the whole body is rotated about the vertical
# (y) axis until the line through the shoulders and hips lies along the x
# axis, with the person's LEFT side on +x. Afterwards "forward" always means
# toward the camera (negative z), whichever way the body was turned.

def body_yaw(lm_dict):
    x = (
        (lm_dict[11][0] - lm_dict[12][0])
        + (lm_dict[23][0] - lm_dict[24][0])
    )

    z = (
        (lm_dict[11][2] - lm_dict[12][2])
        + (lm_dict[23][2] - lm_dict[24][2])
    )

    if math.hypot(x, z) < 1e-6:
        return 0.0  # degenerate: leave as is

    return math.atan2(z, x)


def rotate_yaw(vector, yaw):
    c = math.cos(yaw)
    s = math.sin(yaw)

    return np.array([
        vector[0] * c + vector[2] * s,
        vector[1],
        -vector[0] * s + vector[2] * c
    ])


def generate_pose_vector(lm_dict, normalize_yaw=True, allowed_parts=None):
    pose_vector_list = []
    yaw = body_yaw(lm_dict) if normalize_yaw else 0.0

    for joint_name, connection in JOINT_SEGMENTS.items():
        if allowed_parts is not None and joint_name not in allowed_parts:
            continue

        start_id, end_id = connection

        vector = rotate_yaw(
            lm_dict[end_id] - lm_dict[start_id],
            yaw
        )

        angles = calculate_plane_angles(vector)

        # Skip invalid or zero-length segments
        if angles is None:
            continue

        angle_x, angle_y, angle_z = angles

        pose_vector_list.append({
            "name": joint_name,
            "x-plane-angle": angle_x,
            "y-plane-angle": angle_y,
            "z-plane-angle": angle_z
        })

    return pose_vector_list


def discover_reference_images():
    image_records = []
    ignored = []

    print("\nScanning reference images...\n")

    for root, dirs, files in os.walk(IMAGE_SET_DIR):
        dirs.sort()

        for filename in sorted(files):
            if not filename.lower().endswith(IMAGE_EXTENSIONS):
                continue

            image_id = os.path.splitext(filename)[0]

            # Only files named like the Cloudinary ones (digits only)
            if not image_id.isdigit():
                ignored.append(filename)
                continue

            image_records.append({
                "file_path": os.path.join(root, filename),
                "filename": filename,
                "image_id": image_id
            })

    # Same number twice (e.g. a copy in two folders): keep the first
    seen = set()
    unique = []

    for record in image_records:
        if record["image_id"] in seen:
            print(f"Duplicate number, ignoring: {record['file_path']}")
            continue

        seen.add(record["image_id"])
        unique.append(record)

    print(f"Numbered images found: {len(unique)}")

    if ignored:
        print(
            f"Ignored {len(ignored)} files whose names are not numbers "
            f"(e.g. {ignored[0]}). These cannot be linked to Cloudinary."
        )

    return unique


def generate_image_url(image_id):
    return CLOUDINARY_BASE_URL + image_id + CLOUDINARY_EXTENSION


def extract_poses_from_directory():
    # Validate configuration
    if not os.path.isfile(MODEL_PATH):
        raise FileNotFoundError(
            f"MediaPipe model not found: {MODEL_PATH}"
        )

    if not os.path.isdir(IMAGE_SET_DIR):
        raise FileNotFoundError(
            f"Image dataset directory not found: "
            f"{IMAGE_SET_DIR}"
        )

    os.makedirs(
        OUTPUT_DIR,
        exist_ok=True
    )

    image_records = discover_reference_images()
    dataset = []

    if not image_records:
        print("No reference images found.")

        with open(
            OUTPUT_JSON,
            "w",
            encoding="utf-8"
        ) as f:
            json.dump([], f, indent=2)

        return

    # Initialize MediaPipe
    base_options = python.BaseOptions(
        model_asset_path=MODEL_PATH
    )

    options = vision.PoseLandmarkerOptions(
        base_options=base_options,
        running_mode=vision.RunningMode.IMAGE,
        num_poses=1,
        min_pose_detection_confidence=MIN_DETECTION_CONFIDENCE,
        min_pose_presence_confidence=MIN_PRESENCE_CONFIDENCE,
        output_segmentation_masks=False
    )

    successful = 0
    skipped = 0
    duplicates = 0
    seen_poses = {}
    omitted_counts = {}

    print("\nStarting MediaPipe extraction...\n")

    with vision.PoseLandmarker.create_from_options(options) as landmarker:
        for idx, record in enumerate(image_records):
            file_path = record["file_path"]
            filename = record["filename"]

            progress = (
                f"[{idx + 1}/{len(image_records)}]"
            )

            cv_image = cv2.imread(file_path)

            if cv_image is None:
                print(
                    f"{progress} FAILED TO LOAD: {filename}"
                )
                skipped += 1
                continue

            rgb_image = cv2.cvtColor(
                cv_image,
                cv2.COLOR_BGR2RGB
            )

            mp_image = mp.Image(
                image_format=mp.ImageFormat.SRGB,
                data=rgb_image
            )

            try:
                detection_result = landmarker.detect(
                    mp_image
                )
            except Exception as error:
                print(
                    f"{progress} DETECTION ERROR: "
                    f"{filename} - {error}"
                )
                skipped += 1
                continue

            if not detection_result.pose_world_landmarks:
                print(
                    f"{progress} NO POSE DETECTED: "
                    f"{filename}"
                )
                skipped += 1
                continue

            landmarks = (
                detection_result.pose_world_landmarks[0]
            )

            missing_core = core_missing(landmarks)

            if missing_core:
                print(
                    f"{progress} SKIPPED (core not visible): {filename} "
                    f"({', '.join(missing_core)})"
                )
                skipped += 1
                continue

            kept_parts, omitted_parts = reliable_parts(landmarks)

            if (
                len(kept_parts) < MIN_PARTS
                or any(p not in kept_parts for p in CORE_PARTS)
            ):
                print(
                    f"{progress} TOO FEW PARTS ({len(kept_parts)}/14): "
                    f"{filename}"
                )
                skipped += 1
                continue

            lm_dict = build_landmark_dictionary(
                landmarks
            )

            pose_vector_list = generate_pose_vector(
                lm_dict,
                allowed_parts=kept_parts
            )

            if not pose_vector_list:
                print(
                    f"{progress} INVALID POSE VECTORS: "
                    f"{filename}"
                )
                skipped += 1
                continue

            # Exact same pose twice = the same photo uploaded twice
            pose_key = json.dumps(pose_vector_list, sort_keys=True)

            if pose_key in seen_poses:
                print(
                    f"{progress} DUPLICATE OF {seen_poses[pose_key]}: "
                    f"{filename}"
                )
                duplicates += 1
                continue

            seen_poses[pose_key] = record["image_id"]

            image_record = {
                "id": record["image_id"],
                "url": generate_image_url(record["image_id"]),
                "pose_vector": pose_vector_list
            }

            dataset.append(image_record)
            successful += 1

            for part in omitted_parts:
                omitted_counts[part] = omitted_counts.get(part, 0) + 1

            note = (
                f" (left out: {', '.join(omitted_parts)})"
                if omitted_parts else ""
            )

            print(f"{progress} SUCCESS: {filename}{note}")

    with open(
        OUTPUT_JSON,
        "w",
        encoding="utf-8"
    ) as f:
        json.dump(
            dataset,
            f,
            indent=2,
            ensure_ascii=False
        )

    print("\n" + "=" * 55)
    print("REFERENCE IMAGE EXTRACTION COMPLETED")
    print("=" * 55)
    print(f"Images discovered: {len(image_records)}")
    print(f"Successfully processed: {successful}")
    print(f"Skipped images: {skipped}")
    print(f"Duplicate photos removed: {duplicates}")

    if omitted_counts:
        print("\nParts left out of kept photos (most common first):")

        for name, count in sorted(
            omitted_counts.items(),
            key=lambda kv: -kv[1]
        ):
            print(f"  {name}: {count} photos")

    print(f"JSON records generated: {len(dataset)}")
    print(f"\nOutput file: {OUTPUT_JSON}")
    print("=" * 55)


if __name__ == "__main__":
    extract_poses_from_directory()
