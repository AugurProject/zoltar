export function getCurrentTimestamp() {
	return BigInt(Math.floor(Date.now() / 1000))
}

export function getTimeRemaining(targetTime: bigint | undefined, currentTime: bigint) {
	if (targetTime === undefined) return undefined
	return targetTime <= currentTime ? 0n : targetTime - currentTime
}
