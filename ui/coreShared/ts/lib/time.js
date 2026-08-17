export function getTimeRemaining(targetTime, currentTime) {
    if (targetTime === undefined)
        return undefined;
    return targetTime <= currentTime ? 0n : targetTime - currentTime;
}
//# sourceMappingURL=time.js.map