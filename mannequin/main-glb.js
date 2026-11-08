
import * as THREE from './three.js';
import { ColladaLoader } from './ColladaLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from './OrbitControls.js';

import { createRigTracker } from './rig-landmarks.js';//maryam added for mannequin pose detection


const scene = new THREE.Scene();
//scene.background = new THREE.Color(0x1a1a1a);
//added by maryam below to variable background color
const themeBackground = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-surface')
    .trim();
scene.background = new THREE.Color(themeBackground);


// Camera Setup
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);

// WebGL 2 Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// Lighting Configuration
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
keyLight.position.set(5, 10, 5);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 1.2);
fillLight.position.set(-5, 5, -5);
scene.add(fillLight);

const backLight = new THREE.DirectionalLight(0xffffff, 1.0);
backLight.position.set(0, 5, -8);
scene.add(backLight);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.autoRotate = false;
controls.autoRotateSpeed = 1.5;
controls.rotateSpeed = 1.25;
controls.zoomSpeed = 3.75;

let loadedModel = null;

//added by maryam to detect if mannequin pose changed 
let rigTracker = null;

function sendPose() {
    if (!rigTracker) {
        console.warn("sendPose: rigTracker is null");
        return;
    }
    const pose = rigTracker.readPose();
    if (!pose) {
        console.warn("sendPose: readPose() returned null");
        return;
    }
    console.log("sendPose: sending", pose.pose_vector.length, "parts");
    window.parent.postMessage(
        { type: "MANNEQUIN_POSE_CHANGED", pose: pose },
        window.location.origin
    );
}// end rig tracker functions


// reset pose function (maryam)
const restPose = new Map(); // every node -> its starting transform

function captureRestPose() {
    restPose.clear();
    loadedModel.traverse((node) => {
        restPose.set(node, {
            position: node.position.clone(),
            quaternion: node.quaternion.clone(),
            scale: node.scale.clone(),
        });
    });
}

function resetPose() {
    if (!loadedModel || restPose.size === 0) return;

    // Stop anything the user was in the middle of.
    draggingJoint = null;
    activeHandIK = null;
    selectedArm = null;
    controls.enabled = true;

    for (const [node, saved] of restPose) {
        node.position.copy(saved.position);
        node.quaternion.copy(saved.quaternion);
        node.scale.copy(saved.scale);
    }
    loadedModel.updateMatrixWorld(true);
    sendPose();
}

// The main page asks for a reset with this message.
window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    if (event.origin !== window.location.origin) return;
    if (!event.data || event.data.type !== "MANNEQUIN_RESET_POSE") return;
    resetPose();
});
//end reset pose functions (maryam)


// Raycasting lets us detect which mannequin body part the user clicks.
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// Stores the arm selected by the user.
let selectedArm = null;


 // Detect mouse clicks on the mannequin.
renderer.domElement.addEventListener('click', (event) => {

    // Don't attempt selection before the mannequin finishes loading.
    if (!loadedModel) return;

    // Convert mouse position into Three.js coordinates.
    const rect = renderer.domElement.getBoundingClientRect();

    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Find mannequin objects underneath the mouse.
    raycaster.setFromCamera(mouse, camera);

    const intersections = raycaster.intersectObject(loadedModel, true);

    if (intersections.length > 0) {

        const clickedPart = intersections[0].object;


    // DEBUG: Identify the exact Unicode characters in the object name.
    // This helps locate the character preventing shoulder recognition.

    console.table(
        Array.from(clickedPart.name).map((character, index) => ({
            index: index,
            character: character,
            unicode: "U+" + character.codePointAt(0)
                .toString(16)
                .toUpperCase()
        }))
    );



    // DEBUG: Check the exact name of the clicked shoulder.
    // Detect hidden characters or naming differences.
    console.log(
        "SHOULDER NAME TEST:",
        JSON.stringify(clickedPart.name),
        "Length:", clickedPart.name.length,
        "Exact match:",
        clickedPart.name === "Shoulder_ScreenLeft"
    );

    console.log(
        "Found using actual name:",
        loadedModel.getObjectByName(clickedPart.name) === clickedPart
    );


    // VERIFY LEFT SHOULDER OBJECT
    // Check whether the clicked shoulder can be found in the GLB hierarchy.
    if (clickedPart.name === "Shoulder_ScreenLeft") {

        const leftShoulder = loadedModel.getObjectByName(
            "Shoulder_ScreenLeft"
        );

        console.log("LEFT SHOULDER VERIFICATION:");
        console.log("Clicked object:", clickedPart.name);
        console.log("Found in loaded model:", !!leftShoulder);
        console.log("Same object:", leftShoulder === clickedPart);
        console.log("Parent:", clickedPart.parent?.name);
    }


        // Remember which upper arm the user selected.
        if (
            clickedPart.name === "UpperArm_ScreenLeft" ||
            clickedPart.name === "UpperArm_ScreenRight"
        ) {
            selectedArm = clickedPart;
            console.log("Selected arm:", selectedArm.name);
        }

        console.log("Clicked mannequin part:", clickedPart.name);
        console.log("Parent object:", clickedPart.parent?.name);

    } else {
        console.log("Clicked outside the mannequin");
    }
});


// Temporary keyboard controls for testing FK arm movements.
window.addEventListener('keydown', (event) => {

    // Only rotate an arm after selecting one.
    if (!selectedArm) return;

    // Ignore keyboard shortcuts while typing in an input field.
    if (event.target instanceof HTMLElement &&
        event.target.closest('input, textarea, select, [contenteditable="true"]')) {
        return;
    }

    // Each key press rotates the selected arm by 5 degrees.
    const rotationStep = THREE.MathUtils.degToRad(5);

    const key = event.key.toLowerCase();

    // Q and E: Rotate the arm sideways.
    if (key === 'q') {
        selectedArm.rotation.z += rotationStep;
        console.log("Arm sideways:", selectedArm.name, "Q");
    }

    if (key === 'e') {
        selectedArm.rotation.z -= rotationStep;
        console.log("Arm sideways:", selectedArm.name, "E");
    }

    // W and S: Rotate the arm forward and backward.
    if (key === 'w') {
        selectedArm.rotation.x += rotationStep;
        console.log("Arm forward/backward:", selectedArm.name, "W");
    }

    if (key === 's') {
        selectedArm.rotation.x -= rotationStep;
        console.log("Arm forward/backward:", selectedArm.name, "S");
    }

    sendPose(); // added by maryam to send the updated pose to the parent window

});

 // MOUSE DRAGGING FOR MANNEQUIN JOINTS
let draggingJoint = null;
let previousMouseX = 0;
let previousMouseY = 0;

// Find the movable joint associated with a clicked body part.
function findMovableJoint(clickedObject) {

    let object = clickedObject;

    while (object && object !== loadedModel) {

        const name = object.name;
        let targetName = name;

        // Allow each finger segment to rotate independently.
        if (/^(Index|Middle|Ring|Pinky|Thumb)_(Proximal|Middle|Distal)_Screen(Left|Right)$/.test(name)) {
            return object;
        }

        // Clicking a round joint should rotate its connected limb.
        if (name.startsWith("Shoulder_")) {
            targetName = name.replace("Shoulder_", "UpperArm_");
        } else if (name.startsWith("Elbow_")) {
            targetName = name.replace("Elbow_", "Forearm_");
        } else if (name.startsWith("Hip_")) {
            targetName = name.replace("Hip_", "Thigh_");
        } else if (name.startsWith("Knee_")) {
            targetName = name.replace("Knee_", "Shin_");
        } else if (name.startsWith("Hand_")) {
            targetName = name.replace("Hand_", "Wrist_");
        } else if (name.startsWith("Foot_")) {
            targetName = name.replace("Foot_", "Ankle_");
        } else if (name === "Torso") {
            targetName = "Waist_Joint";
        }

        const movable =
            /^(UpperArm_|Forearm_|Thigh_|Shin_|Wrist_|Ankle_|Neck$|Head$|Waist_Joint$)/;

        if (movable.test(targetName)) {
            return loadedModel.getObjectByName(targetName) || null;
        }

        object = object.parent;
    }

    return null;
}

// Start dragging a mannequin joint.
renderer.domElement.addEventListener('pointerdown', (event) => {

    if (!loadedModel || event.button !== 0) return;

    const rect = renderer.domElement.getBoundingClientRect();

    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const intersections = raycaster.intersectObject(loadedModel, true);


    // Shift + click on a hand starts IK instead of normal FK.
    if (event.shiftKey && intersections.length > 0) {
        beginHandIKDrag(event, intersections[0].object);
        return;
    }


    // Empty background: allow normal camera controls.
    if (intersections.length === 0) return;

    const joint = findMovableJoint(intersections[0].object);

    if (!joint) return;

    draggingJoint = joint;

    previousMouseX = event.clientX;
    previousMouseY = event.clientY;

    // Disable camera rotation while moving a joint.
    controls.enabled = false;

    renderer.domElement.setPointerCapture(event.pointerId);

    console.log("Dragging joint:", draggingJoint.name);

    event.preventDefault();

}, true);

// Rotate the selected joint as the mouse moves.
renderer.domElement.addEventListener('pointermove', (event) => {

    // Handles hand IK dragging before normal joint rotation.
    if (activeHandIK) {
        updateHandIKDrag(event);
        return;
    }


    if (!draggingJoint) return;

    const deltaX = event.clientX - previousMouseX;
    const deltaY = event.clientY - previousMouseY;

    const sensitivity = 0.008;


    // Horizontal drag: sideways movement.
    draggingJoint.rotation.z += deltaX * sensitivity;

    // Vertical drag: forward/backward movement.
    draggingJoint.rotation.x += deltaY * sensitivity;


    // Apply elbow limits during FK dragging.
    constrainElbowRotation(draggingJoint);


    // Apply conservative movement limits to the wrists.
    if (draggingJoint.name.startsWith("Wrist_")) {

        const maxForwardBackward = THREE.MathUtils.degToRad(30);
        const maxSideways = THREE.MathUtils.degToRad(20);

        // Remember the wrist's original resting rotation.
        const rest = draggingJoint.userData.restRotation;

        if (rest) {
            draggingJoint.rotation.x = THREE.MathUtils.clamp(
                draggingJoint.rotation.x,
                rest.x - maxForwardBackward,
                rest.x + maxForwardBackward
            );

            draggingJoint.rotation.z = THREE.MathUtils.clamp(
                draggingJoint.rotation.z,
                rest.z - maxSideways,
                rest.z + maxSideways
            );
        }
    }


    previousMouseX = event.clientX;
    previousMouseY = event.clientY;

}, true);

// Stop dragging and restore camera controls.
function stopJointDragging(event) {

    // Finishes an active hand IK drag first.
    if (activeHandIK) {
        finishHandIKDrag(event);
        return;
    }

    if (!draggingJoint) return;

    console.log("Finished dragging:", draggingJoint.name);
    sendPose(); // added by maryam to send the updated pose to the parent window

    // CHECK ELBOW BENDING DIRECTION
    // Record the forearm rotation after FK dragging.
    if (draggingJoint.name.startsWith("Forearm_")) {

        console.log(
            "ELBOW BEND TEST:",
            draggingJoint.name,
            "X:",
            THREE.MathUtils.radToDeg(draggingJoint.rotation.x).toFixed(2),
            "Y:",
            THREE.MathUtils.radToDeg(draggingJoint.rotation.y).toFixed(2),
            "Z:",
            THREE.MathUtils.radToDeg(draggingJoint.rotation.z).toFixed(2)
        );
    }


    draggingJoint = null;
    controls.enabled = true;

    if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
    }
}

renderer.domElement.addEventListener('pointerup', stopJointDragging, true);
renderer.domElement.addEventListener('pointercancel', stopJointDragging, true);

// Restore camera controls if the browser loses focus.
window.addEventListener('blur', () => {
    finishHandIKDrag();
    draggingJoint = null;
    sendPose(); // added by maryam to send the updated pose to the parent window
    controls.enabled = true;
});


// Texture Core Pipelines
const textureLoader = new THREE.TextureLoader();
const woodAlbedo = textureLoader.load('./wooden-artist-mannequin/source/model/textures/Wood_albedo.jpg');
const woodAmbientOcclusion = textureLoader.load('./wooden-artist-mannequin/source/model/textures/Wood_AO.jpg');
const woodNormal = textureLoader.load('./wooden-artist-mannequin/source/model/textures/Wood_normal.jpg');
const woodRoughness = textureLoader.load('./wooden-artist-mannequin/source/model/textures/Wood_roughness.jpg');

woodAlbedo.colorSpace = THREE.SRGBColorSpace;

const mannequinMaterial = new THREE.MeshStandardMaterial({
    map: woodAlbedo,
    aoMap: woodAmbientOcclusion,
    aoMapIntensity: 1.0,
    metalness: 0.0,
    normalMap: woodNormal,
    normalScale: new THREE.Vector2(1.0, 1.0),
    roughnessMap: woodRoughness,
    roughness: 0.6
});

// Model Initialization
const loadingManager = new THREE.LoadingManager();
loadingManager.setURLModifier((url) => {
    if (url.endsWith('.jpg') || url.endsWith('.jpeg') || url.endsWith('.png')) {
        return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    }
    return url;
});

// This code loads our Blender-exported GLB mannequin
const loader = new GLTFLoader(loadingManager);

loader.load(
    './models/Mannequin_Cleaned.glb',
    (gltf) => {
        loadedModel = gltf.scene;


        // FIX LEFT SHOULDER NAME
        // The Blender GLB contains an extra "d" in Shouldder.
        // Correct the name so our FK and IK controls recognize it.

        const leftShoulderFix = loadedModel.getObjectByName(
            "Shouldder_ScreenLeft"
        );

        if (leftShoulderFix) {

            leftShoulderFix.name = "Shoulder_ScreenLeft";

            console.log(
                "LEFT SHOULDER NAME FIXED:",
                leftShoulderFix.name
            );

        } else {

            console.log(
                "Left shoulder typo not found. Checking existing name:",
                !!loadedModel.getObjectByName("Shoulder_ScreenLeft")
            );

        }


        // FIX LEFT SHOULDER OBJECT NAME
        // Correct the unexpected character in the Blender object name.
        // This does not change the mannequin's geometry or joint positions.

        const leftShoulderCandidates = [];

        loadedModel.traverse((node) => {

            const name = node.name
                .normalize("NFKC")
                .replace(/[\u200B-\u200D\uFEFF]/g, "")
                .trim();

            if (
                node.isMesh &&
                name.startsWith("Shoulder_") &&
                name.includes("ScreenLeft")
            ) {
                leftShoulderCandidates.push(node);
            }

        });


        // ADDITIONAL LEFT SHOULDER NAME CORRECTION
        // Identify the left shoulder even if its name contains
        // an unexpected invisible or special character.

        if (!loadedModel.getObjectByName("Shoulder_ScreenLeft")) {

            const matchingShoulders = [];

            loadedModel.traverse((node) => {

                // Remove non-letter and non-number characters
                // before comparing object names.
                const cleanName = node.name
                    .normalize("NFKD")
                    .replace(/[^a-zA-Z0-9]/g, "")
                    .toLowerCase();

                if (
                    node.isMesh &&
                    cleanName === "shoulderscreenleft"
                ) {
                    matchingShoulders.push(node);
                }

            });

            console.log(
                "LEFT SHOULDER CANDIDATES:",
                matchingShoulders.map(node => JSON.stringify(node.name))
            );

            // Only rename when exactly one matching mesh exists.
            if (matchingShoulders.length === 1) {

                matchingShoulders[0].name =
                    "Shoulder_ScreenLeft";

                console.log(
                    "LEFT SHOULDER FIX SUCCESSFUL:",
                    matchingShoulders[0].name
                );

            } else {

                console.warn(
                    "Left shoulder correction needs inspection.",
                    "Matches:",
                    matchingShoulders.length
                );
            }
        }


        if (leftShoulderCandidates.length === 1) {

            const leftShoulder = leftShoulderCandidates[0];

            console.log(
                "Original left shoulder name:",
                JSON.stringify(leftShoulder.name)
            );

            leftShoulder.name = "Shoulder_ScreenLeft";

            console.log(
                "Left shoulder name corrected:",
                leftShoulder.name
            );

        } else {

            console.warn(
                "Left shoulder naming correction skipped. Candidates:",
                leftShoulderCandidates.length
            );

        }


        // Save each wrist's original rotation so limits are
        // measured relative to the Blender resting pose.
        loadedModel.traverse((node) => {
            if (node.name.startsWith("Wrist_")) {
                node.userData.restRotation = node.rotation.clone();
            }
        });

        // SAVE ORIGINAL ELBOW ROTATIONS
        // Store the resting positions of both forearms.
        // These will be used to calculate realistic elbow limits.

        loadedModel.traverse((node) => {

            if (
                node.name === "Forearm_ScreenLeft" ||
                node.name === "Forearm_ScreenRight"
            ) {

                node.userData.restRotation =
                    node.rotation.clone();

                console.log(
                    "ELBOW REST ROTATION:",
                    node.name,
                    "X:", THREE.MathUtils.radToDeg(node.rotation.x),
                    "Y:", THREE.MathUtils.radToDeg(node.rotation.y),
                    "Z:", THREE.MathUtils.radToDeg(node.rotation.z)
                );
            }

        });


// This code will help us check the mannequin's body parts and joints
console.log("Mannequin model structure:");

        loadedModel.traverse((node) => {
            // Display each body part and its parent group
            console.log(
                "Name:", node.name,
                "| Parent:", node.parent?.name,
                "| Type:", node.type,
                "| Position:", node.position.toArray()
            );
        });

        // Check whether the mannequin's visible mesh uses a skeleton
        loadedModel.traverse((node) => {
            if (node.isMesh) {
                console.log(
                    "MESH CHECK:",
                    node.name,
                    "| Skinned mesh:", node.isSkinnedMesh,
                    "| Parent:", node.parent?.name
                );
            }
        });


        loadedModel.traverse((node) => {
            if (node.isMesh) {
                // We are keeping the materials from our Blender GLB for the first test
                //node.material = mannequinMaterial;
                node.castShadow = true;
                node.receiveShadow = true;
                node.material.needsUpdate = true;
            }
        });

        const box = new THREE.Box3().setFromObject(loadedModel);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        loadedModel.position.sub(center);
        scene.add(loadedModel);

        alignShoulderPivots(loadedModel);
        refineLeftShoulderPivot(loadedModel);

        inspectMannequinRig(loadedModel);
        showShoulderPivotChecks();


 // CHECK ACTUAL SHOULDER OBJECT NAMES AND POSITIONS
// Find shoulder and upper-arm objects without changing them.

loadedModel.updateMatrixWorld(true);

console.group("SHOULDER OBJECT DETAILS");

loadedModel.traverse((node) => {

    if (/shoulder|upperarm/i.test(node.name)) {

        const worldPosition = new THREE.Vector3();
        node.getWorldPosition(worldPosition);

        let meshCenter = null;

        // Measure this mesh's own geometry, not its children.
        if (node.isMesh && node.geometry) {

            node.geometry.computeBoundingBox();

            meshCenter = node.geometry.boundingBox
                .getCenter(new THREE.Vector3())
                .applyMatrix4(node.matrixWorld)
                .toArray();
        }

        console.log({
            name: node.name,
            type: node.type,
            parent: node.parent?.name,
            pivot: worldPosition.toArray(),
            meshCenter: meshCenter
        });
    }
});

console.groupEnd();


        const maxDim = Math.max(size.x, size.y, size.z);

        // TEMPORARY DEBUG: Show the left wrist's actual
        // rotation pivot in world coordinates.
        loadedModel.updateMatrixWorld(true);

        const leftWrist = loadedModel.getObjectByName("Wrist_ScreenLeft");

        if (leftWrist) {
            const wristPosition = new THREE.Vector3();
            leftWrist.getWorldPosition(wristPosition);

            // Make a bright pink sphere at the wrist's pivot.
            const pivotMarker = new THREE.Mesh(
                new THREE.SphereGeometry(maxDim * 0.018, 16, 12),
                new THREE.MeshBasicMaterial({
                    color: 0xff00ff,
                    depthTest: false
                })
            );

            pivotMarker.position.copy(wristPosition);
            pivotMarker.renderOrder = 999;
            scene.add(pivotMarker);

            pivotMarker.visible = false;

            console.log("WORLD wrist pivot:", wristPosition.toArray());
        }

        const fov = camera.fov * (Math.PI / 180);
        let cameraZ = Math.abs(maxDim / 2 * Math.tan(fov * 2)) * 2.5;

        camera.position.set(0, maxDim * 0.4, cameraZ);
        controls.minDistance = maxDim * 0.3; // Minimum distance to prevent clipping
        controls.maxDistance = maxDim * 15; // Maximum distance to allow zooming out
        controls.target.set(0, maxDim * 0.1, 0);
        controls.update();

        console.log('Model loaded cleanly! Dimensions computed:', size);
        
        rigTracker = createRigTracker(loadedModel);// added by maryam to create rig tracker for mannequin pose detection
        captureRestPose(); // added by maryam to capture the rest pose BEFORE the user moves anything
        sendPose(); // added by maryam to send the initial pose to the parent window
    },
    (xhr) => { console.log((xhr.loaded / xhr.total * 100) + '% loaded'); },
    (error) => { console.error('Asset parser crash reported:', error); }
);

function animate() {
    controls.update();
    renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});



 // MANNEQUIN RIG INSPECTION
// Check the skeleton and joint hierarchy before implementing IK.
function inspectMannequinRig(model) {

    const meshes = [];
    const skinnedMeshes = [];
    const bones = [];

    // Find all meshes and bones in the loaded mannequin.
    model.traverse((node) => {

        if (node.isMesh) {
            meshes.push(node.name);
        }

        if (node.isSkinnedMesh) {
            skinnedMeshes.push(node.name);
        }

        if (node.isBone) {
            bones.push(node.name);
        }

    });

    console.group("MANNEQUIN RIG INSPECTION");

    console.log("Total meshes:", meshes.length);
    console.log("Skinned meshes:", skinnedMeshes.length);
    console.log("Bones:", bones.length);

    console.log("Bone names:", bones);

    // Check the joint names used by our FK controls.
    const jointNames = [
        "Waist_Joint",
        "Neck",
        "Head",
        "UpperArm_ScreenLeft",
        "UpperArm_ScreenRight",
        "Forearm_ScreenLeft",
        "Forearm_ScreenRight",
        "Wrist_ScreenLeft",
        "Wrist_ScreenRight",
        "Thigh_ScreenLeft",
        "Thigh_ScreenRight",
        "Shin_ScreenLeft",
        "Shin_ScreenRight",
        "Ankle_ScreenLeft",
        "Ankle_ScreenRight"
    ];

    const jointReport = [];

    model.updateMatrixWorld(true);

    // Report each joint's parent and world-space pivot position.
    jointNames.forEach((name) => {

        const joint = model.getObjectByName(name);

        if (joint) {
            const position = new THREE.Vector3();
            joint.getWorldPosition(position);

            jointReport.push({
                joint: name,
                found: true,
                type: joint.type,
                parent: joint.parent?.name || "None",
                worldPosition: position.toArray()
                    .map(value => Number(value.toFixed(4)))
                    .join(", ")
            });

        } else {

            jointReport.push({
                joint: name,
                found: false,
                type: "Missing",
                parent: "None",
                worldPosition: "N/A"
            });

        }

    });

    console.table(jointReport);

    // Verify whether limb joints form usable FK parent-child chains.
    function isDescendant(child, parent) {

        let current = child?.parent;

        while (current) {
            if (current === parent) return true;
            current = current.parent;
        }

        return false;
    }

    const limbChains = [
        ["UpperArm_ScreenLeft", "Forearm_ScreenLeft"],
        ["Forearm_ScreenLeft", "Wrist_ScreenLeft"],
        ["UpperArm_ScreenRight", "Forearm_ScreenRight"],
        ["Forearm_ScreenRight", "Wrist_ScreenRight"],
        ["Thigh_ScreenLeft", "Shin_ScreenLeft"],
        ["Shin_ScreenLeft", "Ankle_ScreenLeft"],
        ["Thigh_ScreenRight", "Shin_ScreenRight"],
        ["Shin_ScreenRight", "Ankle_ScreenRight"]
    ];

    const hierarchyReport = limbChains.map(([parentName, childName]) => {

        const parent = model.getObjectByName(parentName);
        const child = model.getObjectByName(childName);

        return {
            parent: parentName,
            child: childName,
            bothFound: Boolean(parent && child),
            connected: Boolean(parent && child && isDescendant(child, parent))
        };

    });

    console.log("FK joint hierarchy:");
    console.table(hierarchyReport);

    // Identify which type of mannequin rig is available.
    if (skinnedMeshes.length > 0) {

        console.log("Skinned meshes detected. Inspect their bone chains before implementing IK.");

    } else if (bones.length > 0) {

        console.log("Bones detected, but no skinned meshes. Further rig inspection is required.");

    } else {

        console.log("No skeletal skinning detected. Rigid parent-child FK may still be possible.");

    }

    console.groupEnd();
}



 // HAND INVERSE KINEMATICS (IK)
// First prototype for controlling the mannequin's hands.
// This works with the existing rigid parent-child hierarchy we have already established.

let activeHandIK = null;

// Identify which hand the user clicked.
function findIKHandSide(clickedObject) {

    let object = clickedObject;

    while (object && object !== loadedModel) {

        const name = object.name;

        if (/^(Hand_|Wrist_|Thumb_|Index_|Middle_|Ring_|Pinky_)/.test(name)) {

            const match = name.match(/_Screen(Left|Right)$/);

            if (match) {
                return match[1];
            }
        }

        object = object.parent;
    }

    return null;
}

// Begin dragging a hand using inverse kinematics.
function beginHandIKDrag(event, clickedObject) {

    const side = findIKHandSide(clickedObject);

    if (!side) return false;

    const shoulder = loadedModel.getObjectByName(
        `UpperArm_Screen${side}`
    );

    const elbow = loadedModel.getObjectByName(
        `Forearm_Screen${side}`
    );

    const wrist = loadedModel.getObjectByName(
        `Wrist_Screen${side}`
    );

    if (!shoulder || !elbow || !wrist) {
        console.warn("Missing IK joint:", side);
        return false;
    }

    loadedModel.updateMatrixWorld(true);

    const wristPosition = wrist.getWorldPosition(
        new THREE.Vector3()
    );

    // Keep mouse movement in a camera-facing plane.
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        camera.getWorldDirection(new THREE.Vector3()),
        wristPosition
    );

    const rect = renderer.domElement.getBoundingClientRect();

    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const hitPoint = raycaster.ray.intersectPlane(
        plane,
        new THREE.Vector3()
    );

    if (!hitPoint) return false;

    activeHandIK = {
        shoulder,
        elbow,
        wrist,
        plane,
        pointerId: event.pointerId,
        offset: wristPosition.clone().sub(hitPoint),
        lastPointerY: event.clientY,
        depthOffset: 0,
        towardViewer: camera.getWorldDirection(new THREE.Vector3()).negate(),
        depthScale: Math.max(
            0.00001,
            new THREE.Box3().setFromObject(loadedModel)
                .getSize(new THREE.Vector3()).y * 0.002)

    };

    controls.enabled = false;

    renderer.domElement.setPointerCapture(event.pointerId);

    console.log("Started hand IK:", side);

    event.preventDefault();

    return true;
}

// Adjust the shoulder and elbow toward a hand target.
function solveHandIK(target) {

    if (!activeHandIK) return;

    const { shoulder, elbow, wrist } = activeHandIK;

    const jointPosition = new THREE.Vector3();
    const wristPosition = new THREE.Vector3();

    // Cyclic Coordinate Descent (CCD) solver.
    for (let iteration = 0; iteration < 15; iteration++) {

        for (const joint of [elbow, shoulder]) {

            loadedModel.updateMatrixWorld(true);

            joint.getWorldPosition(jointPosition);
            wrist.getWorldPosition(wristPosition);

            const towardWrist = wristPosition.clone()
                .sub(jointPosition);

            const towardTarget = target.clone()
                .sub(jointPosition);

            if (
                towardWrist.lengthSq() < 1e-10 ||
                towardTarget.lengthSq() < 1e-10
            ) {
                continue;
            }

            const worldRotation = new THREE.Quaternion()
                .setFromUnitVectors(
                    towardWrist.normalize(),
                    towardTarget.normalize()
                );

            const parentRotation = new THREE.Quaternion();

            if (joint.parent) {
                joint.parent.getWorldQuaternion(parentRotation);
            }

            const localRotation = parentRotation.clone()
                .invert()
                .multiply(worldRotation)
                .multiply(parentRotation);

            joint.quaternion.premultiply(localRotation);
            // Apply elbow limits during IK solving.
            constrainElbowRotation(joint);

        }

        loadedModel.updateMatrixWorld(true);

        wrist.getWorldPosition(wristPosition);

        if (wristPosition.distanceToSquared(target) < 1e-6) {
            break;
        }
    }
}

// Update the hand target while dragging.
function updateHandIKDrag(event) {

    if (!activeHandIK) return;

    if (event.pointerId !== activeHandIK.pointerId) return;

    // Holding Alt while dragging controls hand depth.
    if (event.altKey) {
        const deltaY = activeHandIK.lastPointerY - event.clientY;

        activeHandIK.depthOffset +=
            deltaY * activeHandIK.depthScale;
    }

    activeHandIK.lastPointerY = event.clientY;


    const rect = renderer.domElement.getBoundingClientRect();

    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const hitPoint = raycaster.ray.intersectPlane(
        activeHandIK.plane,
        new THREE.Vector3()
    );

    if (!hitPoint) return;

    const target = hitPoint.add(activeHandIK.offset);

    // Move the IK target toward or away from the camera.
    target.addScaledVector(
        activeHandIK.towardViewer,
        activeHandIK.depthOffset
    );

    solveHandIK(target);
}

// End hand IK dragging and restore camera controls.
function finishHandIKDrag(event) {

    if (!activeHandIK) return false;

    const pointerId = activeHandIK.pointerId;

    activeHandIK = null;
    controls.enabled = true;

    if (renderer.domElement.hasPointerCapture(pointerId)) {
        renderer.domElement.releasePointerCapture(pointerId);
    }

    console.log("Finished hand IK");

    sendPose(); // added by maryam to send the updated pose to the parent window
    return true;
}


 // SHOULDER PIVOT INSPECTION
// Display the shoulder centers and upper-arm rotation pivots.
// This helps identify why the arms appear disconnected.

function showShoulderPivotChecks() {

    if (!loadedModel) return;

    loadedModel.updateMatrixWorld(true);

    const modelSize = new THREE.Box3()
        .setFromObject(loadedModel)
        .getSize(new THREE.Vector3());

    const markerRadius = modelSize.y * 0.012;

    // Create a visible marker at a joint position.
    function createPivotMarker(position, color) {

        const marker = new THREE.Mesh(
            new THREE.SphereGeometry(markerRadius, 16, 12),
            new THREE.MeshBasicMaterial({
                color: color,
                depthTest: false
            })
        );

        marker.position.copy(position);
        marker.renderOrder = 999;

        scene.add(marker);
    }

    // Inspect the left and right shoulders separately.
    ["Left", "Right"].forEach((side) => {

        const shoulder = loadedModel.getObjectByName(
            `Shoulder_Screen${side}`
        );

        const upperArm = loadedModel.getObjectByName(
            `UpperArm_Screen${side}`
        );

        if (!shoulder || !upperArm) {
            console.warn("Missing shoulder or upper arm:", side);
            return;
        }

        // Find the shoulder object's visible bounding-box center.
        const shoulderCenter = new THREE.Box3()
            .setFromObject(shoulder)
            .getCenter(new THREE.Vector3());

        // Find the upper arm's actual rotation origin.
        const armPivot = upperArm.getWorldPosition(
            new THREE.Vector3()
        );

        // Green indicates the shoulder center.
        createPivotMarker(shoulderCenter, 0x00ff00);

        // Red indicates the upper arm rotation pivot.
        createPivotMarker(armPivot, 0xff0000);

        console.log(`SHOULDER CHECK: ${side}`);
        console.log("Shoulder center:", shoulderCenter.toArray());
        console.log("Upper arm pivot:", armPivot.toArray());
        console.log(
            "Pivot distance:",
            shoulderCenter.distanceTo(armPivot)
        );

    });
}


 // SHOULDER PIVOT ALIGNMENT
// Align upper-arm rotation pivots with the shoulder joints.
// Preserve visible geometry and child joint positions.

function alignShoulderPivots(model) {

    const rightShoulder =
        model.getObjectByName("Shoulder_ScreenRight");

    const rightArm =
        model.getObjectByName("UpperArm_ScreenRight");

    const leftArm =
        model.getObjectByName("UpperArm_ScreenLeft");

    if (!rightShoulder || !rightArm || !leftArm) {
        console.warn("Shoulder alignment: required objects missing.");
        return;
    }

    if (
        !rightShoulder.isMesh ||
        !rightArm.isMesh ||
        !leftArm.isMesh ||
        !rightArm.parent ||
        rightArm.parent !== leftArm.parent
    ) {
        console.warn("Shoulder alignment: unexpected model structure.");
        return;
    }

    model.updateMatrixWorld(true);

    // Find the center of the right shoulder's own geometry.
    rightShoulder.geometry.computeBoundingBox();

    const rightShoulderCenter =
        rightShoulder.geometry.boundingBox
            .getCenter(new THREE.Vector3());

    rightShoulder.localToWorld(rightShoulderCenter);

    // Calculate the shoulder correction in the parent coordinate system.
    const torso = rightArm.parent;

    const rightPivot = rightArm.getWorldPosition(
        new THREE.Vector3()
    );

    const leftPivot = leftArm.getWorldPosition(
        new THREE.Vector3()
    );

    const rightTargetLocal = torso.worldToLocal(
        rightShoulderCenter.clone()
    );

    const rightPivotLocal = torso.worldToLocal(
        rightPivot.clone()
    );

    const leftPivotLocal = torso.worldToLocal(
        leftPivot.clone()
    );

    const correction = rightTargetLocal.clone()
        .sub(rightPivotLocal);

    // Mirror the correction for the left shoulder.
    // This assumes the mannequin is symmetrical along local X.
    const leftTargetLocal = leftPivotLocal.add(
        new THREE.Vector3(
            -correction.x,
            correction.y,
            correction.z
        )
    );

    const leftTargetWorld = torso.localToWorld(
        leftTargetLocal
    );

    // Reposition a pivot without moving the visible mesh.
    function movePivotPreservingGeometry(mesh, targetWorld) {

        model.updateMatrixWorld(true);

        const localOffset = mesh.worldToLocal(
            targetWorld.clone()
        );

        const parentPosition = mesh.parent.worldToLocal(
            targetWorld.clone()
        );

        // Use a geometry copy so other meshes remain unchanged.
        mesh.geometry = mesh.geometry.clone();

        // Counteract the pivot movement in the mesh geometry.
        mesh.geometry.translate(
            -localOffset.x,
            -localOffset.y,
            -localOffset.z
        );

        // Keep elbows, forearms, wrists, and fingers in place.
        mesh.children.forEach((child) => {
            child.position.sub(localOffset);
        });

        mesh.position.copy(parentPosition);

        model.updateMatrixWorld(true);
    }

    // Align both shoulder pivots.
    movePivotPreservingGeometry(
        rightArm,
        rightShoulderCenter
    );

    movePivotPreservingGeometry(
        leftArm,
        leftTargetWorld
    );

    console.log("Shoulder pivot alignment applied.");
}


 // PRECISE LEFT SHOULDER PIVOT ALIGNMENT
// Align the left upper-arm pivot using the actual shoulder mesh.
// Preserve the upper-arm geometry and child joint positions.

function refineLeftShoulderPivot(model) {

    const shoulder = model.getObjectByName(
        "Shoulder_ScreenLeft"
    );

    const upperArm = model.getObjectByName(
        "UpperArm_ScreenLeft"
    );

    if (
        !shoulder?.isMesh ||
        !upperArm?.isMesh ||
        !shoulder.geometry ||
        !upperArm.geometry ||
        !upperArm.parent
    ) {
        console.warn("Left shoulder refinement skipped.");
        return;
    }

    model.updateMatrixWorld(true);

    // Find the center of the actual left shoulder mesh.
    shoulder.geometry.computeBoundingBox();

    const shoulderCenter = shoulder.geometry.boundingBox
        .getCenter(new THREE.Vector3())
        .applyMatrix4(shoulder.matrixWorld);

    // Measure the current upper-arm pivot.
    const originalPivot = upperArm.getWorldPosition(
        new THREE.Vector3()
    );

    const originalDistance =
        originalPivot.distanceTo(shoulderCenter);

    console.log(
        "Left shoulder distance before:",
        originalDistance
    );

    if (originalDistance < 0.0001) {
        console.log("Left shoulder already aligned.");
        return;
    }

    // Convert the shoulder center into arm-local coordinates.
    const localOffset = upperArm.worldToLocal(
        shoulderCenter.clone()
    );

    // Calculate the new pivot location in parent coordinates.
    const parentPosition = upperArm.parent.worldToLocal(
        shoulderCenter.clone()
    );

    // Copy geometry before modifying its local coordinates.
    upperArm.geometry = upperArm.geometry.clone();

    // Preserve the visible upper-arm position.
    upperArm.geometry.translate(
        -localOffset.x,
        -localOffset.y,
        -localOffset.z
    );

    // Preserve elbow, forearm, wrist, and hand positions.
    upperArm.children.forEach((child) => {
        child.position.sub(localOffset);
    });

    // Move only the upper-arm pivot to the shoulder center.
    upperArm.position.copy(parentPosition);

    model.updateMatrixWorld(true);

    const correctedPivot = upperArm.getWorldPosition(
        new THREE.Vector3()
    );

    console.log(
        "Left shoulder distance after:",
        correctedPivot.distanceTo(shoulderCenter)
    );

    console.log("Left shoulder pivot refinement complete.");
}



 // REALISTIC ELBOW JOINT LIMITATIONS
// Prevent the forearms from bending backward or twisting unnaturally.
// These limits are measured relative to the mannequin's resting pose.

function constrainElbowRotation(joint) {

    if (
        joint.name !== "Forearm_ScreenLeft" &&
        joint.name !== "Forearm_ScreenRight"
    ) {
        return;
    }

    const rest = joint.userData.restRotation;

    if (!rest) return;

    // Maximum elbow flexion: 145 degrees.
    const maxBend = THREE.MathUtils.degToRad(145);

    // Small tolerance for sideways rotation and twisting.
    const maxSideways = THREE.MathUtils.degToRad(5);
    const maxTwist = THREE.MathUtils.degToRad(5);

    // Negative X bends the elbow forward on both arms.
    joint.rotation.x = THREE.MathUtils.clamp(
        joint.rotation.x,
        rest.x - maxBend,
        rest.x
    );

    // Restrict twisting.
    joint.rotation.y = THREE.MathUtils.clamp(
        joint.rotation.y,
        rest.y - maxTwist,
        rest.y + maxTwist
    );

    // Restrict sideways bending.
    joint.rotation.z = THREE.MathUtils.clamp(
        joint.rotation.z,
        rest.z - maxSideways,
        rest.z + maxSideways
    );
}
