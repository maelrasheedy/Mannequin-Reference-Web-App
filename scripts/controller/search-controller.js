
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

    function setStatus(text) {
        statusBanner.textContent = text || "";
    }



    searchButton.addEventListener("click", async () => {
        // Search with the pose as it is right now. There should always be
        // one; if none has arrived yet, ask the mannequin for it.
        let pose = typeof currentUserPose === "undefined" ? null : currentUserPose;

        if (!pose && typeof requestMannequinPose === "function") {
            setStatus("Reading the mannequin's pose...");
            pose = await requestMannequinPose();
        }

        if (!pose) {
            setStatus("The mannequin is still loading. Please try again in a moment.");
            return;
        }

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
