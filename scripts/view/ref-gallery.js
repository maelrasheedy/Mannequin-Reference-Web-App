
// scripts/view/ref-gallery.js
//
// VIEW layer will draw the search results
// It only SHOWS what it is given and does NO matching
// Controllers call renderGallery(results) with
// grouped sections containing [ { id, url, score, partsCompared }, ... ]
// (best match first)

const galleryGrid = document.getElementById("gallery-grid");
const imageViewer = document.getElementById("image-viewer");
const enlargedImage = document.getElementById("enlarged-image");
const closeViewerButton = document.getElementById("close-viewer-button");
const downloadButton = document.getElementById("download-button");

// The result currently shown in the enlarged view (used by Download)
let viewerResult = null;

// Keep track of image requests so old images cannot replace newer ones
let viewerLoadVersion = 0;

// Cloudinary can resize images for us by adding settings to the URL:
//   .../upload/000082.jpg  ->  .../upload/w_400,c_limit,q_auto,f_auto/000082.jpg
// Small thumbnails load much faster than the full-size originals.
function cloudinaryResized(url, width) {
    if (!url.includes("res.cloudinary.com") || !url.includes("/upload/")) {
        return url;
    }

    return url.replace(
        "/upload/",
        `/upload/w_${width},c_limit,q_auto,f_auto/`
    );
}


// Thumbnails: Cloudinary crops to 3:4 around the most important area
// (c_auto + g_auto) so the person stays in the picture.
function cloudinaryThumbnail(url, width) {
    if (!url.includes("res.cloudinary.com") || !url.includes("/upload/")) {
        return url;
    }

    return url.replace(
        "/upload/",
        `/upload/c_auto,g_auto,ar_3:4,w_${width},q_auto,f_auto/`
    );
}


// Cloudinary can ask the browser to SAVE an image instead of showing it
// Adding the fl_attachment flag makes it send a "download this file" header,
// which also works across websites (the HTML "download" attribute does not).
//   .../upload/000082.jpg -> .../upload/fl_attachment:reference-000082/000082.jpg
// This downloads the full-size original, not the resized copy.
function cloudinaryDownloadUrl(url, id) {
    if (!url.includes("res.cloudinary.com") || !url.includes("/upload/")) {
        return url;
    }

    const safeName = `reference-${String(id).replace(/[^A-Za-z0-9_-]/g, "")}`;

    return url.replace(
        "/upload/",
        `/upload/fl_attachment:${safeName}/`
    );
}


// Download the image currently displayed in the viewer
function downloadViewerImage() {
    if (!viewerResult || !imageViewer?.open) {
        return;
    }

    const safeId = String(viewerResult.id)
        .replace(/[^A-Za-z0-9_-]/g, "");

    const link = document.createElement("a");

    link.href = cloudinaryDownloadUrl(
        viewerResult.url,
        viewerResult.id
    );

    link.download = `reference-${safeId}.jpg`; // used if same-origin

    document.body.appendChild(link);
    link.click();
    link.remove();
}

if (downloadButton) {
    downloadButton.addEventListener(
        "click",
        downloadViewerImage
    );
}


// Width of the enlarged picture. 1200 is plenty sharp for the viewer and
// downloads noticeably faster than 1600.
const VIEWER_WIDTH = 1200;

// Start downloading the big version before the user clicks (see the hover
// listeners in renderGallery). Remembering what we've asked for avoids repeats.
const preloadedViewerImages = new Set();

function preloadEnlarged(result) {
    if (!result?.url) {
        return;
    }

    const src = cloudinaryResized(
        result.url,
        VIEWER_WIDTH
    );

    if (preloadedViewerImages.has(src)) {
        return;
    }

    preloadedViewerImages.add(src);

    const image = new Image();

    // Allow another attempt if the image failed to download
    image.onerror = () => {
        preloadedViewerImages.delete(src);
    };

    image.src = src;
}


// Open the selected reference image at a larger size
function openImageViewer(result) {
    if (
        !imageViewer ||
        !enlargedImage ||
        !result?.url
    ) {
        return;
    }

    // Stop an older image request from replacing this one
    const currentLoadVersion = ++viewerLoadVersion;

    viewerResult = result;

    enlargedImage.alt = `Reference image ${result.id}`;

    const thumbnailSrc = cloudinaryThumbnail(
        result.url,
        400
    );

    const sharpSrc = cloudinaryResized(
        result.url,
        VIEWER_WIDTH
    );

    // Show the small thumbnail right away (it is already loaded), then swap in
    // the sharp version as soon as it has finished downloading.
    let usedOriginalFallback = false;

    enlargedImage.onerror = () => {

        // Ignore errors belonging to a previous viewer request
        if (currentLoadVersion !== viewerLoadVersion) {
            return;
        }

        // Try the original if Cloudinary's transformed image fails
        if (!usedOriginalFallback) {
            usedOriginalFallback = true;
            enlargedImage.src = result.url;
        }
    };

    enlargedImage.src = thumbnailSrc;

    const loader = new Image();

    loader.onload = () => {

        // Only update the viewer if this image is still selected
        if (
            currentLoadVersion !== viewerLoadVersion ||
            viewerResult !== result ||
            !imageViewer.open
        ) {
            return;
        }

        enlargedImage.src = sharpSrc;
    };

    // If the sharp image fails, keep showing the thumbnail
    // or its original-image fallback.
    loader.onerror = () => {
        console.warn(
            "Could not load enlarged reference image:",
            result.id
        );
    };

    loader.src = sharpSrc;

    // Do not open an already open dialog again
    if (!imageViewer.open) {
        imageViewer.showModal();
    }
}


// Close the enlarged image viewer
if (closeViewerButton && imageViewer) {
    closeViewerButton.addEventListener(
        "click",
        () => imageViewer.close()
    );
}


// Clear the previous selection when the viewer closes
// This also handles closing the dialog with Escape.
if (imageViewer) {
    imageViewer.addEventListener("close", () => {

        // Ignore any image still downloading for the closed viewer
        viewerLoadVersion++;

        viewerResult = null;

        if (enlargedImage) {
            enlargedImage.onerror = null;
            enlargedImage.removeAttribute("src");
        }
    });
}


// A small notice above the gallery, e.g. when nothing matches closely.
// Pass "" (or nothing) to remove it.
function showGalleryNotice(text) {
    let notice = document.getElementById("gallery-notice");

    if (!text) {
        if (notice) {
            notice.remove();
        }

        return;
    }

    if (!galleryGrid?.parentElement) {
        return;
    }

    if (!notice) {
        notice = document.createElement("p");
        notice.id = "gallery-notice";
        notice.setAttribute("role", "status");

        galleryGrid.parentElement.insertBefore(
            notice,
            galleryGrid
        );
    }

    notice.textContent = text;
}


// Display a message instead of gallery images
function showGalleryMessage(text) {
    if (!galleryGrid) {
        return;
    }

    showGalleryNotice("");

    galleryGrid.replaceChildren();

    const message = document.createElement("p");
    message.textContent = text;

    galleryGrid.appendChild(message);
}


// One thumbnail + caption for a result.
function createGalleryItem(result, number, total) {
    const figure = document.createElement("figure");
    figure.className = "gallery-item";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "gallery-thumb";

    button.setAttribute(
        "aria-label",
        `Enlarge reference image ${number} of ${total}`
    );

    button.title = `Pose difference: ${result.score}°`;

    button.addEventListener(
        "click",
        () => openImageViewer(result)
    );

    button.addEventListener(
        "pointerenter",
        () => preloadEnlarged(result)
    );

    button.addEventListener(
        "focus",
        () => preloadEnlarged(result)
    );

    const img = document.createElement("img");
    img.loading = "lazy";

    img.src = cloudinaryThumbnail(
        result.url,
        400
    );

    img.alt = `Reference image ${result.id}, match number ${number}`;

    // If a transformed thumbnail fails, try the original image.
    // Only attempt the fallback once to avoid repeated errors.
    let triedOriginalImage = false;

    img.addEventListener("error", () => {

        if (!triedOriginalImage) {
            triedOriginalImage = true;
            img.src = result.url;
        }
    });

    button.appendChild(img);

    figure.append(button);

    return figure;
}


// sections = [ { notice: "warning text, or empty", matches: [result, ...] }, ... ]
// Each section shows its warning line (if any) and then its photos.
function renderGallery(sections) {

    if (!galleryGrid) {
        console.warn("Gallery grid element was not found.");
        return;
    }

    // Keep the grouped result format used by search-controller.js.
    // Ignore invalid sections rather than crashing the gallery.
    if (!Array.isArray(sections)) {
        showGalleryMessage("No matching reference images found.");
        return;
    }

    const validSections = sections
        .filter((section) =>
            section &&
            Array.isArray(section.matches)
        )
        .map((section) => ({
            notice: typeof section.notice === "string"
                ? section.notice
                : "",

            // Keep the original matching order.
            // Only show references with usable image URLs.
            matches: section.matches.filter((result) =>
                result &&
                typeof result.url === "string" &&
                result.url.length > 0
            )
        }));

    const total = validSections.reduce(
        (sum, section) => sum + section.matches.length,
        0
    );

    if (total === 0) {
        showGalleryMessage(
            "No matching reference images found."
        );

        return;
    }

    showGalleryNotice("");

    const items = [];
    let number = 0;

    for (const section of validSections) {

        if (section.notice && section.matches.length > 0) {
            const notice = document.createElement("p");

            notice.className = "gallery-section-notice";
            notice.setAttribute("role", "status");
            notice.textContent = section.notice;

            items.push(notice);
        }

        for (const result of section.matches) {
            number += 1;

            items.push(
                createGalleryItem(
                    result,
                    number,
                    total
                )
            );
        }
    }

    galleryGrid.replaceChildren(...items);
}
