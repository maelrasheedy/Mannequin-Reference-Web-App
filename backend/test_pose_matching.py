import unittest
from pose_matching import match_poses


# Test the pose-matching function
class TestPoseMatching(unittest.TestCase):

    # Check that identical poses have a similarity of 1.0
    def test_identical_poses(self):

        target_pose = [
            (0, 0),
            (1, 0),
            (1, 1)
        ]

        reference_poses = [
            [(0, 0), (1, 0), (1, 1)]
        ]

        results = match_poses(target_pose, reference_poses)

        self.assertAlmostEqual(results[0]["similarity"], 1.0)

    # Check that moving or resizing a pose does not change its match
    def test_shifted_and_scaled_poses(self):

        target_pose = [
            (0, 0),
            (1, 0),
            (1, 1)
        ]

        reference_poses = [
            [(5, 5), (7, 5), (7, 7)]
        ]

        results = match_poses(target_pose, reference_poses)

        self.assertAlmostEqual(results[0]["similarity"], 1.0)

    # Check that the most similar pose appears first
    def test_pose_ranking(self):

        target_pose = [
            (0, 0),
            (1, 0),
            (1, 1)
        ]

        reference_poses = [
            [(0, 0), (0, 1), (1, 1)],  # Different pose
            [(0, 0), (1, 0), (1, 1)],  # Identical pose
            [(0, 0), (0, 1), (0, 2)]   # Different pose
        ]

        results = match_poses(target_pose, reference_poses)

        # Reference pose 2 should be ranked first
        self.assertEqual(results[0]["reference_id"], 2)

        # Its similarity score should be 1.0
        self.assertAlmostEqual(results[0]["similarity"], 1.0)

    # Check that a different pose gets a lower similarity score
    def test_different_poses(self):

        target_pose = [
            (0, 0),
            (1, 0),
            (1, 1)
        ]

        reference_poses = [
            [(0, 0), (0, 1), (1, 1)]
        ]

        results = match_poses(target_pose, reference_poses)

        # A different pose should not be a perfect match
        self.assertLess(results[0]["similarity"], 1.0)


            # Check that poses with different landmark counts are rejected
    def test_different_landmark_counts(self):

        target_pose = [
            (0, 0),
            (1, 0),
            (1, 1)
        ]

        reference_poses = [
            [(0, 0), (1, 0)]
        ]

        # Expect a ValueError because the vectors have different lengths
        with self.assertRaises(ValueError):
            match_poses(target_pose, reference_poses)

# Run the tests
if __name__ == "__main__":
    unittest.main()