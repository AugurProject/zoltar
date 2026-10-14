export function claimStateChanged(message: string) {
	return Object.assign(new Error(message), { claimStateChanged: true })
}

export function isClaimStateChanged(error: unknown): error is Error {
	return error instanceof Error && 'claimStateChanged' in error && error.claimStateChanged === true
}

function hasRevertReason(error: unknown, reason: string): boolean {
	let current = error
	for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
		if ([reason, `execution reverted: ${reason}`, `execution reverted with reason string '${reason}'`, `execution reverted with reason string "${reason}"`].includes(current.message)) return true
		current = current.cause
	}
	return false
}

/** Only the contract's mutable nullifier mismatch is eligible for a pre-send rebuild. */
export function isStaleClaimNullifier(error: unknown) {
	return hasRevertReason(error, 'Bad nullifier proof')
}

export function isFailedClaimMulticall(error: unknown) {
	return hasRevertReason(error, 'Multicall3: call failed')
}
