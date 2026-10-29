import { validatePortfolioEconomics } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { parsePortfolioAmount } from './draft.js'

export type CuratedAdmissionMode = 'open' | 'fixed'
export type PortfolioCreationDraft = {
	annualFeePercent: string
	purchaseFeePercent: string
	minimumPurchaseFee: string
	minimumCommitment: string
	minimumExecutionReserve: string
	minimumOutcomeRate: string
	rewardVestingHours: string
	reportingFee: string
	serviceFeePercent: string
	maximumOracleReward: string
	auctionReservePercent: string
}

export const defaultPortfolioCreationDraft = (): PortfolioCreationDraft => ({
	annualFeePercent: '10',
	purchaseFeePercent: '1',
	minimumPurchaseFee: '0.001',
	minimumCommitment: '1',
	minimumExecutionReserve: '0.001',
	minimumOutcomeRate: '0.01',
	rewardVestingHours: '24',
	reportingFee: '0.05',
	serviceFeePercent: '25',
	maximumOracleReward: '0.1',
	auctionReservePercent: '50',
})

function portfolioBasisPoints(value: string, label: string) {
	const amount = portfolioBasisPointsOrUndefined(value)
	if (amount === undefined) throw new Error(`${label} must be a nonnegative percentage with at most two decimal places.`)
	return amount
}

export function portfolioBasisPointsOrUndefined(value: string) {
	if (!/^\d+(\.\d{0,2})?$/.test(value.trim())) return undefined
	const [whole, fraction = ''] = value.trim().split('.')
	if (whole === undefined) return undefined
	return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
}

export function parsePortfolioCreationEconomics(draft: PortfolioCreationDraft) {
	const config = {
		annualFeeBps: portfolioBasisPoints(draft.annualFeePercent, 'Annual time fee'),
		purchaseFeeBps: portfolioBasisPoints(draft.purchaseFeePercent, 'Purchase fee'),
		minimumPurchaseFeeAttoEth: parsePortfolioAmount(draft.minimumPurchaseFee),
		minimumCommitmentAttoEth: parsePortfolioAmount(draft.minimumCommitment),
		minimumExecutionReserveAttoEth: parsePortfolioAmount(draft.minimumExecutionReserve),
		minimumOutcomeRate: parsePortfolioAmount(draft.minimumOutcomeRate),
		rewardVestingSeconds: (parsePortfolioAmount(draft.rewardVestingHours) * 3600n) / 10n ** 18n,
		reportingFeeAttoEth: parsePortfolioAmount(draft.reportingFee),
		serviceFeeBps: portfolioBasisPoints(draft.serviceFeePercent, 'Oracle maintenance share'),
		maximumOracleRewardAttoEth: parsePortfolioAmount(draft.maximumOracleReward),
		auctionReserveFactorBps: portfolioBasisPoints(draft.auctionReservePercent, 'Auction reserve'),
	}
	validatePortfolioEconomics(config)
	return config
}

export function parseFixedPortfolioQuestions(input: string) {
	const values = input
		.trim()
		.split(/[\s,]+/)
		.filter(Boolean)
	if (values.length === 0) throw new Error('Enter at least one approved question ID.')
	return [
		...new Set(
			values.map(value => {
				if (!/^(0x[\da-fA-F]+|\d+)$/.test(value)) throw new Error('Use decimal or hexadecimal question IDs separated by commas or spaces.')
				const id = BigInt(value)
				if (id >= 1n << 256n) throw new Error('Question ID must fit uint256.')
				return id
			}),
		),
	].sort((left, right) => {
		if (left < right) return -1
		if (left > right) return 1
		return 0
	})
}
