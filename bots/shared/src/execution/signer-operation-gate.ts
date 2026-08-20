export type SignerOperation = 'configuration' | 'deployment' | 'scan'

export function createSignerOperationGate() {
	let owner: SignerOperation | undefined
	return {
		acquire(requested: SignerOperation) {
			if (owner !== undefined) return false
			owner = requested
			return true
		},
		release(requested: SignerOperation) {
			if (owner !== requested) throw new Error(`Cannot release signer operation ${requested} while owned by ${owner ?? 'none'}`)
			owner = undefined
		},
	}
}

export type SignerOperationGate = ReturnType<typeof createSignerOperationGate>
