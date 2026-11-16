

// Task 1.1.5 - Load the reference images data into memory
(function () {

    const METADATA_URL = "assets/metadata/images-metadata.json";

    // Keep the loaded data while the website is open
    let cachedReferences = null;
    let loadPromise = null;

    function loadReferences() {

        // Use the saved data if we already loaded it
        if (cachedReferences !== null) {
            return Promise.resolve(cachedReferences);
        }

        // Don't download the file again while it's loading
        if (loadPromise) {
            return loadPromise;
        }

        // Get the image information from the JSON file
        loadPromise = fetch(METADATA_URL)
            .then((response) => {

                if (!response.ok) {
                    throw new Error(
                        `Could not load ${METADATA_URL} (${response.status})`
                    );
                }

                return response.json();
            })
            .then((data) => {

                // Search expects an array of reference image records
                if (!Array.isArray(data)) {
                    throw new Error(
                        "Reference metadata must contain an array of images."
                    );
                }

                // Save the parsed JSON in memory
                // Keep all existing fields, including estimated_segments.
                cachedReferences = data;

                console.log("Reference image metadata loaded into RAM.");

                console.log(
                    "Total reference images:",
                    cachedReferences.length
                );

                // Check how many references have estimated body segments.
                // Do not remove or change the original metadata.
                const referencesWithEstimatedSegments =
                    cachedReferences.filter((reference) =>
                        Array.isArray(reference?.estimated_segments) &&
                        reference.estimated_segments.length > 0
                    ).length;

                console.log(
                    "References with estimated body segments:",
                    referencesWithEstimatedSegments
                );

                return cachedReferences;
            })
            .catch((error) => {

                // Allow another attempt if loading fails
                loadPromise = null;

                console.error(
                    "Could not load reference image metadata:",
                    error
                );

                throw error;
            });

        return loadPromise;
    }

    // Let other parts of the website use the same cached data
    window.ReferenceCache = {
        loadReferences
    };

    // Start loading as soon as this script runs
    loadReferences().catch((error) => {
        console.warn("Could not preload reference metadata:", error);
    });

})();
