
// Use our team's Python visibility requirements with a small ankle allowance
const MIN_VISIBILITY = 0.5;
const MIN_EXTREMITY_VISIBILITY = 0.3;

// Give the ankles a small allowance when they are harder to see
const MIN_ANKLE_VISIBILITY = 0.45;

// Landmarks needed to calculate the main body joints
const REQUIRED_LANDMARKS = [
    7, 8,
    11, 12, 13, 14, 15, 16,
    23, 24, 25, 26, 27, 28
];

// Hand and foot landmarks have a lower visibility requirement
const EXTREMITY_LANDMARKS = [
    17, 18, 19, 20,
    31, 32
];

// Make sure a landmark has valid 3D coordinates
function hasValidCoordinates(landmark) {
    return (
        landmark !== null &&
        landmark !== undefined &&
        Number.isFinite(landmark.x) &&
        Number.isFinite(landmark.y) &&
        Number.isFinite(landmark.z)
    );
}

// Find an arm that is hidden in the uploaded image
export function getOccludedArmSides(landmarks) {
    if (!Array.isArray(landmarks) || landmarks.length < 33) {
        return [];
    }

    const hiddenArms = [];

    const armLandmarks = {
        left: [
            [13, MIN_VISIBILITY],
            [15, MIN_VISIBILITY],
            [17, MIN_EXTREMITY_VISIBILITY],
            [19, MIN_EXTREMITY_VISIBILITY]
        ],
        right: [
            [14, MIN_VISIBILITY],
            [16, MIN_VISIBILITY],
            [18, MIN_EXTREMITY_VISIBILITY],
            [20, MIN_EXTREMITY_VISIBILITY]
        ]
    };

    for (const [side, joints] of Object.entries(armLandmarks)) {
        const hasHiddenJoint = joints.some(([index, minimum]) => {
            const landmark = landmarks[index];
            const visibility = landmark?.visibility;

            // An arm is unreliable if a landmark is hidden
            // or its 3D position cannot be calculated safely.
            return (
                !Number.isFinite(visibility) ||
                visibility < minimum ||
                !hasValidCoordinates(landmark)
            );
        });

        if (hasHiddenJoint) {
            hiddenArms.push(side);
        }
    }

    return hiddenArms;
}

// Check that the detected landmarks meet our visibility requirements
export function validatePoseLandmarks(landmarks) {

    // Make sure MediaPipe returned all 33 landmarks
    if (!Array.isArray(landmarks) || landmarks.length < 33) {
        return false;
    }

    // save which landmarks are failing so we know what to fix
    const failedLandmarks = [];

    // Allow one hidden arm but keep checking the rest of the body
    const hiddenArms = getOccludedArmSides(landmarks);

    if (hiddenArms.length > 1) {
        console.warn("Both arms are unclear in the uploaded image.");
        return false;
    }

    const ignoredLandmarks = new Set();

    if (hiddenArms.includes("left")) {
        [13, 15, 17, 19].forEach((index) => {
            ignoredLandmarks.add(index);
        });
    }

    if (hiddenArms.includes("right")) {
        [14, 16, 18, 20].forEach((index) => {
            ignoredLandmarks.add(index);
        });
    }

    // Main body landmarks need 50% visibility, except ankles
    for (const index of REQUIRED_LANDMARKS) {

        if (ignoredLandmarks.has(index)) {
            continue;
        }

        const landmark = landmarks[index];
        const visibility = landmark?.visibility;

        // Use a slightly lower visibility limit for both ankles
        const requiredVisibility = (index === 27 || index === 28)
            ? MIN_ANKLE_VISIBILITY
            : MIN_VISIBILITY;

        const validVisibility = (
            Number.isFinite(visibility) &&
            visibility >= requiredVisibility
        );

        const validCoordinates = hasValidCoordinates(landmark);

        // Reject visible body parts that lack reliable measurements
        if (!validVisibility || !validCoordinates) {
            failedLandmarks.push({
                index,
                visibility: visibility ?? "missing",
                required: requiredVisibility,
                reason: !validCoordinates
                    ? "invalid or missing coordinates"
                    : "low visibility"
            });
        }
    }

    // Hand and foot landmarks must have at least 30% visibility
    for (const index of EXTREMITY_LANDMARKS) {

        if (ignoredLandmarks.has(index)) {
            continue;
        }

        const landmark = landmarks[index];
        const visibility = landmark?.visibility;

        const validVisibility = (
            Number.isFinite(visibility) &&
            visibility >= MIN_EXTREMITY_VISIBILITY
        );

        const validCoordinates = hasValidCoordinates(landmark);

        if (!validVisibility || !validCoordinates) {
            failedLandmarks.push({
                index,
                visibility: visibility ?? "missing",
                required: MIN_EXTREMITY_VISIBILITY,
                reason: !validCoordinates
                    ? "invalid or missing coordinates"
                    : "low visibility"
            });
        }
    }

    // show which body parts are stopping the uploaded pose
    if (failedLandmarks.length > 0) {
        console.warn(
            "Sketch pose failed landmark validation:",
            failedLandmarks
        );

        return false;
    }

    // Let us know when one arm needs an estimated position
    if (hiddenArms.length > 0) {
        console.warn(
            "Sketch pose has a hidden arm:",
            hiddenArms[0]
        );
    }

    return true;
}
