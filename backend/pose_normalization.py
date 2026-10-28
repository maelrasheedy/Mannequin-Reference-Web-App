import math
from cosine_similarity import cosine_similarity

# Normalize pose landmarks for position and scale
def normalize_pose(landmarks):

    if not landmarks:
        raise ValueError("No landmarks provided.")

    # Use the first landmark as the reference point
    reference_x, reference_y = landmarks[0]

    centered_landmarks = []

    # Remove differences in position
    for x, y in landmarks:
        new_x = x - reference_x
        new_y = y - reference_y

        centered_landmarks.append((new_x, new_y))

    # Find the distance to the farthest landmark
    scale = max(
        math.sqrt(x * x + y * y)
        for x, y in centered_landmarks
    )

    # Handle poses where all landmarks are identical
    if scale == 0:
        return centered_landmarks

    # Remove differences in size
    normalized_landmarks = []

    for x, y in centered_landmarks:
        normalized_landmarks.append(
            (x / scale, y / scale)
        )

    return normalized_landmarks

# Normalize MediaPipe poses using the center of the hips
def normalize_mediapipe_pose(landmarks):

    # MediaPipe should provide 33 body landmarks
    if len(landmarks) != 33:
        raise ValueError("MediaPipe poses must have 33 landmarks.")

    # Get the left and right hip coordinates
    left_hip_x, left_hip_y = landmarks[23]
    right_hip_x, right_hip_y = landmarks[24]

    # Calculate the midpoint between the hips
    reference_x = (left_hip_x + right_hip_x) / 2
    reference_y = (left_hip_y + right_hip_y) / 2

    # Move the hip center to (0, 0)
    centered_landmarks = []

    for x, y in landmarks:
        centered_landmarks.append(
            (x - reference_x, y - reference_y)
        )

    # Find the distance to the farthest landmark
    scale = max(
        math.sqrt(x * x + y * y)
        for x, y in centered_landmarks
    )

    # Avoid dividing by zero
    if scale == 0:
        return centered_landmarks

    # Normalize the size of the pose
    normalized_landmarks = []

    for x, y in centered_landmarks:
        normalized_landmarks.append(
            (x / scale, y / scale)
        )

    return normalized_landmarks

# Convert landmark coordinates into a single vector
def flatten_pose(landmarks):

    vector = []

    for x, y in landmarks:
        vector.append(x)
        vector.append(y)

    return vector


# MediaPipe landmark indices for the main body joints
BODY_JOINT_INDICES = [
    11, 12,  # Left and right shoulders
    13, 14,  # Left and right elbows
    15, 16,  # Left and right wrists
    23, 24,  # Left and right hips
    25, 26,  # Left and right knees
    27, 28   # Left and right ankles
]

# Select the main body joints from MediaPipe landmarks
def select_body_joints(landmarks):

    # MediaPipe provides 33 landmarks
    if len(landmarks) != 33:
        raise ValueError("MediaPipe poses must have 33 landmarks.")

    # Store the selected body joints
    body_joints = []

    # Get the coordinates for each important joint
    for index in BODY_JOINT_INDICES:
        body_joints.append(landmarks[index])

    # Return the 12 selected joints
    return body_joints

# Calculate the angle formed by three body joints
def calculate_joint_angle(point_a, point_b, point_c):

    # Create two vectors starting from the middle joint
    vector_a = (
        point_a[0] - point_b[0],
        point_a[1] - point_b[1]
    )

    vector_c = (
        point_c[0] - point_b[0],
        point_c[1] - point_b[1]
    )

    # Calculate the dot product
    dot_product = (
        vector_a[0] * vector_c[0]
        + vector_a[1] * vector_c[1]
    )

    # Calculate the length of each vector
    magnitude_a = math.sqrt(vector_a[0] ** 2 + vector_a[1] ** 2)
    magnitude_c = math.sqrt(vector_c[0] ** 2 + vector_c[1] ** 2)

    # Avoid division by zero
    if magnitude_a == 0 or magnitude_c == 0:
        return None

    # Calculate cosine of the angle
    cosine_angle = dot_product / (magnitude_a * magnitude_c)

    # Keep the value between -1 and 1 to avoid rounding errors
    cosine_angle = max(-1.0, min(1.0, cosine_angle))

    # Convert the angle from radians to degrees
    angle = math.degrees(math.acos(cosine_angle))

    return angle

# Calculate the main arm and leg joint angles

def calculate_body_angles(landmarks):
    # MediaPipe provides 33 landmarks
    if len(landmarks) != 33:
        raise ValueError("MediaPipe poses must have 33 landmarks.")

    # Calculate shoulder angles
    left_shoulder = calculate_joint_angle(
        landmarks[13], landmarks[11], landmarks[23]
    )

    right_shoulder = calculate_joint_angle(
        landmarks[14], landmarks[12], landmarks[24]
    )

    # Calculate elbow angles
    left_elbow = calculate_joint_angle(
        landmarks[11], landmarks[13], landmarks[15]
    )

    right_elbow = calculate_joint_angle(
        landmarks[12], landmarks[14], landmarks[16]
    )

    # Calculate hip angles
    left_hip = calculate_joint_angle(
        landmarks[11], landmarks[23], landmarks[25]
    )

    right_hip = calculate_joint_angle(
        landmarks[12], landmarks[24], landmarks[26]
    )

    # Calculate knee angles
    left_knee = calculate_joint_angle(
        landmarks[23], landmarks[25], landmarks[27]
    )

    right_knee = calculate_joint_angle(
        landmarks[24], landmarks[26], landmarks[28]
    )

    # Return all eight body joint angles
    return {
        "left_shoulder": left_shoulder,
        "right_shoulder": right_shoulder,
        "left_elbow": left_elbow,
        "right_elbow": right_elbow,
        "left_hip": left_hip,
        "right_hip": right_hip,
        "left_knee": left_knee,
        "right_knee": right_knee
    }

# Test normalization with two poses
if __name__ == "__main__":

    pose_a = [(4, 2), (5, 3), (6, 4)]
    pose_b = [(0, 0), (2, 2), (4, 4)]

    # Normalize both poses
    normalized_a = normalize_pose(pose_a)
    normalized_b = normalize_pose(pose_b)

    print("Pose A:", normalized_a)
    print("Pose B:", normalized_b)

    print("Same normalized pose:", normalized_a == normalized_b)

    # Convert the normalized landmarks into a flat vector
    flat_pose = flatten_pose(normalized_a)

    # Display the result
    print("Flattened pose:", flat_pose)

    # Convert both normalized poses into vectors
    vector_a = flatten_pose(normalized_a)
    vector_b = flatten_pose(normalized_b)

    # Calculate the cosine similarity
    similarity = cosine_similarity(vector_a, vector_b)

    # Display the similarity score
    print("Normalized pose similarity:", similarity)

        # Test selecting the main body joints
    test_landmarks = [(i, i) for i in range(33)]

    # Select the 12 important joints
    selected_joints = select_body_joints(test_landmarks)

    # Display the results
    print("Total selected body joints:", len(selected_joints))
    print("Selected body joints:", selected_joints)

        # Test a straight knee (180 degrees)
    straight_angle = calculate_joint_angle(
        (0, 0),
        (1, 0),
        (2, 0)
    )

    # Test a bent knee (90 degrees)
    bent_angle = calculate_joint_angle(
        (0, 0),
        (1, 0),
        (1, 1)
    )

    print("Straight knee angle:", straight_angle)
    print("Bent knee angle:", bent_angle)

        # Create 33 test landmarks
    test_landmarks = [(0, 0)] * 33

    # Left arm bent at 90 degrees
    test_landmarks[11] = (0, 0)  # Left shoulder
    test_landmarks[13] = (1, 0)  # Left elbow
    test_landmarks[15] = (1, 1)  # Left wrist

    # Right arm straight at 180 degrees
    test_landmarks[12] = (0, 0)  # Right shoulder
    test_landmarks[14] = (1, 0)  # Right elbow
    test_landmarks[16] = (2, 0)  # Right wrist

    # Left leg bent at 90 degrees
    test_landmarks[23] = (0, 0)  # Left hip
    test_landmarks[25] = (1, 0)  # Left knee
    test_landmarks[27] = (1, 1)  # Left ankle

    # Right leg straight at 180 degrees
    test_landmarks[24] = (0, 0)  # Right hip
    test_landmarks[26] = (1, 0)  # Right knee
    test_landmarks[28] = (2, 0)  # Right ankle

    # Calculate all four angles
    body_angles = calculate_body_angles(test_landmarks)

    print("Test body angles:", body_angles)