
// Use the same landmark visibility requirements as our team's Python code
const MIN_VISIBILITY = 0.5;
const MIN_EXTREMITY_VISIBILITY = 0.3;

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

// Check that the detected landmarks meet our visibility requirements
export function validatePoseLandmarks(landmarks) {

    // Make sure MediaPipe returned all 33 landmarks
    if (!Array.isArray(landmarks) || landmarks.length < 33) {
        return false;
    }

    // Main body landmarks must have at least 50% visibility
    for (const index of REQUIRED_LANDMARKS) {

        const visibility = landmarks[index]?.visibility;

        if (
            !Number.isFinite(visibility) ||
            visibility < MIN_VISIBILITY
        ) {
            return false;
        }
    }

    // Hand and foot landmarks must have at least 30% visibility
    for (const index of EXTREMITY_LANDMARKS) {

        const visibility = landmarks[index]?.visibility;

        if (
            !Number.isFinite(visibility) ||
            visibility < MIN_EXTREMITY_VISIBILITY
        ) {
            return false;
        }
    }

    return true;
}
