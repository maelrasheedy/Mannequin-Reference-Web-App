// CONTROLLER layer: keeps the user's latest pose.
let currentUserPose = null;

window.addEventListener("message", (event) => {
    const frame = document.getElementById("mannequin-frame");
    if (event.source !== frame.contentWindow) return;
    if (!event.data || event.data.type !== "MANNEQUIN_POSE_CHANGED") return;

    currentUserPose = event.data.pose;
    console.log("User pose updated:", currentUserPose);
}); 