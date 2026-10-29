import * as THREE from './three.js';
import { ColladaLoader } from './ColladaLoader.js';
import { OrbitControls } from './OrbitControls.js';

import {
    rigMannequinSkeleton,
    DAE_BONE_MAPPING,
    MESH_JOINT_MAPPING
} from './mannequinRig.js';

const scene = new THREE.Scene();
//maryam commented out this color
//scene.background = new THREE.Color(0x1a1a1a); 

// Camera Setup
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);

// WebGL 2 Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
//maryam commented out line below and added line above to make background transparent
//const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace; 
document.body.appendChild(renderer.domElement);

// Lighting Configuration
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
keyLight.position.set(5, 10, 5);
keyLight.castShadow = true;
keyLight.shadow.mapSize.width = 2048;
keyLight.shadow.mapSize.height = 2048;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 1.2);
fillLight.position.set(-5, 5, -5);
scene.add(fillLight);

const backLight = new THREE.DirectionalLight(0xffffff, 1.0);
backLight.position.set(0, 5, -8);
scene.add(backLight);

// Renderer shadow mapping configuration
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;       
controls.dampingFactor = 0.05;       
controls.autoRotate = false;          
controls.autoRotateSpeed = 1.5;      
controls.rotateSpeed = 1.25;
controls.zoomSpeed = 3.75; 

const joints = {};
const initialTransforms = {}; // Cache map storing native coordinates for quick reset processing
let loadedModel = null;
let selectedJointKey = null;
let highlightedMesh = null;
let previousMaterial = null;

// Raycasting Infrastructure
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

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

const highlightMaterial = new THREE.MeshStandardMaterial({
    color: 0x00ffcc,
    emissive: 0x00ffcc,
    emissiveIntensity: 0.5,
    roughness: 0.6,
    metalness: 0.0
});

const ROTATION_LIMITS = {
    'elbow': { x: [0, 2.4] },
    'knee': { x: [-2.4, 0] },
    'neck': { x: [-0.6, 0.6], y: [-1.2, 1.2], z: [-0.4, 0.4] },
    'spine': { x: [-0.3, 0.8], y: [-0.5, 0.5], z: [-0.3, 0.3] }
};

// Model Initialization
const loadingManager = new THREE.LoadingManager();
const loader = new ColladaLoader(loadingManager);
loader.convertUpAxis = true;

loader.load(
    './wooden-artist-mannequin/source/model/model.dae',
    (collada) => {
        loadedModel = collada.scene;
        
        rigMannequinSkeleton(
            loadedModel,
            joints,
            initialTransforms,
            mannequinMaterial,
            scene
        );

                console.log("=== ACTUAL BODY MESHES ===");

        loadedModel.traverse((node) => {
            if (
                node.isMesh &&
                !node.name.startsWith("helper_")
            ) {
                console.log({
                    name: node.name,
                    parent: node.parent?.name,
                    isSkinnedMesh: node.isSkinnedMesh === true
                });
            }
        });

        inspectModelStructure("Man-Waist-Low.003");

        console.log("=== MESH AND SKIN SUMMARY ===");

        loadedModel.traverse((node) => {
            if (node.isMesh) {
                console.log({
                    name: node.name,
                    type: node.type,
                    parent: node.parent?.name,
                    isSkinnedMesh: node.isSkinnedMesh === true,
                    hasSkinIndex: !!node.geometry?.attributes?.skinIndex,
                    hasSkinWeight: !!node.geometry?.attributes?.skinWeight
                });
            }
        });
        
        const box = new THREE.Box3().setFromObject(loadedModel);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());  
    
        // Ground Grid Helper setup
        const gridHelper = new THREE.GridHelper(20, 20, 0x00ffcc, 0x444444);
        gridHelper.position.y = 0; 
        scene.add(gridHelper);

        // Soft Shadow Floor plane configuration
        const floorGeo = new THREE.PlaneGeometry(50, 50);
        const floorMat = new THREE.ShadowMaterial({ opacity: 0.2 }); 
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -0.001; // Restricts layout Z-fighting artifacts
        floor.receiveShadow = true;
        scene.add(floor);

        // Ground alignment processing matrix offsets pinning feet to origin floor grid
        loadedModel.position.set(
            -center.x, 
            -box.min.y,
            -center.z
        );
        scene.add(loadedModel);

        loadedModel.updateMatrixWorld(true);

        // Recalculate bounds after moving the model.
        const centeredBox = new THREE.Box3().setFromObject(loadedModel);
        const centeredCenter = centeredBox.getCenter(new THREE.Vector3());
        const centeredSize = centeredBox.getSize(new THREE.Vector3());

        const maxDim = Math.max(
            centeredSize.x,
            centeredSize.y,
            centeredSize.z
        );

        if (!Number.isFinite(maxDim) || maxDim <= 0) {
            console.error("Invalid mannequin dimensions:", centeredSize);
            return;
        }

        const fov = THREE.MathUtils.degToRad(camera.fov);
        const cameraZ = (maxDim / 2) / Math.tan(fov / 2);

        camera.position.set(
            centeredCenter.x,
            centeredCenter.y + centeredSize.y * 0.1,
            centeredCenter.z + cameraZ * 1.5
        );

        camera.near = Math.max(maxDim / 1000, 0.001);
        camera.far = Math.max(maxDim * 100, 1000);
        camera.updateProjectionMatrix();

        controls.target.copy(centeredCenter);
        controls.minDistance = Math.max(maxDim * 0.1, 0.01);
        controls.maxDistance = maxDim * 20;
        controls.update();

        console.log('Skinned mannequin skeleton locked and loaded cleanly!', joints);
    },
    (xhr) => {
        console.log((xhr.loaded / xhr.total * 100) + '% loaded');
    },
    (error) => {
        console.error('Asset parser tracking failure:', error);
    }
);

// Global Reset Function to Restore Original T-Pose Geometry
export function resetPose() {
    Object.keys(joints).forEach((key) => {
        const joint = joints[key];
        const initial = initialTransforms[key];
        if (joint && initial) {
            joint.position.copy(initial.position);
            joint.rotation.copy(initial.rotation);

            joint.updateMatrix();
            joint.updateMatrixWorld(true);
        }
    });

    // Clear active UI visual highlights
    clearJointHighlight();
    selectedJointKey = null;
    console.log('Mannequin skeleton reset to baseline initial coordinates.');
}

// Unified Joint Rotation Interface with Clamping Boundaries

export function rotateJoint(
    jointName,
    axis,
    angleInDegrees,
    isRelativeDelta = false
) {
    console.log("rotateJoint() called");

    if (!loadedModel) {
        console.warn("Mannequin has not loaded yet.");
        return;
    }

    if (typeof jointName !== "string" || !jointName.trim()) {
        console.warn("A valid joint name is required.");
        return;
    }

    if (!["x", "y", "z"].includes(axis)) {
        console.warn("Invalid rotation axis:", axis);
        return;
    }

    if (
        typeof angleInDegrees !== "number" ||
        !Number.isFinite(angleInDegrees)
    ) {
        console.warn("Rotation angle must be a finite number.");
        return;
    }

    let matchedKey = Object.keys(joints).find(
        key => key.toLowerCase() === jointName.toLowerCase()
    );

    if (!matchedKey) {
        matchedKey = Object.keys(joints).find(
            key => key.toLowerCase().includes(jointName.toLowerCase())
        );
    }

    if (!matchedKey || !joints[matchedKey]) {
        console.warn("Joint not found:", jointName);
        return;
    }

    const joint = joints[matchedKey];
    const radians = THREE.MathUtils.degToRad(angleInDegrees);

    let targetRotation = isRelativeDelta
        ? joint.rotation[axis] + radians
        : radians;

    const constraintGroup = Object.keys(ROTATION_LIMITS).find(
        type => matchedKey.toLowerCase().includes(type)
    );

    const limits = constraintGroup
        ? ROTATION_LIMITS[constraintGroup][axis]
        : null;

    if (limits) {
        const [min, max] = limits;
        targetRotation = THREE.MathUtils.clamp(
            targetRotation,
            min,
            max
        );
    }

    joint.rotation[axis] = targetRotation;

    joint.updateMatrix();
    loadedModel.updateMatrixWorld(true);

    console.log("Joint:", matchedKey);
    console.log("Axis:", axis);
    console.log("Target rotation (radians):", targetRotation);
    console.log("Actual rotation:", joint.rotation.toArray());

    console.log(
        "Joint world position:",
        joint.getWorldPosition(new THREE.Vector3())
    );
}

function clearJointHighlight() {
    if (highlightedMesh && previousMaterial) {
        highlightedMesh.material = previousMaterial;
    }

    highlightedMesh = null;
    previousMaterial = null;
}

function findJointForMesh(mesh) {
    let current = mesh;

    while (current && current !== loadedModel) {
        // Match a mesh or ancestor by its name
        const name = (current.name || "").toLowerCase();

        const jointKey = Object.keys(joints).find(
            key => key.toLowerCase() === name
        );

        if (jointKey) return jointKey;

        current = current.parent;
    }
    return null;
}

function inspectModelStructure(targetMeshName) {
    if (!loadedModel) {
        console.warn("Model is not loaded yet.");
        return;
    }

    let targetMesh = null;

    loadedModel.traverse((node) => {
        if (node.name === targetMeshName) {
            targetMesh = node;
        }
    });

    if (!targetMesh) {
        console.warn("Mesh not found:", targetMeshName);
        return;
    }

    console.log("=== CLICKED MESH HIERARCHY ===");

    let current = targetMesh;
    while (current) {
        console.log({
            name: current.name,
            type: current.type,
            isBone: current.isBone === true,
            isMesh: current.isMesh === true,
            parent: current.parent?.name
        });

        current = current.parent;
    }

    console.log("=== ALL MODEL NODES ===");

    loadedModel.traverse((node) => {
        if (node.isMesh || node.isBone || node.type === "Group") {
            console.log({
                name: node.name,
                type: node.type,
                parent: node.parent?.name
            });
        }
    });

    window.inspectModelStructure = inspectModelStructure;
}

// Raycasting Pointer Interactions
function onPointerDown(event) {
    const rect = renderer.domElement.getBoundingClientRect();

    if (
        rect.width <= 0 ||
        rect.height <= 0 ||
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
    ) {
        return;
    }

    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    if (!loadedModel) return;

    const intersects = raycaster.intersectObject(loadedModel, true);

    const hitRecord = intersects.find(
        hit =>
            hit.object &&
            hit.object.isMesh &&
            !hit.object.name.startsWith("helper_")
    );

    if (!hitRecord) return;

    const hitObject = hitRecord.object;
    let identifiedBoneName = null;

    if (hitObject.isSkinnedMesh && hitRecord.face) {
        const geometry = hitObject.geometry;
        const skeleton = hitObject.skeleton;
        const skinIndex = geometry.attributes.skinIndex;
        const skinWeight = geometry.attributes.skinWeight;

        if (skinIndex && skinWeight && skeleton) {
            const weightMap = {};
            const face = hitRecord.face;

            for (const vertexId of [face.a, face.b, face.c]) {
                for (let i = 0; i < 4; i++) {
                    const boneIndex = skinIndex.getComponent(vertexId, i);
                    const weight = skinWeight.getComponent(vertexId, i);

                    if (weight > 0 && skeleton.bones[boneIndex]) {
                        weightMap[boneIndex] =
                            (weightMap[boneIndex] || 0) + weight;
                    }
                }
            }

            let maxWeight = 0;
            let primaryBoneIndex = -1;

            for (const [index, weight] of Object.entries(weightMap)) {
                if (weight > maxWeight) {
                    maxWeight = weight;
                    primaryBoneIndex = Number(index);
                }
            }

            if (primaryBoneIndex >= 0) {
                identifiedBoneName =
                    skeleton.bones[primaryBoneIndex].name;
            }
        }
    }


    if (!identifiedBoneName) {
        const mappedJoint = MESH_JOINT_MAPPING.get(hitObject);

        if (!mappedJoint || !joints[mappedJoint]) {
            console.warn(
                'No joint mapping for clicked mesh:',
                hitObject.name
            );
            return;
        }

        identifiedBoneName = mappedJoint;
    }

    const associatedJointKey =
        DAE_BONE_MAPPING[identifiedBoneName] &&
        joints[DAE_BONE_MAPPING[identifiedBoneName]]
            ? DAE_BONE_MAPPING[identifiedBoneName]
            : joints[identifiedBoneName]
                ? identifiedBoneName
                : null;

    if (!associatedJointKey) {
        console.warn(
            `Bone "${identifiedBoneName}" has no registered joint mapping.`
        );
        return;
    }

    selectedJointKey = associatedJointKey;

    clearJointHighlight();

    previousMaterial = hitObject.material;
    highlightedMesh = hitObject;

    highlightedMesh.material = Array.isArray(previousMaterial)
        ? previousMaterial.map(() => highlightMaterial)
        : highlightMaterial;

    console.log(
        'Selected mannequin joint:',
        selectedJointKey,
        '| Original bone or mapped joint:',
        identifiedBoneName
    );

    window.postMessage({
        type: 'MANNEQUIN_JOINT_SELECTED',
        jointKey: selectedJointKey
    }, window.location.origin);
}

renderer.domElement.addEventListener(
    "pointerdown",
    onPointerDown
);

const TRUSTED_PARENT_ORIGIN = "http://localhost:3000";

window.addEventListener("message", (event) => {
    // The control panel and viewer are in the same window.
    if (event.source !== window) return;

    const data = event.data;
    if (!data || typeof data !== "object") return;

    if (data.type === "MANNEQUIN_TRANSFORM_JOINT") {
        if (!selectedJointKey) {
            console.warn("Select a mannequin joint first.");
            return;
        }

        rotateJoint(
            selectedJointKey,
            data.axis,
            data.angle,
            data.isRelative === true
        );
    }
});

// Animation loop
function animate() {
    requestAnimationFrame(animate);

    controls.update();

    // Update the red joint markers.
    Object.keys(joints).forEach((boneKey) => {
        if (!boneKey.startsWith("Bone")) return;

        const boneNode = joints[boneKey];
        const marker = scene.getObjectByName(`helper_${boneKey}`);

        if (boneNode && marker) {
            boneNode.getWorldPosition(marker.position);
        }
    });

    renderer.render(scene, camera);
}

// Resize handling
window.addEventListener("resize", () => {
    const width = window.innerWidth;
    const height = window.innerHeight;

    if (width <= 0 || height <= 0) return;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
});

animate();