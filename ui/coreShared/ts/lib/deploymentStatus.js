export function hasDeployedStep(steps, stepId) {
    return steps.some(step => step.id === stepId && step.deployed);
}
//# sourceMappingURL=deploymentStatus.js.map