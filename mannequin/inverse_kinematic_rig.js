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

    const towardEnd = endPosition.sub(jointPosition);
    const towardTarget = target.clone().sub(jointPosition);

    if (
        towardEnd.lengthSq() < 1e-10 ||
        towardTarget.lengthSq() < 1e-10
    ) {
        return false;
    }

    towardEnd.normalize();
    towardTarget.normalize();

    const worldRotation = new THREE.Quaternion()
        .setFromUnitVectors(towardEnd, towardTarget);

    // Limit the amount of rotation applied per iteration.
    const angle = 2 * Math.acos(
        THREE.MathUtils.clamp(worldRotation.w, -1, 1)
    );

    if (angle > maxStepRadians) {
        worldRotation.slerp(
            new THREE.Quaternion(),
            1 - maxStepRadians / angle
        );
    }

    // Convert world-space rotation into local-space rotation.
    const parentRotation = new THREE.Quaternion();

    if (joint.parent) {
        joint.parent.getWorldQuaternion(parentRotation);
    }

    const localRotation = parentRotation.clone()
        .invert()
        .multiply(worldRotation)
        .multiply(parentRotation);

    joint.quaternion.premultiply(localRotation);

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
    constrainJoint = null
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

        // CCD works from the end of the chain toward its root.
        for (const joint of joints) {

            calculateJointRotation(
                model,
                joint,
                endEffector,
                target,
                maxStepRadians
            );

            if (constrainJoint) {
                constrainJoint(joint);
                model.updateMatrixWorld(true);
            }
        }

        endEffector.getWorldPosition(endPosition);

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
