
// Task 1.2.7 - Send image data to the HPE Web Worker
(function () {

    let hpeWorker = null;
    let pendingRequest = null;
    let requestVersion = 0;

    // Reuse the same worker for future uploads
    function getHpeWorker() {
        if (!hpeWorker) {

            // Use a module worker for our pose detection imports.
            // The path is relative to the upload page.
            hpeWorker = new Worker("./pose-worker.js");
        }

        return hpeWorker;
    }

    // Stop the worker if it fails or its current request is canceled
    function stopHpeWorker() {
        if (hpeWorker) {
            hpeWorker.terminate();
            hpeWorker = null;
        }
    }

    // Cancel a previous detection when a new image is processed
    function cancelPendingRequest() {
        if (!pendingRequest) {
            return;
        }

        const request = pendingRequest;
        pendingRequest = null;

        request.cleanup();

        // Stop the old image so it does not keep using resources
        stopHpeWorker();

        request.reject(
            new Error(
                "Pose detection canceled because a newer image was selected."
            )
        );
    }

    // Send an image or canvas snapshot to the worker
    async function runPoseWorker(imageSource, runId) {

        // Give this request its own version so older image conversions
        // cannot start a worker after a newer upload begins.
        const currentVersion = ++requestVersion;

        cancelPendingRequest();

        // Make a transferable copy of the image
        const imageBitmap = await createImageBitmap(imageSource);

        if (currentVersion !== requestVersion) {
            imageBitmap.close();

            throw new Error(
                "Pose detection canceled because a newer image was selected."
            );
        }

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
                worker.removeEventListener(
                    "messageerror",
                    handleMessageError
                );
            }

            const request = {
                cleanup,
                reject
            };

            // Finish only the currently active request
            function finishRequest(callback, value, restartWorker = false) {
                if (pendingRequest !== request) {
                    return;
                }

                pendingRequest = null;

                cleanup();

                if (restartWorker) {
                    stopHpeWorker();
                }

                callback(value);
            }

            // Get the result for the correct uploaded image
            function handleMessage(event) {
                const data = event.data;

                if (!data || data.runId !== runId) {
                    return;
                }

                if (data.type === "pose-result") {
                    finishRequest(resolve, data);
                    return;
                }

                if (data.type === "pose-error") {
                    finishRequest(
                        reject,
                        new Error(
                            data.message || "Pose detection failed."
                        )
                    );
                    return;
                }

                // Do not accept unknown worker messages as valid results
                finishRequest(
                    reject,
                    new Error("Unexpected pose worker response.")
                );
            }

            // Handle errors from the background worker
            function handleError(event) {
                finishRequest(
                    reject,
                    new Error(
                        event.message || "Could not start the pose worker."
                    ),
                    true
                );
            }

            // Handle image or message transfer errors
            function handleMessageError() {
                finishRequest(
                    reject,
                    new Error(
                        "Could not read the message from the pose worker."
                    ),
                    true
                );
            }

            worker.addEventListener("message", handleMessage);
            worker.addEventListener("error", handleError);
            worker.addEventListener(
                "messageerror",
                handleMessageError
            );

            pendingRequest = request;

            try {
                // Transfer the image without copying its pixels again
                worker.postMessage(
                    { runId, imageBitmap },
                    [imageBitmap]
                );
            } catch (error) {
                finishRequest(reject, error, true);

                // Close the bitmap if the transfer did not succeed
                imageBitmap.close();
            }
        });
    }

    // Allow Sketch Upload to cancel an active detection
    function cancelPoseWorker() {
        requestVersion++;
        cancelPendingRequest();
    }

    // Let Sketch Upload use the Controller
    window.HpeWorkerController = {
        runPoseWorker,
        cancelPoseWorker
    };

})();
