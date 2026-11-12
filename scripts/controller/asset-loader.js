
 // Task 1.1.7 - Show a loading screen while app data loads
(function () {

    const loadingOverlay = document.getElementById("loading-overlay");
    const statusBanner = document.getElementById("status-banner");

    // Load the data without freezing the webpage
    async function loadAssets() {

        if (!loadingOverlay || !window.ReferenceCache) {
            console.error("Loading screen or reference cache is missing.");
            return;
        }

        // Show Loading... while the data is being prepared
        loadingOverlay.hidden = false;

        try {

            // Reuse the metadata loader from Task 1.1.5
            await window.ReferenceCache.loadReferences();

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
            loadingOverlay.hidden = true;

        }
    }

    // Start loading when the Controller runs
    loadAssets();

})();