
 // CONTROLLER layer,
 // connects the Search button, the matcher and the gallery
 // It does NO matching itself (PoseMatcher does),
 // draws NOTHING itself (renderGallery does)
 //
 // this script Needs:
 //   scripts/model/pose-matcher.js ->           DELIVERS PoseMatcher
 //   scripts/model/reference-cache.js ->        DELIVERS ReferenceCache
 //   scripts/view/ref-gallery.js ->             DELIVERS renderGallery and showGalleryMessage
 //   scripts/controller/pose-controller.js ->   DELIVERS currentUserPose
 //(they all need to be loaded BEFORE this file)

(function () {
    const TOP_N = 20;

    const searchButton = document.getElementById("search-button");
    const statusBanner = document.getElementById("status-banner");
    const mannequinFrame = document.getElementById("mannequin-frame");

    function setStatus(text) {
        statusBanner.textContent = text || "";
    }

    // Task 5.6.8 - List the 14 joints required for a complete pose
    const REQUIRED_JOINTS = [
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
    ];

    // Task 5.6.8 - Check that no joints or angles are missing
    function isCompletePose(pose) {

        // A complete pose must have exactly 14 joints
        if (
            !pose ||
            !Array.isArray(pose.pose_vector) ||
            pose.pose_vector.length !== REQUIRED_JOINTS.length
        ) {
            return false;
        }

        const jointNames = new Set();

        for (const joint of pose.pose_vector) {

            // Reject missing, unknown, or repeated joints
            if (
                !joint ||
                !REQUIRED_JOINTS.includes(joint.name) ||
                jointNames.has(joint.name)
            ) {
                return false;
            }

            jointNames.add(joint.name);

            // Each joint must have three valid angle numbers
            if (
                !Number.isFinite(joint["x-plane-angle"]) ||
                !Number.isFinite(joint["y-plane-angle"]) ||
                !Number.isFinite(joint["z-plane-angle"])
            ) {
                return false;
            }
        }

        return REQUIRED_JOINTS.every((name) => jointNames.has(name));
    }

    // The Search button works as soon as the mannequin has sent a pose.
    window.addEventListener("message", (event) => {
        if (event.source !== mannequinFrame.contentWindow) return;
        if (!event.data || event.data.type !== "MANNEQUIN_POSE_CHANGED") return;
        searchButton.disabled = false;
    });

    searchButton.addEventListener("click", async () => {
        if (typeof currentUserPose === "undefined" || !currentUserPose) {
            setStatus("Pose the mannequin first, then press Search.");
            return;
        }

        // Task 5.6.8 - Stop Search if the pose is incomplete
        if (!isCompletePose(currentUserPose)) {
            const message =
                "Incomplete pose detected. Please upload a clearer full-body image or reset the mannequin and try again.";

            setStatus(message);
            showGalleryMessage(message);
            return;
        }

        // Search with the pose as it is right now.
        const pose = currentUserPose;

        searchButton.disabled = true;
        setStatus("Searching...");

        try {
            // Task 1.1.5 - Use the image data already saved in RAM
            const references = await window.ReferenceCache.loadReferences();

            const matches = PoseMatcher.findMatches(pose, references, TOP_N);
            renderGallery(matches);
            setStatus("");
        } catch (error) {
            console.error("Search failed:", error);
            showGalleryMessage("Could not load the reference images.");
            setStatus("Search failed. Please check your connection and try again.");
        } finally {
            searchButton.disabled = false;
        }
    });

})
();