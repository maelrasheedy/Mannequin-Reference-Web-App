// refernce image gallery 
//
// VIEW layer: draws the search results
// only shows what is given and does NO matching. 
// CONTROLLERS call renderGallery(results) with
// [ { id, url, score, partsCompared }, ... ]   (best match first)

const galleryGrid = document.getElementById("gallery-grid");
const imageViewer = document.getElementById("image-viewer");
const enlargedImage = document.getElementById("enlarged-image");
const closeViewerButton = document.getElementById("close-viewer-button");

// Cloudinary can resize images by adding settings to the URL:
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

function openImageViewer(result) {
    if (!imageViewer || !enlargedImage) return;
    enlargedImage.src = cloudinaryResized(result.url, 1600);
    enlargedImage.alt = `Reference image ${result.id}`;
    imageViewer.showModal();
}

if (closeViewerButton && imageViewer) {
    closeViewerButton.addEventListener("click", () => imageViewer.close());
}

function showGalleryMessage(text) {
    galleryGrid.replaceChildren();
    const message = document.createElement("p");
    message.textContent = text;
    galleryGrid.appendChild(message);
}

function renderGallery(results) {
    if (!results || results.length === 0) {
        showGalleryMessage("No matching reference images found.");
        return;
    }

    const items = results.map((result, index) => {
        const figure = document.createElement("figure");
        figure.className = "gallery-item";

        const button = document.createElement("button");
        button.type = "button";
        button.className = "gallery-thumb";
        button.setAttribute(
            "aria-label",
            `Enlarge reference image ${index + 1} of ${results.length}`
        );
        button.title = `Pose difference: ${result.score}°`;
        button.addEventListener("click", () => openImageViewer(result));

        const img = document.createElement("img");
        img.loading = "lazy";
        img.src = cloudinaryResized(result.url, 400);
        img.alt = `Reference image ${result.id}, match number ${index + 1}`;
        button.appendChild(img);

        const caption = document.createElement("figcaption");
        caption.textContent = `#${index + 1}`;

        figure.append(button, caption);
        return figure;
    });

    galleryGrid.replaceChildren(...items);
}