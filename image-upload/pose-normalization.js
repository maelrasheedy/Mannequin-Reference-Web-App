

// Calculate body rotation to keep pose angles consistent with our Python code
export function calculateBodyYaw(lmDict) {

    // Make sure the shoulder and hip landmarks are available
    const requiredLandmarks = [11, 12, 23, 24];

    for (const index of requiredLandmarks) {
        const point = lmDict?.[index];

        if (
            !Array.isArray(point) ||
            point.length < 3 ||
            !Number.isFinite(point[0]) ||
            !Number.isFinite(point[2])
        ) {
            throw new Error(
                `Cannot calculate body rotation: invalid landmark ${index}.`
            );
        }
    }

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

    // Reject invalid segment directions before calculating angles
    if (
        !Array.isArray(vector) ||
        vector.length !== 3 ||
        !vector.every(Number.isFinite) ||
        !Number.isFinite(yaw)
    ) {
        throw new Error(
            "Cannot normalize pose: invalid segment vector or body rotation."
        );
    }

    const [x, y, z] = vector;

    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);

    // Keep the same rotation direction used by our Python dataset
    return [
        x * cosYaw + z * sinYaw,
        y,
        -x * sinYaw + z * cosYaw
    ];
}
