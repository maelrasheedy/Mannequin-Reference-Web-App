
// Calculate body rotation to keep pose angles consistent with our Python code
export function calculateBodyYaw(lmDict) {

    // Use the shoulders and hips to calculate the body's direction
    const x =
        (lmDict[11][0] - lmDict[12][0]) +
        (lmDict[23][0] - lmDict[24][0]);

    const z =
        (lmDict[11][2] - lmDict[12][2]) +
        (lmDict[23][2] - lmDict[24][2]);

    // Skip rotation if the direction is too small to calculate reliably
    if (Math.hypot(x, z) < 1e-6) {
        return 0;
    }

    return Math.atan2(z, x);
}

// Rotate a body segment around the Y-axis before calculating its angles
export function rotateYaw(vector, yaw) {

    const [x, y, z] = vector;

    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);

    return [
        x * cosYaw + z * sinYaw,
        y,
        -x * sinYaw + z * cosYaw
    ];
}
