import { getAddress, zeroAddress, type Address } from '@zoltar/bot-shared/ethereum'
import { boolean, formatDecimalAmount, integer, parseDecimalAmount, record, nonemptyString } from '@zoltar/bot-shared/infrastructure/json-validation'

export type SecurityPoolSelection = { address: Address; universeId: bigint }
export type SecurityPoolPolicy = {
	allowFundedTakeovers: boolean
	takeoverIncomeHorizonSeconds: number
	maximumPositionsPerScan: number
	maximumPrincipalAttoRep: bigint
	maximumTotalPrincipalAttoRep: bigint
	maximumCommitmentAttoEth: bigint
	maximumOwnFundingAttoRep: bigint
	minimumNetRewardAttoEth: bigint
	walletReserveAttoEth: bigint
	targetHealthFactorBps: bigint
	stalledRetirementSeconds: number
}

export function parseSecurityPoolSelections(value: unknown): SecurityPoolSelection[] {
	if (value === undefined) return []
	if (!Array.isArray(value) || value.length > 16) throw new Error('selectedSecurityPools must contain at most 16 security pool/universe selections')
	const selections = value.map(entry => {
		const selection = record(entry, 'selected security pool')
		const address = getAddress(nonemptyString(selection['address'], 'Security pool address'))
		const universe = selection['universeId']
		if (address === zeroAddress) throw new Error('Security pool address must be nonzero')
		if (typeof universe !== 'string' || !/^(0|[1-9]\d*)$/.test(universe) || BigInt(universe) >= 2n ** 248n) throw new Error('Security pool universeId must fit uint248')
		return { address, universeId: BigInt(universe) }
	})
	if (new Set(selections.map(selection => `${selection.address}:${selection.universeId}`)).size !== selections.length) throw new Error('Duplicate security pool/universe selection')
	return selections
}

export function parseSecurityPoolPolicy(value: unknown): SecurityPoolPolicy {
	const policy = value === undefined ? {} : record(value, 'securityPoolPolicy')
	const amount = (key: string, fallback: string) => parseDecimalAmount(policy[key] ?? fallback, `securityPoolPolicy.${key}`)
	const parsed = {
		takeoverIncomeHorizonSeconds: integer(policy['takeoverIncomeHorizonSeconds'] ?? 0, 'securityPoolPolicy.takeoverIncomeHorizonSeconds', 0, 31_536_000),
		allowFundedTakeovers: policy['allowFundedTakeovers'] === undefined ? false : boolean(policy['allowFundedTakeovers'], 'securityPoolPolicy.allowFundedTakeovers'),
		maximumPositionsPerScan: integer(policy['maximumPositionsPerScan'] ?? 32, 'securityPoolPolicy.maximumPositionsPerScan', 1, 256),
		maximumPrincipalAttoRep: amount('maximumPrincipalRep', '0'),
		maximumTotalPrincipalAttoRep: amount('maximumTotalPrincipalRep', '0'),
		maximumCommitmentAttoEth: amount('maximumCommitmentEth', '0'),
		maximumOwnFundingAttoRep: amount('maximumOwnFundingRep', '0'),
		minimumNetRewardAttoEth: amount('minimumNetRewardEth', '0.001'),
		walletReserveAttoEth: amount('walletReserveEth', '0.01'),
		targetHealthFactorBps: BigInt(integer(policy['targetHealthFactorBps'] ?? 15_000, 'securityPoolPolicy.targetHealthFactorBps', 10_000, 1_000_000)),
		stalledRetirementSeconds: integer(policy['stalledRetirementSeconds'] ?? 3600, 'securityPoolPolicy.stalledRetirementSeconds', 1, 31_536_000),
	}
	if (parsed.maximumPrincipalAttoRep > parsed.maximumTotalPrincipalAttoRep) throw new Error('Security pool principal limit exceeds total security pool principal limit')
	if (parsed.allowFundedTakeovers && (parsed.maximumPrincipalAttoRep === 0n || parsed.maximumCommitmentAttoEth === 0n)) throw new Error('Funded security pool takeovers require positive principal and commitment limits')
	return parsed
}

export function serializeSecurityPoolPolicy(policy: SecurityPoolPolicy) {
	return {
		allowFundedTakeovers: policy.allowFundedTakeovers,
		takeoverIncomeHorizonSeconds: policy.takeoverIncomeHorizonSeconds,
		maximumPositionsPerScan: policy.maximumPositionsPerScan,
		maximumPrincipalRep: formatDecimalAmount(policy.maximumPrincipalAttoRep),
		maximumTotalPrincipalRep: formatDecimalAmount(policy.maximumTotalPrincipalAttoRep),
		maximumCommitmentEth: formatDecimalAmount(policy.maximumCommitmentAttoEth),
		maximumOwnFundingRep: formatDecimalAmount(policy.maximumOwnFundingAttoRep),
		minimumNetRewardEth: formatDecimalAmount(policy.minimumNetRewardAttoEth),
		walletReserveEth: formatDecimalAmount(policy.walletReserveAttoEth),
		targetHealthFactorBps: Number(policy.targetHealthFactorBps),
		stalledRetirementSeconds: policy.stalledRetirementSeconds,
	}
}
