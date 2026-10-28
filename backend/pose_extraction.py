import mediapipe as mp
# Tools for detecting body landmarks in images
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
from pose_normalization import normalize_pose, normalize_mediapipe_pose, flatten_pose, select_body_joints, calculate_joint_angle, calculate_body_angles    # Compare two pose vectors
from cosine_similarity import cosine_similarity, compare_poses, pose_distance
from pathlib import Path



# Location of the trained pose detection model
model_path = "backend/models/pose_landmarker_lite.task"

# Configure MediaPipe to use our model
base_options = python.BaseOptions(
    model_asset_path=model_path
)

# Configure the pose detector for still images
options = vision.PoseLandmarkerOptions(
    base_options=base_options,
    running_mode=vision.RunningMode.IMAGE
)

# Load the pose detection model
with vision.PoseLandmarker.create_from_options(options) as detector:
    print("MediaPipe pose detector loaded successfully!")

        # Location of our reference image
    image_path = "assets/image_set/set/group_set_b/Image_1.jpg"

    # Load the image using MediaPipe
    image = mp.Image.create_from_file(image_path)

    # Display the image dimensions
    print("Image loaded successfully!")
    print("Image width:", image.width)
    print("Image height:", image.height)

        # Detect body landmarks in the reference image
    result = detector.detect(image)

    # Check whether MediaPipe found a person
    if result.pose_landmarks:
        print("Pose detected successfully!")

        # Get the landmarks for the first detected person
        landmarks = result.pose_landmarks[0]

                # Get the coordinates for the left leg
        left_hip = (landmarks[23].x, landmarks[23].y)
        left_knee = (landmarks[25].x, landmarks[25].y)
        left_ankle = (landmarks[27].x, landmarks[27].y)

        # Get the coordinates for the right leg
        right_hip = (landmarks[24].x, landmarks[24].y)
        right_knee = (landmarks[26].x, landmarks[26].y)
        right_ankle = (landmarks[28].x, landmarks[28].y)

        # Calculate both knee angles
        left_knee_angle = calculate_joint_angle(
            left_hip, left_knee, left_ankle
        )

        right_knee_angle = calculate_joint_angle(
            right_hip, right_knee, right_ankle
        )

        # Display the results
        print("Image 1 left knee angle:", left_knee_angle)
        print("Image 1 right knee angle:", right_knee_angle)

        # Display how many landmarks were detected
        print("Number of landmarks:", len(landmarks))
                     # Store the body landmark coordinates
        pose_coordinates = []

        for landmark in landmarks:
            pose_coordinates.append(
                (landmark.x, landmark.y)
            )

        # Display the extracted coordinates
        print("Extracted pose coordinates:", pose_coordinates)
        print("Total coordinate pairs:", len(pose_coordinates))

                # Normalize the extracted body coordinates
        normalized_pose = normalize_mediapipe_pose(pose_coordinates)

        # Display the normalized coordinates
        print("Normalized pose:", normalized_pose)
        print("Total normalized landmarks:", len(normalized_pose))

                # Convert normalized coordinates into a single vector
        pose_vector = flatten_pose(normalized_pose)

        # Display the number of values in the vector
        print("Total values in pose vector:", len(pose_vector))

                # Location of our second reference image
        image_path_2 = "assets/image_set/set/group_set_b/Image_2.jpg"

        # Load the second image using MediaPipe
        image_2 = mp.Image.create_from_file(image_path_2)

        # Display the image dimensions
        print("Second image loaded successfully!")
        print("Second image width:", image_2.width)
        print("Second image height:", image_2.height)

                # Detect body landmarks in the second image
        result_2 = detector.detect(image_2)

        # Check whether MediaPipe found a person
        if result_2.pose_landmarks:
            print("Second image pose detected successfully!")

            # Get the landmarks for the first detected person
            landmarks_2 = result_2.pose_landmarks[0]

            # Display how many landmarks were detected
            print("Second image landmarks:", len(landmarks_2))

                        # Store the second image's body coordinates
            pose_coordinates_2 = []

            for landmark in landmarks_2:
                pose_coordinates_2.append(
                    (landmark.x, landmark.y)
                )

            # Normalize the second image's coordinates
            normalized_pose_2 = normalize_pose(pose_coordinates_2)

            # Convert the normalized coordinates into a vector
            pose_vector_2 = flatten_pose(normalized_pose_2)

            # Display the number of values
            print("Second image vector values:", len(pose_vector_2))

                        # Compare the poses from both reference images
            similarity_score = cosine_similarity(
                pose_vector,
                pose_vector_2
            )

            # Display the similarity score
            print(
                "Similarity between Image 1 and Image 2:",
                round(similarity_score, 2)
            )

                        # Compare Image 1's pose vector with itself
            self_similarity = cosine_similarity(
                pose_vector,
                pose_vector
            )

            print(
                "Image 1 self-similarity:",
                round(self_similarity, 2)
            )

                        # Create a list of reference pose vectors
            reference_poses = [
                pose_vector,
                pose_vector_2
            ]

            # Compare Image 1 against both reference poses
            ranked_results = compare_poses(
                pose_vector,
                reference_poses
            )

            # Display the results from most similar to least similar
            print("Ranked reference images:")

            for result in ranked_results:
                print(
                    f"Reference image {result['reference_id']}: "
                    f"{result['similarity']:.2f}"
                )

        else:
            print("No pose detected in the second image.")

    else:
        print("No pose detected in this image.")

        # Find all reference images in group_set_b
image_folder = Path("assets/image_set/set/group_set_b")

# Create a list of JPG images in the folder
image_files = sorted(image_folder.glob("*.jpg"))

# Display how many images were found
print("Total reference images found:", len(image_files))

# Display the name of each reference image
for image_file in image_files:
    print("Found image:", image_file.name)

# Extract elbow and knee angles from an image
def extract_body_angles(image_path, detector):

    # Load the image using MediaPipe
    image = mp.Image.create_from_file(str(image_path))

    # Detect the person's body landmarks
    result = detector.detect(image)

    # Check whether a person was detected
    if not result.pose_landmarks:
        return None

    # Get the first person's 33 landmarks
    landmarks = result.pose_landmarks[0]

    # Store the X and Y coordinates
    pose_coordinates = []

    for landmark in landmarks:
        pose_coordinates.append(
            (landmark.x, landmark.y)
        )

    # Calculate the four body joint angles
    body_angles = calculate_body_angles(pose_coordinates)

    # Return the elbow and knee angles
    return body_angles


# Extract knee angles from an image
def extract_knee_angles(image_path, detector):

    # Load the image
    image = mp.Image.create_from_file(str(image_path))

    # Detect the body landmarks
    result = detector.detect(image)

    # Return None if no person is detected
    if not result.pose_landmarks:
        return None

    # Get the first person's landmarks
    landmarks = result.pose_landmarks[0]

    # Calculate the left knee angle
    left_knee_angle = calculate_joint_angle(
        (landmarks[23].x, landmarks[23].y),
        (landmarks[25].x, landmarks[25].y),
        (landmarks[27].x, landmarks[27].y)
    )

    # Calculate the right knee angle
    right_knee_angle = calculate_joint_angle(
        (landmarks[24].x, landmarks[24].y),
        (landmarks[26].x, landmarks[26].y),
        (landmarks[28].x, landmarks[28].y)
    )

    # Return both angles
    return left_knee_angle, right_knee_angle


    # Extract a pose vector from a reference image
def extract_pose_vector(image_path, detector):

    # Load the image using MediaPipe
    image = mp.Image.create_from_file(str(image_path))

    # Detect body landmarks in the image
    result = detector.detect(image)

    # Check whether a pose was detected
    if not result.pose_landmarks:
        return None

        # Get the landmarks from the first detected person
    landmarks = result.pose_landmarks[0]

    # Store the X and Y coordinates
    pose_coordinates = []

    for landmark in landmarks:
        pose_coordinates.append(
            (landmark.x, landmark.y)
        )

       # Normalize all 33 landmarks around the hip center
    normalized_pose = normalize_mediapipe_pose(pose_coordinates)

    # Select the 12 main body joints
    body_joints = select_body_joints(normalized_pose)

    # Convert the 12 joints into a vector
    pose_vector = flatten_pose(body_joints)

    # Return the completed pose vector
    return pose_vector

# Test the reusable pose extraction function
if __name__ == "__main__":

    # Create a pose detector
    with vision.PoseLandmarker.create_from_options(options) as detector:

        # Test extracting all four joint angles from Image 1
        body_angles = extract_body_angles(
            "assets/image_set/set/group_set_b/Image_1.jpg",
            detector
        )

        # Display the results
        if body_angles is not None:
            print("Image 1 body angles:", body_angles)
        else:
            print("No body angles detected for Image 1.")
        # Test our reusable knee angle function
        knee_angles = extract_knee_angles(
            "assets/image_set/set/group_set_b/Image_1.jpg",
            detector
        )

        # Display the results
        if knee_angles is not None:
            print("Image 1 knee angles:", knee_angles)
        else:
            print("No knee angles detected for Image 1.")
        # Extract the pose from Image 1
        test_vector = extract_pose_vector(
            "assets/image_set/set/group_set_b/Image_1.jpg",
            detector
        )

        # Check whether extraction worked
        if test_vector is not None:
            print("Reusable function test successful!")
            print("Extracted vector length:", len(test_vector))
        else:
            print("No pose detected in test image.")

        # Store the pose vectors from our reference images
        reference_vectors = {}
        
        # Store knee angles for each reference image
        reference_knee_angles = {}

        # Store all four joint angles for each reference image
        reference_body_angles = {}



        # Process each image in the dataset folder
        for image_file in image_files:
                        # Extract all four joint angles from this image
            body_angles = extract_body_angles(image_file, detector)

            # Store the angles if a person was detected
            if body_angles is not None:
                reference_body_angles[image_file.name] = body_angles
                        # Extract the knee angles from this image
            angles = extract_knee_angles(image_file, detector)

            # Save the angles if they were detected
            if angles is not None and all(angle is not None for angle in angles):
                reference_knee_angles[image_file.name] = angles

            # Extract the pose vector from this image
            vector = extract_pose_vector(image_file, detector)

            # Save the vector if a pose was detected
            if vector is not None:
                reference_vectors[image_file.name] = vector
                print("Processed:", image_file.name)

            else:
                print("No pose found:", image_file.name)

        # Display how many images were processed successfully
        print("Total poses extracted:", len(reference_vectors))

                # Display how many images have four body joint angles
        print("Total body angles extracted:", len(reference_body_angles))

        # Display the four angles for each image
        print("Body angles for reference images:")

        for image_name, angles in reference_body_angles.items():
            print(
                f"{image_name}: "
                f"Left elbow = {angles['left_elbow']:.2f}°, "
                f"Right elbow = {angles['right_elbow']:.2f}°, "
                f"Left knee = {angles['left_knee']:.2f}°, "
                f"Right knee = {angles['right_knee']:.2f}°"
            )

                    # Use Image 1's four joint angles as our target
        target_body_angles = reference_body_angles["image_1.jpg"]

        # Store the matching results
        body_angle_results = []

        # Compare all four angles for every reference image
        for image_name, angles in reference_body_angles.items():

            # Calculate the difference for each joint
            differences = []

            for joint in target_body_angles:
                difference = abs(
                    target_body_angles[joint] - angles[joint]
                )
                differences.append(difference)

            # Calculate the average difference
            average_difference = sum(differences) / len(differences)

            # Save the image name and its difference
            body_angle_results.append((image_name, average_difference))

        # Sort from smallest difference to largest
        body_angle_results.sort(key=lambda result: result[1])

        # Display the five closest matches
        print("Top 5 matches using four body angles:")

        for image_name, difference in body_angle_results[:5]:
            print(f"{image_name}: {difference:.2f} degrees")
            
                # Display how many images have knee angle measurements
        print("Total knee angles extracted:", len(reference_knee_angles))

        # Display the knee angles for each reference image
        print("Knee angles for reference images:")

        for image_name, angles in reference_knee_angles.items():
            print(
                f"{image_name}: "
                f"Left knee = {angles[0]:.2f}°, "
                f"Right knee = {angles[1]:.2f}°"
            )

                    # Use Image 1's knee angles as our target
        target_angles = reference_knee_angles["image_1.jpg"]

        # Store the knee angle differences
        knee_results = []

        # Compare each reference image with the target
        for image_name, angles in reference_knee_angles.items():

            # Calculate the difference for each knee
            left_difference = abs(target_angles[0] - angles[0])
            right_difference = abs(target_angles[1] - angles[1])

            # Calculate the average difference
            average_difference = (left_difference + right_difference) / 2

            # Save the result
            knee_results.append((image_name, average_difference))

        # Rank images from smallest difference to largest
        knee_results.sort(key=lambda result: result[1])

        # Display the five closest matches
        print("Top 5 matches using knee angles:")

        for image_name, difference in knee_results[:5]:
            print(f"{image_name}: {difference:.2f} degrees")

                # Use Image 1 as our target pose
        target_vector = reference_vectors["image_1.jpg"]

        # Get the filenames and pose vectors
        reference_names = list(reference_vectors.keys())
        reference_list = list(reference_vectors.values())

        # Compare the target against all reference poses
        ranked_results = compare_poses(
            target_vector,
            reference_list
        )

        # Display the five closest matches
        print("Top 5 matching reference images:")

        for result in ranked_results[:5]:
            image_index = result["reference_id"] - 1
            image_name = reference_names[image_index]

            print(
                f"{image_name}: "
                f"{result['similarity']:.2f}"
            )

                    # Store the distance results for each reference image
        distance_results = []

        # Compare the target pose with every reference pose
        for image_name, reference_vector in reference_vectors.items():

            distance = pose_distance(
                target_vector,
                reference_vector
            )

            # Save the filename and its distance
            distance_results.append({
                "image_name": image_name,
                "distance": distance
            })

        # Sort from smallest distance to largest distance
        distance_results.sort(
            key=lambda result: result["distance"]
        )

        # Display the five closest matches
        print("Top 5 matches using pose distance:")

        for result in distance_results[:5]:
            print(
                f"{result['image_name']}: "
                f"{result['distance']:.4f}"
            )