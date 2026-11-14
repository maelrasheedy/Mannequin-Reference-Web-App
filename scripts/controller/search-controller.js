
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

    function setStatus(text) {
        statusBanner.textContent = text || "";
    }



    searchButton.addEventListener("click", async () => {
        // Search with the pose as it is right now. There should always be
        // one; if none has arrived yet, ask the mannequin for it.
        let pose = typeof currentUserPose === "undefined" ? null : currentUserPose;


        // No WebGL means no mannequin to read a pose from!!!
        if (!pose && document.documentElement.classList.contains("no-webgl")) {
            setStatus("Upload a sketch first, then press Search.");
            return;
        }


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

})();
