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

export function poolStatusText(pool: { approvedUniverse: boolean; centralizedPriceAllowed: boolean; selected: boolean; systemState: string }) {
	if (!pool.approvedUniverse) return 'Universe not approved'
	if (pool.systemState !== '0') return 'Pool inactive'
	if (!pool.centralizedPriceAllowed) return 'Market consensus guard'
	return pool.selected ? 'Eligible' : ''
}

/** Basis points as a percentage with up to two decimals, such as `12050` → `120.5%`. */
function healthPercentage(basisPoints: bigint) {
	const fraction = (basisPoints % 100n).toString().padStart(2, '0').replace(/0+$/, '')
	return `${(basisPoints / 100n).toString()}${fraction === '' ? '' : `.${fraction}`}%`
}

/**
 * The bot vault's standing against the strategy's top-up threshold, the health below which the bot deposits REP. Without
 * a loaded strategy the protocol minimum of 100% is the only threshold that can be judged.
 */
export function botVaultState(vault: { healthBps?: string; vaultRepBacking: string; openInterestDisplay: string }, topUpHealthBps: bigint = 10_000n) {
	const health = vault.healthBps === undefined ? undefined : BigInt(vault.healthBps)
	if (vault.vaultRepBacking === '0' && vault.openInterestDisplay === '0') return 'Inactive'
	if (health === undefined) return 'No open interest'
	if (health < topUpHealthBps) return `Top-up required · ${healthPercentage(health)} health, below the ${healthPercentage(topUpHealthBps)} top-up threshold`
	return `Healthy · ${healthPercentage(health)} health`
}

export function publicFailure(error: unknown, message: string, includeDetail = false) {
	if (includeDetail && error instanceof Error) {
		const detail = error.message.trim()
		if (detail !== '' && detail !== message && !/^Request failed with HTTP \d+$/.test(detail) && !/(?:https?:\/\/[^\s/:]+:[^@\s]+@|authorization|bearer|password|secret|token\s*[=:])/i.test(detail)) return detail
	}
	return message
}
