// CONTROLLER layer: keeps the user's latest pose.
let currentUserPose = null;

window.addEventListener("message", (event) => {
    const frame = document.getElementById("mannequin-frame");
    if (event.source !== frame.contentWindow) return;
    if (!event.data || event.data.type !== "MANNEQUIN_POSE_CHANGED") return;

    currentUserPose = event.data.pose;
    console.log("User pose updated:", currentUserPose);
});

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