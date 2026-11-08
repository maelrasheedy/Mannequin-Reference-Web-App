// MANNEQUIN CONTROLS this is part of the View layer.

// It connects the main website's Rotate, Bend, and Tilt buttons to the 3D mannequin inside its iframe.

const mannequinFrame = document.getElementById("mannequin-frame");

// Available mannequin control tools
const mannequinTools = ["rotate", "bend", "tilt"];

// Connect each button to its corresponding tool
mannequinTools.forEach((tool) => {

    const button = document.getElementById(`${tool}-button`);

    button.addEventListener("click", () => {

        // Send the selected tool to the 3D mannequin
        mannequinFrame.contentWindow.postMessage(
            {
                type: "mannequin:set-tool",
                tool: tool
            },
            window.location.origin
        );

        console.log("Selected mannequin tool:", tool);
    });
});