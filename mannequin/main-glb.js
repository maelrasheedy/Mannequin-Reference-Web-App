
import * as THREE from './three.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from './OrbitControls.js';

// Shared pose format for mannequin, sketch upload, and image search
import { poseFromLandmarks } from './pose-vector.js';

// Anthony's inverse kinematics solver
import { solveIKChain } from './inverse_kinematic_rig.js';

// Set up the mannequin scene
const scene = new THREE.Scene();


// Match the sketch box: use the page's panel color (maryam)
function applySceneBackground() {
    const surface = getComputedStyle(document.documentElement)
        .getPropertyValue("--color-surface")
        .trim();

    scene.background = new THREE.Color(surface || "#ffffff");
}

applySceneBackground();

window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", applySceneBackground);


const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);


// If the browser can't start WebGL, tell the main page so it can hide this
// viewport and fall back to the sketch upload.
let renderer;

try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
} catch (error) {
    if (window.parent !== window) {
        window.parent.postMessage(
            { type: "MANNEQUIN_WEBGL_UNAVAILABLE" },
            window.location.origin
        );
    }

    throw error; // nothing else in this file can run without WebGL
}


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

// let the mannequin do regular poses and flexible yoga or ballet poses
// but keep each joint from bending or twisting too far
const JOINT_LIMITS = {
    UpperArm: {
        x: [-170, 65],
        y: [-35, 35],
        z: [-140, 140]
    },

    UpperArmScreenLeft: {
        x: [-170, 65],
        y: [-35, 35],
        z: [-160, 25]
    },

    UpperArmScreenRight: {
        x: [-170, 65],
        y: [-35, 35],
        z: [-25, 160]
    },

    Forearm: {
        x: [-150, 0],
        y: [-3, 3],
        z: [-3, 3]
    },

    Wrist: {
        x: [-85, 85],
        y: [-25, 25],
        z: [-35, 35]
    },

    // let both legs lift farther forward for stretches and poses
    Thigh: {
    x: [-110, 135],
    y: [-50, 50],
    z: [-90, 90]
    },

    ThighScreenLeft: {
        x: [-110, 135],
        y: [-50, 50],
        z: [-90, 30]
    },

    ThighScreenRight: {
        x: [-110, 135],
        y: [-50, 50],
        z: [-30, 90]
    },

    Shin: {
        x: [0, 150],
        y: [-3, 3],
        z: [-3, 3]
    },

    Ankle: {
        x: [-70, 35],
        y: [-15, 15],
        z: [-25, 25]
    },

    Neck: {
        x: [-35, 35],
        y: [-50, 50],
        z: [-25, 25]
    },

    Head: {
        x: [-25, 25],
        y: [-40, 40],
        z: [-20, 20]
    },

    Waist_Joint: {
        x: [-35, 40],
        y: [-40, 40],
        z: [-35, 35]
    },

    FingerProximal: {
        x: [-90, 10],
        y: [-10, 10],
        z: [-10, 10]
    },

    FingerMiddle: {
        x: [-100, 5],
        y: [-3, 3],
        z: [-3, 3]
    },

    FingerDistal: {
        x: [-80, 5],
        y: [-3, 3],
        z: [-3, 3]
    },

    ThumbProximal: {
        x: [-65, 15],
        y: [-25, 25],
        z: [-20, 20]
    },

    ThumbMiddle: {
        x: [-70, 10],
        y: [-10, 10],
        z: [-10, 10]
    },

    ThumbDistal: {
        x: [-60, 10],
        y: [-5, 5],
        z: [-5, 5]
    }
};

let mannequinHeight = 1;

// Find the movement limits for a body part
function getJointLimits(name) {
    const fingerMatch = name.match(
        /^(Index|Middle|Ring|Pinky|Thumb)_(Proximal|Middle|Distal)_/
    );

    if (fingerMatch) {
        const [, finger, segment] = fingerMatch;

        if (finger === "Thumb") {
            return JOINT_LIMITS[`Thumb${segment}`];
        }

        return JOINT_LIMITS[`Finger${segment}`];
    }

    if (name === "Waist_Joint") {
        return JOINT_LIMITS.Waist_Joint;
    }

    // give the left and right shoulders and hips their own limits
    if (name === "UpperArm_ScreenLeft") {
        return JOINT_LIMITS.UpperArmScreenLeft;
    }

    if (name === "UpperArm_ScreenRight") {
        return JOINT_LIMITS.UpperArmScreenRight;
    }

    if (name === "Thigh_ScreenLeft") {
        return JOINT_LIMITS.ThighScreenLeft;
    }

    if (name === "Thigh_ScreenRight") {
        return JOINT_LIMITS.ThighScreenRight;
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
            node.userData.lastSafeRotation = node.rotation.clone();
        }
    });
}


// ============================================================
// BODY COLLISION LIMITS
// ============================================================

// check if the arms and legs are going through the torso or head
// we dont block every movement behind the body since some stretches need it
function getBodyCollisionScore() {
    if (!loadedModel) return 0;

    loadedModel.updateMatrixWorld(true);

    const bodyBoxes = [];
    const headBoxes = [];
    const padding = mannequinHeight * 0.012;

    loadedModel.traverse((part) => {
        if (!part.isMesh || !part.geometry) return;

        const isBody = /^(Torso|Chest|UpperTorso|Abdomen|Waist_Joint|Pelvis|Hips)(?:[_\-.]|$)/i.test(
            part.name
        );

        const isHead = /^Head(?:[_\-.]|$)/i.test(part.name);

        if (!isBody && !isHead) return;

        part.geometry.computeBoundingBox();

        if (!part.geometry.boundingBox) return;

        const bounds = part.geometry.boundingBox.clone()
            .applyMatrix4(part.matrixWorld);

        if (bounds.isEmpty()) return;

        const size = bounds.getSize(new THREE.Vector3());

        const shrink = Math.min(
            padding,
            size.x * 0.15,
            size.y * 0.15,
            size.z * 0.15
        );

        bounds.expandByScalar(-shrink);

        if (bounds.isEmpty()) return;

        if (isBody) {
            bodyBoxes.push(bounds);
        } else {
            headBoxes.push(bounds);
        }
    });

    let score = 0;

    function pointInsideBody(point, bounds) {
        if (!bounds.containsPoint(point)) return 0;

        const depth = Math.min(
            point.x - bounds.min.x,
            bounds.max.x - point.x,
            point.y - bounds.min.y,
            bounds.max.y - point.y,
            point.z - bounds.min.z,
            bounds.max.z - point.z
        );

        return Math.max(0, depth);
    }

    function checkSegment(startName, endName, samples, boxes) {
        const start = loadedModel.getObjectByName(startName);
        const end = loadedModel.getObjectByName(endName);

        if (!start || !end) return;

        const a = start.getWorldPosition(new THREE.Vector3());
        const b = end.getWorldPosition(new THREE.Vector3());

        for (const t of samples) {
            const point = a.clone().lerp(b, t);

            for (const bounds of boxes) {
                const penetration = pointInsideBody(point, bounds);
                score += penetration * penetration;
            }
        }
    }

    for (const side of ["Left", "Right"]) {
        const armBoxes = [...bodyBoxes, ...headBoxes];

        // keep the arms from going inside the torso or head
        checkSegment(
            `UpperArm_Screen${side}`,
            `Forearm_Screen${side}`,
            [0.55, 0.7, 0.85, 0.95],
            armBoxes
        );

        checkSegment(
            `Forearm_Screen${side}`,
            `Wrist_Screen${side}`,
            [0.2, 0.4, 0.6, 0.8],
            armBoxes
        );

        checkSegment(
            `Wrist_Screen${side}`,
            `Palm_Screen${side}`,
            [0.4, 0.8],
            armBoxes
        );

        // keep the legs from going inside the torso
        checkSegment(
            `Thigh_Screen${side}`,
            `Shin_Screen${side}`,
            [0.55, 0.75, 0.9],
            bodyBoxes
        );

        checkSegment(
            `Shin_Screen${side}`,
            `Ankle_Screen${side}`,
            [0.3, 0.6, 0.9],
            bodyBoxes
        );
    }

    // stop the head from sinking into the torso
    const head = loadedModel.getObjectByName("Head");

    if (head?.isMesh && head.geometry) {
        head.geometry.computeBoundingBox();

        if (head.geometry.boundingBox) {
            const headCenter = head.geometry.boundingBox
                .getCenter(new THREE.Vector3())
                .applyMatrix4(head.matrixWorld);

            for (const bounds of bodyBoxes) {
                const penetration = pointInsideBody(
                    headCenter,
                    bounds
                );

                score += penetration * penetration;
            }
        }
    }

    return score;
}


// Prevent a joint from going outside its movement limits
function constrainJointRotation(joint, previousRotation = null) {
    const limits = getJointLimits(joint.name);
    const rest = joint.userData.restRotation;

    if (!limits || !rest) return;

    // keep the rotations close to the original Blender pose
    function limitAngles() {
        for (const axis of ["x", "y", "z"]) {
            if (!limits[axis]) continue;

            const [minDegrees, maxDegrees] = limits[axis];

            const minAngle = THREE.MathUtils.degToRad(minDegrees);
            const maxAngle = THREE.MathUtils.degToRad(maxDegrees);

            const difference = joint.rotation[axis] - rest[axis];

            const normalizedDifference = Math.atan2(
                Math.sin(difference),
                Math.cos(difference)
            );

            const limitedDifference = THREE.MathUtils.clamp(
                normalizedDifference,
                minAngle,
                maxAngle
            );

            joint.rotation[axis] = rest[axis] + limitedDifference;
        }
    }

    limitAngles();

    // stop the shoulder and hip from combining rotations into a full spin
    let maximumRotation = null;

    if (joint.name.startsWith("UpperArm_")) {
        maximumRotation = 175;
    } else if (joint.name.startsWith("Thigh_")) {
        maximumRotation = 160;
    }

    if (maximumRotation !== null) {
        const restQuaternion = new THREE.Quaternion()
            .setFromEuler(rest);

        const currentQuaternion = joint.quaternion.clone();

        const angle = restQuaternion.angleTo(currentQuaternion);
        const maxAngle = THREE.MathUtils.degToRad(maximumRotation);

        if (angle > maxAngle) {
            const limitedQuaternion = restQuaternion.clone().slerp(
                currentQuaternion,
                maxAngle / angle
            );

            joint.quaternion.copy(limitedQuaternion);
            limitAngles();
        }
    }

    if (!loadedModel) return;

    const oldRotation =
        previousRotation ||
        joint.userData.lastSafeRotation;

    if (!oldRotation) {
        joint.userData.lastSafeRotation = joint.rotation.clone();
        return;
    }

    const newRotation = joint.rotation.clone();

    // compare the pose before and after the movement
    joint.rotation.copy(oldRotation);
    loadedModel.updateMatrixWorld(true);

    const previousCollision = getBodyCollisionScore();

    joint.rotation.copy(newRotation);
    loadedModel.updateMatrixWorld(true);

    const newCollision = getBodyCollisionScore();

    const tolerance = Math.pow(mannequinHeight * 0.0005, 2);

    // only reject movement if the body parts go further into each other
    if (newCollision > previousCollision + tolerance) {
        joint.rotation.copy(oldRotation);
        loadedModel.updateMatrixWorld(true);
    } else {
        joint.userData.lastSafeRotation = joint.rotation.clone();
    }
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
        // use the finger tip first to match the hand direction
        endNames: [
            "Middle_Distal_ScreenRight",
            "Index_Distal_ScreenRight",
            "Palm_ScreenRight"
        ]
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
        // use the finger tip first to match the hand direction
        endNames: [
            "Middle_Distal_ScreenLeft",
            "Index_Distal_ScreenLeft",
            "Palm_ScreenLeft"
        ]
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
            joint.userData.lastSafeRotation = joint.rotation.clone();
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

    // save the rotation the sketch is asking for
    const requestedRotation = joint.quaternion.clone();

    // Keep the same joint movement limits.
    constrainJointRotation(joint);

    // check how much the movement limits changed the rotation
    const restrictedDegrees = THREE.MathUtils.radToDeg(
        requestedRotation.angleTo(joint.quaternion)
    );

    if (restrictedDegrees > 5) {
        console.warn(
            "Sketch rotation restricted:",
            joint.name,
            restrictedDegrees.toFixed(1) + " degrees"
        );
    }

    loadedModel.updateMatrixWorld(true);

    // check how close this body part got to the uploaded pose
    const finalJointPosition = joint.getWorldPosition(
        new THREE.Vector3()
    );

    const finalEndPosition = segmentEnd.getWorldPosition(
        new THREE.Vector3()
    );

    const finalDirection = finalEndPosition.sub(
        finalJointPosition
    );

    if (finalDirection.lengthSq() > 1e-8) {
        finalDirection.normalize();

        const difference = THREE.MathUtils.radToDeg(
            finalDirection.angleTo(targetDirection)
        );

        // show which joints still do not match the sketch
        if (difference > 10) {
            console.warn(
                "Sketch joint did not match target:",
                joint.name,
                difference.toFixed(1) + " degrees"
            );
        }
    }

    return true;
}


// Check how far a mannequin part is from the sketch
function getSketchSegmentError(segment) {
    loadedModel.updateMatrixWorld(true);

    const start = segment.joint.getWorldPosition(
        new THREE.Vector3()
    );

    const end = segment.segmentEnd.getWorldPosition(
        new THREE.Vector3()
    );

    const direction = end.sub(start);

    if (direction.lengthSq() < 1e-8) {
        return Math.PI;
    }

    return direction.normalize().angleTo(
        segment.targetDirection
    );
}

// Improve the shoulder and elbow positions together
function refineSketchArms(segments) {

    for (const side of ["left", "right"]) {

        const shoulder = segments.find(
            (segment) => segment.poseName === `${side}_shoulder`
        );

        const elbow = segments.find(
            (segment) => segment.poseName === `${side}_elbow`
        );

        if (!shoulder || !elbow) {
            continue;
        }

        // Keep the shoulder close while improving the elbow
        function getArmScore() {
            const shoulderError = getSketchSegmentError(
                shoulder
            );

            const elbowError = getSketchSegmentError(
                elbow
            );

            // Don't let the shoulder move too far from its original match
            const maxShoulderError =
                beforeShoulder +
                THREE.MathUtils.degToRad(2);

            if (shoulderError > maxShoulderError) {
                return Infinity;
            }

            return (
                2 * shoulderError * shoulderError +
                elbowError * elbowError
            );
        }

        const beforeShoulder = getSketchSegmentError(
            shoulder
        );

        const beforeElbow = getSketchSegmentError(
            elbow
        );

        let bestScore = getArmScore();

        // Try small rotations without changing the joint limits
        for (const degrees of [10, 5, 2]) {

            const movableJoints = [
                {
                    joint: shoulder.joint,
                    axes: ["x", "y", "z"]
                },
                {
                    joint: elbow.joint,
                    axes: ["x"]
                }
            ];

            for (const part of movableJoints) {

                const joint = part.joint;

                for (const axis of part.axes) {

                    const previousRotation =
                        joint.rotation.clone();

                    const previousSafeRotation =
                        joint.userData.lastSafeRotation?.clone();

                    let bestRotation = null;
                    let candidateScore = bestScore;

                    // Test both directions before keeping a change
                    for (const sign of [-1, 1]) {

                        joint.rotation.copy(previousRotation);

                        joint.rotation[axis] +=
                            THREE.MathUtils.degToRad(
                                degrees * sign
                            );

                        // Keep Rosie's limits and body collision checks
                        constrainJointRotation(
                            joint,
                            previousRotation
                        );

                        const score = getArmScore();

                        if (score < candidateScore - 1e-7) {
                            candidateScore = score;
                            bestRotation = joint.rotation.clone();
                        }

                        // Put the joint back after testing
                        joint.rotation.copy(previousRotation);

                        if (previousSafeRotation) {
                            joint.userData.lastSafeRotation =
                                previousSafeRotation.clone();
                        }

                        loadedModel.updateMatrixWorld(true);
                    }

                    // Only keep a rotation if it improves the pose
                    if (bestRotation) {
                        joint.rotation.copy(bestRotation);

                        joint.userData.lastSafeRotation =
                            bestRotation.clone();

                        loadedModel.updateMatrixWorld(true);

                        bestScore = candidateScore;
                    }
                }
            }
        }

        const afterShoulder = getSketchSegmentError(
            shoulder
        );

        const afterElbow = getSketchSegmentError(
            elbow
        );

        // Show whether the arm got closer to the uploaded pose
        console.log(
            `Sketch arm refinement (${side}):`,
            "Shoulder:",
            THREE.MathUtils.radToDeg(beforeShoulder).toFixed(1),
            "to",
            THREE.MathUtils.radToDeg(afterShoulder).toFixed(1),
            "degrees, Elbow:",
            THREE.MathUtils.radToDeg(beforeElbow).toFixed(1),
            "to",
            THREE.MathUtils.radToDeg(afterElbow).toFixed(1),
            "degrees"
        );
    }
}


// Help the mannequin wrists match the uploaded pose
function refineSketchWrists(segments) {
    const wrists = segments.filter((segment) =>
        segment.poseName === "left_wrist" ||
        segment.poseName === "right_wrist"
    );

    for (const segment of wrists) {
        const joint = segment.joint;

        const beforeError = getSketchSegmentError(segment);
        let bestError = beforeError;

        // Try small wrist movements within the joint limits
        for (const degrees of [10, 5, 2]) {
            for (const axis of ["x", "y", "z"]) {
                const originalRotation = joint.rotation.clone();
                const originalSafe =
                    joint.userData.lastSafeRotation?.clone();

                let bestRotation = null;

                // Check both rotation directions
                for (const sign of [-1, 1]) {
                    joint.rotation.copy(originalRotation);

                    joint.rotation[axis] +=
                        THREE.MathUtils.degToRad(degrees * sign);

                    constrainJointRotation(
                        joint,
                        originalRotation
                    );

                    const error = getSketchSegmentError(segment);

                    if (error < bestError - 1e-7) {
                        bestError = error;
                        bestRotation = joint.rotation.clone();
                    }

                    // Restore the wrist after checking
                    joint.rotation.copy(originalRotation);

                    if (originalSafe) {
                        joint.userData.lastSafeRotation =
                            originalSafe.clone();
                    }

                    loadedModel.updateMatrixWorld(true);
                }

                // Keep only wrist movements that improve the pose
                if (bestRotation) {
                    joint.rotation.copy(bestRotation);

                    joint.userData.lastSafeRotation =
                        bestRotation.clone();

                    loadedModel.updateMatrixWorld(true);
                }
            }
        }

        console.log(
            "Sketch wrist refinement:",
            segment.poseName,
            THREE.MathUtils.radToDeg(beforeError).toFixed(1),
            "to",
            THREE.MathUtils.radToDeg(bestError).toFixed(1),
            "degrees"
        );
    }
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

    // Fine tune both arms after applying the sketch pose
    refineSketchArms(availableSegments);

    // Fine tune the hands after the arms are positioned
    refineSketchWrists(availableSegments);

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

        // Tell the main page the mannequin's pose again, so Search always
        // has a valid pose after a sketch is removed.
        scheduleMannequinPoseUpdate();
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


// Let Shift or Space move the whole mannequin view
let spacePanHeld = false;
let backgroundPan = null;

// Check when Space is being held
window.addEventListener("keydown", (event) => {
    if (event.code !== "Space") return;

    // Do not affect typing in input boxes
    if (
        event.target instanceof HTMLElement &&
        event.target.closest(
            'input, textarea, select, [contenteditable="true"]'
        )
    ) {
        return;
    }

    spacePanHeld = true;
    event.preventDefault();
});

window.addEventListener("keyup", (event) => {
    if (event.code === "Space") {
        spacePanHeld = false;
    }
});

// Start moving the view when dragging the black background
renderer.domElement.addEventListener("pointerdown", (event) => {
    if (
        !loadedModel ||
        event.button !== 0 ||
        !(event.shiftKey || spacePanHeld)
    ) {
        return;
    }

    // Only move the view when clicking outside the mannequin
    if (getClickedPart(event)) {
        return;
    }

    backgroundPan = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY
    };

    controls.enabled = false;

    renderer.domElement.setPointerCapture(event.pointerId);

    event.preventDefault();
    event.stopImmediatePropagation();
}, true);

// Move the camera and its target together
renderer.domElement.addEventListener("pointermove", (event) => {
    if (
        !backgroundPan ||
        event.pointerId !== backgroundPan.pointerId
    ) {
        return;
    }

    const deltaX = event.clientX - backgroundPan.x;
    const deltaY = event.clientY - backgroundPan.y;

    const distance = camera.position.distanceTo(
        controls.target
    );

    const visibleHeight =
        2 * distance *
        Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);

    const pixelsToWorld =
        visibleHeight / renderer.domElement.clientHeight;

    camera.updateMatrixWorld();

    const right = new THREE.Vector3()
        .setFromMatrixColumn(camera.matrixWorld, 0);

    const up = new THREE.Vector3()
        .setFromMatrixColumn(camera.matrixWorld, 1);

    // Move the whole view without changing the mannequin pose
    const movement = right.multiplyScalar(
        -deltaX * pixelsToWorld
    ).addScaledVector(
        up,
        deltaY * pixelsToWorld
    );

    camera.position.add(movement);
    controls.target.add(movement);

    backgroundPan.x = event.clientX;
    backgroundPan.y = event.clientY;

    camera.updateMatrixWorld();

    event.preventDefault();
    event.stopImmediatePropagation();
}, true);

// Stop moving the view when the mouse is released
function stopBackgroundPan(event) {
    if (
        !backgroundPan ||
        event.pointerId !== backgroundPan.pointerId
    ) {
        return;
    }

    backgroundPan = null;
    controls.enabled = true;

    if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
    }

    event.preventDefault();
    event.stopImmediatePropagation();
}

renderer.domElement.addEventListener(
    "pointerup",
    stopBackgroundPan,
    true
);

renderer.domElement.addEventListener(
    "pointercancel",
    stopBackgroundPan,
    true
);

// Stop panning if the browser loses focus
window.addEventListener("blur", () => {
    spacePanHeld = false;

    if (backgroundPan) {
        const pointerId = backgroundPan.pointerId;
        backgroundPan = null;

        if (renderer.domElement.hasPointerCapture(pointerId)) {
            renderer.domElement.releasePointerCapture(pointerId);
        }

        controls.enabled = true;
    }
});


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
        } else if (name.startsWith("Palm_")) {
            targetName = name.replace("Palm_", "Wrist_");
        } else if (name.startsWith("Foot_")) {
            targetName = name.replace("Foot_", "Ankle_");
        } else if (name.startsWith("Toe_")) {
            targetName = name.replace("Toe_", "Ankle_");
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

// Find which joint should move when a part is selected
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
    //scheduleMannequinPoseUpdate(); //removing this so it only updates on release (maryam)
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

    // Send the pose once, now that the drag has ended
    scheduleMannequinPoseUpdate(); //added so that pose only updates on release (maryam)
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

    const previousRotation = draggingJoint.rotation.clone();

    // normal drag moves X and Z
    // hold Alt while dragging to adjust the Y rotation too
    if (event.altKey) {
        draggingJoint.rotation.y += deltaX * sensitivity;
    } else {
        draggingJoint.rotation.z += deltaX * sensitivity;
        draggingJoint.rotation.x += deltaY * sensitivity;
    }

    constrainJointRotation(draggingJoint, previousRotation);

    previousMouseX = event.clientX;
    previousMouseY = event.clientY;

    // Update the reference-search pose after moving a joint
    //scheduleMannequinPoseUpdate(); //removing this so pose only updates on release (maryam)
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

    // check which hip rotation is used when lifting the leg
    if (draggingJoint.name.startsWith("Thigh_")) {
        const rest = draggingJoint.userData.restRotation;

        if (rest) {
            const rotationDifference = (axis) => {
                const difference =
                    draggingJoint.rotation[axis] - rest[axis];

                return THREE.MathUtils.radToDeg(
                    Math.atan2(
                        Math.sin(difference),
                        Math.cos(difference)
                    )
                ).toFixed(1);
            };

            console.log("Hip rotation from rest:", {
                joint: draggingJoint.name,
                x: rotationDifference("x"),
                y: rotationDifference("y"),
                z: rotationDifference("z")
            });
        }
    }

    draggingJoint = null;
    draggingPointerId = null;
    controls.enabled = true;

    if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
    }

    // Send the pose once, now that the drag has ended
    scheduleMannequinPoseUpdate(); //added so that pose only updates on release (maryam)
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
    const previousRotation = selectedArm.rotation.clone();

    if (key === "q") selectedArm.rotation.z += step;
    else if (key === "e") selectedArm.rotation.z -= step;
    else if (key === "w") selectedArm.rotation.x += step;
    else if (key === "s") selectedArm.rotation.x -= step;
    else return;

    constrainJointRotation(selectedArm, previousRotation);

    // Send the new mannequin pose after keyboard movement
    scheduleMannequinPoseUpdate();

    event.preventDefault();
});

// Restore controls if the browser loses focus
window.addEventListener("blur", () => {
    const wasDraggingJoint = draggingJoint !== null;

    finishHandIKDrag(); // sends the pose itself if a hand drag was active
    draggingJoint = null;
    draggingPointerId = null;
    controls.enabled = true;

    if (wasDraggingJoint) scheduleMannequinPoseUpdate();
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


// The main page can ask for the current pose at any time, for example if
// Search is clicked before the first pose has arrived.
window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.source !== window.parent) return;
    if (event.data?.type !== "MANNEQUIN_REQUEST_POSE") return;

    sendMannequinPose();
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

        mannequinHeight = new THREE.Box3()
            .setFromObject(loadedModel)
            .getSize(new THREE.Vector3()).y;

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

        // keep the starting view and zoom limits we already fixed
        camera.position.set(
            modelCenter.x,
            modelCenter.y + size.y * 0.10,
            modelCenter.z + Math.max(distance * 0.85, maxDim * 1.05)
        );

        controls.target.copy(modelCenter);
        controls.enablePan = true;
        controls.enableZoom = true;

        controls.minDistance = distance * 0.25;
        controls.maxDistance = camera.position.distanceTo(controls.target);
        controls.zoomSpeed = 0.85;
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
