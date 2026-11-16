
// Import the functions used to generate our team's 14-joint pose JSON
import { POSE_JOINT_NAMES } from "./pose-schema.js";
import { JOINT_SEGMENTS } from "./pose-segments.js";
import { calculatePlaneAngles } from "./pose-angles.js";
import { createLandmarkDictionary } from "./pose-landmarks.js";
import {
    validatePoseLandmarks,
    getOccludedArmSides
} from "./pose-validation.js";
import { calculateBodyYaw, rotateYaw } from "./pose-normalization.js";

// Convert MediaPipe's 3D world landmarks into our pose JSON format
export function generateUserPoseJson(worldLandmarks) {

    // Check landmark visibility before calculating joint angles
    if (!validatePoseLandmarks(worldLandmarks)) {
        throw new Error(
            "Pose rejected: one or more required landmarks have low visibility"
        );
    }

    // Check if one arm needs an estimated position
    const hiddenArms = getOccludedArmSides(worldLandmarks);

    // Prepare the landmarks and calculate the neck, head, pelvis, and hand points
    const lmDict = createLandmarkDictionary(worldLandmarks);

    // Calculate body rotation to match the Python dataset normalization
    const bodyYaw = calculateBodyYaw(lmDict);

    const poseVector = [];

    // Use the torso direction for an arm that cannot be seen
    const neckBase = lmDict["neck_base"];
    const pelvisMid = lmDict["pelvis_mid"];

    if (!neckBase || !pelvisMid) {
        throw new Error(
            "Cannot estimate hidden arms: neck or pelvis landmarks are missing"
        );
    }

    const neutralArmDirection = [
        pelvisMid[0] - neckBase[0],
        pelvisMid[1] - neckBase[1],
        pelvisMid[2] - neckBase[2]
    ];

    // Check that the neutral arm direction is usable
    const neutralLength = Math.hypot(...neutralArmDirection);

    if (
        !neutralArmDirection.every(Number.isFinite) ||
        neutralLength < 1e-8
    ) {
        throw new Error(
            "Cannot calculate a valid neutral arm direction"
        );
    }

    // Keep track of the arm segments we had to estimate
    const estimatedSegments = hiddenArms.flatMap((side) => [
        `${side}_shoulder`,
        `${side}_elbow`,
        `${side}_wrist`
    ]);

    const estimatedSegmentNames = new Set(estimatedSegments);

    // Calculate the angles for all 14 body joints
    for (const jointName of POSE_JOINT_NAMES) {

        const segment = JOINT_SEGMENTS[jointName];

        if (!segment) {
            throw new Error(`Missing joint segment: ${jointName}`);
        }

        const [startId, endId] = segment;

        const start = lmDict[startId];
        const end = lmDict[endId];

        // Check whether this segment belongs to a hidden arm
        const isEstimatedArm = estimatedSegmentNames.has(jointName);

        let vector;

        if (isEstimatedArm) {

            // Keep the hidden arm in an estimated neutral position.
            // This also works when its original landmarks are missing.
            vector = [...neutralArmDirection];

        } else {

            // A visible segment needs both landmarks
            if (!start || !end) {
                throw new Error(
                    `Missing landmarks for pose segment: ${jointName}`
                );
            }

            // Find the direction of the segment between two landmarks
            vector = [
                end[0] - start[0],
                end[1] - start[1],
                end[2] - start[2]
            ];
        }

        // Normalize the segment before calculating the three plane angles
        const normalizedVector = rotateYaw(vector, bodyYaw);
        const angles = calculatePlaneAngles(normalizedVector);

        // Reject invalid or zero-length segments instead of
        // returning an incomplete 14-joint pose
        if (
            !angles ||
            angles.length !== 3 ||
            !angles.every(Number.isFinite)
        ) {
            throw new Error(
                `Invalid direction for pose segment: ${jointName}`
            );
        }

        const [angleX, angleY, angleZ] = angles;

        // Add the calculated joint angles to the pose vector
        poseVector.push({
            name: jointName,
            "x-plane-angle": angleX,
            "y-plane-angle": angleY,
            "z-plane-angle": angleZ
        });
    }

    // Make sure Search receives all 14 body segments
    if (poseVector.length !== 14) {
        throw new Error(
            `Incomplete pose JSON: expected 14 segments, got ${poseVector.length}`
        );
    }

    // Show which arm segments were estimated
    if (hiddenArms.length > 0) {
        console.warn(
            "Sketch pose used estimated neutral arms:",
            hiddenArms
        );
    }

    // Return the pose JSON used by the reference-image search
    return {
        pose_vector: poseVector,
        estimated_segments: estimatedSegments
    };
}
