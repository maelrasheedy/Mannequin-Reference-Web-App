
import * as THREE from './three.js';

function isDescendantOf(object, ancestor) {
    let current = object;

    while (current) {
        if (current === ancestor) return true;
        current = current.parent;
    }

    return false;
}

// Calculate a world-space rotation that moves the end effector toward the target.
function calculateJointRotation(
    model,
    joint,
    endEffector,
    target,
    maxStepRadians = THREE.MathUtils.degToRad(15)
) {
    model.updateMatrixWorld(true);

    const jointPosition = joint.getWorldPosition(
        new THREE.Vector3()
    );

    const endPosition = endEffector.getWorldPosition(
        new THREE.Vector3()
    );

    const currentDirection = endPosition.sub(jointPosition);
    const targetDirection = target.clone().sub(jointPosition);

    if (
        currentDirection.lengthSq() < 1e-10 ||
        targetDirection.lengthSq() < 1e-10
    ) {
        return false;
    }

    currentDirection.normalize();
    targetDirection.normalize();

    const worldDelta = new THREE.Quaternion()
        .setFromUnitVectors(currentDirection, targetDirection);

    const angle = worldDelta.angleTo(
        new THREE.Quaternion()
    );

    if (angle < 1e-6) return false;

    // Limit the rotation step.
    if (angle > maxStepRadians) {
        const axis = new THREE.Vector3(
            worldDelta.x,
            worldDelta.y,
            worldDelta.z
        );

        if (axis.lengthSq() < 1e-10) return false;

        axis.normalize();

        worldDelta.setFromAxisAngle(
            axis,
            maxStepRadians
        );
    }

    // Convert world-space rotation into parent-local coordinates.
    const parentWorldRotation = new THREE.Quaternion();

    if (joint.parent) {
        joint.parent.getWorldQuaternion(parentWorldRotation);
    }

    const localDelta = parentWorldRotation.clone()
        .invert()
        .multiply(worldDelta)
        .multiply(parentWorldRotation);

    joint.quaternion.premultiply(localDelta);

    model.updateMatrixWorld(true);

    return true;
}

// Apply a rotation only when the resulting pose is collision-free.
function applyJointRotationSafely({
    model,
    joint,
    endEffector,
    target,
    maxStepRadians,
    constrainJoint,
    isPoseValid
}) {
    const originalRotation = joint.quaternion.clone();

    const changed = calculateJointRotation(
        model,
        joint,
        endEffector,
        target,
        maxStepRadians
    );

    if (!changed) return false;

    // Apply joint restrictions before checking collisions.
    if (constrainJoint) {
        constrainJoint(joint);
        model.updateMatrixWorld(true);
    }

    const candidateRotation = joint.quaternion.clone();

    // No collision validator supplied.
    if (!isPoseValid) {
        return true;
    }

    // Accept the complete rotation if it is safe.
    if (isPoseValid(model)) {
        return true;
    }

    // The candidate is unsafe. Search for a safe partial rotation.
    let low = 0;
    let high = 1;

    let bestRotation = originalRotation.clone();
    let foundSafeRotation = false;

    for (let i = 0; i < 14; i++) {
        const middle = (low + high) * 0.5;

        joint.quaternion.copy(originalRotation).slerp(
            candidateRotation,
            middle
        );

        model.updateMatrixWorld(true);

        if (constrainJoint) {
            constrainJoint(joint);
            model.updateMatrixWorld(true);
        }

        if (isPoseValid(model)) {
            low = middle;
            bestRotation.copy(joint.quaternion);
            foundSafeRotation = true;
        } else {
            high = middle;
        }
    }

    // Never leave the joint in an invalid pose.
    if (foundSafeRotation) {
        joint.quaternion.copy(bestRotation);
    } else {
        joint.quaternion.copy(originalRotation);
    }

    model.updateMatrixWorld(true);

    return foundSafeRotation &&
        originalRotation.angleTo(bestRotation) > 1e-6;
}

export function solveIKChain({
    model,
    joints,
    endEffector,
    target,
    iterations = 20,
    tolerance = 0.005,
    maxStepDegrees = 15,
    constrainJoint = null,
    isPoseValid = null
}) {
    if (
        !model ||
        !Array.isArray(joints) ||
        joints.length === 0 ||
        !endEffector ||
        !target ||
        !target.isVector3
    ) {
        console.warn("IK solver: Invalid parameters.");
        return false;
    }

    if (
        !isDescendantOf(endEffector, model) ||
        !joints.every(joint =>
            joint &&
            isDescendantOf(joint, model) &&
            isDescendantOf(endEffector, joint)
        )
    ) {
        console.warn("IK solver: Invalid joint hierarchy.");
        return false;
    }

    model.updateMatrixWorld(true);

    // Do not begin solving from an already-invalid pose.
    if (isPoseValid && !isPoseValid(model)) {
        console.warn("IK solver: Starting pose contains a collision.");
        return false;
    }

    const endPosition = new THREE.Vector3();

    const maxStepRadians =
        THREE.MathUtils.degToRad(maxStepDegrees);

    for (let iteration = 0; iteration < iterations; iteration++) {

        // Process joints from the end effector toward the root.
        for (const joint of joints) {

            applyJointRotationSafely({
                model,
                joint,
                endEffector,
                target,
                maxStepRadians,
                constrainJoint,
                isPoseValid
            });

            endEffector.getWorldPosition(endPosition);

            if (endPosition.distanceTo(target) <= tolerance) {
                break;
            }
        }

        endEffector.getWorldPosition(endPosition);

        if (endPosition.distanceTo(target) <= tolerance) {
            break;
        }
    }

    endEffector.getWorldPosition(endPosition);

    const distance = endPosition.distanceTo(target);

    return {
        success: distance <= tolerance,
        distance
    };
}

// Convenience function for hand IK.
export function solveHandIK({
    model,
    shoulder,
    elbow,
    wrist,
    target,
    iterations = 20,
    tolerance = 0.005,
    maxStepDegrees = 15,
    constrainElbow = null,
    constrainJoint = null,
    isPoseValid = null
}) {
    if (!shoulder || !elbow || !wrist) {
        console.warn("Hand IK: Missing arm joints.");
        return false;
    }

    return solveIKChain({
        model,
        joints: [elbow, shoulder],
        endEffector: wrist,
        target,
        iterations,
        tolerance,
        maxStepDegrees,

        constrainJoint: joint => {
            if (constrainJoint) {
                constrainJoint(joint);
            }

            if (joint === elbow && constrainElbow) {
                constrainElbow(joint);
            }
        },

        isPoseValid
    });
}