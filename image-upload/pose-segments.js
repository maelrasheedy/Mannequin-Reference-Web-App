
// Define the 14 body segments using the same connections as our team's Python code
export const JOINT_SEGMENTS = {

    // Torso and neck
    torso: ["pelvis_mid", "neck_base"],
    neck: ["neck_base", "head_center"],

    // Left arm
    left_shoulder: [11, 13],
    left_elbow: [13, 15],
    left_wrist: [15, "left_hand_tip"],

    // Right arm
    right_shoulder: [12, 14],
    right_elbow: [14, 16],
    right_wrist: [16, "right_hand_tip"],

    // Left leg
    left_hip: [23, 25],
    left_knee: [25, 27],
    left_ankle: [27, 31],

    // Right leg
    right_hip: [24, 26],
    right_knee: [26, 28],
    right_ankle: [28, 32]

};
