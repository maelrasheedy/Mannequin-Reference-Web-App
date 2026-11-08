
// Connect the upload page elements to JavaScript
const sketchUpload = document.getElementById("sketchUpload");
const imagePreview = document.getElementById("imagePreview");
const removeImage = document.getElementById("removeImage");
const changeImage = document.getElementById("changeImage");
const uploadMessage = document.getElementById("uploadMessage");
const uploadInstructions = document.getElementById("uploadInstructions");
const uploadArea = document.querySelector("main");

// Confirmation dialog buttons
const uploadConfirmDialog = document.getElementById("uploadConfirmDialog");
const confirmUpload = document.getElementById("confirmUpload");
const cancelUpload = document.getElementById("cancelUpload");

// Store the confirmed image and its detected pose
let confirmedImageFile = null;
let detectedPose = null;
let activePoseJson = null;

// Keep the previous confirmed pose in case an image change is canceled
let confirmedPose = null;
let confirmedPoseJson = null;

// Track the current image preview and pose detection process
let previewURL = null;
let detectionRunId = 0;

// Track when an image is loading so users cannot interrupt the process
let isUploadLoading = false;

// Lock or unlock the upload controls while an image is processing
function setUploadLoading(loading) {
    isUploadLoading = loading;

    sketchUpload.disabled = loading;
    removeImage.disabled = loading;
    changeImage.disabled = loading;

    uploadArea.setAttribute("aria-busy", String(loading));
}

// Hide the preview buttons until an image is selected
imagePreview.hidden = true;
removeImage.hidden = true;
changeImage.hidden = true;


// Send sketch pose updates to the main website
function sendPoseToMainPage() {
    if (window.parent !== window) {
        window.parent.postMessage({
            source: "image-upload",
            type: "pose-update",
            pose: activePoseJson
        }, window.location.origin);
    }
}


// Clear the current image preview and release its temporary URL
function clearPreview() {
    imagePreview.onload = null;
    imagePreview.onerror = null;
    imagePreview.removeAttribute("src");

    if (previewURL) {
        URL.revokeObjectURL(previewURL);
        previewURL = null;
    }
}


// Show the original upload screen when no image is selected
function showEmptyState(message = "") {
    imagePreview.hidden = true;
    removeImage.hidden = true;
    changeImage.hidden = true;

    uploadInstructions.hidden = false;
    uploadArea.classList.remove("has-image");

    uploadMessage.classList.remove("loading");
    uploadMessage.textContent = message;
}


// Restore the last confirmed image and its pose data
function restoreConfirmedImage() {
    if (!confirmedImageFile) {
        return false;
    }

    clearPreview();

    // Restore the confirmed file in the file input
    const restoredFiles = new DataTransfer();
    restoredFiles.items.add(confirmedImageFile);
    sketchUpload.files = restoredFiles.files;

    // Display the previous image again
    previewURL = URL.createObjectURL(confirmedImageFile);
    imagePreview.src = previewURL;
    imagePreview.hidden = false;

    uploadInstructions.hidden = true;
    uploadArea.classList.add("has-image");

    removeImage.hidden = false;
    changeImage.hidden = false;

    // Restore the pose data that belongs to the confirmed image
    detectedPose = confirmedPose;
    activePoseJson = confirmedPoseJson;

    sendPoseToMainPage();
    console.log("Restored sketch pose sent to main page");

    uploadMessage.classList.remove("loading");

    return true;
}


// Reject an invalid image and restore the previous one if available
function rejectImage(message) {
    sketchUpload.value = "";

    if (!restoreConfirmedImage()) {
        clearPreview();
        showEmptyState();
    }

    uploadMessage.textContent = message;
}


// Handle images selected through the file picker or drag and drop
sketchUpload.addEventListener("change", function () {
    const file = sketchUpload.files[0];

    // Keep the confirmed image if the user cancels the file picker
    if (!file) {
        if (confirmedImageFile) {
            restoreConfirmedImage();
        }
        return;
    }

    // Stop old detection results and clear the active sketch pose
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
    uploadMessage.classList.remove("loading");

    // Only JPG, JPEG, and PNG images are supported
    const allowedTypes = ["image/jpeg", "image/png"];
    const allowedExtensions = ["jpg", "jpeg", "png"];
    const fileExtension = file.name.split(".").pop().toLowerCase();

    if (
        !allowedTypes.includes(file.type) ||
        !allowedExtensions.includes(fileExtension)
    ) {
        rejectImage("Please select a JPG, JPEG, or PNG image.");
        return;
    }

    // Reject images larger than 10 MB
    const maxFileSize = 10 * 1024 * 1024;

    if (file.size > maxFileSize) {
        rejectImage("Image must be 10 MB or smaller.");
        return;
    }

    // Create a temporary URL to preview the selected image
    setUploadLoading(true);
    const imageURL = URL.createObjectURL(file);
    previewURL = imageURL;

    uploadMessage.textContent = "Loading...";
    uploadMessage.classList.add("loading");

    imagePreview.onload = function () {
        if (previewURL !== imageURL) {
            return;
        }
        setUploadLoading(false);

        imagePreview.onload = null;
        imagePreview.onerror = null;

        uploadMessage.classList.remove("loading");

        imagePreview.hidden = false;
        uploadInstructions.hidden = true;
        uploadArea.classList.add("has-image");

        removeImage.hidden = false;
        uploadMessage.textContent = "Image selected successfully!";

        // Ask the user to confirm the image before detecting its pose
        uploadConfirmDialog.showModal();
    };

    imagePreview.onerror = function () {
        if (previewURL !== imageURL) {
            return;
        }
        setUploadLoading(false);

        clearPreview();

        rejectImage(
            "Error: This image could not be opened. Please select a valid JPG or PNG image."
        );
    };

    imagePreview.src = imageURL;
});


// Remove the image and clear all saved pose information
removeImage.addEventListener("click", function () {
    detectionRunId++;

    confirmedImageFile = null;
    detectedPose = null;
    activePoseJson = null;

    confirmedPose = null;
    confirmedPoseJson = null;

    // Tell the main website that the sketch pose was removed
    sendPoseToMainPage();
    console.log("Sketch pose cleared from main page message");

    sketchUpload.value = "";

    clearPreview();
    showEmptyState("Image removed successfully!");

    console.log("Pose after removal:", detectedPose);
    console.log("Pose JSON after removal:", activePoseJson);
});

// Open the file picker when the empty upload area is clicked
uploadArea.addEventListener("click", function (event) {
    // Only open the picker when no image is displayed
    if (uploadArea.classList.contains("has-image")) {
        return;
    }

    // Don't interfere with buttons, dialogs, or the file input itself
    if (event.target.closest("button, dialog, input, a")) {
        return;
    }

    sketchUpload.click();
});

// Highlight the upload area when an image is dragged over it
uploadArea.addEventListener("dragover", function (event) {
    event.preventDefault();

    event.dataTransfer.dropEffect = "copy";
    uploadArea.classList.add("drag-over");
});


// Remove the highlight when the dragged file leaves the upload area
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


// Let users drop one image into the upload area
uploadArea.addEventListener("drop", function (event) {
    event.preventDefault();
    uploadArea.classList.remove("drag-over");

        // Ignore new files while an image is loading
    if (isUploadLoading) {
        return;
    }

    const droppedFiles = event.dataTransfer.files;

    if (droppedFiles.length !== 1) {
        uploadMessage.textContent = "Please drop one image at a time.";
        return;
    }

    // Run the same validation used by the file picker
    sketchUpload.files = droppedFiles;
    sketchUpload.dispatchEvent(new Event("change"));
});


// Confirm the image and start human pose detection
confirmUpload.addEventListener("click", async function () {
    uploadConfirmDialog.close();

    const file = sketchUpload.files[0];

    if (!file || !previewURL) {
        return;
    }

    // Lock the upload controls while we detect the pose
    setUploadLoading(true);

    // Save the newly confirmed image and clear old pose data
    confirmedImageFile = file;

    detectedPose = null;
    activePoseJson = null;

    confirmedPose = null;
    confirmedPoseJson = null;

    sendPoseToMainPage();
    console.log("Sketch pose cleared from main page message");

    changeImage.hidden = false;

    //Lock the upload controls while we detect the pose
    setUploadLoading(true);

    uploadMessage.textContent = "Detecting human pose...";
    uploadMessage.classList.add("loading");

    // Track this detection so older results cannot replace newer ones
    const imageBeingChecked = previewURL;
    const currentRunId = ++detectionRunId;

    function isCurrentImage() {
        return (
            currentRunId === detectionRunId &&
            previewURL === imageBeingChecked
        );
    }

    try {
        // Load MediaPipe and check the uploaded image for a human pose
        const { detectHumanPose } = await import("./pose-detection.js");

        if (!isCurrentImage()) {
            return;
        }

        const result = await detectHumanPose(imagePreview);

        if (!isCurrentImage()) {
            return;
        }

        // Stop if MediaPipe does not detect a human
        if (!result.detected) {
            uploadMessage.textContent = "Error! Human pose not detected.";
            return;
        }

        // Save the 33 image landmarks and 3D world landmarks
        detectedPose = {
            landmarks: result.landmarks,
            worldLandmarks: result.worldLandmarks
        };

        confirmedPose = detectedPose;

        console.log("Detected human pose:", detectedPose);

        try {
            // Convert the world landmarks into our team's 14-joint pose JSON
            const { generateUserPoseJson } = await import("./pose-vector.js");

            if (!isCurrentImage()) {
                return;
            }

            const userPoseJson = generateUserPoseJson(
                result.worldLandmarks
            );

            if (!isCurrentImage()) {
                return;
            }

            // Save the pose JSON and send it to the main website
            activePoseJson = userPoseJson;
            confirmedPoseJson = userPoseJson;

            sendPoseToMainPage();

            console.log("Sketch pose update sent to main page");
            console.log("Generated user pose JSON:", userPoseJson);
            console.log(
                "Number of pose joints:",
                userPoseJson.pose_vector.length
            );

            uploadMessage.textContent = "Human pose detected!";

        } catch (error) {
            if (!isCurrentImage()) {
                return;
            }

            // Clear pose JSON if visibility checks or angle calculations fail
            activePoseJson = null;
            confirmedPoseJson = null;

            console.log("Pose JSON after failed validation:", activePoseJson);
            console.error("Could not generate user pose JSON:", error);

            if (error.message?.includes("low visibility")) {
                uploadMessage.textContent =
                    "Human detected, but some body joints are unclear. Try a clearer full-body image.";
            } else {
                uploadMessage.textContent =
                    "Human detected, but the pose measurements could not be generated.";
            }
        }

    } catch (error) {
        if (!isCurrentImage()) {
            return;
        }

        // Show an error if MediaPipe cannot load or run
        console.error("Pose detection failed:", error);

        uploadMessage.textContent =
            "Error: Pose detection could not start. Please try again.";

    } finally {
    // Unlock the upload controls when pose detection finishes
    if (isCurrentImage()) {
        uploadMessage.classList.remove("loading");
        setUploadLoading(false);
        }
    }
});


// Cancel an upload and restore the previous confirmed image if there is one
function cancelPendingUpload() {
    if (uploadConfirmDialog.open) {
        uploadConfirmDialog.close();
    }

    detectionRunId++;

    if (confirmedImageFile) {
        restoreConfirmedImage();

        uploadMessage.textContent =
            "Change canceled. Your previous image is still selected.";

        console.log("Pose JSON after cancel:", activePoseJson);

    } else {
        // Return to the empty upload screen if no image was confirmed
        sketchUpload.value = "";

        clearPreview();

        detectedPose = null;
        activePoseJson = null;

        sendPoseToMainPage();
        showEmptyState("Image selection canceled.");
    }
}


// Run the cancel function when the Cancel button is clicked
cancelUpload.addEventListener("click", cancelPendingUpload);


// Make the Escape key work like the Cancel button
uploadConfirmDialog.addEventListener("cancel", function (event) {
    event.preventDefault();
    cancelPendingUpload();
});


// Open the file picker when the user clicks Change Image
changeImage.addEventListener("click", function () {
    sketchUpload.value = "";
    sketchUpload.click();
});


// Restore the confirmed image if the file picker is closed without a selection
sketchUpload.addEventListener("cancel", function () {
    if (confirmedImageFile) {
        restoreConfirmedImage();
    }
});
