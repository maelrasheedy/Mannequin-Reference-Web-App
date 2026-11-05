
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

    // Return the detected pose and its 3D world landmarks
    return {
        detected: result.landmarks.length > 0,
        landmarks: result.landmarks[0] || null,
        worldLandmarks: result.worldLandmarks[0] || null
    };

}
