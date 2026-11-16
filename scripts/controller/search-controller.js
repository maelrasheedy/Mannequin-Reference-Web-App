
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
    const TOP_N = 20; // the highest number of possible matches to the image gallery

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
        if (!mannequinFrame || event.source !== mannequinFrame.contentWindow) return;
        if (!event.data || event.data.type !== "MANNEQUIN_POSE_CHANGED") return;
        searchButton.disabled = false;
    });

   
searchButton.addEventListener("click", async () => {
    // Use the most recently received pose.
    let pose = typeof currentUserPose === "undefined"
        ? null
        : currentUserPose;

    // Without WebGL, the mannequin cannot provide a pose.
    if (!pose && document.documentElement.classList.contains("no-webgl")) {
        setStatus("Upload a sketch first, then press Search.");
        return;
    }

    // Maryam's improvement: request the mannequin pose if needed.
    if (!pose && typeof requestMannequinPose === "function") {
        setStatus("Reading the mannequin's pose...");

        try {
            pose = await requestMannequinPose();
        } catch (error) {
            console.error("Could not retrieve mannequin pose:", error);
            setStatus("Could not read the mannequin's pose. Please try again.");
            return;
        }
    }

    if (!pose) {
        setStatus("The mannequin is still loading. Please try again in a moment.");
        return;
    }

    // Your improvement: validate all 14 joints before searching.
    if (!isCompletePose(pose)) {
        const message =
            "Incomplete pose detected. Please upload a clearer full-body image or reset the mannequin and try again.";

        setStatus(message);
        showGalleryMessage(message);
        return;
    }
        searchButton.disabled = true;
        setStatus("Searching...");

        try {
            // Task 1.1.5 - Use the image data already saved in RAM
            const references = await window.ReferenceCache.loadReferences();

        const { groups } = PoseMatcher.search(pose, references, TOP_N);
        renderGallery(groups.map((g) => ({ notice: noticeForLevel(g.level), matches: g.matches })));
            // (level) based on whether there are ref image matches at 40 (great) 50 (good) 60 (um) none (no matches)
        
            setStatus("");
            // The message shown above the gallery, depending on how close the results are.
            // (Edit the wording here.)
        function noticeForLevel(level) {
            if (level === 40) return "";                                       // real matches: no warning
            if (level === 50) return "Matche(s) in our dataset that may not be accurate:";
            if (level === 60) return "Matche(s) in our dataset that are not so accurate:";
            return "No reference images match your pose!! Here are the next closest matches:";                  // nothing within 60
        }

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