
// Import the functions used to generate our team's 14-joint pose JSON
import { POSE_JOINT_NAMES } from "./pose-schema.js";
import { JOINT_SEGMENTS } from "./pose-segments.js";
import { calculatePlaneAngles } from "./pose-angles.js";
import { createLandmarkDictionary } from "./pose-landmarks.js";
import { validatePoseLandmarks } from "./pose-validation.js";
import { calculateBodyYaw, rotateYaw } from "./pose-normalization.js";

// Convert MediaPipe's 3D world landmarks into our pose JSON format
export function generateUserPoseJson(worldLandmarks) {

    // Check landmark visibility before calculating joint angles
    if (!validatePoseLandmarks(worldLandmarks)) {
        throw new Error("Pose rejected: one or more required landmarks have low visibility");
    }

    // Prepare the landmarks and calculate the neck, head, pelvis, and hand points
    const lmDict = createLandmarkDictionary(worldLandmarks);

    // Calculate body rotation to match the Python dataset normalization
    const bodyYaw = calculateBodyYaw(lmDict);

    const poseVector = [];

    // Calculate the angles for all 14 body joints
    for (const jointName of POSE_JOINT_NAMES) {

        const segment = JOINT_SEGMENTS[jointName];

        if (!segment) {
            throw new Error(`Missing joint segment: ${jointName}`);
        }

        const [startId, endId] = segment;

        const start = lmDict[startId];
        const end = lmDict[endId];

        if (!start || !end) {
            continue;
        }

        // Find the direction of the segment between two landmarks
        const vector = [
            end[0] - start[0],
            end[1] - start[1],
            end[2] - start[2]
        ];

        // Normalize the segment before calculating the three plane angles
        const normalizedVector = rotateYaw(vector, bodyYaw);
        const angles = calculatePlaneAngles(normalizedVector);

        // Skip segments with invalid or zero-length vectors
        if (angles === null) {
            continue;
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

    // Return the pose JSON used by the reference-image search
    return {
        pose_vector: poseVector
    };
}
