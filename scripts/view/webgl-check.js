
// scripts/view/webgl-check.js
//
// The 3D mannequin needs WebGL. Some browsers and devices don't have it
// (graphics acceleration turned off, old hardware, locked-down browsers).
// When WebGL is missing this script:
//   1. hides the 3D mannequin (CSS does the hiding, using the "no-webgl" class)
//   2. stops the mannequin page from loading
//   3. shows a short notice explaining that WebGL is unavailable
//
// Our current Sketch Upload code also checks for WebGL before running
// pose detection, so new sketches cannot be analyzed without WebGL.
//
// It checks for WebGL itself, and it also listens for the mannequin page
// reporting a failure (MANNEQUIN_WEBGL_UNAVAILABLE).
//
// Other scripts can test: document.documentElement.classList.contains("no-webgl")

(function () {

    const NOTICE_TEXT =
        "Your browser has WebGL turned off or unavailable, so both the 3D mannequin " +
        "and sketch pose analysis cannot run. Please enable WebGL or hardware " +
        "acceleration, or try another browser.";

    // Check whether the browser can create a WebGL context
    function webglAvailable() {

        try {
            const canvas = document.createElement("canvas");

            return Boolean(
                canvas.getContext("webgl2") ||
                canvas.getContext("webgl") ||
                canvas.getContext("experimental-webgl")
            );

        } catch (error) {

            console.warn(
                "Could not check WebGL availability:",
                error
            );

            return false;
        }
    }

    // Hide the mannequin and explain why WebGL features are unavailable
    function switchToSketchOnly() {

        const root = document.documentElement;

        // Do not repeat the fallback setup
        if (root.classList.contains("no-webgl")) {
            return;
        }

        root.classList.add("no-webgl");

        // Stop the 3D page from loading (it can't work without WebGL)
        const frame = document.getElementById("mannequin-frame");

        if (frame && frame.getAttribute("src") !== "about:blank") {
            frame.src = "about:blank";
        }

        // A notice that stays on the page
        // (the status banner gets cleared by Search)
        if (!document.getElementById("webgl-notice")) {

            const notice = document.createElement("p");

            notice.id = "webgl-notice";
            notice.setAttribute("role", "status");
            notice.textContent = NOTICE_TEXT;

            const columns = document.getElementById(
                "workspace-columns"
            );

            if (columns && columns.parentNode) {

                columns.parentNode.insertBefore(
                    notice,
                    columns
                );

            } else {

                document.body.prepend(notice);

            }
        }

        console.warn(
            "WebGL is not available: the 3D mannequin is hidden."
        );
    }

    // 1. Check right away
    if (!webglAvailable()) {
        switchToSketchOnly();
    }

    // 2. The mannequin page tells us if it could not start WebGL
    window.addEventListener("message", (event) => {

        const frame = document.getElementById(
            "mannequin-frame"
        );

        // Only accept messages from our own mannequin iframe
        if (
            !frame?.contentWindow ||
            event.origin !== window.location.origin ||
            event.source !== frame.contentWindow
        ) {
            return;
        }

        if (
            event.data &&
            event.data.type === "MANNEQUIN_WEBGL_UNAVAILABLE"
        ) {
            switchToSketchOnly();
        }

    });

})();
