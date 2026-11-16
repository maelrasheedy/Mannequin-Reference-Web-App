
// Task 1.1.7 - Show a loading screen while app data loads
(function () {

    const loadingOverlay = document.getElementById("loading-overlay");
    const statusBanner = document.getElementById("status-banner");

    // Load the data without freezing the webpage
    async function loadAssets() {

        // Show Loading... while the data is being prepared
        if (loadingOverlay) {
            loadingOverlay.hidden = false;
        } else {
            console.warn("Loading screen element is missing.");
        }

        try {

            // Make sure the reference cache is available
            if (
                !window.ReferenceCache ||
                typeof window.ReferenceCache.loadReferences !== "function"
            ) {
                throw new Error(
                    "Reference cache is missing or not initialized."
                );
            }

            // Reuse the metadata loader from Task 1.1.5
            const references =
                await window.ReferenceCache.loadReferences();

            // Make sure the reference images were loaded correctly
            if (!Array.isArray(references)) {
                throw new Error(
                    "Reference metadata is not a valid array."
                );
            }

            console.log("Reference data is ready.");

        } catch (error) {

            console.error("Could not load reference data:", error);

            // Let the user know if loading fails
            if (statusBanner) {
                statusBanner.textContent =
                    "Could not load reference data. Please refresh the page.";
            }

        } finally {

            // Hide the loading screen when loading finishes
            if (loadingOverlay) {
                loadingOverlay.hidden = true;
            }

        }
    }

    // Start loading when the Controller runs
    loadAssets();

})();
