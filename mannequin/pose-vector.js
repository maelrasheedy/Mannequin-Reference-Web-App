// mannequin/pose-vector.js
//
// pure math, no DOM, no three.js import.
// Turns joint positions into user pose JSON from the Designing APIs doc:
//
//   { "pose_vector": [ { "name": "neck", "x-plane-angle": 30,
//                        "y-plane-angle": 25, "z-plane-angle": 70 }, ... ] }
//
// It deliberately mirrors python/extract_pose_references.py
// (calculate_plane_angles / generate_pose_vector) so mannequin vectors and
// reference-image vectors are directly comparable:
//   - a part's entry is the direction of the segment that STARTS at that joint
//   - each angle = asin(component / |segment|), in degrees, rounded to 0.1
//   - coordinates follow MediaPipe world space:
//       x = image right, y = DOWN, z = away from the camera (smaller = closer)

// ---------------------------------------------------------------------------
// 1. Shared spec: the 14 tracked parts, in output order
// ---------------------------------------------------------------------------
// [from, to] = the two landmarks that define each part's segment.
export const SEGMENTS = {
  torso:          ["hip_mid", "neck_base"],
  neck:           ["neck_base", "head_center"],

  left_shoulder:  ["left_shoulder", "left_elbow"],   // upper arm
  left_elbow:     ["left_elbow", "left_wrist"],      // forearm
  left_wrist:     ["left_wrist", "left_hand_tip"],   // hand

  right_shoulder: ["right_shoulder", "right_elbow"],
  right_elbow:    ["right_elbow", "right_wrist"],
  right_wrist:    ["right_wrist", "right_hand_tip"],

  left_hip:       ["left_hip", "left_knee"],         // thigh
  left_knee:      ["left_knee", "left_ankle"],       // shin
  left_ankle:     ["left_ankle", "left_toe"],        // foot

  right_hip:      ["right_hip", "right_knee"],
  right_knee:     ["right_knee", "right_ankle"],
  right_ankle:    ["right_ankle", "right_toe"],
};

// ---------------------------------------------------------------------------
// 2. Helpers
// ---------------------------------------------------------------------------
const mid = (a, b) => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
  z: (a.z + b.z) / 2,
});

// three.js (y up, +z toward a camera in front of the model)
//   -> MediaPipe world (y down, smaller z = closer to camera)
export const threeToMediaPipe = (p) => ({ x: p.x, y: -p.y, z: -p.z });

const toDeg = (r) => (r * 180) / Math.PI;
const clamp1 = (v) => Math.max(-1, Math.min(1, v));
// "+ 0" turns -0 into 0, so the output never shows "-0"
const round1 = (v) => Math.round(v * 10) / 10 + 0;

// Same formula as calculate_plane_angles() in the Python script.
export function planeAngles(vec) {
  const norm = Math.hypot(vec.x, vec.y, vec.z);
  if (norm < 1e-8) return null;
  return {
    x: round1(toDeg(Math.asin(clamp1(vec.x / norm)))),
    y: round1(toDeg(Math.asin(clamp1(vec.y / norm)))),
    z: round1(toDeg(Math.asin(clamp1(vec.z / norm)))),
  };
}

// ---------------------------------------------------------------------------
// 3. Viewpoint normalisation: make every pose "face the camera"
// ---------------------------------------------------------------------------
// A photo's numbers depend on where the photographer stood. To make matching
// independent of the viewpoint, BOTH sides (this file and the Python script)
// rotate the whole body about the vertical (y) axis until the line through
// the shoulders and hips lies along the x axis, with the person's LEFT side
// on +x. After that, "forward" always means toward the camera (negative z),
// whichever way the original body was turned.
//
// facing angle = atan2(z, x) of  (left_shoulder - right_shoulder)
//                              + (left_hip      - right_hip)      [x/z only]
export function bodyYaw(points) {
  const x = (points.left_shoulder.x - points.right_shoulder.x)
          + (points.left_hip.x      - points.right_hip.x);
  const z = (points.left_shoulder.z - points.right_shoulder.z)
          + (points.left_hip.z      - points.right_hip.z);
  if (Math.hypot(x, z) < 1e-6) return 0; // degenerate: leave as is
  return Math.atan2(z, x);
}

// Rotate a vector about the vertical axis by -yaw (x/z only, y unchanged).
export function rotateYaw(v, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}

// ---------------------------------------------------------------------------
// 4. Core: landmarks (MediaPipe convention) -> user pose JSON
// ---------------------------------------------------------------------------
export function computePoseVector(points, normalizeYaw = true) {
  const pose_vector = [];
  const yaw = normalizeYaw ? bodyYaw(points) : 0;

  for (const [name, [from, to]] of Object.entries(SEGMENTS)) {
    const a = points[from];
    const b = points[to];
    if (!a || !b) continue; // caller checks completeness

    const seg = rotateYaw(
      { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z },
      yaw
    );
    const angles = planeAngles(seg);
    if (!angles) continue;

    pose_vector.push({
      name,
      "x-plane-angle": angles.x,
      "y-plane-angle": angles.y,
      "z-plane-angle": angles.z,
    });
  }

  return { pose_vector };
}

// A user pose must contain all 14 parts or matching should reject it
// (SRS REQ-9.7).
export const isCompletePose = (pose) =>
  pose.pose_vector.length === Object.keys(SEGMENTS).length;

// ---------------------------------------------------------------------------
// 5. Entry point used by the rig
// ---------------------------------------------------------------------------
// `raw` = positions in the MODEL's own space (three.js axes) for:
//   left/right_shoulder, _elbow, _wrist, _hand_tip, _hip, _knee, _ankle, _toe
//   and head_center.
// hip_mid and neck_base are derived here, exactly like the Python script does.
// The result is viewpoint-independent (see bodyYaw above).
// Returns null if anything is missing.
export function poseFromLandmarks(raw, normalizeYaw = true) {
  const needed = new Set();
  for (const [a, b] of Object.values(SEGMENTS)) { needed.add(a); needed.add(b); }
  needed.delete("hip_mid");
  needed.delete("neck_base");
  for (const k of needed) if (!raw[k]) return null;

  const withMids = {
    ...raw,
    hip_mid:   mid(raw.left_hip, raw.right_hip),
    neck_base: mid(raw.left_shoulder, raw.right_shoulder),
  };

  const points = {};
  for (const [k, v] of Object.entries(withMids)) points[k] = threeToMediaPipe(v);
  return computePoseVector(points, normalizeYaw);
}