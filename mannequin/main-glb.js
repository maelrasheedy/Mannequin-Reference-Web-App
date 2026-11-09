import * as THREE from './three.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from './OrbitControls.js';

// Shared pose format for mannequin, sketch upload, and image search
import { poseFromLandmarks } from './pose-vector.js';

// Anthony's inverse kinematics solver
import { solveIKChain } from './inverse_kinematic_rig.js';

// Set up the mannequin scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a);

const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// Lighting
scene.add(new THREE.AmbientLight(0xffffff, 0.6));

const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(5, 10, 5);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 1.0);
fillLight.position.set(-5, 5, -5);
scene.add(fillLight);

const backLight = new THREE.DirectionalLight(0xffffff, 0.8);
backLight.position.set(0, 5, -8);
scene.add(backLight);

// Camera controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.autoRotate = false;
controls.rotateSpeed = 1.25;
controls.zoomSpeed = 2.0;

let loadedModel = null;
let selectedArm = null;
let draggingJoint = null;
let activeHandIK = null;

let previousMouseX = 0;
let previousMouseY = 0;
let draggingPointerId = null;

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// Starting movement limits in degrees from the original Blender pose.
// We still need to test and adjust some directions for our model.
const JOINT_LIMITS = {
    UpperArm: {
        x: [-120, 160],
        y: [-60, 60],
        z: [-130, 130]
    },
    Forearm: {
        x: [-145, 0],
        y: [-5, 5],
        z: [-5, 5]
    },
    Wrist: {
        x: [-65, 65],
        y: [-30, 30],
        z: [-25, 25]
    },
    Thigh: {
        x: [-45, 120],
        y: [-35, 35],
        z: [-45, 45]
    },
    Shin: {
        x: [0, 135],
        y: [-5, 5],
        z: [-5, 5]
    },
    Ankle: {
        x: [-45, 25],
        y: [-20, 20],
        z: [-25, 25]
    },
    Neck: {
        x: [-40, 40],
        y: [-65, 65],
        z: [-35, 35]
    },
    Head: {
        x: [-20, 20],
        y: [-25, 25],
        z: [-20, 20]
    },
    Waist_Joint: {
        x: [-30, 30],
        y: [-45, 45],
        z: [-25, 25]
    },
    Finger: {
        x: [-90, 90],
        y: [-8, 8],
        z: [-8, 8]
    }
};

// Find the movement limits for a body part
function getJointLimits(name) {
    if (/^(Index|Middle|Ring|Pinky|Thumb)_(Proximal|Middle|Distal)_/.test(name)) {
        return JOINT_LIMITS.Finger;
    }

    if (name === "Waist_Joint") {
        return JOINT_LIMITS.Waist_Joint;
    }

    const jointType = name.split("_")[0];
    return JOINT_LIMITS[jointType] || null;
}

// Save the original rotations from Blender
function saveRestRotations(model) {
    model.traverse((node) => {
        if (getJointLimits(node.name)) {
            node.userData.restRotation = node.rotation.clone();
            node.userData.rotationOrder = node.rotation.order;
        }
    });
}

// Prevent a joint from going outside its movement limits
function constrainJointRotation(joint) {
    const limits = getJointLimits(joint.name);
    const rest = joint.userData.restRotation;

    if (!limits || !rest) return;

    for (const axis of ["x", "y", "z"]) {
        if (!limits[axis]) continue;

        const [minDegrees, maxDegrees] = limits[axis];

        const minAngle = rest[axis] + THREE.MathUtils.degToRad(minDegrees);
        const maxAngle = rest[axis] + THREE.MathUtils.degToRad(maxDegrees);

        joint.rotation[axis] = THREE.MathUtils.clamp(
            joint.rotation[axis],
            minAngle,
            maxAngle
        );
    }
}

// Fix the shoulder name if Blender exported it incorrectly
function fixShoulderName(model) {
    const incorrectName = model.getObjectByName("Shouldder_ScreenLeft");

    if (incorrectName) {
        incorrectName.name = "Shoulder_ScreenLeft";
        return;
    }

    if (model.getObjectByName("Shoulder_ScreenLeft")) return;

    const matches = [];

    model.traverse((node) => {
        const cleanName = node.name
            .normalize("NFKD")
            .replace(/[^a-zA-Z0-9]/g, "")
            .toLowerCase();

        if (node.isMesh && cleanName === "shoulderscreenleft") {
            matches.push(node);
        }
    });

    if (matches.length === 1) {
        matches[0].name = "Shoulder_ScreenLeft";
    }
}

// Correct an arm pivot while keeping the visible mesh in place
function moveArmPivot(model, arm, targetWorld) {
    if (!arm?.isMesh || !arm.geometry || !arm.parent || arm.isSkinnedMesh) {
        return;
    }

    model.updateMatrixWorld(true);

    const localOffset = arm.worldToLocal(targetWorld.clone());
    const newParentPosition = arm.parent.worldToLocal(targetWorld.clone());

    if (localOffset.length() < 0.0001) return;

    arm.geometry = arm.geometry.clone();

    arm.geometry.translate(
        -localOffset.x,
        -localOffset.y,
        -localOffset.z
    );

    arm.children.forEach((child) => {
        child.position.sub(localOffset);
    });

    arm.position.copy(newParentPosition);
    model.updateMatrixWorld(true);
}

// Check the shoulder pivots
function alignShoulderPivots(model) {
    model.updateMatrixWorld(true);

    for (const side of ["Left", "Right"]) {
        const shoulder = model.getObjectByName(`Shoulder_Screen${side}`);
        const upperArm = model.getObjectByName(`UpperArm_Screen${side}`);

        if (!shoulder?.isMesh || !upperArm?.isMesh || !shoulder.geometry) {
            continue;
        }

        shoulder.geometry.computeBoundingBox();

        const shoulderCenter = shoulder.geometry.boundingBox
            .getCenter(new THREE.Vector3())
            .applyMatrix4(shoulder.matrixWorld);

        const currentPivot = upperArm.getWorldPosition(new THREE.Vector3());

        const modelHeight = new THREE.Box3()
            .setFromObject(model)
            .getSize(new THREE.Vector3()).y;

        if (currentPivot.distanceTo(shoulderCenter) > modelHeight * 0.005) {
            moveArmPivot(model, upperArm, shoulderCenter);
        }
    }
}


// ============================================================
// MANNEQUIN POSE JSON
// Added to connect our Blender mannequin to reference searching
// ============================================================

// ScreenLeft is normally the person's anatomical right when
// looking at the mannequin from the front.
// We can swap these values if testing shows the sides are reversed.
const ANATOMICAL_TO_SCREEN = {
    left: "Right",
    right: "Left"
};

let lastPoseWarning = "";
let poseUpdateScheduled = false;

// Find a mannequin object by its Blender name
function findPosePart(name) {
    return loadedModel?.getObjectByName(name) || null;
}

// Get a joint's rotation pivot in the mannequin's own coordinates
function getJointPosition(name) {
    const part = findPosePart(name);

    if (!part) return null;

    const worldPosition = part.getWorldPosition(new THREE.Vector3());

    return loadedModel.worldToLocal(worldPosition);
}

// Get the center of a body part's visible geometry
function getPartCenter(name) {
    const part = findPosePart(name);

    if (!part) return null;

    const bounds = new THREE.Box3().setFromObject(part);

    if (bounds.isEmpty()) {
        return getJointPosition(name);
    }

    const center = bounds.getCenter(new THREE.Vector3());

    return loadedModel.worldToLocal(center);
}

// Estimate the end of a hand or foot from its visible geometry.
// These are starting measurements until we verify the exact
// fingertip and toe locations in Blender.
function getPartTip(name, anchorName) {
    const part = findPosePart(name);
    const anchor = findPosePart(anchorName);

    if (!part || !anchor) return null;

    const bounds = new THREE.Box3().setFromObject(part);

    if (bounds.isEmpty()) {
        return getJointPosition(name);
    }

    const anchorWorld = anchor.getWorldPosition(new THREE.Vector3());

    let farthestPoint = null;
    let farthestDistance = -1;

    // Check the bounding box corners for the point farthest
    // from the wrist or ankle.
    for (const x of [bounds.min.x, bounds.max.x]) {
        for (const y of [bounds.min.y, bounds.max.y]) {
            for (const z of [bounds.min.z, bounds.max.z]) {
                const point = new THREE.Vector3(x, y, z);
                const distance = point.distanceToSquared(anchorWorld);

                if (distance > farthestDistance) {
                    farthestDistance = distance;
                    farthestPoint = point;
                }
            }
        }
    }

    return farthestPoint
        ? loadedModel.worldToLocal(farthestPoint)
        : null;
}

// Read the points needed by our shared pose-vector.js file
function getMannequinLandmarks() {
    if (!loadedModel) return null;

    loadedModel.updateMatrixWorld(true);

    const landmarks = {
        head_center: getPartCenter("Head")
    };

    for (const [side, screenSide] of Object.entries(ANATOMICAL_TO_SCREEN)) {
        // The rotation origins represent the main joint positions.
        landmarks[`${side}_shoulder`] =
            getJointPosition(`UpperArm_Screen${screenSide}`);

        landmarks[`${side}_elbow`] =
            getJointPosition(`Forearm_Screen${screenSide}`);

        landmarks[`${side}_wrist`] =
            getJointPosition(`Wrist_Screen${screenSide}`);

        landmarks[`${side}_hip`] =
            getJointPosition(`Thigh_Screen${screenSide}`);

        landmarks[`${side}_knee`] =
            getJointPosition(`Shin_Screen${screenSide}`);

        landmarks[`${side}_ankle`] =
            getJointPosition(`Ankle_Screen${screenSide}`);

        // Hand tips and toes are estimated from the mesh bounds.
        landmarks[`${side}_hand_tip`] = getPartTip(
            `Hand_Screen${screenSide}`,
            `Wrist_Screen${screenSide}`
        );

        landmarks[`${side}_toe`] = getPartTip(
            `Foot_Screen${screenSide}`,
            `Ankle_Screen${screenSide}`
        );
    }

    return landmarks;
}

// Generate the 14-part pose JSON and send it to the main website
function sendMannequinPose() {
    if (!loadedModel) return;

    const landmarks = getMannequinLandmarks();

    if (!landmarks) return;

    // Do not send an incomplete pose if a Blender part is missing.
    const missing = Object.entries(landmarks)
        .filter(([, position]) => !position)
        .map(([name]) => name);

    if (missing.length > 0) {
        const warning = `Missing mannequin pose points: ${missing.join(", ")}`;

        if (warning !== lastPoseWarning) {
            console.warn(warning);
            lastPoseWarning = warning;
        }

        return;
    }

    try {
        const pose = poseFromLandmarks(landmarks);

        // Our reference matching format requires all 14 parts.
        if (
            !pose ||
            !Array.isArray(pose.pose_vector) ||
            pose.pose_vector.length !== 14
        ) {
            const warning = "Mannequin pose JSON is incomplete.";

            if (warning !== lastPoseWarning) {
                console.warn(warning, pose);
                lastPoseWarning = warning;
            }

            return;
        }

        lastPoseWarning = "";

        // The mannequin and sketch upload are separate input methods.
        // Each sends its own pose information to the main website.
        if (window.parent !== window) {
            window.parent.postMessage(
                {
                    type: "MANNEQUIN_POSE_CHANGED",
                    pose: pose
                },
                window.location.origin
            );
        }

        console.log("Mannequin pose JSON updated:", pose);

    } catch (error) {
        console.error("Could not calculate mannequin pose JSON:", error);
    }
}

// Only calculate one pose update per frame while someone drags.
// This keeps the movement smoother.
function scheduleMannequinPoseUpdate() {
    if (poseUpdateScheduled || !loadedModel) return;

    poseUpdateScheduled = true;

    requestAnimationFrame(() => {
        poseUpdateScheduled = false;
        sendMannequinPose();
    });
}


// ============================================================
// MOUSE AND MANNEQUIN CONTROLS
// ============================================================

// Convert the mouse position to Three.js coordinates
function updateMousePosition(event) {
    const rect = renderer.domElement.getBoundingClientRect();

    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

// Find the visible mannequin part under the mouse
function getClickedPart(event) {
    if (!loadedModel) return null;

    updateMousePosition(event);
    raycaster.setFromCamera(mouse, camera);

    const intersections = raycaster.intersectObject(loadedModel, true);

    const hit = intersections.find((intersection) => {
        return intersection.object.isMesh &&
            !intersection.object.name.startsWith("helper_");
    });

    return hit ? hit.object : null;
}

// Find which joint should move when a part is selected
function findMovableJoint(clickedObject) {
    let object = clickedObject;

    while (object && object !== loadedModel) {
        const name = object.name;
        let targetName = name;

        if (/^(Index|Middle|Ring|Pinky|Thumb)_(Proximal|Middle|Distal)_Screen(Left|Right)$/.test(name)) {
            return object;
        }

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

        if (/^(UpperArm_|Forearm_|Thigh_|Shin_|Wrist_|Ankle_|Neck$|Head$|Waist_Joint$)/.test(targetName)) {
            return loadedModel.getObjectByName(targetName) || null;
        }

        object = object.parent;
    }

    return null;
}

// Find the hand selected for inverse kinematics
function findIKHandSide(clickedObject) {
    let object = clickedObject;

    while (object && object !== loadedModel) {
        if (/^(Hand_|Wrist_|Thumb_|Index_|Middle_|Ring_|Pinky_)/.test(object.name)) {
            const match = object.name.match(/_Screen(Left|Right)$/);

            if (match) return match[1];
        }

        object = object.parent;
    }

    return null;
}

// Start hand IK dragging
function beginHandIKDrag(event, clickedObject) {
    const side = findIKHandSide(clickedObject);

    if (!side) return false;

    const shoulder = loadedModel.getObjectByName(`UpperArm_Screen${side}`);
    const elbow = loadedModel.getObjectByName(`Forearm_Screen${side}`);
    const wrist = loadedModel.getObjectByName(`Wrist_Screen${side}`);

    if (!shoulder || !elbow || !wrist) return false;

    if (!isDescendant(elbow, shoulder) || !isDescendant(wrist, elbow)) {
        console.warn("The arm joints are not connected for IK:", side);
        return false;
    }

    loadedModel.updateMatrixWorld(true);

    const wristPosition = wrist.getWorldPosition(new THREE.Vector3());

    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        camera.getWorldDirection(new THREE.Vector3()),
        wristPosition
    );

    updateMousePosition(event);
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
            new THREE.Box3()
                .setFromObject(loadedModel)
                .getSize(new THREE.Vector3()).y * 0.002
        )
    };

    controls.enabled = false;
    renderer.domElement.setPointerCapture(event.pointerId);

    event.preventDefault();
    return true;
}

// Check whether a joint belongs to the correct parent chain
function isDescendant(child, parent) {
    let object = child.parent;

    while (object) {
        if (object === parent) return true;
        object = object.parent;
    }

    return false;
}


// Move the hand toward the pointer using Anthony's IK solver
function solveHandIK(target) {
    if (!activeHandIK || !loadedModel) {
        return;
    }

    const { shoulder, elbow, wrist } = activeHandIK;

    // Anthony's shared CCD solver moves the wrist toward
    // the mouse target by rotating the elbow and shoulder.
    solveIKChain({
        model: loadedModel,

        // Solve from the elbow back toward the shoulder
        joints: [elbow, shoulder],

        // The wrist is the point we're trying to move
        endEffector: wrist,

        // Target position calculated from the mouse
        target: target,

        // Keep the existing movement behavior
        iterations: 15,
        tolerance: 0.001,
        maxStepDegrees: 15,

        // Preserve Rosie's joint movement limits
        // for BOTH the elbow and shoulder.
        constrainJoint: constrainJointRotation
    });
}

// Update hand IK while dragging
function updateHandIKDrag(event) {
    if (!activeHandIK || event.pointerId !== activeHandIK.pointerId) {
        return;
    }

    if (event.altKey) {
        const deltaY = activeHandIK.lastPointerY - event.clientY;
        activeHandIK.depthOffset += deltaY * activeHandIK.depthScale;
    }

    activeHandIK.lastPointerY = event.clientY;

    updateMousePosition(event);
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

    solveHandIK(target);

    // Let the main website know the hand pose changed
    scheduleMannequinPoseUpdate();
}

// Stop hand IK and restore camera controls
function finishHandIKDrag() {
    if (!activeHandIK) return false;

    const pointerId = activeHandIK.pointerId;
    activeHandIK = null;

    if (renderer.domElement.hasPointerCapture(pointerId)) {
        renderer.domElement.releasePointerCapture(pointerId);
    }

    controls.enabled = true;
    return true;
}

// Select a mannequin joint
renderer.domElement.addEventListener("pointerdown", (event) => {
    if (!loadedModel || event.button !== 0) return;

    const clickedPart = getClickedPart(event);
    if (!clickedPart) return;

    if (event.shiftKey && beginHandIKDrag(event, clickedPart)) {
        return;
    }

    const joint = findMovableJoint(clickedPart);
    if (!joint) return;

    draggingJoint = joint;
    draggingPointerId = event.pointerId;

    previousMouseX = event.clientX;
    previousMouseY = event.clientY;

    if (joint.name.startsWith("UpperArm_")) {
        selectedArm = joint;
    }

    controls.enabled = false;
    renderer.domElement.setPointerCapture(event.pointerId);

    event.preventDefault();
}, true);

// Rotate the selected joint with the mouse
renderer.domElement.addEventListener("pointermove", (event) => {
    if (activeHandIK) {
        updateHandIKDrag(event);
        return;
    }

    if (!draggingJoint || event.pointerId !== draggingPointerId) {
        return;
    }

    const deltaX = event.clientX - previousMouseX;
    const deltaY = event.clientY - previousMouseY;
    const sensitivity = 0.008;

    draggingJoint.rotation.z += deltaX * sensitivity;
    draggingJoint.rotation.x += deltaY * sensitivity;

    constrainJointRotation(draggingJoint);

    previousMouseX = event.clientX;
    previousMouseY = event.clientY;

    // Update the reference-search pose after moving a joint
    scheduleMannequinPoseUpdate();
}, true);

// Stop joint dragging
function stopJointDragging(event) {
    if (activeHandIK) {
        if (event.pointerId === activeHandIK.pointerId) {
            finishHandIKDrag();
        }
        return;
    }

    if (!draggingJoint || event.pointerId !== draggingPointerId) {
        return;
    }

    draggingJoint = null;
    draggingPointerId = null;
    controls.enabled = true;

    if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
    }
}

renderer.domElement.addEventListener("pointerup", stopJointDragging, true);
renderer.domElement.addEventListener("pointercancel", stopJointDragging, true);

// Keyboard shortcuts for moving the selected arm
window.addEventListener("keydown", (event) => {
    if (!selectedArm) return;

    if (
        event.target instanceof HTMLElement &&
        event.target.closest('input, textarea, select, [contenteditable="true"]')
    ) {
        return;
    }

    const step = THREE.MathUtils.degToRad(5);
    const key = event.key.toLowerCase();

    if (key === "q") selectedArm.rotation.z += step;
    else if (key === "e") selectedArm.rotation.z -= step;
    else if (key === "w") selectedArm.rotation.x += step;
    else if (key === "s") selectedArm.rotation.x -= step;
    else return;

    constrainJointRotation(selectedArm);

    // Send the new mannequin pose after keyboard movement
    scheduleMannequinPoseUpdate();

    event.preventDefault();
});

// Restore controls if the browser loses focus
window.addEventListener("blur", () => {
    finishHandIKDrag();
    draggingJoint = null;
    draggingPointerId = null;
    controls.enabled = true;
});

function addFaceMarker(model) {
    model.updateMatrixWorld(true);

    const head = model.getObjectByName("Head");

    if (!head || !head.isMesh || !head.geometry) {
        console.warn("Head mesh not found.");
        return;
    }

    head.geometry.computeBoundingBox();

    const bounds = head.geometry.boundingBox;
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());

    const faceWidth = size.x * 0.65;
    const faceHeight = size.y * 0.65;
    const surfaceOffset = Math.max(size.z * 0.003, 0.001);

    const face = new THREE.Group();
    face.name = "MannequinFace";
    head.add(face);

    const black = new THREE.MeshBasicMaterial({
        color: 0x000000,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: false
    });

    const localRaycaster = new THREE.Raycaster();

    function addFeature(x, y, radius) {
        const origin = new THREE.Vector3(
            center.x + x,
            center.y + y,
            bounds.max.z + size.z
        );

        localRaycaster.set(
            origin.applyMatrix4(head.matrixWorld),
            new THREE.Vector3(0, 0, -1)
                .transformDirection(head.matrixWorld)
        );

        const intersections = localRaycaster.intersectObject(head, false);

        if (!intersections.length) {
            console.warn("Could not find face surface at:", x, y);
            return null;
        }

        const hit = intersections[0];

        const localPoint = head.worldToLocal(hit.point.clone());

        const localNormal = hit.face.normal.clone().normalize();

        const feature = new THREE.Mesh(
            new THREE.CircleGeometry(radius, 24),
            black
        );

        feature.position.copy(localPoint);
        feature.position.addScaledVector(localNormal, surfaceOffset);
        feature.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 0, 1),
            localNormal
        );

        face.add(feature);

        return feature;
    }

    // Eyes
    addFeature(
        -faceWidth * 0.25,
        faceHeight * 0.18,
        faceWidth * 0.055
    );

    addFeature(
        faceWidth * 0.25,
        faceHeight * 0.18,
        faceWidth * 0.055
    );

function addMouth() {
    const points = [];

    // Create a curved smile using several surface points.
    for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        const x = THREE.MathUtils.lerp(
            -faceWidth * 0.15,
            faceWidth * 0.15,
            t
        );

        const y =
            -faceHeight * 0.19 -
            Math.sin(t * Math.PI) * faceHeight * 0.045;

        const origin = new THREE.Vector3(
            center.x + x,
            center.y + y,
            bounds.max.z + size.z
        );

        const worldOrigin = head.localToWorld(origin.clone());

        const direction = new THREE.Vector3(0, 0, -1)
            .transformDirection(head.matrixWorld);

        localRaycaster.set(worldOrigin, direction);

        const hit = localRaycaster.intersectObject(head, false)[0];

        if (!hit) continue;

        const localPoint = head.worldToLocal(hit.point.clone());
        const localNormal = hit.face.normal.clone().normalize();

        localPoint.addScaledVector(localNormal, surfaceOffset);

        points.push(localPoint);
    }

        if (points.length < 2) return;

        const curve = new THREE.CatmullRomCurve3(points);

        const mouth = new THREE.Mesh(
            new THREE.TubeGeometry(
                curve,
                32,
                faceWidth * 0.008,
                6,
                false
            ),
            black
        );

        mouth.name = "helper_FaceMouth";
        face.add(mouth);
    }

    addMouth();

    console.log("Surface-aligned mannequin face added.");
}

// Load the Blender mannequin
const loader = new GLTFLoader();

loader.load(
    "./models/mannequin_joint_fixes.glb",
    (gltf) => {
        loadedModel = gltf.scene;

        // Print part names to help us check the Blender mapping
        loadedModel.traverse((part) => {
            if (
                part.name &&
                /upperarm|forearm|wrist|hand|thigh|shin|ankle|foot|head|neck/i.test(part.name)
            ) {
                console.log("Mannequin part:", part.name);
            }
        });

        fixShoulderName(loadedModel);

        // Keep the materials exported from Blender
        loadedModel.traverse((node) => {
            if (!node.isMesh) return;

            node.castShadow = true;
            node.receiveShadow = true;

            const materials = Array.isArray(node.material)
                ? node.material
                : [node.material];

            materials.forEach((material) => {
                if (material) material.needsUpdate = true;
            });
        });

        // Center the mannequin in its viewer
        const box = new THREE.Box3().setFromObject(loadedModel);
        const center = box.getCenter(new THREE.Vector3());

        loadedModel.position.sub(center);
        scene.add(loadedModel);

        addFaceMarker(loadedModel);

        alignShoulderPivots(loadedModel);
        saveRestRotations(loadedModel);

        // Fit the mannequin inside the camera view
        const modelBox = new THREE.Box3().setFromObject(loadedModel);
        const size = modelBox.getSize(new THREE.Vector3());
        const modelCenter = modelBox.getCenter(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);

        const verticalFov = THREE.MathUtils.degToRad(camera.fov);
        const horizontalFov = 2 * Math.atan(
            Math.tan(verticalFov / 2) * camera.aspect
        );

        const distance = Math.max(
            size.y / (2 * Math.tan(verticalFov / 2)),
            size.x / (2 * Math.tan(horizontalFov / 2))
        ) * 1.05;

        camera.position.set(
            modelCenter.x,
            modelCenter.y + size.y * 0.12,
            modelCenter.z + Math.max(distance, maxDim)
        );

        controls.target.copy(modelCenter);
        controls.minDistance = maxDim * 0.5;
        controls.maxDistance = maxDim * 15;
        controls.update();

        console.log("Mannequin loaded successfully.");

        // Generate the first pose JSON after the model loads
        scheduleMannequinPoseUpdate();
    },
    undefined,
    (error) => {
        console.error("Could not load the mannequin:", error);
    }
);

// Render the scene
renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
});

// Resize the viewer with the browser window
window.addEventListener("resize", () => {
    const width = window.innerWidth;
    const height = window.innerHeight;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});
