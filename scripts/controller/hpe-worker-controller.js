// Task 1.2.7 - Send image data to the HPE Web Worker
(function () {

    let hpeWorker = null;

    // Reuse the same worker for future uploads
    function getHpeWorker() {
        if (!hpeWorker) {
            hpeWorker = new Worker("./pose-worker.js");
        }

        return hpeWorker;
    }

    // Send an image or canvas snapshot to the worker
    async function runPoseWorker(imageSource, runId) {

        // Make a transferable copy of the image
        const imageBitmap = await createImageBitmap(imageSource);

        return new Promise((resolve, reject) => {

            let worker;

            try {
                worker = getHpeWorker();
            } catch (error) {
                imageBitmap.close();
                reject(error);
                return;
            }

            // Stop listening after this request finishes
            function cleanup() {
                worker.removeEventListener("message", handleMessage);
                worker.removeEventListener("error", handleError);
            }

            // Get the result for the correct uploaded image
            function handleMessage(event) {
                if (event.data.runId !== runId) {
                    return;
                }

                cleanup();

                if (event.data.type === "pose-result") {
                    resolve(event.data);
                } else {
                    reject(new Error(
                        event.data.message || "Pose detection failed."
                    ));
                }
            }

            // Handle errors from the background worker
            function handleError(event) {
                cleanup();

                worker.terminate();

                if (hpeWorker === worker) {
                    hpeWorker = null;
                }

                reject(new Error(
                    event.message || "Could not start the pose worker."
                ));
            }

            worker.addEventListener("message", handleMessage);
            worker.addEventListener("error", handleError);

            try {
                // Transfer the image without copying its pixels again
                worker.postMessage(
                    { runId, imageBitmap },
                    [imageBitmap]
                );
            } catch (error) {
                cleanup();
                imageBitmap.close();
                reject(error);
            }
        });
    }

    // Let Sketch Upload use the Controller
    window.HpeWorkerController = {
        runPoseWorker
    };

})();