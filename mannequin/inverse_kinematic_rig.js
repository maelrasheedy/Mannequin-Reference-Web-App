
import * as THREE from './three.js';

function calculateJointRotation(
    model,
    joint,
    endEffector,
    target
) {
    model.updateMatrixWorld(true);

    const jointPosition = joint.getWorldPosition(
        new THREE.Vector3()
    );

    const endPosition = endEffector.getWorldPosition(
        new THREE.Vector3()
    );

    const towardEnd = endPosition.clone().sub(jointPosition);
    const towardTarget = target.clone().sub(jointPosition);

    if (
        towardEnd.lengthSq() < 1e-10 ||
        towardTarget.lengthSq() < 1e-10
    ) {
        return;
    }

    towardEnd.normalize();
    towardTarget.normalize();

    // Calculate the rotation in world coordinates.
    const worldRotation = new THREE.Quaternion()
        .setFromUnitVectors(towardEnd, towardTarget);

    // Convert the world rotation into the joint's local coordinate system.
    const parentRotation = new THREE.Quaternion();

    if (joint.parent) {
        joint.parent.getWorldQuaternion(parentRotation);
    }

    const localRotation = parentRotation.clone()
        .invert()
        .multiply(worldRotation)
        .multiply(parentRotation);

    // Apply the calculated rotation.
    joint.quaternion.premultiply(localRotation);

    model.updateMatrixWorld(true);
}

export function solveHandIK({
    model,
    shoulder,
    elbow,
    wrist,
    target,
    iterations = 15,
    tolerance = 0.001,
    constrainElbow = null
}) {

    if (!model || !shoulder || !elbow || !wrist || !target) {
        console.warn("IK solver: Missing required parameters.");
        return false;
    }

    if (
        !model.getObjectById(shoulder.id) ||
        !model.getObjectById(elbow.id) ||
        !model.getObjectById(wrist.id)
    ) {
        console.warn("IK solver: Joint hierarchy is invalid.");
        return false;
    }

    model.updateMatrixWorld(true);

    const wristPosition = new THREE.Vector3();

    for (let iteration = 0; iteration < iterations; iteration++) {

        for (const joint of [elbow, shoulder]) {

            calculateJointRotation(
                model,
                joint,
                wrist,
                target
            );

            if (joint === elbow && constrainElbow) {
                constrainElbow(joint);
                model.updateMatrixWorld(true);
            }
        }

        wrist.getWorldPosition(wristPosition);

        const distance = wristPosition.distanceTo(target);

        if (distance <= tolerance) {
            break;
        }
    }

    return true;
}
