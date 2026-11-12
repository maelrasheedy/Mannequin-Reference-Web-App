
// Task 1.2.6 - Run human pose detection in a Web Worker

// Receive an image from Sketch Upload
self.onmessage = async function (event) {

    const { runId, imageBitmap } = event.data;

    try {

        // Load the pose detection and calculation files
        const { detectHumanPose } = await import("./pose-detection.js");
        const { generateUserPoseJson } = await import("./pose-vector.js");

        // Detect the body landmarks in the worker
        const result = await detectHumanPose(imageBitmap);

        let userPoseJson = null;

        // Only calculate the pose if it passes 70% confidence
        if (
            result.detected &&
            result.landmarks?.length &&
            result.averageLandmarkConfidence >= 0.7
        ) {

            // Create our team's 14-joint pose data
            userPoseJson = generateUserPoseJson(
                result.worldLandmarks
            );
        }

        // Send the pose results back to Sketch Upload
        self.postMessage({
            type: "pose-result",
            runId,
            result,
            userPoseJson
        });

    } catch (error) {

        // Send an error message if processing fails
        self.postMessage({
            type: "pose-error",
            runId,
            message: error.message || "Pose detection failed."
        });

    } finally {

        // Release the image after processing
        if (imageBitmap) {
            imageBitmap.close();
        }
    }
};