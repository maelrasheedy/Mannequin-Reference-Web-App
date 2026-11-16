// Use the same hidden-arm detection as our pose validation
import { getOccludedArmSides } from "./pose-validation.js";

// Prepare the MediaPipe landmarks using the same midpoint calculations as our Python code
export function createLandmarkDictionary(landmarks) {

    // Make sure MediaPipe returned all 33 landmarks
    if (!Array.isArray(landmarks) || landmarks.length < 33) {
        throw new Error("Expected 33 MediaPipe landmarks.");
    }

    const lmDict = {};

    // Check whether one arm needs an estimated position
    const hiddenArms = getOccludedArmSides(landmarks);

    // Keep the same rule as pose validation: only one arm may be hidden
    if (hiddenArms.length > 1) {
        throw new Error(
            "Cannot create pose landmarks when both arms are unclear."
        );
    }

    // Keep track of the landmarks allowed to be estimated
    const hiddenArmLandmarks = new Map();

    if (hiddenArms.includes("left")) {
        [13, 15, 17, 19].forEach((index) => {
            hiddenArmLandmarks.set(index, 11);
        });
    }

    if (hiddenArms.includes("right")) {
        [14, 16, 18, 20].forEach((index) => {
            hiddenArmLandmarks.set(index, 12);
        });
    }

    // Store the X, Y, and Z coordinates for each landmark
    landmarks.forEach((landmark, index) => {

        const x = landmark?.x;
        const y = landmark?.y;
        const z = landmark?.z;

        if (![x, y, z].every(Number.isFinite)) {

            // A hidden arm may have missing coordinates.
            // Its pose segments will be estimated in pose-vector.js.
            if (hiddenArmLandmarks.has(index)) {
                return;
            }

            throw new Error(`Invalid landmark at index ${index}.`);
        }

        lmDict[index] = [x, y, z];
    });

    // Keep the dictionary complete when a hidden arm has missing points.
    // These are temporary positions, not real arm measurements.
    // pose-vector.js replaces the hidden arm directions before scoring.
    for (const [index, shoulderIndex] of hiddenArmLandmarks) {

        if (lmDict[index]) {
            continue;
        }

        const shoulder = lmDict[shoulderIndex];

        if (!shoulder) {
            throw new Error(
                `Cannot estimate hidden arm landmark ${index}: shoulder is missing.`
            );
        }

        lmDict[index] = [...shoulder];
    }

    // Find the midpoint between two landmarks
    function midpoint(pointA, pointB) {
        return [
            (pointA[0] + pointB[0]) / 2,
            (pointA[1] + pointB[1]) / 2,
            (pointA[2] + pointB[2]) / 2
        ];
    }

    // Calculate the midpoint between the shoulders
    lmDict["neck_base"] = midpoint(
        lmDict[11],
        lmDict[12]
    );

    // Calculate the midpoint between the hips
    lmDict["pelvis_mid"] = midpoint(
        lmDict[23],
        lmDict[24]
    );

    // Estimate the center of the head using both ears
    lmDict["head_center"] = midpoint(
        lmDict[7],
        lmDict[8]
    );

    // Find the left hand tip using the pinky and index finger
    lmDict["left_hand_tip"] = midpoint(
        lmDict[17],
        lmDict[19]
    );

    // Find the right hand tip using the pinky and index finger
    lmDict["right_hand_tip"] = midpoint(
        lmDict[18],
        lmDict[20]
    );

    return lmDict;
}