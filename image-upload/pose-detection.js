
// Import MediaPipe to detect human poses in uploaded images
import {
    PoseLandmarker,
    FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

// Keep the MediaPipe model in memory so it does not reload every time
let poseLandmarkerPromise = null;

// Keep the same 70% landmark confidence requirement used by our team
const MIN_LANDMARK_CONFIDENCE = 0.7;

// Allow MediaPipe to consider slightly less confident poses.
// This may help with drawings and sketches that are harder to recognize.
// The separate 70% landmark confidence check remains unchanged.
const MIN_POSE_DETECTION_CONFIDENCE = 0.5;
const MIN_POSE_PRESENCE_CONFIDENCE = 0.5;

// Load the MediaPipe pose detection model
async function loadPoseLandmarker() {

    if (!poseLandmarkerPromise) {

        poseLandmarkerPromise = (async function () {

            // Load the files MediaPipe needs to run in the browser
            const vision = await FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
            );

            // Use the pose detection model stored in our project
            const modelPath = new URL(
                "../python/pose_landmarker_full.task",
                import.meta.url
            ).href;

            // Create the pose detector using our team's confidence requirements
            return await PoseLandmarker.createFromOptions(vision, {

                baseOptions: {
                    modelAssetPath: modelPath,
                    delegate: "CPU"
                },

                runningMode: "IMAGE",
                numPoses: 1,

                // Allow poses with at least 50% detection confidence.
                // Lowering this may improve recognition of drawings.
                minPoseDetectionConfidence:
                    MIN_POSE_DETECTION_CONFIDENCE,

                // Allow poses with at least 50% presence confidence.
                minPosePresenceConfidence:
                    MIN_POSE_PRESENCE_CONFIDENCE

            });

        })().catch(function (error) {

            // Reset the model so another upload can retry if loading fails
            poseLandmarkerPromise = null;
            throw error;

        });

    }

    return await poseLandmarkerPromise;
}

// Check whether the uploaded image contains a human pose
export async function detectHumanPose(imageElement) {

    // Make sure the worker received a usable image
    if (!imageElement) {
        throw new Error(
            "Pose detection failed: no image was provided."
        );
    }

    // Make sure the pose detection model is loaded
    const detector = await loadPoseLandmarker();

    // Detect human body landmarks directly from the uploaded image
    const result = detector.detect(imageElement);

    // Safely read the first detected pose
    const landmarks = result?.landmarks?.[0] ?? null;
    const worldLandmarks = result?.worldLandmarks?.[0] ?? null;

    // Get the detected landmarks and calculate their average visibility
    const averageLandmarkConfidence =
        calculateAverageLandmarkConfidence(landmarks);

    // Make sure MediaPipe returned a usable set of body landmarks
    const detected =
        Array.isArray(landmarks) &&
        landmarks.length >= 33;

    if (!detected) {
        console.warn(
            "MediaPipe did not return a complete human pose. " +
            "The image may be too stylized, incomplete, or difficult to detect."
        );
    }

    // The 3D landmarks are needed by pose-vector.js.
    // The worker will reject the pose if they are missing.
    if (
        detected &&
        (
            !Array.isArray(worldLandmarks) ||
            worldLandmarks.length < 33
        )
    ) {
        console.warn(
            "Human pose detected, but the 3D world landmarks are incomplete."
        );
    }

    // Return the detected pose, landmarks, and average visibility score
    return {
        detected: detected,
        landmarks: landmarks,
        worldLandmarks: worldLandmarks,
        averageLandmarkConfidence: averageLandmarkConfidence
    };
}

// Calculate the average visibility confidence of detected landmarks
export function calculateAverageLandmarkConfidence(landmarks) {

    if (!Array.isArray(landmarks) || landmarks.length === 0) {
        return 0;
    }

    const totalConfidence = landmarks.reduce((total, landmark) => {

        // Invalid or missing visibility values count as zero
        const visibility = landmark?.visibility;

        const confidence = Number.isFinite(visibility)
            ? Math.max(0, Math.min(1, visibility))
            : 0;

        return total + confidence;

    }, 0);

    return totalConfidence / landmarks.length;
}

// Check whether the average landmark visibility meets our threshold
export function meetsLandmarkConfidenceThreshold(landmarks) {

    const averageConfidence =
        calculateAverageLandmarkConfidence(landmarks);

    return averageConfidence >= MIN_LANDMARK_CONFIDENCE;
}
