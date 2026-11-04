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

# CDN base URL.
CDN_BASE_URL = "/assets/image_set/"

# Dataset configuration
DATASET_SPLITS = ["set", "val"]

EXPECTED_GROUPS = [
    "group_set_a",
    "group_set_b",
    "group_set_c"
]

IMAGE_EXTENSIONS = (
    ".png",
    ".jpg",
    ".jpeg",
    ".webp"
)

MIN_VISIBILITY = 0.5

# Hands and feet are small in most photos, so MediaPipe is less sure about
# them. They get their own (lower) visibility threshold. Raise it for cleaner
# data, lower it to keep more images.
MIN_EXTREMITY_VISIBILITY = 0.3

# ---------------------------------------------------------------------------
# POSE VECTOR SPEC  (must stay identical to mannequin/pose-vector.js)
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

    "left_shoulder": (11, 13),          # upper arm
    "left_elbow": (13, 15),             # forearm
    "left_wrist": (15, "left_hand_tip"),

    "right_shoulder": (12, 14),
    "right_elbow": (14, 16),
    "right_wrist": (16, "right_hand_tip"),

    "left_hip": (23, 25),               # thigh
    "left_knee": (25, 27),              # shin
    "left_ankle": (27, 31),             # foot

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

def validate_landmarks(landmarks):
    for index in REQUIRED_LANDMARKS:
        visibility = landmarks[index].visibility
        if visibility < MIN_VISIBILITY:
            return False
    for index in EXTREMITY_LANDMARKS:
        visibility = landmarks[index].visibility
        if visibility < MIN_EXTREMITY_VISIBILITY:
            return False
    return True

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
# VIEWPOINT NORMALISATION  (must stay identical to bodyYaw/rotateYaw in
# mannequin/pose-vector.js)
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

def generate_pose_vector(lm_dict, normalize_yaw=True):
    pose_vector_list = []
    yaw = body_yaw(lm_dict) if normalize_yaw else 0.0
    for joint_name, connection in JOINT_SEGMENTS.items():
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
    print("\nScanning reference image directories...\n")
    for split in DATASET_SPLITS:
        split_dir = os.path.join(
            IMAGE_SET_DIR,
            split
        )
        if not os.path.isdir(split_dir):
            print(
                f"WARNING: Missing dataset directory: {split_dir}"
            )
            continue

        for group in EXPECTED_GROUPS:
            group_dir = os.path.join(
                split_dir,
                group
            )
            if not os.path.isdir(group_dir):
                print(
                    f"WARNING: Missing group directory: "
                    f"{split}/{group}"
                )
                continue
            group_count = 0
            for root, dirs, files in os.walk(group_dir):
                dirs.sort()
                for filename in sorted(files):
                    if not filename.lower().endswith(
                        IMAGE_EXTENSIONS
                    ):
                        continue
                    file_path = os.path.join(
                        root,
                        filename
                    )
                    relative_path = os.path.relpath(
                        file_path,
                        IMAGE_SET_DIR
                    ).replace("\\", "/")
                    image_records.append({
                        "file_path": file_path,
                        "filename": filename,
                        "relative_path": relative_path,
                        "split": split,
                        "group": group
                    })
                    group_count += 1
            print(
                f"{split}/{group}: "
                f"{group_count} images found"
            )
    print(
        f"\nTotal reference images discovered: "
        f"{len(image_records)}"
    )
    return image_records
def generate_image_url(relative_path):
    encoded_path = quote(
        relative_path,
        safe="/"
    )
    return (
        CDN_BASE_URL.rstrip("/")
        + "/"
        + encoded_path
    )
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
        num_poses= 1,
        min_pose_detection_confidence=0.5,
        min_pose_presence_confidence=0.5,
        output_segmentation_masks=False
    )
    successful = 0
    skipped = 0
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
            if not validate_landmarks(landmarks):
                print(
                    f"{progress} LOW VISIBILITY: "
                    f"{filename}"
                )
                skipped += 1
                continue
            lm_dict = build_landmark_dictionary(
                landmarks
            )
            pose_vector_list = generate_pose_vector(
                lm_dict
            )
            if not pose_vector_list:
                print(
                    f"{progress} INVALID POSE VECTORS: "
                    f"{filename}"
                )
                skipped += 1
                continue
            image_record = {
                "id": uuid.uuid4().hex,
                "url": generate_image_url(
                    record["relative_path"]
                ),
                "split": record["split"],
                "group": record["group"],
                "pose_vector": pose_vector_list
            }
            dataset.append(image_record)
            successful += 1
            print(
                f"{progress} SUCCESS: "
                f"{record['split']}/"
                f"{record['group']}/"
                f"{filename}"
            )
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
    print(f"JSON records generated: {len(dataset)}")
    print(f"\nOutput file: {OUTPUT_JSON}")
    print("=" * 55)

if __name__ == "__main__":
    extract_poses_from_directory()