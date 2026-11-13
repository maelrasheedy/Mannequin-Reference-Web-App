// Limbs should be moving towards the mouse regardless of the camera angle. Fix Clipping issues on the model.
import * as THREE from './three.js';

function isDescendantOf(object, ancestor) {
    let current = object;

    while (current) {
        if (current === ancestor) return true;
        current = current.parent;
    }

    return false;
}

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

    // Calculate the required world-space correction.
    const worldDelta = new THREE.Quaternion()
        .setFromUnitVectors(currentDirection, targetDirection);

    // Limit each rotation step.
    const angle = worldDelta.angleTo(
        new THREE.Quaternion()
    );

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

    // Convert the world-space correction into joint-local space.
    const parentWorldRotation = new THREE.Quaternion();

    if (joint.parent) {
        joint.parent.getWorldQuaternion(parentWorldRotation);
    }

    const localDelta = parentWorldRotation.clone()
        .invert()
        .multiply(worldDelta)
        .multiply(parentWorldRotation);

    // Apply the incremental correction.
    joint.quaternion.premultiply(localDelta);

    model.updateMatrixWorld(true);

    return true;
}

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

    // Apply the existing joint restrictions.
    if (constrainJoint) {
        constrainJoint(joint);
        model.updateMatrixWorld(true);
    }

    const candidateRotation = joint.quaternion.clone();

    // No collision validator supplied: preserve normal IK behavior.
    if (!isPoseValid || isPoseValid(model)) {
        return true;
    }

    // The full rotation causes a collision.
    // Find the largest safe portion of that rotation.
    let low = 0;
    let high = 1;
    let bestRotation = originalRotation.clone();

    for (let i = 0; i < 10; i++) {
        const middle = (low + high) / 2;

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
        } else {
            high = middle;
        }
    }

    // Keep the best collision-free rotation.
    joint.quaternion.copy(bestRotation);
    model.updateMatrixWorld(true);

    return true;
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

            // Stop processing joints when the target is reached.
            if (endPosition.distanceTo(target) <= tolerance) {
                break;
            }
        }

        // Check the updated end-effector position.
        endEffector.getWorldPosition(endPosition);

        // Stop the outer iteration loop when the target is reached.
        if (endPosition.distanceTo(target) <= tolerance) {
            break;
        }
    }

    endEffector.getWorldPosition(endPosition);

    return {
        success: endPosition.distanceTo(target) <= tolerance,
        distance: endPosition.distanceTo(target)
    };
}

export function solveHandIK({
    model,
    shoulder,
    elbow,
    wrist,
    target,
    iterations = 20,
    tolerance = 0.005,
    constrainElbow = null
}) {
    return solveIKChain({
        model,
        joints: [elbow, shoulder],
        endEffector: wrist,
        target,
        iterations,
        tolerance,
        constrainJoint: joint => {
            if (joint === elbow && constrainElbow) {
                constrainElbow(joint);
            }
        }
    });
}
