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
let activeJointDrag = null;

// Task 4.5.9 - Store sketch poses until the mannequin is ready.
let pendingSketchPose = undefined;
let hasAppliedSketchPose = false;

let previousMouseX = 0;
let previousMouseY = 0;
let draggingPointerId = null;

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// Starting movement limits in degrees from the original Blender pose.
// We still need to test and adjust some directions for our model.
const JOINT_LIMITS = {
    UpperArm: {
        x: [-160, 160],
        y: [-100, 100],
        z: [-160, 160]
    },
    Forearm: {
        x: [-160, 0],
        y: [-20, 20],
        z: [-20, 20]
    },
    Wrist: {
        x: [-85, 85],
        y: [-45, 45],
        z: [-45, 45]
    },
    Thigh: {
        x: [-90, 135],
        y: [-65, 65],
        z: [-75, 75]
    },
    Shin: {
        x: [0, 145],
        y: [-15, 15],
        z: [-15, 15]
    },
    Ankle: {
        x: [-60, 45],
        y: [-35, 35],
        z: [-40, 40]
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
    },
    Pelvis_Pivot: {
        x: [-30, 30],
        y: [-35, 35],
        z: [-25, 25]
    }
};

// Find the movement limits for a body part
function getJointLimits(name) {
    if (/^(Index|Middle|Ring|Pinky|Thumb)_(Proximal|Middle|Distal)_/.test(name)) {
        return JOINT_LIMITS.Finger;
    }

    if (name === "Pelvis_Pivot") {
    return JOINT_LIMITS.Pelvis_Pivot;
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


// ============================================================
// TORSO AND PELVIS COLLISION PREVENTION
// ============================================================


// ============================================================
// FULL UPPER-BODY AND LIMB COLLISION PREVENTION
// ============================================================

const COLLISION_SEGMENTS = [
    // LEFT ARM: upper arm
    { joint: "UpperArm_ScreenLeft", child: "Forearm_ScreenLeft", body: "Torso", skip: 0.45, radiusScale: 0.65 },
    { joint: "UpperArm_ScreenLeft", child: "Forearm_ScreenLeft", body: "Head", skip: 0.15 },
    { joint: "UpperArm_ScreenLeft", child: "Forearm_ScreenLeft", body: "Waist_Joint", skip: 0.1 },
    { joint: "UpperArm_ScreenLeft", child: "Forearm_ScreenLeft", body: "Pelvis", skip: 0.1 },

    // LEFT ARM: forearm and wrist
    { joint: "Forearm_ScreenLeft", child: "Wrist_ScreenLeft", body: "Torso", skip: 0 },
    { joint: "Forearm_ScreenLeft", child: "Wrist_ScreenLeft", body: "Head", skip: 0 },
    { joint: "Forearm_ScreenLeft", child: "Wrist_ScreenLeft", body: "Waist_Joint", skip: 0 },
    { joint: "Forearm_ScreenLeft", child: "Wrist_ScreenLeft", body: "Pelvis", skip: 0 },

    // RIGHT ARM: upper arm
    { joint: "UpperArm_ScreenRight", child: "Forearm_ScreenRight", body: "Torso", skip: 0.45, radiusScale: 0.65 },
    { joint: "UpperArm_ScreenRight", child: "Forearm_ScreenRight", body: "Head", skip: 0.15 },
    { joint: "UpperArm_ScreenRight", child: "Forearm_ScreenRight", body: "Waist_Joint", skip: 0.1 },
    { joint: "UpperArm_ScreenRight", child: "Forearm_ScreenRight", body: "Pelvis", skip: 0.1 },

    // RIGHT ARM: forearm and wrist
    { joint: "Forearm_ScreenRight", child: "Wrist_ScreenRight", body: "Torso", skip: 0 },
    { joint: "Forearm_ScreenRight", child: "Wrist_ScreenRight", body: "Head", skip: 0 },
    { joint: "Forearm_ScreenRight", child: "Wrist_ScreenRight", body: "Waist_Joint", skip: 0 },
    { joint: "Forearm_ScreenRight", child: "Wrist_ScreenRight", body: "Pelvis", skip: 0 },

    // LEFT ARM against legs
    { joint: "UpperArm_ScreenLeft", child: "Forearm_ScreenLeft", body: "Thigh_ScreenLeft", skip: 0 },
    { joint: "UpperArm_ScreenLeft", child: "Forearm_ScreenLeft", body: "Thigh_ScreenRight", skip: 0 },
    { joint: "Forearm_ScreenLeft", child: "Wrist_ScreenLeft", body: "Thigh_ScreenLeft", skip: 0 },
    { joint: "Forearm_ScreenLeft", child: "Wrist_ScreenLeft", body: "Thigh_ScreenRight", skip: 0 },
    { joint: "Forearm_ScreenLeft", child: "Wrist_ScreenLeft", body: "Shin_ScreenLeft", skip: 0 },
    { joint: "Forearm_ScreenLeft", child: "Wrist_ScreenLeft", body: "Shin_ScreenRight", skip: 0 },

    // RIGHT ARM against legs
    { joint: "UpperArm_ScreenRight", child: "Forearm_ScreenRight", body: "Thigh_ScreenLeft", skip: 0 },
    { joint: "UpperArm_ScreenRight", child: "Forearm_ScreenRight", body: "Thigh_ScreenRight", skip: 0 },
    { joint: "Forearm_ScreenRight", child: "Wrist_ScreenRight", body: "Thigh_ScreenLeft", skip: 0 },
    { joint: "Forearm_ScreenRight", child: "Wrist_ScreenRight", body: "Thigh_ScreenRight", skip: 0 },
    { joint: "Forearm_ScreenRight", child: "Wrist_ScreenRight", body: "Shin_ScreenLeft", skip: 0 },
    { joint: "Forearm_ScreenRight", child: "Wrist_ScreenRight", body: "Shin_ScreenRight", skip: 0 },

    // LEGS against pelvis
    { joint: "Thigh_ScreenLeft", child: "Shin_ScreenLeft", body: "Pelvis", skip: 0.22 },
    { joint: "Shin_ScreenLeft", child: "Ankle_ScreenLeft", body: "Pelvis", skip: 0 },
    { joint: "Thigh_ScreenRight", child: "Shin_ScreenRight", body: "Pelvis", skip: 0.22 },
    { joint: "Shin_ScreenRight", child: "Ankle_ScreenRight", body: "Pelvis", skip: 0 },

        // LEFT THIGH against RIGHT LEG
    {
        joint: "Thigh_ScreenLeft",
        child: "Shin_ScreenLeft",
        body: "Thigh_ScreenRight",
        skip: 0.2,
        radiusScale: 0.7
    },
    {
        joint: "Thigh_ScreenLeft",
        child: "Shin_ScreenLeft",
        body: "Shin_ScreenRight",
        skip: 0.2,
        radiusScale: 0.7
    },

    // LEFT SHIN against RIGHT LEG
    {
        joint: "Shin_ScreenLeft",
        child: "Ankle_ScreenLeft",
        body: "Thigh_ScreenRight",
        skip: 0.05,
        radiusScale: 0.7
    },
    {
        joint: "Shin_ScreenLeft",
        child: "Ankle_ScreenLeft",
        body: "Shin_ScreenRight",
        skip: 0.05,
        radiusScale: 0.7
    },

    // RIGHT THIGH against LEFT LEG
    {
        joint: "Thigh_ScreenRight",
        child: "Shin_ScreenRight",
        body: "Thigh_ScreenLeft",
        skip: 0.2,
        radiusScale: 0.7
    },
    {
        joint: "Thigh_ScreenRight",
        child: "Shin_ScreenRight",
        body: "Shin_ScreenLeft",
        skip: 0.2,
        radiusScale: 0.7
    },

    // RIGHT SHIN against LEFT LEG
    {
        joint: "Shin_ScreenRight",
        child: "Ankle_ScreenRight",
        body: "Thigh_ScreenLeft",
        skip: 0.05,
        radiusScale: 0.7
    },
    {
        joint: "Shin_ScreenRight",
        child: "Ankle_ScreenRight",
        body: "Shin_ScreenLeft",
        skip: 0.05,
        radiusScale: 0.7
    }
];

function getCollisionRadiusWorld(limb) {
    if (!limb?.geometry) return 0;

    const geometry = limb.geometry;

    if (!geometry.boundingBox) {
        geometry.computeBoundingBox();
    }

    const size = geometry.boundingBox.getSize(
        new THREE.Vector3()
    );

    const localRadius = Math.min(size.x, size.z) * 0.5;

    const worldScale = limb.getWorldScale(
        new THREE.Vector3()
    );

    return localRadius * Math.max(
        worldScale.x,
        worldScale.y,
        worldScale.z
    );
}

function isDescendantOf(object, ancestor) {
    let current = object;

    while (current) {
        if (current === ancestor) {
            return true;
        }

        current = current.parent;
    }

    return false;
}

function pointInsideBodyBoundary(worldPoint, body, radiusWorld) {
    if (!body?.geometry || !worldPoint?.isVector3) {
        return false;
    }

    const geometry = body.geometry;

    if (!geometry.boundingBox) {
        geometry.computeBoundingBox();
    }

    if (geometry.boundingBox.isEmpty()) {
        return false;
    }

    body.updateWorldMatrix(true, false);

    // Transform the point into the body's local coordinate system.
    const localPoint = body.worldToLocal(
        worldPoint.clone()
    );

    const bounds = geometry.boundingBox;

    const center = bounds.getCenter(new THREE.Vector3());
    const halfSize = bounds.getSize(new THREE.Vector3())
        .multiplyScalar(0.5);

    const localPointFromCenter = localPoint.sub(center);

    // Convert world collision radius into a conservative local radius.
    const inverseWorldMatrix = new THREE.Matrix4()
        .copy(body.matrixWorld)
        .invert();

    const inverseScale = new THREE.Vector3();

    inverseWorldMatrix.decompose(
        new THREE.Vector3(),
        new THREE.Quaternion(),
        inverseScale
    );

    const localRadius = radiusWorld * Math.max(
        Math.abs(inverseScale.x),
        Math.abs(inverseScale.y),
        Math.abs(inverseScale.z)
    );

    const rx = Math.max(halfSize.x + localRadius, 0.00001);
    const ry = Math.max(halfSize.y + localRadius, 0.00001);
    const rz = Math.max(halfSize.z + localRadius, 0.00001);

    // Ellipsoid boundary test.
    const normalizedDistance =
        (localPointFromCenter.x / rx) ** 2 +
        (localPointFromCenter.y / ry) ** 2 +
        (localPointFromCenter.z / rz) ** 2;

    return normalizedDistance < 1;
}

function isMannequinPoseCollisionFree() {
    if (!loadedModel) return true;

    loadedModel.updateMatrixWorld(true);

    // Check the existing arm and leg collision definitions.
    for (const segment of COLLISION_SEGMENTS) {
        const joint = loadedModel.getObjectByName(segment.joint);
        const child = loadedModel.getObjectByName(segment.child);
        const body = loadedModel.getObjectByName(segment.body);

        if (!joint || !child || !body) continue;

        const start = joint.getWorldPosition(new THREE.Vector3());
        const end = child.getWorldPosition(new THREE.Vector3());

        const radius =
            getCollisionRadiusWorld(joint) *
            (segment.radiusScale ?? 1);

        if (radius <= 0) continue;

        const direction = end.clone().sub(start);

        if (direction.lengthSq() < 1e-10) continue;

        for (let i = 0; i <= 24; i++) {
            const t = segment.skip +
                (1 - segment.skip) * (i / 24);

            const sample = start.clone().addScaledVector(
                direction,
                t
            );

            if (pointInsideBodyBoundary(sample, body, radius)) {
                return false;
            }
        }
    }

    // Check individual hand and finger meshes against the body.
    const handBodies = [
        "Head",
        "Torso",
        "Waist_Joint",
        "Pelvis",
        "Thigh_ScreenLeft",
        "Thigh_ScreenRight",
        "Shin_ScreenLeft",
        "Shin_ScreenRight"
    ];

    const handParts = [];

    loadedModel.traverse(object => {
        if (
            object.isMesh &&
            /^(Wrist|Index|Middle|Ring|Pinky|Thumb)_.*_Screen(Left|Right)$/.test(
                object.name
            )
        ) {
            handParts.push(object);
        }
    });

    for (const hand of handParts) {
        const radius = getCollisionRadiusWorld(hand);

        if (radius <= 0) continue;

        const handPosition = hand.getWorldPosition(
            new THREE.Vector3()
        );

        for (const bodyName of handBodies) {
            const body = loadedModel.getObjectByName(bodyName);

            if (!body) continue;

            // Do not test a hand against its own mesh.
            if (hand === body) continue;

            // Ignore the hand's immediate attachment hierarchy.
            if (
                isDescendantOf(hand, body) &&
                bodyName !== "Torso"
            ) {
                continue;
            }

            if (
                pointInsideBodyBoundary(
                    handPosition,
                    body,
                    radius * 0.8
                )
            ) {
                return false;
            }
        }
    }

    return true;
}

// Apply a proposed joint rotation only when it does not introduce a torso or pelvis collision.
function applyRotationWithCollision(joint, applyRotation) {
    const originalRotation = joint.quaternion.clone();

    applyRotation();

    constrainJointRotation(joint);
    loadedModel.updateMatrixWorld(true);

    if (joint.name === "Waist_Joint") {
        return true;
    }

    if (isMannequinPoseCollisionFree()) {
        return true;
    }

    const candidateRotation = joint.quaternion.clone();

    let low = 0;
    let high = 1;
    let bestRotation = originalRotation.clone();

    for (let i = 0; i < 10; i++) {
        const middle = (low + high) * 0.5;

        joint.quaternion.copy(originalRotation).slerp(
            candidateRotation,
            middle
        );

        constrainJointRotation(joint);
        loadedModel.updateMatrixWorld(true);

        if (isMannequinPoseCollisionFree()) {
            low = middle;
            bestRotation.copy(joint.quaternion);
        } else {
            high = middle;
        }
    }

    joint.quaternion.copy(bestRotation);
    loadedModel.updateMatrixWorld(true);

    return low > 0.001;
}

// ============================================================
// TASK 4.5.9 - SKETCH POSE TO MANNEQUIN
// ============================================================

// Match the 14 sketch segments to the Blender mannequin parts.
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

// Check that the sketch pose has all 14 segments.
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

// Turn the sketch angles into a 3D direction.
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

    // MediaPipe and Three.js use different Y directions.
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

// Put the mannequin back into its original Blender pose.
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

// Stop dragging before using the uploaded pose.
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

// Reset the mannequin when the sketch is removed.
function resetSketchMannequinPose() {
    if (!loadedModel || !hasAppliedSketchPose) {
        return;
    }

    stopSketchPoseInteraction();
    restoreSketchRestPose();

    hasAppliedSketchPose = false;

    console.log("Mannequin restored after sketch pose cleared.");
}

// Find an endpoint for each mannequin segment.
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

        // Use the joint position when the pivots are apart.
        if (endPosition.distanceToSquared(jointPosition) > 1e-8) {
            return end;
        }

        // Reuse the helper if we already made one.
        if (end.userData.sketchEndpointHelper) {
            return end.userData.sketchEndpointHelper;
        }

        // Some parts share a pivot, so use the mesh center.
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

// Rotate a mannequin part toward the sketch direction.
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

    const worldCorrection = new THREE.Quaternion()
        .setFromUnitVectors(
            currentDirection,
            targetDirection
        );

    // Change the rotation to the joint's local coordinates.
    const parentRotation = new THREE.Quaternion();

    if (joint.parent) {
        joint.parent.getWorldQuaternion(parentRotation);
    }

    const localCorrection = parentRotation.clone()
        .invert()
        .multiply(worldCorrection)
        .multiply(parentRotation);

    joint.quaternion.premultiply(localCorrection);

    // Keep the same joint movement limits.
    constrainJointRotation(joint);

    loadedModel.updateMatrixWorld(true);

    return true;
}

// Apply the uploaded pose to the mannequin.
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

    // Find the matching Blender parts.
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

    // Start from the original pose each time.
    stopSketchPoseInteraction();
    restoreSketchRestPose();

    let updatedCount = 0;

    // Move the body parts from the center outward.
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

// Receive sketch pose updates from the main website.
window.addEventListener("message", function (event) {
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

    // Null means the sketch was removed or rejected.
    if (message.pose === null) {
        pendingSketchPose = null;
        resetSketchMannequinPose();
        return;
    }

    if (!isValidSketchPose(message.pose)) {
        console.warn("Rejected invalid sketch pose message.");
        return;
    }

    // Save the pose in case the model is still loading.
    pendingSketchPose = message.pose;

    if (loadedModel) {
        applySketchPose(pendingSketchPose);
    }
});


// ============================================================
// EXISTING MANNEQUIN MODEL AND CONTROLS
// ============================================================

// Fix the shoulder name if Blender exported it incorrectly.
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

        // Some Blender models don't have a part named Hand.
        // Try the finger parts before estimating the hand tip.
        const wristName = `Wrist_Screen${screenSide}`;
        const wristPoint = getJointPosition(wristName);
        const elbowPoint = getJointPosition(
            `Forearm_Screen${screenSide}`
        );

        landmarks[`${side}_hand_tip`] =
            getPartTip(`Hand_Screen${screenSide}`, wristName) ||
            getPartTip(`Middle_Distal_Screen${screenSide}`, wristName) ||
            getPartTip(`Index_Distal_Screen${screenSide}`, wristName) ||
            (wristPoint && elbowPoint
                ? wristPoint.clone().add(
                    wristPoint.clone()
                        .sub(elbowPoint)
                        .multiplyScalar(0.25)
                )
                : null);

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


function getClickedWorldPoint(event) {
    if (!loadedModel) return null;

    updateMousePosition(event);
    raycaster.setFromCamera(mouse, camera);

    const intersections = raycaster.intersectObject(
        loadedModel,
        true
    );

    const hit = intersections.find((intersection) =>
        intersection.object.isMesh &&
        !intersection.object.name.startsWith("helper_")
    );

    return hit ? hit.point.clone() : null;
}
// Find the actual mesh selected by the mouse.
function getClickedPart(event) {
    if (!loadedModel) return null;

    updateMousePosition(event);
    raycaster.setFromCamera(mouse, camera);

    const intersections = raycaster.intersectObject(
        loadedModel,
        true
    );

    const hit = intersections.find((intersection) =>
        intersection.object.isMesh &&
        !intersection.object.name.startsWith("helper_")
    );

    return hit ? hit.object : null;
}

function createPelvisPivot(model) {
    const pelvis = model.getObjectByName("Pelvis");
    const waist = model.getObjectByName("Waist_Joint");

    if (!pelvis || !waist) {
        console.error("Pelvis or Waist_Joint not found.");
        return null;
    }

    model.updateMatrixWorld(true);

    const parent = pelvis.parent;

    if (!parent) {
        console.error("Pelvis has no parent.");
        return null;
    }

    // Record the center ball's world position.
    const pivotPosition = waist.getWorldPosition(
        new THREE.Vector3()
    );

    // Reuse an existing pivot or create one.
    let pivot = model.getObjectByName("Pelvis_Pivot");

    if (!pivot) {
        pivot = new THREE.Group();
        pivot.name = "Pelvis_Pivot";
    }

    // Make sure the pivot belongs to the pelvis's original parent.
    if (pivot.parent !== parent) {
        parent.attach(pivot);
    }

    // Position the pivot at the center ball.
    pivot.position.copy(
        parent.worldToLocal(pivotPosition.clone())
    );

    pivot.quaternion.identity();
    pivot.scale.set(1, 1, 1);

    // Put the pelvis and both legs under the pivot.
    pivot.attach(pelvis);

    // Move the center ball outside the pelvis hierarchy.
    parent.attach(waist);

    model.updateMatrixWorld(true);

    console.log("PELVIS PIVOT:", pivot.name);
    console.log("Pelvis parent:", pelvis.parent.name);
    console.log("Waist parent:", waist.parent.name);
    console.log(
        "Pivot world position:",
        pivot.getWorldPosition(new THREE.Vector3())
    );

    return pivot;
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

        if (name === "Torso") {
            return loadedModel.getObjectByName("Waist_Joint");
        }

        if (name === "Pelvis") {
            return loadedModel.getObjectByName("Pelvis_Pivot");
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
        constrainJoint: constrainJointRotation,
    isPoseValid: isMannequinPoseCollisionFree
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

function beginWorldSpaceJointDrag(event, joint, hitPoint) {
    if (!joint || !hitPoint) return false;

    loadedModel.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);

    const cameraDirection = camera.getWorldDirection(
        new THREE.Vector3()
    );

    const plane = new THREE.Plane()
        .setFromNormalAndCoplanarPoint(
            cameraDirection,
            hitPoint
        );

    activeJointDrag = {
        joint,
        pointerId: event.pointerId,

        // Preserve the exact point grabbed on the mesh.
        localGrabPoint: joint.worldToLocal(
            hitPoint.clone()
        ),

        plane
    };

    draggingJoint = joint;
    draggingPointerId = event.pointerId;

    controls.enabled = false;

    renderer.domElement.setPointerCapture(
        event.pointerId
    );

    event.preventDefault();

    return true;
}

// Rotate the joint so its grabbed point follows the mouse.
function updateWorldSpaceJointDrag(event) {
    if (
        !activeJointDrag ||
        event.pointerId !== activeJointDrag.pointerId
    ) {
        return;
    }

    updateMousePosition(event);
    raycaster.setFromCamera(mouse, camera);

    const target = raycaster.ray.intersectPlane(
        activeJointDrag.plane,
        new THREE.Vector3()
    );

    if (!target) return;

    const joint = activeJointDrag.joint;

    loadedModel.updateMatrixWorld(true);

    const jointPosition = joint.getWorldPosition(
        new THREE.Vector3()
    );

    const currentGrabPoint = joint.localToWorld(
        activeJointDrag.localGrabPoint.clone()
    );

    const currentDirection = currentGrabPoint.sub(
        jointPosition
    );

    const targetDirection = target.sub(
        jointPosition
    );

    if (
        currentDirection.lengthSq() < 1e-10 ||
        targetDirection.lengthSq() < 1e-10
    ) {
        return;
    }

    currentDirection.normalize();
    targetDirection.normalize();

    // Calculate the correction in world coordinates.
const fullWorldDelta = new THREE.Quaternion()
    .setFromUnitVectors(
        currentDirection,
        targetDirection
    );

// Reduce the rotation speed.
const worldDelta = new THREE.Quaternion()
    .identity()
    .slerp(fullWorldDelta, 0.35);

    // Convert the correction into local joint coordinates.
    const parentWorldRotation = new THREE.Quaternion();

    if (joint.parent) {
        joint.parent.getWorldQuaternion(
            parentWorldRotation
        );
    }

    const localDelta = parentWorldRotation.clone()
        .invert()
        .multiply(worldDelta)
        .multiply(parentWorldRotation);

    applyRotationWithCollision(joint, () => {
        joint.quaternion.premultiply(localDelta);
    });
}

// Select a mannequin joint
renderer.domElement.addEventListener("pointerdown", (event) => {
    if (!loadedModel || event.button !== 0) return;

    const clickedPart = getClickedPart(event);

    if (!clickedPart) return;

    // Shift + click continues to use hand IK.
    if (event.shiftKey && beginHandIKDrag(event, clickedPart)) {
        return;
    }

    const joint = findMovableJoint(clickedPart);

    console.log("Clicked mesh:", clickedPart.name);
    console.log("Selected joint:", joint?.name ?? "NONE");
    console.log("Joint parent:", joint?.parent?.name ?? "NONE");

    if (joint) {
        console.log("Joint rotation:", joint.rotation);
    }

    if (!joint) return;

    const hitPoint = getClickedWorldPoint(event);

    if (!hitPoint) return;

    if (joint.name.startsWith("UpperArm_")) {
        selectedArm = joint;
    }

    beginWorldSpaceJointDrag(
        event,
        joint,
        hitPoint
    );

}, true);

// Rotate the selected joint with the mouse
renderer.domElement.addEventListener("pointermove", (event) => {

    // Hand IK takes priority.
    if (activeHandIK) {
        updateHandIKDrag(event);
        return;
    }

    // All ordinary joint dragging uses world-space movement.
    if (activeJointDrag) {
        updateWorldSpaceJointDrag(event);
        return;
    }

}, true);

// Stop joint dragging
function stopJointDragging(event) {

    if (activeHandIK) {
        if (event.pointerId === activeHandIK.pointerId) {
            finishHandIKDrag();
        }

        return;
    }

    if (
        !activeJointDrag ||
        event.pointerId !== activeJointDrag.pointerId
    ) {
        return;
    }

    activeJointDrag = null;
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
    activeJointDrag = null;
    draggingJoint = null;
    draggingPointerId = null;
    controls.enabled = true;
});


// Reset the mannequin when the Reset Pose button is clicked.
window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.source !== window.parent) return;
    if (event.data?.type !== "MANNEQUIN_RESET_POSE") return;

    if (!loadedModel) return;

    // Stop any dragging before resetting the joints.
    finishHandIKDrag();

    if (
        draggingPointerId !== null &&
        renderer.domElement.hasPointerCapture(draggingPointerId)
    ) {
        renderer.domElement.releasePointerCapture(draggingPointerId);
    }

    draggingJoint = null;
    draggingPointerId = null;
    selectedArm = null;
    controls.enabled = true;

    // Put all the joints back where they started.
    restoreSketchRestPose();

    hasAppliedSketchPose = false;
    pendingSketchPose = null;

    // Update the pose used by the search system.
    scheduleMannequinPoseUpdate();

    console.log("Mannequin reset to original pose!");
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

    createPelvisPivot(loadedModel);
            
    function inspectBodyHierarchy(model) {
        const names = [
            "Pelvis",
            "Waist_Joint",
            "Thigh_ScreenLeft",
            "Thigh_ScreenRight",
            "Shin_ScreenLeft",
            "Shin_ScreenRight"
        ];

        for (const name of names) {
            const object = model.getObjectByName(name);

            if (!object) {
                console.warn(`Missing object: ${name}`);
                continue;
            }

            console.group(`HIERARCHY: ${name}`);
            console.log("Object:", object);
            console.log("Parent:", object.parent?.name);
            console.log(
                "World position:",
                object.getWorldPosition(new THREE.Vector3())
            );

            console.log(
                "Children:",
                object.children.map(child => ({
                    name: child.name,
                    type: child.type,
                    isMesh: child.isMesh
                }))
            );

            let parent = object.parent;
            while (parent) {
                console.log("Ancestor:", parent.name, parent.type);
                parent = parent.parent;
            }

            console.groupEnd();
        }
    }

    inspectBodyHierarchy(loadedModel);


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
            Math.tan(verticalFov / 2)
            * camera.aspect
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

        // Apply a sketch pose if it arrived before the model loaded.
        if (pendingSketchPose) {
            applySketchPose(pendingSketchPose);
        }

        // Send the first mannequin pose to the search system.
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
    renderer.setPixelRatio(Math.min(
        window.devicePixelRatio, 2
    ));
});
