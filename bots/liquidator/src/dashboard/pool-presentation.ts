type Vault = {
	capacityOwnershipEth: string
	openInterestDisplay: string
	healthBps?: string
	vaultRepBacking: string
	claimableFeesEth: string
}

export type MonitoredPool = {
	knownVaultCount: string
	address: string
	approvedUniverse: boolean
	bestCandidateBonusValueEth?: string
	botVault: Vault
	candidateCount: number
	centralizedPriceAllowed: boolean
	centralizedPriceDeviationBps?: string
	isPriceValid: boolean
	lastPrice: string
	multiplierBps: string
	parent?: string
	universeId: string
	questionId: string
	selected: boolean
	systemState: string
	totalCapacityOwnershipEth: string
	totalPoolHeldRep: string
}

export function publicFailure(error: unknown, message: string, includeDetail = false) {
	if (includeDetail && error instanceof Error) {
		const detail = error.message.trim()
		if (detail !== '' && detail !== message && !/^Request failed with HTTP \d+$/.test(detail) && !/(?:https?:\/\/[^\s/:]+:[^@\s]+@|authorization|bearer|password|secret|token\s*[=:])/i.test(detail)) return detail
	}
	return message
}
