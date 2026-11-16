
// CONTROLLER layer: keeps the user's latest pose.
//
// currentUserPose is the pose Search uses. Once the mannequin has loaded it is
// never null: it is the mannequin's pose, or the uploaded sketch's pose while
// a valid sketch is present.
let currentUserPose = null;

// Keep the latest mannequin pose separate from the active search pose
let latestMannequinPose = null;

// Make sure mannequin poses have all 14 valid body segments
function isValidMannequinPose(pose) {

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

    return foundNames.size === requiredNames.size;
}


// Receive the current mannequin pose from its iframe
window.addEventListener("message", (event) => {

    const frame = document.getElementById("mannequin-frame");

    // Only accept messages from our own mannequin iframe
    if (
        !frame?.contentWindow ||
        event.origin !== window.location.origin ||
        event.source !== frame.contentWindow
    ) {
        return;
    }

    if (
        !event.data ||
        event.data.type !== "MANNEQUIN_POSE_CHANGED"
    ) {
        return;
    }

    // Keep invalid or incomplete poses out of the search system
    if (!isValidMannequinPose(event.data.pose)) {
        console.warn(
            "Ignored incomplete or invalid mannequin pose."
        );
        return;
    }

    // Save the complete mannequin pose JSON
    latestMannequinPose = event.data.pose;

    // If no sketch is active, Search should follow the mannequin
    if (!window.sketchUploadPoseJson) {
        currentUserPose = latestMannequinPose;
    }

    console.log("User pose updated:", currentUserPose);
});


// Ask the mannequin for its pose right now and wait for the answer.
// Search uses this if, for any reason, no pose has arrived yet.
// Resolves with the pose, or null if the mannequin does not answer in time.
function requestMannequinPose(timeoutMs = 2000) {

    return new Promise((resolve) => {

        const frame = document.getElementById("mannequin-frame");

        if (!frame?.contentWindow) {
            resolve(null);
            return;
        }

        const mannequinWindow = frame.contentWindow;

        let timer = null;
        let finished = false;

        // Clean up the listener and timer after receiving a result
        function finishRequest(pose) {

            if (finished) {
                return;
            }

            finished = true;

            if (timer !== null) {
                clearTimeout(timer);
            }

            window.removeEventListener("message", onReply);

            resolve(pose);
        }

        // Get the mannequin's latest pose when it responds
        function onReply(event) {

            if (
                event.origin !== window.location.origin ||
                event.source !== mannequinWindow
            ) {
                return;
            }

            if (
                !event.data ||
                event.data.type !== "MANNEQUIN_POSE_CHANGED"
            ) {
                return;
            }

            // Ignore invalid responses and keep waiting for a valid pose
            if (!isValidMannequinPose(event.data.pose)) {
                console.warn(
                    "Mannequin returned an invalid pose."
                );
                return;
            }

            latestMannequinPose = event.data.pose;

            // A sketch still takes priority over the mannequin
            if (!window.sketchUploadPoseJson) {
                currentUserPose = latestMannequinPose;
            }

            finishRequest(latestMannequinPose);
        }

        // Use the last valid mannequin pose if it takes too long to reply
        timer = setTimeout(() => {
            finishRequest(latestMannequinPose);
        }, timeoutMs);

        window.addEventListener("message", onReply);

        try {

            // Ask the mannequin iframe for its current 14-joint pose
            mannequinWindow.postMessage(
                { type: "MANNEQUIN_REQUEST_POSE" },
                window.location.origin
            );

        } catch (error) {

            console.warn(
                "Could not request mannequin pose:",
                error
            );

            finishRequest(latestMannequinPose);
        }
    });
}


// Reset Pose button: ask the mannequin iframe to return to its standing pose.
const resetPoseButton = document.getElementById("reset-pose-button");

if (resetPoseButton) {

    resetPoseButton.addEventListener("click", () => {

        const frame = document.getElementById("mannequin-frame");

        // Do not send a reset command before the iframe is ready
        if (!frame?.contentWindow) {
            console.warn(
                "Cannot reset mannequin: iframe is not ready."
            );
            return;
        }

        frame.contentWindow.postMessage(
            { type: "MANNEQUIN_RESET_POSE" },
            window.location.origin
        );
    });
}
