// CONTROLLER layer: keeps the user's latest pose.
//
// currentUserPose is the pose Search uses. Once the mannequin has loaded it is
// never null: it is the mannequin's pose, or the uploaded sketch's pose while
// a valid sketch is present.
let currentUserPose = null;

window.addEventListener("message", (event) => {
    const frame = document.getElementById("mannequin-frame");
    if (event.source !== frame.contentWindow) return;
    if (!event.data || event.data.type !== "MANNEQUIN_POSE_CHANGED") return;

    currentUserPose = event.data.pose;
    console.log("User pose updated:", currentUserPose);
});

// Ask the mannequin for its pose right now and wait for the answer.
// Search uses this if, for any reason, no pose has arrived yet.
// Resolves with the pose, or null if the mannequin does not answer in time.
function requestMannequinPose(timeoutMs = 2000) {
    return new Promise((resolve) => {
        const frame = document.getElementById("mannequin-frame");

        if (!frame || !frame.contentWindow) {
            resolve(null);
            return;
        }

        const timer = setTimeout(() => {
            window.removeEventListener("message", onReply);
            resolve(null);
        }, timeoutMs);

        function onReply(event) {
            if (event.source !== frame.contentWindow) return;
            if (!event.data || event.data.type !== "MANNEQUIN_POSE_CHANGED") return;

            clearTimeout(timer);
            window.removeEventListener("message", onReply);
            resolve(event.data.pose);
        }

        window.addEventListener("message", onReply);

        frame.contentWindow.postMessage(
            { type: "MANNEQUIN_REQUEST_POSE" },
            window.location.origin
        );
    });
}

// Reset Pose button: ask the mannequin iframe to return to its standing pose.
const resetPoseButton = document.getElementById("reset-pose-button");
if (resetPoseButton) {
    resetPoseButton.addEventListener("click", () => {
        const frame = document.getElementById("mannequin-frame");
        frame.contentWindow.postMessage(
            { type: "MANNEQUIN_RESET_POSE" },
            window.location.origin
        );
    });
}