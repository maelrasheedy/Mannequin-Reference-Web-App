
// Define the 14 joints in the same order as our team's Python dataset
export const POSE_JOINT_NAMES = [
    "torso",
    "neck",

    "left_shoulder",
    "left_elbow",
    "left_wrist",

    "right_shoulder",
    "right_elbow",
    "right_wrist",

    "left_hip",
    "left_knee",
    "left_ankle",

    "right_hip",
    "right_knee",
    "right_ankle"
];

// MediaPipe landmark numbers for the wrists and ankles
export const EXTRA_LANDMARK_INDICES = {
    left_wrist: 15,
    right_wrist: 16,
    left_ankle: 27,
    right_ankle: 28
};
