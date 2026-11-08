//pose matching
//MODEL layer: pure logic
// Finds the reference images whose pose is
//closest to a given pose.
//
// A "pose" is 
// { pose_vector: [ { name, 
//                  "x-plane-angle", 
//                  "y-plane-angle",
//                  "z-plane-angle" }, ... ] }  
//
//HOW A SCORE IS COMPUTED
// 1. Each body part's three angles describe a direction in 3D.
// 2. For every part that BOTH poses have, measure the angle between the two
//    directions (0 degrees = pointing the same way, 180 = opposite).
// 3. Average those angles, giving important parts more say (WEIGHTS).
// 4. A part the reference photo is missing (e.g. a hidden arm) counts as a
//    MISSING_PART_DEGREES error, so a complete photo beats a partial one
//    when they are otherwise equally close.
//  Lower score = better match.

(function (root) {

  // How much each part counts. Hands and feet are the noisiest, so half
  const WEIGHTS = {
    torso: 2,
    neck: 1,
    left_shoulder: 1, left_elbow: 1, left_wrist: 0.5,
    right_shoulder: 1, right_elbow: 1, right_wrist: 0.5,
    left_hip: 1, left_knee: 1, left_ankle: 0.5,
    right_hip: 1, right_knee: 1, right_ankle: 0.5,
  };

  const MISSING_PART_DEGREES = 30; // error charged for human landmark the photo lacks (in json)
  const DEFAULT_TOP_N = 20;

  const toDirection = (p) => {
    // The three plane angles are asin(component / length), so
    // (sin x, sin y, sin z) is already a unit-length direction.
    const rad = Math.PI / 180;
    return [
      Math.sin(p["x-plane-angle"] * rad),
      Math.sin(p["y-plane-angle"] * rad),
      Math.sin(p["z-plane-angle"] * rad),
    ];
  };

  const angleBetween = (a, b) => {
    const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const lenA = Math.hypot(a[0], a[1], a[2]);
    const lenB = Math.hypot(b[0], b[1], b[2]);
    if (lenA < 1e-9 || lenB < 1e-9) return null;
    const c = Math.max(-1, Math.min(1, dot / (lenA * lenB)));
    return (Math.acos(c) * 180) / Math.PI;
  };

  // Score one reference record against the user's pose,, lower is better
  function scorePose(userParts, reference) {
    let weightedError = 0;
    let totalWeight = 0;
    let compared = 0;

    const refByName = new Map();
    for (const p of reference.pose_vector) refByName.set(p.name, p);

    for (const [name, weight] of Object.entries(WEIGHTS)) {
      const user = userParts.get(name);
      if (!user) continue; // if the user's pose lacks this part then skip it for everyone

      totalWeight += weight;
      const ref = refByName.get(name);
      if (!ref) {
        weightedError += weight * MISSING_PART_DEGREES;
        continue;
      }
      const diff = angleBetween(toDirection(user), toDirection(ref));
      if (diff === null) {
        weightedError += weight * MISSING_PART_DEGREES;
        continue;
      }
      weightedError += weight * diff;
      compared += 1;
    }

    if (totalWeight === 0 || compared === 0) return null;
    return { score: weightedError / totalWeight, partsCompared: compared };
  }

  // Returns the best `topN` references, BEST FIRST:
  //   [ { id, url, score, partsCompared }, ... ]
  function findMatches(userPose, references, topN) {
    if (!userPose || !Array.isArray(userPose.pose_vector)) return [];
    const limit = topN || DEFAULT_TOP_N;

    const userParts = new Map();
    for (const p of userPose.pose_vector) userParts.set(p.name, p);

    const results = [];
    for (const ref of references) {
      if (!ref || !Array.isArray(ref.pose_vector)) continue;
      const scored = scorePose(userParts, ref);
      if (!scored) continue;
      results.push({
        id: ref.id,
        url: ref.url,
        score: Math.round(scored.score * 10) / 10,
        partsCompared: scored.partsCompared,
      });
    }

    // Best first but if there are ties, 
    // then more parts compared first, then id, 
    // so the order is the same every time
    results.sort(
      (a, b) =>
        a.score - b.score ||
        b.partsCompared - a.partsCompared ||
        String(a.id).localeCompare(String(b.id))
    );
    return results.slice(0, limit);
  }

  const api = {
    findMatches,
    scorePose,
    WEIGHTS,
    MISSING_PART_DEGREES,
    DEFAULT_TOP_N,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api; // Node tests
  else root.PoseMatcher = api;                                                 // browser

})(typeof window !== "undefined" ? window : globalThis);