import * as THREE from './three.js';

export const MESH_JOINT_MAPPING = new Map();

const MESH_NAME_TO_JOINT = {
    "Man-Waist-Low.003": "pelvis"
};

export const DAE_BONE_MAPPING = {
    "Bone.020": "left_hip",
    "Bone.021": "left_knee",
    "Bone.022": "left_ankle",
    "Bone.023": "right_hip",
    "Bone.024": "right_knee",
    "Bone.025": "right_ankle",

    "Bone": "pelvis",
    "Bone.005": "spine",
    "Bone.006": "neck_head",

    "Bone.001": "left_shoulder",
    "Bone.002": "left_elbow",
    "Bone.003": "left_wrist",
    "Bone.004": "left_hand",

    "Bone.007": "right_shoulder",
    "Bone.008": "right_elbow",
    "Bone.009": "right_wrist",
    "Bone.010": "right_hand"
};

export function rigMannequinSkeleton(
    modelScene,
    jointsRef,
    transformsRef,
    targetMaterial,
    globalScene
) {
    MESH_JOINT_MAPPING.clear();

    modelScene.updateMatrixWorld(true);

    // Register joints and save their initial transforms.
    modelScene.traverse((node) => {
        if (node.isMesh) {
            node.material = targetMaterial;
            node.castShadow = true;
            node.receiveShadow = true;
        }

        if (node.isBone || DAE_BONE_MAPPING[node.name]) {
            const friendlyName = DAE_BONE_MAPPING[node.name] || node.name;

            node.rotation.reorder('YXZ');

            jointsRef[node.name] = node;
            jointsRef[friendlyName] = node;

            transformsRef[node.name] = {
                position: node.position.clone(),
                rotation: node.rotation.clone()
            };

            transformsRef[friendlyName] = {
                position: node.position.clone(),
                rotation: node.rotation.clone()
            };
        }
    });

    // Map meshes to joints.
    modelScene.traverse((node) => {
        if (!node.isMesh || node.name.startsWith("helper_")) {
            return;
        }

        const explicitJoint = MESH_NAME_TO_JOINT[node.name];

        if (explicitJoint) {
            if (jointsRef[explicitJoint]) {
                MESH_JOINT_MAPPING.set(node, explicitJoint);
            } else {
                console.warn(
                    "Mapped joint does not exist:",
                    explicitJoint,
                    "| Mesh:",
                    node.name,
                    "| Available joints:",
                    Object.keys(jointsRef)
                );
            }

            return;
        }

        let ancestor = node.parent;

        while (ancestor && ancestor !== modelScene) {
            const friendlyName = DAE_BONE_MAPPING[ancestor.name];

            if (friendlyName && jointsRef[friendlyName]) {
                MESH_JOINT_MAPPING.set(node, friendlyName);
                break;
            }

            if (jointsRef[ancestor.name]) {
                MESH_JOINT_MAPPING.set(node, ancestor.name);
                break;
            }

            ancestor = ancestor.parent;
        }
    });

    // Create joint markers and attach them to their joints.
    if (globalScene) {
        const markerMaterial = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            depthTest: false
        });

        modelScene.traverse((node) => {
            if (!node.isBone && !DAE_BONE_MAPPING[node.name]) return;

            const marker = new THREE.Mesh(
                new THREE.SphereGeometry(0.015, 12, 12),
                markerMaterial
            );

            marker.name = `helper_${node.name}`;
            marker.renderOrder = 999;

            // Attach the marker so it follows the joint.
            node.add(marker);
            marker.position.set(0, 0, 0);
        });
    }


    console.log("=== MESH TO JOINT MAP ===");

    modelScene.traverse((node) => {
        if (!node.isMesh || node.name.startsWith("helper_")) return;

        console.log({
            mesh: node.name,
            mappedJoint: MESH_JOINT_MAPPING.get(node) ?? "UNMAPPED",
            parent: node.parent?.name,
            skinned: node.isSkinnedMesh === true
        });
    });

    console.log(
        "Rig initialized. Unique joints:",
        new Set(Object.values(jointsRef)).size,
        "| Mapped meshes:",
        MESH_JOINT_MAPPING.size
    );
}