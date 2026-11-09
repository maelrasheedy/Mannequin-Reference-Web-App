// Store the latest sketch pose JSON in the main website
window.sketchUploadPoseJson = null;

// Find the iframe that contains the Sketch Upload section
const sketchUploadFrame = document.querySelector(
    'iframe[src="image-upload/index.html"]'
);

// Receive pose updates from the Sketch Upload section
window.addEventListener("message", function (event) {

    // Only accept messages from our own website
    if (event.origin !== window.location.origin) {
        return;
    }

    // Make sure the message came from the correct iframe
    if (
        !sketchUploadFrame ||
        event.source !== sketchUploadFrame.contentWindow
    ) {
        return;
    }

    const message = event.data;

    // Ignore messages unrelated to sketch pose updates
    if (
        !message ||
        message.source !== "image-upload" ||
        message.type !== "pose-update"
    ) {
        return;
    }

    // Accept a valid pose vector or null when the image is removed
    if (
        message.pose !== null &&
        (
            !Array.isArray(message.pose?.pose_vector) ||
            message.pose.pose_vector.length === 0
        )
    ) {
        console.warn("Invalid sketch pose received.");
        return;
    }

    // Save the new sketch pose or clear it if removed
    window.sketchUploadPoseJson = message.pose;

    // INTEGRATION FIX:
    // Share the sketch pose with Maryam's search controller.
    if (typeof currentUserPose !== "undefined") {

        currentUserPose = window.sketchUploadPoseJson;

        // Enable Search when a sketch pose is available.
        // Disable Search when the sketch pose is cleared.
        const searchButton = document.getElementById(
            "search-button"
        );

        if (searchButton) {
            searchButton.disabled = !currentUserPose;
        }

    } else {

        console.error(
            "Search pose controller is not loaded."
        );

    }

    // Forward the sketch pose to the Three.js mannequin
    const sketchPoseMannequinFrame = document.getElementById(
        "mannequin-frame"
    );

    if (sketchPoseMannequinFrame?.contentWindow) {

        sketchPoseMannequinFrame.contentWindow.postMessage(
            {
                type: "SKETCH_POSE_UPDATED",
                pose: window.sketchUploadPoseJson
            },
            window.location.origin
        );

        console.log(
            "Sketch pose update forwarded to mannequin"
        );
    }

    if (window.sketchUploadPoseJson) {

        console.log(
            "Main website received sketch pose:",
            window.sketchUploadPoseJson.pose_vector.length,
            "joints"
        );

        console.log(
            "Sketch pose connected to Maryam's search!"
        );

    } else {

        console.log("Main website cleared sketch pose");

    }
});
