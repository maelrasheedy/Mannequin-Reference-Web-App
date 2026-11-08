from pose_normalization import normalize_pose, flatten_pose
from cosine_similarity import compare_poses

# These line lets us compare a target pose against multiple reference poses
def match_poses(target_pose, reference_poses):

    # Normalize the target pose
    normalized_target = normalize_pose(target_pose)

    # Convert the target pose into a flat vector
    target_vector = flatten_pose(normalized_target)

    # Store the normalized reference vectors
    reference_vectors = []

    # Normalize each reference pose
    for reference_pose in reference_poses:
        normalized_reference = normalize_pose(reference_pose)

        # Convert the reference pose into a flat vector
        reference_vector = flatten_pose(normalized_reference)

        # Add the vector to our list
        reference_vectors.append(reference_vector)

    # Compare and rank the normalized vectors
    results = compare_poses(target_vector, reference_vectors)

    return results

    # Test matching one pose against multiple reference poses
if __name__ == "__main__":

    # The pose we want to find matches for
    target_pose = [
        (0, 0),
        (1, 0),
        (1, 1)
    ]

    # Three reference poses
    reference_poses = [
        [(0, 0), (1, 0), (1, 1)],   # Same pose
        [(0, 0), (0, 1), (1, 1)],   # Different pose
        [(5, 5), (7, 5), (7, 7)]    # Same pose, larger and shifted
    ]

    # Compare and rank the poses
    results = match_poses(target_pose, reference_poses)

    # Display the ranked results
    for result in results:
        print(
            f"Reference pose {result['reference_id']}: "
            f"{result['similarity']:.2f}"
        )