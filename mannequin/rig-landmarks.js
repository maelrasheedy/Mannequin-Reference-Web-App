// mannequin/rig-landmarks.js
// CURRENTLY UNUSED in this project!!!  
// reads joint positions from the GLB mannequin as the user moves it.
//
// WHY THIS FILE EXISTS
// In Mannequin_Cleaned.glb the "Bone.*" nodes are NOT connected to the meshes
// (there are no skins), so they never move. When the user drags a joint,
// main-glb.js rotates mesh nodes such as Thigh_ScreenRight, Forearm_ScreenLeft,
// Waist_Joint... So we track THOSE nodes instead.
//
// Two kinds of landmark:
//   1. PIVOT landmarks: the node's own origin IS the joint
//      (e.g. Forearm_ScreenRight's origin is the elbow).
//   2. ATTACHED landmarks: points with no node of their own (fingertip, toe,
//      head centre). We remember where they sit relative to the node that
//      carries them, so they follow it when it rotates.
//
// LEFT / RIGHT: the mannequin faces +Z, so its anatomical LEFT side is +X.
// The GLB names are from the VIEWER's side ("Screen"), so
//   anatomical left  = *_ScreenRight nodes
//   anatomical right = *_ScreenLeft  nodes

import * as THREE from './three.js';
import { poseFromLandmarks } from './pose-vector.js';

const PIVOT_NODES = {
  left_shoulder:  "UpperArm_ScreenRight",
  left_elbow:     "Forearm_ScreenRight",
  left_wrist:     "Wrist_ScreenRight",
  left_hip:       "Thigh_ScreenRight",
  left_knee:      "Shin_ScreenRight",
  left_ankle:     "Ankle_ScreenRight",

  right_shoulder: "UpperArm_ScreenLeft",
  right_elbow:    "Forearm_ScreenLeft",
  right_wrist:    "Wrist_ScreenLeft",
  right_hip:      "Thigh_ScreenLeft",
  right_knee:     "Shin_ScreenLeft",
  right_ankle:    "Ankle_ScreenLeft",
};

// [carrier node, rest position in the model's own space].
// Rest positions come from the (frozen) Bone.* end nodes in the GLB.
const ATTACHED_POINTS = {
  left_hand_tip:  ["Wrist_ScreenRight", [ 3.586,  -7.248, 0.032]],
  right_hand_tip: ["Wrist_ScreenLeft",  [-3.561,  -7.295, 0.042]],
  left_toe:       ["Ankle_ScreenRight", [ 0.982, -18.744, 2.059]],
  right_toe:      ["Ankle_ScreenLeft",  [-0.982, -18.744, 2.059]],
  head_center:    ["Head",              [ 0.041,   4.826, 0.001]],
};

// Call ONCE, right after the model has loaded and been positioned, BEFORE the
// user moves anything. Returns { readPose() }.
export function createRigTracker(model) {
  const find = (name) => {
    const node = model.getObjectByName(name);
    if (!node) console.warn("rig-landmarks: node not found:", name);
    return node;
  };

  model.updateMatrixWorld(true);

  // Remember each attached point in its carrier node's local space.
  const attached = {};
  for (const [landmark, [nodeName, rest]] of Object.entries(ATTACHED_POINTS)) {
    const node = find(nodeName);
    if (!node) continue;
    const world = model.localToWorld(new THREE.Vector3(...rest));
    attached[landmark] = { node, local: node.worldToLocal(world) };
  }

  const pivots = {};
  for (const [landmark, nodeName] of Object.entries(PIVOT_NODES)) {
    const node = find(nodeName);
    if (node) pivots[landmark] = node;
  }

  const tmp = new THREE.Vector3();

  // Current pose as the user-pose JSON, or null if any node is missing.
  function readPose() {
    model.updateMatrixWorld(true);
    const raw = {};

    const toModelSpace = (v) => {
      model.worldToLocal(v);
      return { x: v.x, y: v.y, z: v.z };
    };

    for (const [landmark, node] of Object.entries(pivots)) {
      node.getWorldPosition(tmp);
      raw[landmark] = toModelSpace(tmp);
    }

    for (const [landmark, { node, local }] of Object.entries(attached)) {
      tmp.copy(local);
      node.localToWorld(tmp);
      raw[landmark] = toModelSpace(tmp);
    }

    return poseFromLandmarks(raw);
  }

  return { readPose };
}