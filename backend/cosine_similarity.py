import math


# Compare two pose vectors using cosine similarity
def cosine_similarity(vector_a, vector_b):

    # Both vectors must have the same number of values
    if len(vector_a) != len(vector_b):
        raise ValueError("Vectors must have the same length.")

    # Calculate the dot product
    dot_product = sum(a * b for a, b in zip(vector_a, vector_b))

    # Calculate the length of each vector
    magnitude_a = math.sqrt(sum(a * a for a in vector_a))
    magnitude_b = math.sqrt(sum(b * b for b in vector_b))

    # Prevent division by zero
    if magnitude_a == 0 or magnitude_b == 0:
        return 0.0

    # Calculate cosine similarity
    similarity = dot_product / (magnitude_a * magnitude_b)

# Keep the result within the valid cosine similarity range
    similarity = max(-1.0, min(1.0, similarity))

    return similarity


# Calculate the average distance between corresponding pose landmarks
def pose_distance(vector_a, vector_b):

    # Both vectors must contain the same number of values
    if len(vector_a) != len(vector_b):
        raise ValueError("Vectors must have the same length.")

    # Each landmark contains an X and Y coordinate
    if len(vector_a) == 0 or len(vector_a) % 2 != 0:
        raise ValueError("Pose vectors must contain X and Y pairs.")

    total_distance = 0.0
    number_of_landmarks = len(vector_a) // 2

    # Compare the corresponding landmarks
    for i in range(0, len(vector_a), 2):
        difference_x = vector_a[i] - vector_b[i]
        difference_y = vector_a[i + 1] - vector_b[i + 1]

        distance = math.sqrt(
            difference_x ** 2 + difference_y ** 2
        )

        total_distance += distance

    # Return the average distance
    return total_distance / number_of_landmarks



# Compare one pose against multiple reference poses
def compare_poses(target_pose, reference_poses):

    results = []

    for i, reference_pose in enumerate(reference_poses):

        # Calculate similarity for each reference pose
        score = cosine_similarity(target_pose, reference_pose)

        # Store the reference ID and its similarity score
        results.append({
            "reference_id": i + 1,
            "similarity": score
        })

    # Sort from highest similarity to lowest
    results.sort(
        key=lambda result: result["similarity"],
        reverse=True
    )

    return results


# Test comparing one pose against multiple reference poses
if __name__ == "__main__":

    # The pose we want to find a match for
    target_pose = [1, 2]

    # Three reference poses to compare
    reference_poses = [
        [1, 2],
        [2, 1],
        [0, 1]
    ]

    # Calculate the similarity scores
    results = compare_poses(target_pose, reference_poses)

    # Display the reference poses from best match to worst match
    for result in results:
        print(
            f"Reference pose {result['reference_id']}: "
            f"{result['similarity']:.2f}"
        )

    # Test a zero vector
    zero_vector = [0, 0]
    test_vector = [1, 2]

    zero_result = cosine_similarity(zero_vector, test_vector)

    print("Zero vector test:", zero_result)

    # Test vectors with different lengths
    try:
        result = cosine_similarity([1, 2, 3], [1, 2])
        print("Different length test:", result)

    except ValueError as error:
        print("Different length test:", error)

            # Test the pose distance function
    pose_a = [0, 0, 1, 1]
    pose_b = [0, 0, 2, 1]

    # Calculate the distance between two poses
    distance = pose_distance(pose_a, pose_b)

    print("Pose distance test:", distance)

    # Compare a pose with itself
    same_distance = pose_distance(pose_a, pose_a)

    print("Same pose distance:", same_distance)