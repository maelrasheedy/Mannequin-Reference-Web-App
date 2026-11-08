import mediapipe as mp
import cv2
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
from pathlib import Path

from pose_normalization import (
    normalize_mediapipe_pose,
    flatten_pose,
    select_body_joints,
    calculate_joint_angle,
    calculate_body_angles,
)

from cosine_similarity import (
    cosine_similarity,
    compare_poses,
    pose_distance,
)



# CONFIGURATION


MODEL_PATH = "backend/models/pose_landmarker_lite.task"

IMAGE_FOLDER = Path("assets/image_set/set/group_set_b")

# Change this filename whenever you want to test
# a different image from your dataset.
TARGET_IMAGE = "Image_15.jpg"


# MEDIAPIPE SETUP


base_options = python.BaseOptions(
    model_asset_path=MODEL_PATH
)

options = vision.PoseLandmarkerOptions(
    base_options=base_options,
    running_mode=vision.RunningMode.IMAGE,
)


# DRAW DETECTED BODY LANDMARKS

def draw_pose_landmarks(image_path, detector):
    # Load the original image
    image = cv2.imread(str(image_path))

    if image is None:
        print("Could not load image:", image_path)
        return

    # Detect body landmarks using MediaPipe
    mp_image = mp.Image.create_from_file(str(image_path))
    result = detector.detect(mp_image)

    if not result.pose_landmarks:
        print("No pose detected for visualization.")
        return

    # Get the first detected person's landmarks
    landmarks = result.pose_landmarks[0]

    # Get the image dimensions
    height, width = image.shape[:2]

    # Connect the main body joints to show the skeleton
    connections = [
        (11, 12),  # Shoulders
        (11, 13),  # Left upper arm
        (13, 15),  # Left lower arm
        (12, 14),  # Right upper arm
        (14, 16),  # Right lower arm
        (11, 23),  # Left torso
        (12, 24),  # Right torso
        (23, 24),  # Hips
        (23, 25),  # Left thigh
        (25, 27),  # Left lower leg
        (24, 26),  # Right thigh
        (26, 28),  # Right lower leg
    ]

    # Draw blue lines between connected landmarks
    for start, end in connections:
        x1 = int(landmarks[start].x * width)
        y1 = int(landmarks[start].y * height)
        x2 = int(landmarks[end].x * width)
        y2 = int(landmarks[end].y * height)

        cv2.line(image, (x1, y1), (x2, y2), (255, 0, 0), 3)

    # Draw each detected landmark as a green circle
    for landmark in landmarks:
        x = int(landmark.x * width)
        y = int(landmark.y * height)

        cv2.circle(image, (x, y), 6, (0, 255, 0), -1)

    # Save a separate image with the landmarks
    output_path = "pose_landmarks_output.jpg"
    cv2.imwrite(output_path, image)

    print("Landmark visualization saved to:", output_path)




# CHECK BODY LANDMARK CONFIDENCE

def check_landmark_confidence(image_path, detector):

    image = mp.Image.create_from_file(str(image_path))
    result = detector.detect(image)

    if not result.pose_landmarks:
        print("No pose detected for confidence check.")
        return

    landmarks = result.pose_landmarks[0]

    body_landmarks = {
        "Left shoulder": 11,
        "Right shoulder": 12,
        "Left elbow": 13,
        "Right elbow": 14,
        "Left wrist": 15,
        "Right wrist": 16,
        "Left hip": 23,
        "Right hip": 24,
        "Left knee": 25,
        "Right knee": 26,
        "Left ankle": 27,
        "Right ankle": 28,
    }

    print()
    print("Body landmark visibility scores:")

    for name, index in body_landmarks.items():
        visibility = landmarks[index].visibility

        if visibility >= 0.5:
            status = "Higher visibility"
        else:
            status = "Low visibility"

        print(f"{name}: {visibility:.2f} - {status}")

# EXTRACT BODY LANDMARKS


def extract_landmarks(image_path, detector):
    """Detect a person and return 33 (x, y) landmarks."""

    image = mp.Image.create_from_file(str(image_path))

    result = detector.detect(image)

    if not result.pose_landmarks:
        return None

    landmarks = result.pose_landmarks[0]

    pose_coordinates = [
        (landmark.x, landmark.y)
        for landmark in landmarks
    ]

    return pose_coordinates


# EXTRACT EIGHT BODY ANGLES


def extract_body_angles(image_path, detector):
    """Extract all body joint angles."""

    coordinates = extract_landmarks(image_path, detector)

    if coordinates is None:
        return None

    return calculate_body_angles(coordinates)


# EXTRACT KNEE ANGLES


def extract_knee_angles(image_path, detector):
    """Extract the left and right knee angles."""

    coordinates = extract_landmarks(image_path, detector)

    if coordinates is None:
        return None

    left_knee = calculate_joint_angle(
        coordinates[23],
        coordinates[25],
        coordinates[27],
    )

    right_knee = calculate_joint_angle(
        coordinates[24],
        coordinates[26],
        coordinates[28],
    )

    return left_knee, right_knee



# EXTRACT NORMALIZED POSE VECTOR


def extract_pose_vector(image_path, detector):
    """Convert the detected pose into a 24-value vector."""

    coordinates = extract_landmarks(image_path, detector)

    if coordinates is None:
        return None

    normalized_pose = normalize_mediapipe_pose(
        coordinates
    )

    body_joints = select_body_joints(
        normalized_pose
    )

    pose_vector = flatten_pose(
        body_joints
    )

    return pose_vector


# The main test program is defined in the main() function below. It will process all images in the dataset, extract pose vectors and angles, and then compare the target image to all other images using multiple methods.

def main():

    target_path = IMAGE_FOLDER / TARGET_IMAGE

    if not target_path.is_file():
        print("Target image was not found:", target_path)
        return

    # Collect all JPG/JPEG images in the folder.
    image_files = sorted(
        [
            image_path
            for image_path in IMAGE_FOLDER.iterdir()
            if image_path.is_file()
            and image_path.suffix.lower() in (".jpg", ".jpeg")
        ],
        key=lambda path: path.name.lower(),
    )

    print("Target image:", TARGET_IMAGE)
    print("Total images found:", len(image_files))

    reference_vectors = {}
    reference_knee_angles = {}
    reference_body_angles = {}

    with vision.PoseLandmarker.create_from_options(
        options
    ) as detector:

        # Draw the detected landmarks on the target image
        draw_pose_landmarks(target_path, detector)
        
        # Check the visibility of the target image landmarks
        check_landmark_confidence(target_path, detector)

        # Process each image in the dataset.
        for image_file in image_files:

            try:
                vector = extract_pose_vector(
                    image_file,
                    detector,
                )

                body_angles = extract_body_angles(
                    image_file,
                    detector,
                )

                knee_angles = extract_knee_angles(
                    image_file,
                    detector,
                )

                if vector is not None:
                    reference_vectors[image_file.name] = vector

                if body_angles is not None:
                    reference_body_angles[image_file.name] = body_angles

                if (
                    knee_angles is not None
                    and all(
                        angle is not None
                        for angle in knee_angles
                    )
                ):
                    reference_knee_angles[image_file.name] = knee_angles

                if vector is not None:
                    print("Processed:", image_file.name)
                else:
                    print("No pose detected:", image_file.name)

            except Exception as error:
                print(
                    f"Could not process {image_file.name}: {error}"
                )

    print()
    print("Total poses extracted:", len(reference_vectors))
    print(
        "Total body angles extracted:",
        len(reference_body_angles),
    )
    print(
        "Total knee angles extracted:",
        len(reference_knee_angles),
    )

    # Check whether the target image was processed.
    if TARGET_IMAGE not in reference_vectors:
        print("No pose vector found for:", TARGET_IMAGE)
        return

    if TARGET_IMAGE not in reference_body_angles:
        print("No body angles found for:", TARGET_IMAGE)
        return

    if TARGET_IMAGE not in reference_knee_angles:
        print("No knee angles found for:", TARGET_IMAGE)
        return

    # Use Image 15 as the target for ALL comparisons.
    target_vector = reference_vectors[TARGET_IMAGE]

    target_body_angles = reference_body_angles[TARGET_IMAGE]

    target_knee_angles = reference_knee_angles[TARGET_IMAGE]

    # Exclude the target image so it cannot match itself.
    reference_names = [
        name
        for name in reference_vectors
        if name.lower() != TARGET_IMAGE.lower()
    ]

    reference_list = [
        reference_vectors[name]
        for name in reference_names
    ]

    print()
    print("Testing pose matching for:", TARGET_IMAGE)

    print()
    print("Target body angles:", target_body_angles)
    print("Target knee angles:", target_knee_angles)
    print("Target pose vector length:", len(target_vector))

    # The 8 body angles are the left and right shoulders,
    # elbows, hips, and knees.
    body_angle_results = []

    for image_name in reference_names:

        if image_name not in reference_body_angles:
            continue

        angles = reference_body_angles[image_name]

        differences = [
            abs(target_body_angles[joint] - angles[joint])
            for joint in target_body_angles
        ]

        average_difference = (
            sum(differences) / len(differences)
        )

        body_angle_results.append(
            (image_name, average_difference)
        )

    body_angle_results.sort(
        key=lambda result: result[1]
    )

    print()
    print("Top 5 matches using eight body angles:")

    for image_name, difference in body_angle_results[:5]:
        print(
            f"{image_name}: {difference:.2f} degrees"
        )

    # Knee angles

    knee_results = []

    for image_name in reference_names:

        if image_name not in reference_knee_angles:
            continue

        angles = reference_knee_angles[image_name]

        left_difference = abs(
            target_knee_angles[0] - angles[0]
        )

        right_difference = abs(
            target_knee_angles[1] - angles[1]
        )

        average_difference = (
            left_difference + right_difference
        ) / 2

        knee_results.append(
            (image_name, average_difference)
        )

    knee_results.sort(
        key=lambda result: result[1]
    )

    print()
    print("Top 5 matches using knee angles:")

    for image_name, difference in knee_results[:5]:
        print(
            f"{image_name}: {difference:.2f} degrees"
        )

    # Cosine Similarity

    ranked_results = compare_poses(
        target_vector,
        reference_list,
    )

    print()
    print("Top 5 matching reference images:")

    for result in ranked_results[:5]:

        image_index = result["reference_id"] - 1

        image_name = reference_names[image_index]

        print(
            f"{image_name}: "
            f"{result['similarity']:.2f}"
        )

    # Pose distance

    distance_results = []

    for image_name in reference_names:

        reference_vector = reference_vectors[image_name]

        distance = pose_distance(
            target_vector,
            reference_vector,
        )

        distance_results.append({
            "image_name": image_name,
            "distance": distance,
        })

    distance_results.sort(
        key=lambda result: result["distance"]
    )

    print()
    print("Top 5 matches using pose distance:")

    for result in distance_results[:5]:
        print(
            f"{result['image_name']}: "
            f"{result['distance']:.4f}"
        )

   

    combined_results = []

    for image_name in reference_names:

        if image_name not in reference_body_angles:
            continue

        reference_vector = reference_vectors[image_name]

        reference_angles = reference_body_angles[image_name]

        # Calculate cosine similarity
        pose_score = cosine_similarity(
            target_vector,
            reference_vector,
        )

        # Compare all eight joint angles
        angle_differences = [
            abs(
                target_body_angles[joint]
                - reference_angles[joint]
            )
            for joint in target_body_angles
        ]

        average_angle_difference = (
            sum(angle_differences)
            / len(angle_differences)
        )

        # Convert angle difference into a 0 to 1 score
        angle_score = max(
            0.0,
            1.0 - average_angle_difference / 180.0,
        )

        # Keep the cosine score between 0 and 1.
        normalized_pose_score = max(
            0.0,
            min(1.0, pose_score),
        )

        # 50% normalized pose similarity
        # 50% body joint angle similarity
        combined_score = (
            0.50 * normalized_pose_score
            + 0.50 * angle_score
        )

        combined_results.append({
            "image_name": image_name,
            "combined_score": combined_score,
            "pose_score": pose_score,
            "angle_difference": average_angle_difference,
        })

    combined_results.sort(
        key=lambda result: result["combined_score"],
        reverse=True,
    )

    print()
    print("Top 5 combined pose matches:")

    for result in combined_results[:5]:
        print(
            f"{result['image_name']}: "
            f"Combined = {result['combined_score']:.3f}, "
            f"Pose = {result['pose_score']:.3f}, "
            f"Angle difference = "
            f"{result['angle_difference']:.2f} degrees"
        )


#Run the main test program
if __name__ == "__main__":
    main()
