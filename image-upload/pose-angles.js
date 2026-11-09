
// Calculate the X, Y, and Z plane angles using the same formula as our Python code
export function calculatePlaneAngles(vector) {

    const [x, y, z] = vector;

    // Calculate the length of the 3D vector
    const norm = Math.hypot(x, y, z);

    // Skip invalid vectors or vectors that are too small
    if (!Number.isFinite(norm) || norm < 1e-8) {
        return null;
    }

    // Keep values within the valid range for Math.asin()
    function clamp(value) {
        return Math.max(-1, Math.min(1, value));
    }

    // Convert the angle to degrees and round to one decimal place
    function toDegrees(value) {
        const degrees = Math.asin(clamp(value / norm)) * 180 / Math.PI;
        return Math.round(degrees * 10) / 10;
    }

    // Calculate the three plane angles
    const angleX = toDegrees(x);
    const angleY = toDegrees(y);
    const angleZ = toDegrees(z);

    return [angleX, angleY, angleZ];
}
