import * as THREE from './three.js';
import { ColladaLoader } from './ColladaLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'; 
import { OrbitControls } from './OrbitControls.js';
import {
    solveHandIK as solveHandIKRig,
    solveIKChain
} from './inverse_kinematic_rig.js';
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a); 

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

// Raycasting lets us detect which mannequin body part the user clicks.
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// Stores the arm selected by the user.
let selectedArm = null;

// RECEIVE MANNEQUIN TOOL SELECTIONS

let activeMannequinTool = "rotate";

window.addEventListener("message", (event) => {

    // Only accept messages from the parent website.
    if (event.origin !== window.location.origin) return;

    if (event.data?.type !== "mannequin:set-tool") return;

    const allowedTools = ["rotate", "bend", "tilt"];

    if (!allowedTools.includes(event.data.tool)) return;

    activeMannequinTool = event.data.tool;

    console.log("Active mannequin tool:", activeMannequinTool);

});

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


if (activeMannequinTool === "tilt") {

    if (intersections.length > 0) {

        const clickedObject = intersections[0].object;

        let started = beginHandIKDrag(event, clickedObject);

        if (!started) {
            started = beginLegIKDrag(event, clickedObject);
        }

        if (!started) {
            started = beginTorsoIKDrag(event, clickedObject);
        }

        if (!started) {
            console.log(
                "Select a hand, finger, foot, or head to use Tilt."
            );
        }
    }

    return;
}

    // SHIFT + CLICK remains available as an IK shortcut.
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

    // Handle inverse kinematics before normal joint rotation.
    if (activeHandIK) {
        updateHandIKDrag(event);
        return;
    }

    if (activeLegIK) {
        updateLegIKDrag(event);
        return;
    }

    if (activeTorsoIK) {
        updateTorsoIKDrag(event);
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
    constrainShoulderRotation(draggingJoint);


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

    // Finish active hand IK dragging.
    if (activeHandIK) {
        finishHandIKDrag(event);
        return;
    }

    // Finish active leg IK dragging.
    if (activeLegIK) {
        finishLegIKDrag(event);
        return;
    }

    if (activeTorsoIK) {
        finishTorsoIKDrag(event);
        return;
    }

    if (!draggingJoint) return;

    console.log("Finished dragging:", draggingJoint.name);

    // CHECK ELBOW BENDING DIRECTION
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

    // CHECK KNEE BENDING DIRECTION
    if (draggingJoint.name.startsWith("Shin_")) {

        console.log(
            "KNEE BEND TEST:",
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

    if (
        renderer.domElement.hasPointerCapture(event.pointerId)
    ) {
        renderer.domElement.releasePointerCapture(event.pointerId);
    }
}

// Register the stop-dragging handler.
renderer.domElement.addEventListener(
    'pointerup',
    stopJointDragging
);

renderer.domElement.addEventListener(
    'pointercancel',
    stopJointDragging
);

// Restore camera controls if the browser loses focus.
window.addEventListener('blur', () => {
    finishHandIKDrag();
    finishLegIKDrag();
    finishTorsoIKDrag();
    draggingJoint = null;
    controls.enabled = true;
});


// Texture Core Pipelines
const textureLoader = new THREE.TextureLoader();
const woodAlbedo = textureLoader.load('./wooden-artist-mannequin/source/model/textures/Wood_albedo.jpg');
const woodAmbientOcclusion = textureLoader.load('./wooden-artist-mannequin/source/model/textures/Wood_AO.jpg');
const woodNormal = textureLoader.load('./wooden-artist-mannequin/source/model/textures/Wood_normal.png');
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

                node.userData.restRotation = node.rotation.clone();

                console.log(
                    "ELBOW REST ROTATION:",
                    node.name,
                    node.rotation.toArray()
                );
            }

        });


       // SAVE ORIGINAL SHOULDER ROTATIONS
        loadedModel.traverse((node) => {

            if (
                node.name === "UpperArm_ScreenLeft" ||
                node.name === "UpperArm_ScreenRight"
            ) {

                node.userData.restRotation = node.rotation.clone();

                console.log(
                    "SHOULDER REST ROTATION:",
                    node.name,
                    node.rotation.toArray()
                );
            }

        });


        // SAVE ORIGINAL KNEE ROTATIONS
        loadedModel.traverse((node) => {

            if (
                node.name === "Shin_ScreenLeft" ||
                node.name === "Shin_ScreenRight"
            ) {

                node.userData.restRotation = node.rotation.clone();

                console.log(
                    "KNEE REST ROTATION:",
                    node.name,
                    node.rotation.toArray()
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
        inspectTorsoHierarchy();
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

        if (
            /^(Shoulder_|UpperArm_|Elbow_|Forearm_|Wrist_|Hand_|Thumb_|Index_|Middle_|Ring_|Pinky_)/.test(name)
        ) {

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

    const shoulderPosition = shoulder.getWorldPosition(
    new THREE.Vector3()
    );

    const elbowPosition = elbow.getWorldPosition(
        new THREE.Vector3()
    );

    const upperArmLength = shoulderPosition.distanceTo(elbowPosition);
    const forearmLength = elbowPosition.distanceTo(wristPosition);

    const maxReach = upperArmLength + forearmLength;

    activeHandIK = {
        shoulder,
        elbow,
        wrist,
        plane,
        upperArmLength,
        forearmLength,
        maxReach,
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
// Send the selected arm and target to the IK solver.
function solveHandIK(target) {
    if (!activeHandIK) return;

    const { shoulder, elbow, wrist } = activeHandIK;

    return solveHandIKRig({
        model: loadedModel,
        shoulder,
        elbow,
        wrist,
        target,
        iterations: 20,
        tolerance: 0.005,
        constrainElbow: constrainElbowRotation
    });
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

    target.addScaledVector(
        activeHandIK.towardViewer,
        activeHandIK.depthOffset
    );

    // Keep the hand target within the arm's reachable distance.
    const shoulderPosition = activeHandIK.shoulder.getWorldPosition(
        new THREE.Vector3()
    );

    const shoulderToTarget = target.clone().sub(shoulderPosition);

    const maxReach = activeHandIK.maxReach * 0.99;

    if (shoulderToTarget.length() > maxReach) {
        shoulderToTarget.setLength(maxReach);

        target.copy(
            shoulderPosition.clone().add(shoulderToTarget)
        );
    }

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

    return true;
}

// LEG INVERSE KINEMATICS (IK)
let activeLegIK = null;

// Identify which leg the user clicked.
function findIKLegSide(clickedObject) {

    let object = clickedObject;

    while (object && object !== loadedModel) {

        const name = object.name;

        if (/^(Foot_|Ankle_|Shin_|Knee_|Thigh_|Hip_)/.test(name)) {

            const match = name.match(/_Screen(Left|Right)$/);

            if (match) return match[1];
        }

        object = object.parent;
    }

    return null;
}


// Begin dragging a foot using inverse kinematics.
function beginLegIKDrag(event, clickedObject) {

    const side = findIKLegSide(clickedObject);

    if (!side) return false;

    const thigh = loadedModel.getObjectByName(
        `Thigh_Screen${side}`
    );

    const shin = loadedModel.getObjectByName(
        `Shin_Screen${side}`
    );

    const ankle = loadedModel.getObjectByName(
        `Ankle_Screen${side}`
    );

    if (!thigh || !shin || !ankle) {
        console.warn("Missing leg IK joint:", side);
        return false;
    }

    loadedModel.updateMatrixWorld(true);

    const thighPosition = thigh.getWorldPosition(
        new THREE.Vector3()
    );

    const shinPosition = shin.getWorldPosition(
        new THREE.Vector3()
    );

    const anklePosition = ankle.getWorldPosition(
        new THREE.Vector3()
    );

    const upperLegLength = thighPosition.distanceTo(shinPosition);
    const lowerLegLength = shinPosition.distanceTo(anklePosition);

    const maxReach = upperLegLength + lowerLegLength;
    const minReach = Math.abs(upperLegLength - lowerLegLength);

    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        camera.getWorldDirection(new THREE.Vector3()),
        anklePosition
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

    activeLegIK = {
        side,
        thigh,
        shin,
        ankle,
        plane,
        upperLegLength,
        lowerLegLength,
        maxReach,
        minReach,
        pointerId: event.pointerId,
        offset: anklePosition.clone().sub(hitPoint)
    };

    controls.enabled = false;

    renderer.domElement.setPointerCapture(event.pointerId);

    console.log("Started leg IK:", side);

    event.preventDefault();

    return true;
}


// Solve the leg chain.
function solveLegIK(target) {

    if (!activeLegIK) return;

    const { thigh, shin, ankle } = activeLegIK;

    return solveIKChain({
        model: loadedModel,

        // Start at the knee, then rotate the hip.
        joints: [shin, thigh],

        // The ankle is the end effector.
        endEffector: ankle,

        target,

        iterations: 25,
        tolerance: 0.01,

        // Apply the knee's Z-axis bending limits.
        constrainJoint: constrainKneeRotation
    });
}


// Update the foot target while dragging.
function updateLegIKDrag(event) {

    if (!activeLegIK) return;

    if (event.pointerId !== activeLegIK.pointerId) return;

    const rect = renderer.domElement.getBoundingClientRect();

    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const hitPoint = raycaster.ray.intersectPlane(
        activeLegIK.plane,
        new THREE.Vector3()
    );

    if (!hitPoint) return;

    const target = hitPoint.add(activeLegIK.offset);

    // Keep the ankle target within the leg's reachable distance.
    const hipPosition = activeLegIK.thigh.getWorldPosition(
        new THREE.Vector3()
    );

    const hipToTarget = target.clone().sub(hipPosition);

    const maxReach = activeLegIK.maxReach * 0.99;
    const minReach = activeLegIK.minReach * 1.01;

    if (hipToTarget.length() > maxReach) {
        hipToTarget.setLength(maxReach);
    } else if (hipToTarget.length() < minReach) {
        hipToTarget.setLength(minReach);
    }

    target.copy(hipPosition).add(hipToTarget);

    solveLegIK(target);
}


// Finish leg IK dragging.
function finishLegIKDrag(event) {

    if (!activeLegIK) return false;

    const pointerId = activeLegIK.pointerId;

    activeLegIK = null;

    controls.enabled = true;

    if (renderer.domElement.hasPointerCapture(pointerId)) {
        renderer.domElement.releasePointerCapture(pointerId);
    }

    console.log("Finished leg IK");

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

let activeTorsoIK = null;

// Begin dragging the head using torso inverse kinematics.
function beginTorsoIKDrag(event, clickedObject) {

    const head = loadedModel.getObjectByName("Head");

    // Accept the head itself or a child mesh belonging to it.
    let current = clickedObject;
    let clickedHead = false;

    while (current && current !== loadedModel) {
        if (current === head) {
            clickedHead = true;
            break;
        }

        current = current.parent;
    }

    if (!head || !clickedHead) return false;

    const waistJoint = loadedModel.getObjectByName("Waist_Joint");
    const torso = loadedModel.getObjectByName("Torso");
    const neck = loadedModel.getObjectByName("Neck");

    if (!waistJoint || !torso || !neck) {
        console.warn("Missing torso IK joint.");
        return false;
    }

    loadedModel.updateMatrixWorld(true);

    console.log("TORSO IK STARTING ROTATIONS");

    console.table([
        loadedModel.getObjectByName("Waist_Joint"),
        loadedModel.getObjectByName("Torso"),
        loadedModel.getObjectByName("Neck")
    ].map(joint => ({
        joint: joint.name,
        x: THREE.MathUtils.radToDeg(joint.rotation.x).toFixed(1),
        y: THREE.MathUtils.radToDeg(joint.rotation.y).toFixed(1),
        z: THREE.MathUtils.radToDeg(joint.rotation.z).toFixed(1)
    })));

    const headPosition = head.getWorldPosition(
        new THREE.Vector3()
    );

    // Keep mouse movement in a camera-facing plane.
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        camera.getWorldDirection(new THREE.Vector3()),
        headPosition
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

    activeTorsoIK = {
        waistJoint,
        torso,
        neck,
        head,
        plane,
        pointerId: event.pointerId,
        offset: headPosition.clone().sub(hitPoint),
        lastPointerY: event.clientY,
        depthOffset: 0,
        towardViewer: camera.getWorldDirection(
            new THREE.Vector3()
        ).negate(),
        depthScale: Math.max(
            0.00001,
            new THREE.Box3()
                .setFromObject(loadedModel)
                .getSize(new THREE.Vector3()).y * 0.002
        )
    };

    controls.enabled = false;

    renderer.domElement.setPointerCapture(event.pointerId);

    console.log("Started torso IK");

    event.preventDefault();

    return true;
}


// Solve torso IK by moving the head toward the target.
function solveTorsoIK(target) {

    if (!activeTorsoIK) return false;

    const { waistJoint, torso, neck, head } = activeTorsoIK;

    return solveIKChain({
        model: loadedModel,

        // CCD order: head backward toward the waist.
        joints: [torso, waistJoint],

        endEffector: head,
        target,

        iterations: 8,
        tolerance: 0.01,
        maxStepDegrees: 4
    });
}


// Update the head target while dragging.
function updateTorsoIKDrag(event) {

    if (!activeTorsoIK) return;

    if (event.pointerId !== activeTorsoIK.pointerId) return;

    // Holding Alt controls head depth.
    if (event.altKey) {
        const deltaY =
            activeTorsoIK.lastPointerY - event.clientY;

        activeTorsoIK.depthOffset +=
            deltaY * activeTorsoIK.depthScale;
    }

    activeTorsoIK.lastPointerY = event.clientY;

    const rect = renderer.domElement.getBoundingClientRect();

    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const hitPoint = raycaster.ray.intersectPlane(
        activeTorsoIK.plane,
        new THREE.Vector3()
    );

    if (!hitPoint) return;

    const target = hitPoint.add(activeTorsoIK.offset);

    target.addScaledVector(
        activeTorsoIK.towardViewer,
        activeTorsoIK.depthOffset
    );

    solveTorsoIK(target);
}


// Finish torso IK dragging.
function finishTorsoIKDrag(event) {

    if (!activeTorsoIK) return false;

    if (
        event &&
        event.pointerId !== activeTorsoIK.pointerId
    ) {
        return false;
    }

    // Capture joint rotations before clearing the IK state.
    const rotationReport = [
        activeTorsoIK.waistJoint,
        activeTorsoIK.torso,
        activeTorsoIK.neck
    ].map(joint => ({
        joint: joint.name,
        rotationX: THREE.MathUtils.radToDeg(
            joint.rotation.x
        ).toFixed(1),
        rotationY: THREE.MathUtils.radToDeg(
            joint.rotation.y
        ).toFixed(1),
        rotationZ: THREE.MathUtils.radToDeg(
            joint.rotation.z
        ).toFixed(1)
    }));

    console.table(rotationReport);

    const pointerId = activeTorsoIK.pointerId;

    activeTorsoIK = null;
    controls.enabled = true;

    if (renderer.domElement.hasPointerCapture(pointerId)) {
        renderer.domElement.releasePointerCapture(pointerId);
    }

    console.log("Finished torso IK");

    return true;
}

function inspectTorsoHierarchy() {

    const names = [
        "Waist_Joint",
        "Torso",
        "Neck",
        "Head"
    ];

    const results = names.map(name => {

        const joint = loadedModel.getObjectByName(name);

        return {
            joint: name,
            found: !!joint,
            type: joint?.type ?? "Missing",
            parent: joint?.parent?.name ?? "None",
            position: joint
                ? joint.getWorldPosition(new THREE.Vector3())
                    .toArray()
                    .map(value => value.toFixed(3))
                    .join(", ")
                : "N/A"
        };
    });

    console.table(results);
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

// LIMIT ELBOW ROTATION
function constrainElbowRotation(joint) {

    if (
        joint.name !== "Forearm_ScreenLeft" &&
        joint.name !== "Forearm_ScreenRight"
    ) return;

    const rest = joint.userData.restRotation;
    if (!rest) return;

    const maxBend = THREE.MathUtils.degToRad(145);
    const maxSideways = THREE.MathUtils.degToRad(5);
    const maxTwist = THREE.MathUtils.degToRad(5);

    joint.rotation.x = THREE.MathUtils.clamp(
        joint.rotation.x,
        rest.x - maxBend,
        rest.x
    );

    joint.rotation.y = THREE.MathUtils.clamp(
        joint.rotation.y,
        rest.y - maxTwist,
        rest.y + maxTwist
    );

    joint.rotation.z = THREE.MathUtils.clamp(
        joint.rotation.z,
        rest.z - maxSideways,
        rest.z + maxSideways
    );
}

// LIMIT SHOULDER ROTATION
function constrainShoulderRotation(joint) {
    if (
        joint.name !== "UpperArm_ScreenLeft" &&
        joint.name !== "UpperArm_ScreenRight"
    ) return;

    const rest = joint.userData.restRotation;
    if (!rest) return;

    const maxForwardBackward = THREE.MathUtils.degToRad(90);
    const maxSideways = THREE.MathUtils.degToRad(90);
    const maxTwist = THREE.MathUtils.degToRad(45);

    joint.rotation.x = THREE.MathUtils.clamp(
        joint.rotation.x,
        rest.x - maxForwardBackward,
        rest.x + maxForwardBackward
    );

    joint.rotation.y = THREE.MathUtils.clamp(
        joint.rotation.y,
        rest.y - maxTwist,
        rest.y + maxTwist
    );

    joint.rotation.z = THREE.MathUtils.clamp(
        joint.rotation.z,
        rest.z - maxSideways,
        rest.z + maxSideways
    );
}

// LIMIT KNEE ROTATION
// The knee bends around the Z axis.
// Left and right knees bend in opposite directions.

function constrainKneeRotation(joint) {

    if (
        joint.name !== "Shin_ScreenLeft" &&
        joint.name !== "Shin_ScreenRight"
    ) return;

    const rest = joint.userData.restRotation;
    if (!rest) return;

    const maxBend = THREE.MathUtils.degToRad(130);

    // Prevent unwanted sideways and twisting movement.
    joint.rotation.x = rest.x;
    joint.rotation.y = rest.y;

    if (joint.name === "Shin_ScreenLeft") {

        joint.rotation.z = THREE.MathUtils.clamp(
            joint.rotation.z,
            rest.z - maxBend,
            rest.z
        );

    } else {

        joint.rotation.z = THREE.MathUtils.clamp(
            joint.rotation.z,
            rest.z,
            rest.z + maxBend
        );

    }
}