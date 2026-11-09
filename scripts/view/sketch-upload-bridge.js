// Store the latest sketch pose JSON in the main website
window.sketchUploadPoseJson = null;

// Find the iframe that contains the Sketch Upload section
const sketchUploadFrame = document.querySelector(
    'iframe[src="image-upload/index.html"]'
);

// Find the mannequin iframe so we can send it the uploaded sketch pose
const mannequinFrame = document.getElementById("mannequin-frame");

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

    // Ignore messages that are not related to sketch pose updates
    if (
        !message ||
        message.source !== "image-upload" ||
        message.type !== "pose-update"
    ) {
        return;
    }

    // Only accept valid pose JSON structures or null when the pose is cleared
    if (
        message.pose !== null &&
        !Array.isArray(message.pose?.pose_vector)
    ) {
        return;
    }

    // Save the new sketch pose or clear it if the image was removed
    window.sketchUploadPoseJson = message.pose;

    // Forward the sketch pose to the Three.js mannequin
    if (mannequinFrame?.contentWindow) {
        mannequinFrame.contentWindow.postMessage(
            {
                type: "SKETCH_POSE_UPDATED",
                pose: window.sketchUploadPoseJson
            },
            window.location.origin
        );

        console.log("Sketch pose update forwarded to mannequin");
    }

    if (window.sketchUploadPoseJson) {

        console.log(
            "Main website received sketch pose:",
            window.sketchUploadPoseJson.pose_vector.length,
            "joints"
        );

    } else {

        console.log("Main website cleared sketch pose");

    }
});