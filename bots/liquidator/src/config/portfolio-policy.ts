import { getAddress, zeroAddress, type Address } from '@zoltar/bot-shared/ethereum'
import { boolean, formatDecimalAmount, integer, parseDecimalAmount, record, nonemptyString } from '@zoltar/bot-shared/infrastructure/json-validation'

export type PortfolioSelection = { address: Address; universeId: bigint }
export type PortfolioPolicy = {
	allowFundedTakeovers: boolean
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

export function parsePortfolioSelections(value: unknown): PortfolioSelection[] {
	if (value === undefined) return []
	if (!Array.isArray(value) || value.length > 16) throw new Error('selectedPortfolios must contain at most 16 portfolio/universe selections')
	const selections = value.map(entry => {
		const selection = record(entry, 'selected portfolio')
		const address = getAddress(nonemptyString(selection['address'], 'Portfolio address'))
		const universe = selection['universeId']
		if (address === zeroAddress) throw new Error('Portfolio address must be nonzero')
		if (typeof universe !== 'string' || !/^(0|[1-9]\d*)$/.test(universe) || BigInt(universe) >= 2n ** 248n) throw new Error('Portfolio universeId must fit uint248')
		return { address, universeId: BigInt(universe) }
	})
	if (new Set(selections.map(selection => `${selection.address}:${selection.universeId}`)).size !== selections.length) throw new Error('Duplicate portfolio/universe selection')
	return selections
}

export function parsePortfolioPolicy(value: unknown): PortfolioPolicy {
	const policy = value === undefined ? {} : record(value, 'portfolioPolicy')
	const amount = (key: string, fallback: string) => parseDecimalAmount(policy[key] ?? fallback, `portfolioPolicy.${key}`)
	const parsed = {
		allowFundedTakeovers: policy['allowFundedTakeovers'] === undefined ? false : boolean(policy['allowFundedTakeovers'], 'portfolioPolicy.allowFundedTakeovers'),
		maximumPositionsPerScan: integer(policy['maximumPositionsPerScan'] ?? 32, 'portfolioPolicy.maximumPositionsPerScan', 1, 256),
		maximumPrincipalAttoRep: amount('maximumPrincipalRep', '0'),
		maximumTotalPrincipalAttoRep: amount('maximumTotalPrincipalRep', '0'),
		maximumCommitmentAttoEth: amount('maximumCommitmentEth', '0'),
		maximumOwnFundingAttoRep: amount('maximumOwnFundingRep', '0'),
		minimumNetRewardAttoEth: amount('minimumNetRewardEth', '0.001'),
		walletReserveAttoEth: amount('walletReserveEth', '0.01'),
		targetHealthFactorBps: BigInt(integer(policy['targetHealthFactorBps'] ?? 15_000, 'portfolioPolicy.targetHealthFactorBps', 10_001, 1_000_000)),
		stalledRetirementSeconds: integer(policy['stalledRetirementSeconds'] ?? 3600, 'portfolioPolicy.stalledRetirementSeconds', 1, 31_536_000),
	}
	if (parsed.maximumPrincipalAttoRep > parsed.maximumTotalPrincipalAttoRep) throw new Error('Portfolio principal limit exceeds total portfolio principal limit')
	if (parsed.allowFundedTakeovers && (parsed.maximumPrincipalAttoRep === 0n || parsed.maximumCommitmentAttoEth === 0n)) throw new Error('Funded portfolio takeovers require positive principal and commitment limits')
	return parsed
}

export function serializePortfolioPolicy(policy: PortfolioPolicy) {
	return {
		allowFundedTakeovers: policy.allowFundedTakeovers,
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
