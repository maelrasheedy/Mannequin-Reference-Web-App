// scripts/view/gallery.js
//
// VIEW layer will draw the search results
// It only SHOWS what it is given and does NO matching
// Controllers call renderGallery(results) with
//   [ { id, url, score, partsCompared }, ... ]   (best match first)

const galleryGrid = document.getElementById("gallery-grid");
const imageViewer = document.getElementById("image-viewer");
const enlargedImage = document.getElementById("enlarged-image");
const closeViewerButton = document.getElementById("close-viewer-button");
const downloadButton = document.getElementById("download-button");

// The result currently shown in the enlarged view (used by Download)
let viewerResult = null;

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
    return url.replace("/upload/", `/upload/fl_attachment:${safeName}/`);
}

function downloadViewerImage() {
    if (!viewerResult) return;
    const link = document.createElement("a");
    link.href = cloudinaryDownloadUrl(viewerResult.url, viewerResult.id);
    link.download = `reference-${viewerResult.id}.jpg`; // used if same-origin
    document.body.appendChild(link);
    link.click();
    link.remove();
}

if (downloadButton) {
    downloadButton.addEventListener("click", downloadViewerImage);
}

   // Width of the enlarged picture. 1200 is plenty sharp for the viewer and
   // downloads noticeably faster than 1600.
   const VIEWER_WIDTH = 1200;

   // Start downloading the big version before the user clicks (see the hover
   // listeners in renderGallery). Remembering what we've asked for avoids repeats.
   const preloadedViewerImages = new Set();
   function preloadEnlarged(result) {
       const src = cloudinaryResized(result.url, VIEWER_WIDTH);
       if (preloadedViewerImages.has(src)) return;
       preloadedViewerImages.add(src);
       new Image().src = src;
   }

   function openImageViewer(result) {
       if (!imageViewer || !enlargedImage) return;
       viewerResult = result;
       enlargedImage.alt = `Reference image ${result.id}`;

       // Show the small thumbnail right away (it is already loaded), then swap in
       // the sharp version as soon as it has finished downloading.
       enlargedImage.src = cloudinaryThumbnail(result.url, 400);
       const sharpSrc = cloudinaryResized(result.url, VIEWER_WIDTH);
       const loader = new Image();
       loader.onload = () => {
           if (viewerResult === result) enlargedImage.src = sharpSrc;
       };
       loader.src = sharpSrc;

       imageViewer.showModal();
   }

if (closeViewerButton && imageViewer) {
    closeViewerButton.addEventListener("click", () => imageViewer.close());
}


  // A small notice above the gallery, e.g. when nothing matches closely.
  // Pass "" (or nothing) to remove it.
  function showGalleryNotice(text) {
      let notice = document.getElementById("gallery-notice");
      if (!text) {
          if (notice) notice.remove();
          return;
      }
      if (!notice) {
          notice = document.createElement("p");
          notice.id = "gallery-notice";
          notice.setAttribute("role", "status");
          galleryGrid.parentElement.insertBefore(notice, galleryGrid);
      }
      notice.textContent = text;
  }


function showGalleryMessage(text) {
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
    button.setAttribute("aria-label", `Enlarge reference image ${number} of ${total}`);
    button.title = `Pose difference: ${result.score}°`;
    button.addEventListener("click", () => openImageViewer(result));
    button.addEventListener("pointerenter", () => preloadEnlarged(result));
    button.addEventListener("focus", () => preloadEnlarged(result));

    const img = document.createElement("img");
    img.loading = "lazy";
    img.src = cloudinaryThumbnail(result.url, 400);
    img.alt = `Reference image ${result.id}, match number ${number}`;
    button.appendChild(img);

    figure.append(button);
    return figure;
}

// sections = [ { notice: "warning text, or empty", matches: [result, ...] }, ... ]
// Each section shows its warning line (if any) and then its photos.
function renderGallery(sections) {
    const total = sections.reduce((sum, s) => sum + s.matches.length, 0);
    if (total === 0) {
        showGalleryMessage("No matching reference images found.");
        return;
    }

    const items = [];
    let number = 0;
    for (const section of sections) {
        if (section.notice) {
            const notice = document.createElement("p");
            notice.className = "gallery-section-notice";
            notice.setAttribute("role", "status");
            notice.textContent = section.notice;
            items.push(notice);
        }
        for (const result of section.matches) {
            number += 1;
            items.push(createGalleryItem(result, number, total));
        }
    }
    galleryGrid.replaceChildren(...items);
}