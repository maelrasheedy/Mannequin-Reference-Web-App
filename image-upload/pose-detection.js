
// Import MediaPipe to detect human poses in uploaded images
import {
    PoseLandmarker,
    FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

// Keep the MediaPipe model in memory so it does not reload every time
let poseLandmarkerPromise = null;

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

                // Require at least 70% confidence for pose detection
                minPoseDetectionConfidence: 0.7,

                // Require at least 70% confidence that a pose is present
                minPosePresenceConfidence: 0.7

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

    // Make sure the pose detection model is loaded
    const detector = await loadPoseLandmarker();

    // Detect human body landmarks directly from the uploaded image
    const result = detector.detect(imageElement);

   // Get the detected landmarks and calculate their average visibility
    const landmarks = result.landmarks[0] || null;
    const averageLandmarkConfidence =
        calculateAverageLandmarkConfidence(landmarks);

    // Return the detected pose, landmarks, and average visibility score
    return {
        detected: result.landmarks.length > 0,
        landmarks: landmarks,
        worldLandmarks: result.worldLandmarks[0] || null,
        averageLandmarkConfidence: averageLandmarkConfidence
    };
}

// Calculate the average visibility confidence of detected landmarks
export function calculateAverageLandmarkConfidence(landmarks) {
    if (!Array.isArray(landmarks) || landmarks.length === 0) {
        return 0;
    }

    const totalConfidence = landmarks.reduce((total, landmark) => {
        const confidence = Number.isFinite(landmark.visibility)
            ? landmark.visibility
            : 0;

        return total + confidence;
    }, 0);

    return totalConfidence / landmarks.length;
}

// Check whether the average landmark visibility meets our threshold
export function meetsLandmarkConfidenceThreshold(landmarks) {
    const averageConfidence =
        calculateAverageLandmarkConfidence(landmarks);

    return averageConfidence >= 0.7;
}
