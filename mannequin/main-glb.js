
import * as THREE from './three.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from './OrbitControls.js';

// Set up the scene and camera for our mannequin.
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

// Use simple lighting so we can see the wooden model clearly.
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

// Let users rotate and zoom the camera.
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

// Task 4.5.9 - Store sketch poses until the mannequin is ready.
let pendingSketchPose = undefined;
let hasAppliedSketchPose = false;

let previousMouseX = 0;
let previousMouseY = 0;
let draggingPointerId = null;

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// These are starting movement limits in degrees from the resting pose.
// We can adjust individual axes after testing the Blender model.
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

// Match a Blender object name to the limits for that body part.
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

// Save the starting rotations so the limits work with Blender's original pose.
function saveRestRotations(model) {
    model.traverse((node) => {
        if (getJointLimits(node.name)) {
            node.userData.restRotation = node.rotation.clone();
            node.userData.rotationOrder = node.rotation.order;
        }
    });
}

// Keep each joint inside the allowed movement range.
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


// ============================================================
// TASK 4.5.9 - SKETCH POSE TO MANNEQUIN
// ============================================================

// Connect our team's 14 sketch segments to the Blender mannequin parts.
// The screen-side mapping may need adjustment after visual testing.
const SKETCH_JOINT_MAPPING = [
    {
        poseName: "torso",
        jointName: "Waist_Joint",
        endNames: ["Neck"]
    },
    {
        poseName: "neck",
        jointName: "Neck",
        endNames: ["Head"]
    },

    {
        poseName: "left_shoulder",
        jointName: "UpperArm_ScreenRight",
        endNames: ["Forearm_ScreenRight"]
    },
    {
        poseName: "left_elbow",
        jointName: "Forearm_ScreenRight",
        endNames: ["Wrist_ScreenRight"]
    },
    {
        poseName: "left_wrist",
        jointName: "Wrist_ScreenRight",
        endNames: ["Palm_ScreenRight"]
    },

    {
        poseName: "right_shoulder",
        jointName: "UpperArm_ScreenLeft",
        endNames: ["Forearm_ScreenLeft"]
    },
    {
        poseName: "right_elbow",
        jointName: "Forearm_ScreenLeft",
        endNames: ["Wrist_ScreenLeft"]
    },
   {
        poseName: "right_wrist",
        jointName: "Wrist_ScreenLeft",
        endNames: ["Palm_ScreenLeft"]
    },
    {
        poseName: "left_hip",
        jointName: "Thigh_ScreenRight",
        endNames: ["Shin_ScreenRight"]
    },
    {
        poseName: "left_knee",
        jointName: "Shin_ScreenRight",
        endNames: ["Ankle_ScreenRight"]
    },
    {
        poseName: "left_ankle",
        jointName: "Ankle_ScreenRight",
        endNames: ["Foot_ScreenRight"]
    },

    {
        poseName: "right_hip",
        jointName: "Thigh_ScreenLeft",
        endNames: ["Shin_ScreenLeft"]
    },
    {
        poseName: "right_knee",
        jointName: "Shin_ScreenLeft",
        endNames: ["Ankle_ScreenLeft"]
    },
    {
        poseName: "right_ankle",
        jointName: "Ankle_ScreenLeft",
        endNames: ["Foot_ScreenLeft"]
    }
];

// Check that the incoming sketch pose has all 14 valid segments.
function isValidSketchPose(pose) {
    if (
        !pose ||
        !Array.isArray(pose.pose_vector) ||
        pose.pose_vector.length !== 14
    ) {
        return false;
    }

    const joints = new Map();

    for (const joint of pose.pose_vector) {
        if (
            !joint ||
            typeof joint.name !== "string" ||
            joints.has(joint.name) ||
            !Number.isFinite(joint["x-plane-angle"]) ||
            !Number.isFinite(joint["y-plane-angle"]) ||
            !Number.isFinite(joint["z-plane-angle"])
        ) {
            return false;
        }

        joints.set(joint.name, joint);
    }

    return SKETCH_JOINT_MAPPING.every((mapping) =>
        joints.has(mapping.poseName)
    );
}

// Convert the sketch's plane angles back into a 3D direction.
function sketchAnglesToDirection(jointData) {
    const angleX = THREE.MathUtils.degToRad(
        jointData["x-plane-angle"]
    );

    const angleY = THREE.MathUtils.degToRad(
        jointData["y-plane-angle"]
    );

    const angleZ = THREE.MathUtils.degToRad(
        jointData["z-plane-angle"]
    );

    // Convert MediaPipe's downward-positive Y to Three.js upward-positive Y.
    // The Z direction is an initial mapping to verify with the actual model.
    const direction = new THREE.Vector3(
        Math.sin(angleX),
        -Math.sin(angleY),
        -Math.sin(angleZ)
    );

    if (
        !Number.isFinite(direction.x) ||
        !Number.isFinite(direction.y) ||
        !Number.isFinite(direction.z) ||
        direction.lengthSq() < 1e-8
    ) {
        return null;
    }

    return direction.normalize();
}

// Restore the mannequin's original Blender joint rotations.
function restoreSketchRestPose() {
    if (!loadedModel) {
        return;
    }

    loadedModel.traverse((joint) => {
        const restRotation = joint.userData.restRotation;

        if (restRotation) {
            joint.rotation.copy(restRotation);
        }
    });

    loadedModel.updateMatrixWorld(true);
}

// Stop manual dragging before applying an automatic sketch pose.
function stopSketchPoseInteraction() {
    if (activeHandIK) {
        finishHandIKDrag();
    }

    if (
        draggingPointerId !== null &&
        renderer.domElement.hasPointerCapture(draggingPointerId)
    ) {
        renderer.domElement.releasePointerCapture(
            draggingPointerId
        );
    }

    draggingJoint = null;
    draggingPointerId = null;

    controls.enabled = true;
}

// Restore the mannequin when an applied sketch pose is removed.
function resetSketchMannequinPose() {
    if (!loadedModel || !hasAppliedSketchPose) {
        return;
    }

    stopSketchPoseInteraction();
    restoreSketchRestPose();

    hasAppliedSketchPose = false;

    console.log("Mannequin restored after sketch pose cleared.");
}

// Find a usable endpoint for each mannequin body segment
function findSketchSegmentEnd(joint, endNames) {
    loadedModel.updateMatrixWorld(true);

    const jointPosition = joint.getWorldPosition(
        new THREE.Vector3()
    );

    for (const endName of endNames) {
        const end = loadedModel.getObjectByName(endName);

        if (!end || !isDescendant(end, joint)) {
            continue;
        }

        const endPosition = end.getWorldPosition(
            new THREE.Vector3()
        );

        // Use the normal pivot when the two joints are separated
        if (endPosition.distanceToSquared(jointPosition) > 1e-8) {
            return end;
        }

        // Reuse a previously calculated geometry endpoint
        if (end.userData.sketchEndpointHelper) {
            return end.userData.sketchEndpointHelper;
        }

        // Some Blender parts share a pivot, so use their mesh center
        const bounds = new THREE.Box3().setFromObject(end);

        if (bounds.isEmpty()) {
            continue;
        }

        const geometryCenter = bounds.getCenter(
            new THREE.Vector3()
        );

        if (
            geometryCenter.distanceToSquared(jointPosition) <= 1e-8
        ) {
            continue;
        }

        // Attach a helper point so it moves with the mannequin part
        const helper = new THREE.Object3D();
        helper.name = `helper_sketch_endpoint_${endName}`;

        const localPosition = end.worldToLocal(
            geometryCenter.clone()
        );

        end.add(helper);
        helper.position.copy(localPosition);

        end.userData.sketchEndpointHelper = helper;

        console.log(
            "Using geometry-based sketch endpoint:",
            endName
        );

        return helper;
    }

    return null;
}

// Rotate one mannequin segment toward its detected sketch direction.
function rotatePartTowardSketch(joint, segmentEnd, targetDirection) {
    loadedModel.updateMatrixWorld(true);

    const jointPosition = joint.getWorldPosition(
        new THREE.Vector3()
    );

    const endPosition = segmentEnd.getWorldPosition(
        new THREE.Vector3()
    );

    const currentDirection = endPosition.sub(jointPosition);

    if (currentDirection.lengthSq() < 1e-8) {
        return false;
    }

    currentDirection.normalize();

    // Calculate the rotation needed to align the segment directions.
    const worldCorrection = new THREE.Quaternion()
        .setFromUnitVectors(
            currentDirection,
            targetDirection
        );

    // Convert the rotation into the joint parent's local coordinates.
    const parentRotation = new THREE.Quaternion();

    if (joint.parent) {
        joint.parent.getWorldQuaternion(parentRotation);
    }

    const localCorrection = parentRotation.clone()
        .invert()
        .multiply(worldCorrection)
        .multiply(parentRotation);

    joint.quaternion.premultiply(localCorrection);

    // Apply the same limits to IK as normal dragging.
    constrainJointRotation(joint);

    loadedModel.updateMatrixWorld(true);

    return true;
}

// Apply the uploaded human sketch pose to the mannequin.
function applySketchPose(pose) {
    if (!loadedModel) {
        return false;
    }

    if (!isValidSketchPose(pose)) {
        console.warn("Cannot apply an invalid sketch pose.");
        return false;
    }

    const poseByName = new Map(
        pose.pose_vector.map((joint) => [joint.name, joint])
    );

    const availableSegments = [];

    // Find each matching part in our Blender mannequin.
    for (const mapping of SKETCH_JOINT_MAPPING) {
        const joint = loadedModel.getObjectByName(
            mapping.jointName
        );

        if (!joint) {
            console.warn(
                "Missing mannequin joint:",
                mapping.jointName
            );
            continue;
        }

        const segmentEnd = findSketchSegmentEnd(
            joint,
            mapping.endNames
        );

        if (!segmentEnd) {
            console.warn(
                "Missing connected segment for:",
                mapping.poseName
            );
            continue;
        }

        const targetDirection = sketchAnglesToDirection(
            poseByName.get(mapping.poseName)
        );

        if (!targetDirection) {
            console.warn(
                "Invalid sketch direction for:",
                mapping.poseName
            );
            continue;
        }

        availableSegments.push({
            poseName: mapping.poseName,
            joint,
            segmentEnd,
            targetDirection
        });
    }

    if (availableSegments.length === 0) {
        console.warn(
            "No compatible mannequin parts found for sketch pose."
        );
        return false;
    }

    // Begin every sketch pose from the mannequin's resting position.
    stopSketchPoseInteraction();
    restoreSketchRestPose();

    let updatedCount = 0;

    // Apply the pose from the central body toward the outer joints.
    for (const segment of availableSegments) {
        const updated = rotatePartTowardSketch(
            segment.joint,
            segment.segmentEnd,
            segment.targetDirection
        );

        if (updated) {
            updatedCount++;
        }
    }

    hasAppliedSketchPose = updatedCount > 0;

    console.log(
        "Sketch pose applied to mannequin:",
        updatedCount,
        "of 14 segments"
    );

    if (updatedCount < 14) {
        console.warn(
            "Some sketch segments could not be mapped. Check the Blender part names and hierarchy."
        );
    }

    return hasAppliedSketchPose;
}

// Receive pose updates from the main website.
window.addEventListener("message", function (event) {
    // Only accept messages from the parent page on our own website.
    if (
        window.parent === window ||
        event.origin !== window.location.origin ||
        event.source !== window.parent
    ) {
        return;
    }

    const message = event.data;

    if (!message || message.type !== "SKETCH_POSE_UPDATED") {
        return;
    }

    // A null pose means the sketch was removed or rejected.
    if (message.pose === null) {
        pendingSketchPose = null;
        resetSketchMannequinPose();
        return;
    }

    if (!isValidSketchPose(message.pose)) {
        console.warn("Rejected invalid sketch pose message.");
        return;
    }

    // Save the pose in case the mannequin is still loading.
    pendingSketchPose = message.pose;

    if (loadedModel) {
        applySketchPose(pendingSketchPose);
    }
});


// ============================================================
// EXISTING MANNEQUIN MODEL AND CONTROLS
// ============================================================

// Some Blender exports have an extra letter in the left shoulder's name.
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

// Keep the visible arm in place when correcting its rotation pivot.
function moveArmPivot(model, arm, targetWorld) {
    if (!arm?.isMesh || !arm.geometry || !arm.parent || arm.isSkinnedMesh) {
        return;
    }

    model.updateMatrixWorld(true);

    const localOffset = arm.worldToLocal(targetWorld.clone());
    const newParentPosition = arm.parent.worldToLocal(targetWorld.clone());

    // Skip the correction if Blender already has the pivot in the right place.
    if (localOffset.length() < 0.0001) return;

    arm.geometry = arm.geometry.clone();

    arm.geometry.translate(
        -localOffset.x,
        -localOffset.y,
        -localOffset.z
    );

    // Move the children back so elbows, wrists and hands do not jump.
    arm.children.forEach((child) => {
        child.position.sub(localOffset);
    });

    arm.position.copy(newParentPosition);
    model.updateMatrixWorld(true);
}

// Check each shoulder separately instead of assuming both sides are identical.
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

        // Only adjust pivots that are noticeably out of place.
        const modelHeight = new THREE.Box3()
            .setFromObject(model)
            .getSize(new THREE.Vector3()).y;

        if (currentPivot.distanceTo(shoulderCenter) > modelHeight * 0.005) {
            moveArmPivot(model, upperArm, shoulderCenter);
        }
    }
}

// Convert the pointer location to Three.js coordinates.
function updateMousePosition(event) {
    const rect = renderer.domElement.getBoundingClientRect();

    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

// Find the visible part of the mannequin under the pointer.
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

// Find the limb that should move when someone clicks a body part.
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

// Find which hand is selected for inverse kinematics.
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

// Start moving a hand while the shoulder and elbow follow it.
function beginHandIKDrag(event, clickedObject) {
    const side = findIKHandSide(clickedObject);

    if (!side) return false;

    const shoulder = loadedModel.getObjectByName(`UpperArm_Screen${side}`);
    const elbow = loadedModel.getObjectByName(`Forearm_Screen${side}`);
    const wrist = loadedModel.getObjectByName(`Wrist_Screen${side}`);

    if (!shoulder || !elbow || !wrist) return false;

    // IK needs a connected arm hierarchy to move properly.
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

// Check that a joint belongs to the correct parent chain.
function isDescendant(child, parent) {
    let object = child.parent;

    while (object) {
        if (object === parent) return true;
        object = object.parent;
    }

    return false;
}

// Use CCD to move the hand toward the pointer target.
function solveHandIK(target) {
    if (!activeHandIK || !loadedModel) return;

    const { shoulder, elbow, wrist } = activeHandIK;
    const jointPosition = new THREE.Vector3();
    const wristPosition = new THREE.Vector3();

    for (let iteration = 0; iteration < 15; iteration++) {
        for (const joint of [elbow, shoulder]) {
            loadedModel.updateMatrixWorld(true);

            joint.getWorldPosition(jointPosition);
            wrist.getWorldPosition(wristPosition);

            const towardWrist = wristPosition.clone().sub(jointPosition);
            const towardTarget = target.clone().sub(jointPosition);

            if (
                towardWrist.lengthSq() < 1e-10 ||
                towardTarget.lengthSq() < 1e-10
            ) {
                continue;
            }

            const worldRotation = new THREE.Quaternion().setFromUnitVectors(
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

            // Apply the same limits to IK as normal dragging.
            constrainJointRotation(joint);
        }

        loadedModel.updateMatrixWorld(true);
        wrist.getWorldPosition(wristPosition);

        if (wristPosition.distanceToSquared(target) < 1e-6) {
            break;
        }
    }
}

// Update the hand target during IK dragging.
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
}

// Stop hand IK dragging and allow camera movement again.
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

// Start posing a joint when the user clicks and drags it.
renderer.domElement.addEventListener("pointerdown", (event) => {
    if (!loadedModel || event.button !== 0) return;

    const clickedPart = getClickedPart(event);
    if (!clickedPart) return;

    // Shift and drag a hand to use IK.
    if (event.shiftKey && beginHandIKDrag(event, clickedPart)) {
        return;
    }

    const joint = findMovableJoint(clickedPart);
    if (!joint) return;

    draggingJoint = joint;
    draggingPointerId = event.pointerId;

    previousMouseX = event.clientX;
    previousMouseY = event.clientY;

    // Remember the arm for keyboard shortcuts too.
    if (joint.name.startsWith("UpperArm_")) {
        selectedArm = joint;
    }

    controls.enabled = false;
    renderer.domElement.setPointerCapture(event.pointerId);

    event.preventDefault();
}, true);

// Rotate joints with the mouse, but stop at their movement limits.
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
}, true);

// Stop posing and restore normal camera controls.
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

// Keep the arm keyboard shortcuts from our original prototype.
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
    event.preventDefault();
});

// Reset dragging if the browser window loses focus.
window.addEventListener("blur", () => {
    finishHandIKDrag();
    draggingJoint = null;
    draggingPointerId = null;
    controls.enabled = true;
});

// Load the updated mannequin from Blender.
const loader = new GLTFLoader();

loader.load(
    "./models/mannequin_joint_fixes.glb",
    (gltf) => {
        loadedModel = gltf.scene;

        fixShoulderName(loadedModel);

        // Keep the wood materials exported from Blender.
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

        // Center the mannequin in the viewer.
        const box = new THREE.Box3().setFromObject(loadedModel);
        const center = box.getCenter(new THREE.Vector3());

        loadedModel.position.sub(center);
        scene.add(loadedModel);

        // Correct shoulder pivots only if they are out of place.
        alignShoulderPivots(loadedModel);

        // Save the final resting pose after any pivot adjustments.
        saveRestRotations(loadedModel);

        // Check the actual wrist children and ankle-to-foot distances.
        loadedModel.updateMatrixWorld(true);

        for (const side of ["Left", "Right"]) {
            const wrist = loadedModel.getObjectByName(
                `Wrist_Screen${side}`
            );

            const ankle = loadedModel.getObjectByName(
                `Ankle_Screen${side}`
            );

            const foot = loadedModel.getObjectByName(
                `Foot_Screen${side}`
            );

            const wristParts = [];

            wrist?.traverse((part) => {
                if (part !== wrist && part.name) {
                    wristParts.push(part.name);
                }
            });

            const ankleFootDistance = ankle && foot
                ? ankle.getWorldPosition(
                    new THREE.Vector3()
                ).distanceTo(
                    foot.getWorldPosition(new THREE.Vector3())
                )
                : null;

            console.log("Sketch endpoints:", side, {
                wristParts,
                ankleFootDistance
            });
        }

        // Fit the entire mannequin inside the camera view.
        const modelBox = new THREE.Box3().setFromObject(loadedModel);
        const size = modelBox.getSize(new THREE.Vector3());
        const modelCenter = modelBox.getCenter(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);

        const verticalFov = THREE.MathUtils.degToRad(camera.fov);
        const horizontalFov = 2 * Math.atan(
            Math.tan(verticalFov / 2)
            * camera.aspect
        );

        const distance = Math.max(
            size.y / (2 * Math.tan(verticalFov / 2)),
            size.x / (2 * Math.tan(horizontalFov / 2))
        ) * 1.35;

        camera.position.set(
            modelCenter.x,
            modelCenter.y + size.y * 0.12,
            modelCenter.z + Math.max(distance, maxDim)
        );

        controls.target.copy(modelCenter);
        controls.minDistance = maxDim * 0.3;
        controls.maxDistance = maxDim * 15;
        controls.update();

        console.log("Mannequin loaded successfully.");

        // Apply any sketch pose received while the GLB was loading.
        if (pendingSketchPose) {
            applySketchPose(pendingSketchPose);
        }
    },
    undefined,
    (error) => {
        console.error("Could not load the mannequin:", error);
    }
);

// Keep the viewer running and update camera movement smoothly.
renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
});

// Resize the canvas when the browser window changes size.
window.addEventListener("resize", () => {
    const width = window.innerWidth;
    const height = window.innerHeight;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(
        window.devicePixelRatio, 2
    ));
});
