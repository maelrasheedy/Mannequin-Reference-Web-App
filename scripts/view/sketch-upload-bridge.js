
// Store the latest sketch pose JSON in the main website
window.sketchUploadPoseJson = null;

// Find the iframe that contains the Sketch Upload section
const sketchUploadFrame = document.querySelector(
    'iframe[src="image-upload/index.html"]'
);

// Keep track of sketch changes so an old mannequin response
// cannot replace a newer uploaded pose.
let sketchPoseUpdateVersion = 0;

// Check that a sketch contains all 14 valid body segments
function isValidSketchUploadPose(pose) {

    const requiredNames = new Set([
        "torso",
        "neck",

        "left_shoulder",
        "left_elbow",
        "left_wrist",

        "right_shoulder",
        "right_elbow",
        "right_wrist",

        "left_hip",
        "left_knee",
        "left_ankle",

        "right_hip",
        "right_knee",
        "right_ankle"
    ]);

    if (
        !pose ||
        !Array.isArray(pose.pose_vector) ||
        pose.pose_vector.length !== requiredNames.size
    ) {
        return false;
    }

    const foundNames = new Set();

    for (const joint of pose.pose_vector) {

        if (
            !joint ||
            typeof joint.name !== "string" ||
            !requiredNames.has(joint.name) ||
            foundNames.has(joint.name) ||
            !Number.isFinite(joint["x-plane-angle"]) ||
            !Number.isFinite(joint["y-plane-angle"]) ||
            !Number.isFinite(joint["z-plane-angle"])
        ) {
            return false;
        }

        foundNames.add(joint.name);
    }

    if (foundNames.size !== requiredNames.size) {
        return false;
    }

    // Keep the hidden-arm information from pose-vector.js.
    // Estimated segments must refer to real names in the pose JSON.
    if (pose.estimated_segments !== undefined) {

        if (!Array.isArray(pose.estimated_segments)) {
            return false;
        }

        const estimatedNames = new Set();

        for (const name of pose.estimated_segments) {

            if (
                typeof name !== "string" ||
                !requiredNames.has(name) ||
                estimatedNames.has(name)
            ) {
                return false;
            }

            estimatedNames.add(name);
        }
    }

    return true;
}


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

    // Accept a complete 14-joint pose or null when the image is removed
    if (
        message.pose !== null &&
        !isValidSketchUploadPose(message.pose)
    ) {
        console.warn("Invalid sketch pose received.");
        return;
    }

    // Save the new sketch pose or clear it if removed
    const receivedPose = message.pose;

    const currentUpdateVersion = ++sketchPoseUpdateVersion;

    window.sketchUploadPoseJson = receivedPose;

    const noWebGL = document.documentElement.classList.contains(
        "no-webgl"
    );

    // INTEGRATION FIX:
    // Share the sketch pose with Maryam's search controller.
    if (typeof currentUserPose !== "undefined") {

        // A valid sketch becomes the active search pose.
        if (window.sketchUploadPoseJson) {
            currentUserPose = window.sketchUploadPoseJson;
        } else {

            // Clear the old sketch immediately so Search
            // cannot accidentally use it after removal.
            currentUserPose = null;
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

        // Send the update first so the mannequin can reset
        // before we request its pose for Search.
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

    // Without WebGL there is no mannequin to fall back to!!
    // so removing the sketch means there is no pose to search with.
    if (
        !window.sketchUploadPoseJson &&
        noWebGL
    ) {

        if (typeof currentUserPose !== "undefined") {
            currentUserPose = null;
        }
    }

    // When the sketch is removed, return Search to the mannequin.
    // Request its pose after forwarding the reset message.
    if (
        !window.sketchUploadPoseJson &&
        !noWebGL &&
        typeof currentUserPose !== "undefined"
    ) {

        if (typeof requestMannequinPose === "function") {

            requestMannequinPose()
                .then((pose) => {

                    // Ignore an older response if another sketch
                    // was uploaded while this request was running.
                    if (
                        currentUpdateVersion !== sketchPoseUpdateVersion ||
                        window.sketchUploadPoseJson !== null ||
                        document.documentElement.classList.contains(
                            "no-webgl"
                        )
                    ) {
                        return;
                    }

                    // Restore the latest mannequin pose,
                    // or null if the mannequin did not answer.
                    currentUserPose = pose;

                    console.log(
                        "Search returned to mannequin pose:",
                        currentUserPose
                    );

                })
                .catch((error) => {

                    if (
                        currentUpdateVersion !== sketchPoseUpdateVersion
                    ) {
                        return;
                    }

                    console.error(
                        "Could not restore mannequin pose:",
                        error
                    );
                });

        } else {

            console.warn(
                "Mannequin pose request is not available."
            );
        }
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


// If the mannequin iframe reloads, send the active sketch again.
// This prevents the mannequin from losing the sketch pose
// while Search is still using it.
const mannequinFrameForSketch = document.getElementById(
    "mannequin-frame"
);

if (mannequinFrameForSketch) {

    mannequinFrameForSketch.addEventListener("load", () => {

        if (!window.sketchUploadPoseJson) {
            return;
        }

        mannequinFrameForSketch.contentWindow?.postMessage(
            {
                type: "SKETCH_POSE_UPDATED",
                pose: window.sketchUploadPoseJson
            },
            window.location.origin
        );

        console.log(
            "Active sketch pose restored after mannequin reload."
        );
    });
}
