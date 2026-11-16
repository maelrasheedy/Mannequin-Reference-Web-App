
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
// (they all need to be loaded BEFORE this file)

(function () {
    const TOP_N = 20; // the highest number of possible matches to the image gallery

    const searchButton = document.getElementById("search-button");
    const statusBanner = document.getElementById("status-banner");
    const mannequinFrame = document.getElementById("mannequin-frame");

    // Find the Sketch Upload iframe so a valid sketch can also enable Search.
    const sketchUploadFrame = document.querySelector(
        'iframe[src="image-upload/index.html"]'
    );

    let isSearching = false;

    function setStatus(text) {
        if (statusBanner) {
            statusBanner.textContent = text || "";
        }
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

        if (!REQUIRED_JOINTS.every((name) => jointNames.has(name))) {
            return false;
        }

        // Keep hidden-arm information consistent with the pose matcher.
        // Estimated joints must be part of the existing 14-joint schema.
        if (pose.estimated_segments !== undefined) {

            if (!Array.isArray(pose.estimated_segments)) {
                return false;
            }

            const estimatedNames = new Set();

            for (const name of pose.estimated_segments) {

                if (
                    typeof name !== "string" ||
                    !REQUIRED_JOINTS.includes(name) ||
                    estimatedNames.has(name)
                ) {
                    return false;
                }

                estimatedNames.add(name);
            }
        }

        return true;
    }

    // Find the pose Search should use right now.
    // An uploaded sketch takes priority over the mannequin.
    function getActiveSearchPose() {

        if (isCompletePose(window.sketchUploadPoseJson)) {
            return window.sketchUploadPoseJson;
        }

        // Without WebGL, the mannequin cannot provide a pose.
        if (
            document.documentElement.classList.contains("no-webgl")
        ) {
            return null;
        }

        if (
            typeof currentUserPose !== "undefined" &&
            isCompletePose(currentUserPose)
        ) {
            return currentUserPose;
        }

        return null;
    }

    // Enable Search when a valid mannequin or sketch pose is available.
    function updateSearchAvailability() {

        if (!searchButton) {
            return;
        }

        // Do not reactivate Search during an unfinished search.
        if (isSearching) {
            searchButton.disabled = true;
            return;
        }

        searchButton.disabled = !getActiveSearchPose();
    }

    // The Search button works as soon as the mannequin has sent a pose.
    window.addEventListener("message", (event) => {

        // Only accept pose messages from our own website.
        if (event.origin !== window.location.origin) {
            return;
        }

        if (
            mannequinFrame?.contentWindow &&
            event.source === mannequinFrame.contentWindow &&
            event.data?.type === "MANNEQUIN_POSE_CHANGED"
        ) {

            // Do not enable Search from incomplete mannequin poses.
            if (!isCompletePose(event.data.pose)) {
                console.warn(
                    "Search ignored an invalid mannequin pose."
                );
                return;
            }

            updateSearchAvailability();
            return;
        }

        // A valid Sketch Upload pose should also enable Search,
        // including when the mannequin cannot run without WebGL.
        if (
            sketchUploadFrame?.contentWindow &&
            event.source === sketchUploadFrame.contentWindow &&
            event.data?.source === "image-upload" &&
            event.data?.type === "pose-update"
        ) {

            if (
                event.data.pose !== null &&
                !isCompletePose(event.data.pose)
            ) {
                console.warn(
                    "Search ignored an invalid sketch pose."
                );
                return;
            }

            // sketch-upload-bridge.js updates the active pose.
            updateSearchAvailability();
        }
    });

    // The message shown above the gallery, depending on
    // how close the results are.
    // (Edit the wording here.)
    function noticeForLevel(level) {
        if (level === 40) return ""; // real matches: no warning

        if (level === 50) {
            return "Matche(s) in our dataset that may not be accurate:";
        }

        if (level === 60) {
            return "Matche(s) in our dataset that are not so accurate:";
        }

        return "No reference images match your pose!! Here are the next closest matches:";
    }

    if (searchButton) {

        searchButton.addEventListener("click", async () => {

            // Do not start two reference searches at the same time.
            if (isSearching) {
                return;
            }

            isSearching = true;
            searchButton.disabled = true;

            try {

                // Use the most recently received pose.
                // A valid uploaded sketch always takes priority.
                let pose = getActiveSearchPose();

                // Without WebGL, the mannequin cannot provide a pose.
                if (
                    !pose &&
                    document.documentElement.classList.contains("no-webgl")
                ) {
                    setStatus(
                        "Upload a sketch first, then press Search."
                    );
                    return;
                }

                // Maryam's improvement: request the mannequin pose if needed.
                if (
                    !pose &&
                    typeof requestMannequinPose === "function"
                ) {
                    setStatus("Reading the mannequin's pose...");

                    try {
                        pose = await requestMannequinPose();

                        // If a sketch was uploaded while waiting for
                        // the mannequin, use the sketch instead.
                        if (
                            isCompletePose(window.sketchUploadPoseJson)
                        ) {
                            pose = window.sketchUploadPoseJson;
                        }

                    } catch (error) {
                        console.error(
                            "Could not retrieve mannequin pose:",
                            error
                        );

                        setStatus(
                            "Could not read the mannequin's pose. Please try again."
                        );
                        return;
                    }
                }

                if (!pose) {
                    setStatus(
                        "The mannequin is still loading. Please try again in a moment."
                    );
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

                setStatus("Searching...");

                // Task 1.1.5 - Use the image data already saved in RAM
                const references =
                    await window.ReferenceCache.loadReferences();

                // Check for valid reference data before matching.
                if (!Array.isArray(references)) {
                    throw new Error(
                        "Reference image data is unavailable."
                    );
                }

                // Preserve the entire pose, including estimated_segments,
                // so PoseMatcher can ignore unreliable body parts.
                const { groups } = PoseMatcher.search(
                    pose,
                    references,
                    TOP_N
                );

                // (level) based on whether there are ref image matches
                // at 40 (great), 50 (good), 60 (um), none (no matches).
                const galleryGroups = groups.map((group) => ({
                    notice: noticeForLevel(group.level),
                    matches: group.matches
                }));

                renderGallery(galleryGroups);

                setStatus("");

            } catch (error) {

                console.error("Search failed:", error);

                showGalleryMessage(
                    "Could not complete the reference image search."
                );

                setStatus(
                    "Search failed. Please check the reference data and try again."
                );

            } finally {

                isSearching = false;

                // Restore the button based on whichever pose
                // is currently active.
                updateSearchAvailability();
            }
        });
    }

    // Check whether a valid pose was already available
    // before this controller finished loading.
    updateSearchAvailability();

})();
