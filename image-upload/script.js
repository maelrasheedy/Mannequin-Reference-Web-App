
// Get the elements we need from the upload page
const sketchUpload = document.getElementById("sketchUpload");
const imagePreview = document.getElementById("imagePreview");
const removeImage = document.getElementById("removeImage");
const changeImage = document.getElementById("changeImage");
const uploadMessage = document.getElementById("uploadMessage");
const uploadInstructions = document.getElementById("uploadInstructions");
const uploadArea = document.querySelector("main");

const uploadConfirmDialog = document.getElementById("uploadConfirmDialog");
const confirmUpload = document.getElementById("confirmUpload");
const cancelUpload = document.getElementById("cancelUpload");

// Save the confirmed image and pose if someone cancels a change
let confirmedImageFile = null;
let detectedPose = null;
let activePoseJson = null;

let confirmedPose = null;
let confirmedPoseJson = null;

// Keep track of the image and detection process
let previewURL = null;
let detectionRunId = 0;

let imageArrayBuffer = null;

let isUploadLoading = false;
let activeUploadTimer = null;


// Lock the upload controls while the image is processing
function setUploadLoading(loading) {
    isUploadLoading = loading;

    sketchUpload.disabled = loading;
    removeImage.disabled = loading;
    changeImage.disabled = loading;
    confirmUpload.disabled = loading;
    cancelUpload.disabled = loading;

    uploadArea.setAttribute("aria-busy", String(loading));

    if (loading) {
        uploadArea.classList.remove("drag-over");
    }
}


// Task 4.1.11 - Stop any upload timeout that might be running
function stopUploadTimer() {
    if (activeUploadTimer !== null) {
        clearTimeout(activeUploadTimer);
        activeUploadTimer = null;
    }
}


// Task 4.1.11 - Handle errors and reset the loading state
function handleUploadException(error, message) {
    stopUploadTimer();

    uploadMessage.classList.remove("loading");
    setUploadLoading(false);

    uploadMessage.textContent =
        message ||
        "Something went wrong while processing the image. Please try again.";

    console.error("Sketch upload error:", error);
}


// Task 4.1.10 - Show a helpful message when pose detection cannot load
function getPoseDetectionErrorMessage(error) {
    const errorMessage = String(error?.message || error || "");

    if (navigator.onLine === false) {
        return "You are offline. Check your internet connection and try again.";
    }

    const networkError =
        /failed to fetch|fetch failed|networkerror|network error|dynamically imported module|importing a module script failed|err_internet_disconnected|err_name_not_resolved/i.test(
            errorMessage
        );

    if (networkError) {
        return "Could not load pose detection files. Check your connection and try again.";
    }

    return "Error: Pose detection could not start. Please try again.";
}


// Start with the preview and buttons hidden
imagePreview.hidden = true;
removeImage.hidden = true;
changeImage.hidden = true;


// Send the sketch pose to the main website
function sendPoseToMainPage() {
    if (window.parent !== window) {
        window.parent.postMessage(
            {
                source: "image-upload",
                type: "pose-update",
                pose: activePoseJson
            },
            window.location.origin
        );
    }
}


// Task 4.5.6 - Clear invalid sketch pose data
function clearInvalidSketchPose() {
    detectedPose = null;
    activePoseJson = null;

    // Clear any saved pose data from the invalid image
    confirmedPose = null;
    confirmedPoseJson = null;

    // Tell the main page that no valid sketch pose is available
    sendPoseToMainPage();

    console.log("Invalid sketch pose data cleared.");
}


// Clear the image preview and release its temporary URL
function clearPreview() {
    imagePreview.onload = null;
    imagePreview.onerror = null;
    imagePreview.removeAttribute("src");

    if (previewURL) {
        URL.revokeObjectURL(previewURL);
        previewURL = null;
    }
}


// Task 4.1.8 - Clear the image and all saved pose data
function clearImageAndPoseState() {
    detectionRunId++;
    stopUploadTimer();

    if (imageArrayBuffer instanceof ArrayBuffer) {
        try {
            new Uint8Array(imageArrayBuffer).fill(0);
        } catch (error) {
            console.warn("Could not clear image buffer:", error);
        }
    }

    imageArrayBuffer = null;

    confirmedImageFile = null;
    detectedPose = null;
    activePoseJson = null;

    confirmedPose = null;
    confirmedPoseJson = null;

    sketchUpload.value = "";

    clearPreview();
    setUploadLoading(false);

    // Tell the main website that the sketch pose was removed
    sendPoseToMainPage();

    console.log("Image and pose data cleared.");
}


// Return the upload area to its empty state
function showEmptyState(message = "") {
    imagePreview.hidden = true;
    removeImage.hidden = true;
    changeImage.hidden = true;

    uploadInstructions.hidden = false;

    uploadArea.classList.remove("has-image", "drag-over");

    uploadMessage.classList.remove("loading");
    uploadMessage.textContent = message;
}


// Restore the previous image if a change is canceled
function restoreConfirmedImage() {
    if (!confirmedImageFile) {
        return false;
    }

    clearPreview();

    const restoredFiles = new DataTransfer();
    restoredFiles.items.add(confirmedImageFile);
    sketchUpload.files = restoredFiles.files;

    previewURL = URL.createObjectURL(confirmedImageFile);
    imagePreview.src = previewURL;
    imagePreview.hidden = false;

    uploadInstructions.hidden = true;
    uploadArea.classList.add("has-image");

    removeImage.hidden = false;
    changeImage.hidden = false;

    detectedPose = confirmedPose;
    activePoseJson = confirmedPoseJson;

    uploadMessage.classList.remove("loading");

    sendPoseToMainPage();

    return true;
}


// Show a validation error without losing the old image
function rejectImage(message) {
    sketchUpload.value = "";

    if (!restoreConfirmedImage()) {
        clearPreview();
        showEmptyState();
    }

    uploadMessage.textContent = message;
}


// Handle images selected from the picker or drag and drop
sketchUpload.addEventListener("change", function () {
    if (isUploadLoading) {
        return;
    }

    const file = sketchUpload.files[0];

    if (!file) {
        if (confirmedImageFile) {
            restoreConfirmedImage();
        } else {
            showEmptyState();
        }
        return;
    }

    // Check the image type and file size
    const allowedTypes = ["image/jpeg", "image/png"];
    const allowedExtensions = ["jpg", "jpeg", "png"];

    const fileExtension = file.name
        .split(".")
        .pop()
        .toLowerCase();

    if (
        !allowedTypes.includes(file.type) ||
        !allowedExtensions.includes(fileExtension)
    ) {
        rejectImage("Please select a JPG, JPEG, or PNG image.");
        return;
    }

    const maxFileSize = 10 * 1024 * 1024;

    if (file.size > maxFileSize) {
        rejectImage("Image must be 10 MB or smaller.");
        return;
    }

    // Clear the active pose while the new image is loading
    detectionRunId++;
    clearPreview();

    detectedPose = null;
    activePoseJson = null;

    sendPoseToMainPage();

    imagePreview.hidden = true;
    removeImage.hidden = true;
    changeImage.hidden = true;

    uploadInstructions.hidden = false;
    uploadArea.classList.remove("has-image");

    uploadMessage.textContent = "";

    // Show Loading… and lock the controls
    setUploadLoading(true);

    let imageURL;

    try {
        imageURL = URL.createObjectURL(file);
    } catch (error) {
        const errorMessage = "This image could not be opened.";

        rejectImage(errorMessage);
        handleUploadException(error, errorMessage);
        return;
    }

    previewURL = imageURL;

    uploadMessage.textContent = "Loading…";
    uploadMessage.classList.add("loading");

    imagePreview.onload = function () {
        if (previewURL !== imageURL) {
            return;
        }

        imagePreview.onload = null;
        imagePreview.onerror = null;

        stopUploadTimer();
        setUploadLoading(false);

        uploadMessage.classList.remove("loading");

        imagePreview.hidden = false;
        uploadInstructions.hidden = true;
        uploadArea.classList.add("has-image");

        removeImage.hidden = false;

        uploadMessage.textContent =
        "Image selected successfully!";

        uploadConfirmDialog.showModal();
    };

    imagePreview.onerror = function () {
        if (previewURL !== imageURL) {
            return;
        }

        const errorMessage =
            "Error: This image could not be opened. Please select a valid JPG or PNG image.";

        // Keep the previous image if there was one
        rejectImage(errorMessage);

        // Stop loading and show the error message
        handleUploadException(
            new Error("Image preview failed to load."),
            errorMessage
        );
    };

    imagePreview.src = imageURL;
});


// Remove the image and all its saved pose information
removeImage.addEventListener("click", function () {
    if (isUploadLoading || uploadConfirmDialog.open) {
        return;
    }

    clearImageAndPoseState();
    showEmptyState("Image removed successfully!");
});


// Open the file picker when the empty upload area is clicked
uploadArea.addEventListener("click", function (event) {
    if (isUploadLoading || uploadConfirmDialog.open) {
        return;
    }

    if (uploadArea.classList.contains("has-image")) {
        return;
    }

    if (event.target.closest("button, dialog, input, a")) {
        return;
    }

    sketchUpload.click();
});


// Highlight the upload area during drag and drop
uploadArea.addEventListener("dragover", function (event) {
    event.preventDefault();

    if (isUploadLoading || uploadConfirmDialog.open) {
        event.dataTransfer.dropEffect = "none";
        uploadArea.classList.remove("drag-over");
        return;
    }

    event.dataTransfer.dropEffect = "copy";
    uploadArea.classList.add("drag-over");
});

uploadArea.addEventListener("dragleave", function (event) {
    const box = uploadArea.getBoundingClientRect();

    if (
        event.clientX <= box.left ||
        event.clientX >= box.right ||
        event.clientY <= box.top ||
        event.clientY >= box.bottom
    ) {
        uploadArea.classList.remove("drag-over");
    }
});


// Use the same validation for dropped images
uploadArea.addEventListener("drop", function (event) {
    event.preventDefault();
    uploadArea.classList.remove("drag-over");

    if (isUploadLoading || uploadConfirmDialog.open) {
        return;
    }

    const droppedFiles = event.dataTransfer.files;

    if (droppedFiles.length !== 1) {
        uploadMessage.textContent =
            "Please drop one image at a time.";
        return;
    }

    sketchUpload.files = droppedFiles;
    sketchUpload.dispatchEvent(new Event("change"));
});


// Confirm the image and start human pose detection
confirmUpload.addEventListener("click", async function () {
    if (isUploadLoading) {
        return;
    }

    const file = sketchUpload.files[0];

    if (!file || !previewURL) {
        return;
    }

    uploadConfirmDialog.close();
    setUploadLoading(true);

    confirmedImageFile = file;

    // Start the new detection without any old pose data
    clearInvalidSketchPose();

    changeImage.hidden = false;

    uploadMessage.textContent = "Detecting human pose...";
    uploadMessage.classList.add("loading");

    // Give each detection a number so old results can be ignored
    const imageBeingChecked = previewURL;
    const currentRunId = ++detectionRunId;

    function isCurrentImage() {
        return (
            currentRunId === detectionRunId &&
            previewURL === imageBeingChecked
        );
    }

    try {
        // Let the Web Worker detect the human pose
        const workerResponse = await window.HpeWorkerController.runPoseWorker(
            imagePreview,
            currentRunId
        );

        if (!isCurrentImage()) {
            return;
        }

        // Get the detection results sent back by the worker
        const result = workerResponse.result;

        if (!isCurrentImage()) {
            return;
        }

        // Check the average landmark visibility
        console.log(
            "Average Landmark Visibility:",
            result?.averageLandmarkConfidence ?? 0
        );

        // Stop processing if no human pose was detected
        if (!result?.detected || !result?.landmarks?.length) {
            const message = "Error!!! Pose not Detected";

            clearInvalidSketchPose();

            uploadMessage.textContent = message;
            window.alert(message);
            return;
        }

        // Reject poses with an average landmark visibility below 70%
        if (
            !Number.isFinite(result.averageLandmarkConfidence) ||
            result.averageLandmarkConfidence < 0.7
        ) {
            const message =
                "Error! Landmark confidence is below 70%. Please upload a clearer image of a person.";

            clearInvalidSketchPose();

            uploadMessage.textContent = message;
            window.alert(message);
            return;
        }

        detectedPose = {
            landmarks: result.landmarks,
            worldLandmarks: result.worldLandmarks
        };

        console.log("Detected human pose:", detectedPose);

        try {
            // Use the 14-joint pose already calculated by the Web Worker
            const userPoseJson = workerResponse.userPoseJson;

            if (!isCurrentImage()) {
                return;
            }

            // Verify that the pose contains all 14 joints
            if (
                !userPoseJson ||
                !Array.isArray(userPoseJson.pose_vector) ||
                userPoseJson.pose_vector.length !== 14
            ) {
                throw new Error("Incomplete pose JSON.");
            }

            // Save and send only a successfully generated pose
            activePoseJson = userPoseJson;
            confirmedPose = detectedPose;
            confirmedPoseJson = userPoseJson;

            sendPoseToMainPage();

            console.log(
                "Sketch pose sent to main page:",
                userPoseJson
            );

            uploadMessage.textContent = "Human pose detected!";

        } catch (error) {
            if (!isCurrentImage()) {
                return;
            }

            // Clear incomplete or invalid pose measurements
            clearInvalidSketchPose();

            const errorMessage = error.message?.includes("low visibility")
                ? "Human detected, but some body joints are unclear. Try a clearer full-body image."
                : "Human detected, but the pose measurements could not be generated.";

            handleUploadException(error, errorMessage);
        }

    } catch (error) {
        if (!isCurrentImage()) {
            return;
        }

        // Clear the pose if MediaPipe fails to run
        clearInvalidSketchPose();

        // Handle MediaPipe loading errors, including network failures
        handleUploadException(
            error,
            getPoseDetectionErrorMessage(error)
        );

    } finally {
        // Always stop loading after the current detection finishes
        if (isCurrentImage()) {
            stopUploadTimer();
            uploadMessage.classList.remove("loading");
            setUploadLoading(false);
        }
    }
});


// Bring back the old image if changing it is canceled
function cancelPendingUpload() {
    if (isUploadLoading) {
        return;
    }

    if (uploadConfirmDialog.open) {
        uploadConfirmDialog.close();
    }

    if (confirmedImageFile) {
        detectionRunId++;

        restoreConfirmedImage();

        uploadMessage.textContent =
            "Change canceled. Your previous image is still selected.";
    } else {
        clearImageAndPoseState();
        showEmptyState("Image selection canceled.");
    }
}

cancelUpload.addEventListener("click", cancelPendingUpload);

// Treat Escape the same as clicking Cancel
uploadConfirmDialog.addEventListener("cancel", function (event) {
    event.preventDefault();
    cancelPendingUpload();
});


// Change Image opens the picker without removing the old image
changeImage.addEventListener("click", function () {
    if (isUploadLoading || uploadConfirmDialog.open) {
        return;
    }

    sketchUpload.value = "";
    sketchUpload.click();
});

// Restore the previous image if the file picker is canceled
sketchUpload.addEventListener("cancel", function () {
    if (isUploadLoading) {
        return;
    }

    if (confirmedImageFile) {
        restoreConfirmedImage();
    }
});