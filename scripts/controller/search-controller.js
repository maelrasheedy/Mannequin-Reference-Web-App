
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

})();
