// pose-matcher
// parts of pose matcher INCORPORATE COSINE SIMILARITY
//
// MODEL layer: pure logic
// finds the reference images whose pose is closest to a given pose
//
// A "pose" is { pose_vector: [ { name, "x-plane-angle", "y-plane-angle",
// "z-plane-angle" }, ... ] }  (see Designing APIs).
//
// HOW A SCORE IS DETERMINED
//  1. Each body part's three angles describe a direction in 3D.
//  2. For every part that BOTH poses have, measure the angle between the two
//     directions (0 degrees = pointing the same way, 180 = opposite).
//  3. Average those angles, giving important parts more say (WEIGHTS).
//  3a. Parts the user MOVED away from the standing pose get extra say
//      (MOVED_PART_BOOST), so a T-pose is judged mostly on the arms and a
//      raised leg mostly on the legs.
//  3b. Blend in the largest single-part error (WORST_PART_MIX) so a photo
//      with one badly wrong limb ranks lower.
//  4. A part the reference photo is missing (e.g. a hidden arm) counts as a
//     MISSING_PART_DEGREES error, so a complete photo beats a partial one
//     when they are otherwise equally close.
//  Lower score = better match.

(function (root) {

  //newest weights increase legs and arms
  const WEIGHTS = {
    torso: 2,
    neck: 0.5,
    left_shoulder: 1.25, left_elbow: 1.25, left_wrist: 0.6,
    right_shoulder: 1.25, right_elbow: 1.25, right_wrist: 0.6,
    left_hip: 1.5, left_knee: 1.5, left_ankle: 0.75,
    right_hip: 1.5, right_knee: 1.5, right_ankle: 0.75,
  };

  // MOVED-PART BOOST ---------------------------------------------------------
  // A limb the user has moved away from the standing pose counts for more:
  //   weight = base weight * (1 + MOVED_PART_BOOST * moved / MAX_BOOST_DEGREES)
  // where "moved" = angle between the user's part and the same part in the
  // standing mannequin (capped at MAX_BOOST_DEGREES). With the defaults an arm
  // held straight out (90 degrees) counts DOUBLE, while a limb at rest keeps its
  // normal weight. Only the main limb bones are boosted; the torso, neck,
  // hands and feet are noisier or already weighted, so they keep their weights.
  // Set MOVED_PART_BOOST = 0 to switch the whole feature off.
  const MOVED_PART_BOOST = 1;
  const MAX_BOOST_DEGREES = 90;

  // Direction of each boosted part in the mannequin's standing pose
  // (MediaPipe-style axes: x = person's left, y = DOWN, z = toward the camera is negative).
  const REST_DIRECTIONS = {
    left_shoulder: [0.33, 0.94, 0.02],
    right_shoulder: [-0.34, 0.94, -0.02],
    left_elbow: [0, 1, 0],
    right_elbow: [0, 1, 0],
    left_hip: [0, 1, 0],
    right_hip: [0, 1, 0],
    left_knee: [0, 1, 0],
    right_knee: [0, 1, 0],
  };

  const MISSING_PART_DEGREES = 30; // error charged for a part the photo lacks

  // Final score = (1 - WORST_PART_MIX) * weighted average error
  //             +      WORST_PART_MIX  * largest single-part error.
  // The second term pushes down photos where one limb is badly wrong even if
  // everything else matches. Only parts with weight >= WORST_PART_MIN_WEIGHT
  // count for it, because hands and feet are the noisiest readings.
  const WORST_PART_MIX = 0.3;
  const WORST_PART_MIN_WEIGHT = 1;
  const DEFAULT_TOP_N = 20;

  // RESULT CUTOFF -----------------------------------------------------------
  // A photo with a score of GOOD_SCORE or lower counts as a real match, and
  // only real matches are returned. If NOTHING is that close, search() reports
  // goodMatch = false (the page shows a "no match" message) and the gallery
  // falls back, so it is never empty: first photos scoring up to 50, then up
  // to 60, and finally the MIN_RESULTS closest whatever their score.
  // The most photos ever returned is topN (TOP_N in search-controller.js).
  const GOOD_SCORE = 40;
  const FALLBACK_SCORES = [50, 60];
  const MIN_RESULTS = 5;

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

  // The weights to use for THIS user pose: the normal weights, with the boost
  // applied to limbs the user has moved. Worked out once per search.
  function effectiveWeights(userParts) {
    const weights = {};
    for (const [name, base] of Object.entries(WEIGHTS)) {
      weights[name] = base;
      const rest = REST_DIRECTIONS[name];
      const user = userParts.get(name);
      if (MOVED_PART_BOOST > 0 && rest && user) {
        const moved = angleBetween(toDirection(user), rest);
        if (moved !== null) {
          weights[name] =
            base * (1 + (MOVED_PART_BOOST * Math.min(moved, MAX_BOOST_DEGREES)) / MAX_BOOST_DEGREES);
        }
      }
    }
    return weights;
  }

  // Score one reference record against the user's pose. Lower is better.
  // `weights` is optional (findMatches works it out once per search).
  function scorePose(userParts, reference, weights) {
    const w = weights || effectiveWeights(userParts);
    let weightedError = 0;
    let totalWeight = 0;
    let compared = 0;
    let worst = 0;

    const refByName = new Map();
    for (const p of reference.pose_vector) refByName.set(p.name, p);

    for (const name of Object.keys(WEIGHTS)) {
      const weight = w[name];
      const user = userParts.get(name);
      if (!user) continue; // the user's pose lacks this part: skip it for everyone

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
      // (judged on the normal weight, so the boost can't pull the neck, hands
      // or feet into the "worst part" check)
      if (WEIGHTS[name] >= WORST_PART_MIN_WEIGHT && diff > worst) worst = diff;
    }

    if (totalWeight === 0 || compared === 0) return null;
    const average = weightedError / totalWeight;
    const score = (1 - WORST_PART_MIX) * average + WORST_PART_MIX * worst;
    return { score, partsCompared: compared };
  }

  // Returns the best `topN` references, best first:
  //   [ { id, url, score, partsCompared }, ... ]
  // Score every reference photo, best first.
  function rankAll(userPose, references) {
    if (!userPose || !Array.isArray(userPose.pose_vector)) return [];

    const userParts = new Map();
    for (const p of userPose.pose_vector) userParts.set(p.name, p);
    const weights = effectiveWeights(userParts);

    const results = [];
    for (const ref of references) {
      if (!ref || !Array.isArray(ref.pose_vector)) continue;
      const scored = scorePose(userParts, ref, weights);
      if (!scored) continue;
      results.push({
        id: ref.id,
        url: ref.url,
        score: Math.round(scored.score * 10) / 10,
        partsCompared: scored.partsCompared,
      });
    }

    // Best first. Ties: more parts compared first, then id, so the order is
    // the same every time.
    results.sort(
      (a, b) =>
        a.score - b.score ||
        b.partsCompared - a.partsCompared ||
        String(a.id).localeCompare(String(b.id))
    );

    return results;
  }


  // Photos are split into bands by score: up to 40, then 40-50, then 50-60.
  // Returns:
  //   { groups: [ { level: 40 | 50 | 60 | null, matches: [ ... ] }, ... ],
  //     matches: all photos in order, goodMatch: true/false, level: best band }
  // Bands with no photos are left out. If NOTHING scores 60 or lower, there is
  // one group with level null holding the MIN_RESULTS closest photos.
  function search(userPose, references, topN) {
    const limit = topN || DEFAULT_TOP_N;
    const all = rankAll(userPose, references); // every photo, best first
    const levels = [GOOD_SCORE, ...FALLBACK_SCORES]; // [40, 50, 60]

    const groups = [];
    let previous = -Infinity;
    let room = limit;
    for (const level of levels) {
      if (room <= 0) break;
      const band = all
        .filter((r) => r.score > previous && r.score <= level)
        .slice(0, room);
      if (band.length > 0) groups.push({ level, matches: band });
      room -= band.length;
      previous = level;
    }

    if (groups.length === 0) {
      const closest = all.slice(0, Math.min(limit, MIN_RESULTS));
      return { groups: [{ level: null, matches: closest }], matches: closest, goodMatch: false, level: null };
    }
    return {
      groups,
      matches: groups.flatMap((g) => g.matches),
      goodMatch: groups[0].level === GOOD_SCORE,
      level: groups[0].level,
    };
  }


  function findMatches(userPose, references, topN) {
    return search(userPose, references, topN).matches;
  }

  const api = {
    search,
    findMatches,
    rankAll,
    scorePose,
    effectiveWeights,
    WEIGHTS,
    MOVED_PART_BOOST,
    GOOD_SCORE,
    MIN_RESULTS,
    MISSING_PART_DEGREES,
    WORST_PART_MIX,
    DEFAULT_TOP_N,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api; // Node tests
  else root.PoseMatcher = api;                                                 // browser

})(typeof window !== "undefined" ? window : globalThis);