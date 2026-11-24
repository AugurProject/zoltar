import { formatUnits } from '@zoltar/core-shared/evm/ethereum'
import { validateSecurityPoolEconomics } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { parseSecurityPoolAmount, securityPoolAmountOrUndefined } from './draft.js'
import { requireFixedAdmissionQuestionLimit } from '../../../protocol/securityPoolAdmission.js'

export type CuratedAdmissionMode = 'open' | 'fixed'
export type SecurityPoolCreationDraft = {
	annualFeePercent: string
	purchaseFeePercent: string
	minimumPurchaseFee: string
	minimumCommitment: string
	minimumOutcomeRate: string
	rewardVestingHours: string
}

export const defaultSecurityPoolCreationDraft = (): SecurityPoolCreationDraft => ({
	annualFeePercent: '10',
	purchaseFeePercent: '1',
	minimumPurchaseFee: '0.001',
	minimumCommitment: '1',
	minimumOutcomeRate: '0.01',
	rewardVestingHours: '24',
})

function securityPoolBasisPoints(value: string, label: string) {
	const amount = securityPoolBasisPointsOrUndefined(value)
	if (amount === undefined) throw new Error(`${label} must be a nonnegative percentage with at most two decimal places.`)
	return amount
}

export function securityPoolBasisPointsOrUndefined(value: string) {
	if (!/^\d+(\.\d{0,2})?$/.test(value.trim())) return undefined
	const [whole, fraction = ''] = value.trim().split('.')
	if (whole === undefined) return undefined
	return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
}

function collateralAmount(value: string, decimals: number) {
	const amount = securityPoolAmountOrUndefined(value, decimals)
	if (amount === undefined) throw new Error(`Enter a nonnegative amount with up to ${decimals} decimal places.`)
	return amount
}

export function parseSecurityPoolCreationEconomics(draft: SecurityPoolCreationDraft, decimals = 18) {
	const config = {
		annualFeeBps: securityPoolBasisPoints(draft.annualFeePercent, 'Annual time fee'),
		purchaseFeeBps: securityPoolBasisPoints(draft.purchaseFeePercent, 'Purchase fee'),
		minimumPurchaseFeeAttoEth: collateralAmount(draft.minimumPurchaseFee, decimals),
		minimumCommitmentAttoEth: collateralAmount(draft.minimumCommitment, decimals),
		minimumOutcomeRate: parseSecurityPoolAmount(draft.minimumOutcomeRate),
		rewardVestingSeconds: (parseSecurityPoolAmount(draft.rewardVestingHours) * 3600n) / 10n ** 18n,
	}
	validateSecurityPoolEconomics(config)
	return config
}

export function parseFixedSecurityPoolQuestions(input: string) {
	const values = input
		.trim()
		.split(/[\s,]+/)
		.filter(Boolean)
	if (values.length === 0) throw new Error('Enter at least one approved question ID.')
	const questions = [
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
	requireFixedAdmissionQuestionLimit(questions.length)
	return questions
}

/** The wallet review for a security pool deployment; the purchase fee floor and minimum commitment are in collateral units. */
export function securityPoolDeploymentReviewDescription(mode: CuratedAdmissionMode, config: ReturnType<typeof parseSecurityPoolCreationEconomics>, collateral: Readonly<{ decimals: number; symbol: string }>) {
	const amount = (value: bigint) => `${formatUnits(value, collateral.decimals)} ${collateral.symbol}`
	return `Deploy a security pool with immutable ${mode} question admission. Fixed annual holding fee ${formatUnits(config.annualFeeBps, 2)}%. Base purchase fee ${formatUnits(config.purchaseFeeBps, 2)}% of required backing value, minimum ${amount(config.minimumPurchaseFeeAttoEth)}. Each purchase also prepays exactly 52 days of resolution fees; unused resolution premium is burned. The base purchase fee vests to underwriters; price reporters and keepers pay their own costs. Capital owners can retire if spare backing permits; there is no minimum holding period. Minimum collateral commitment ${amount(config.minimumCommitmentAttoEth)}; fork auction lots may be larger; prepaid rewards vest over ${config.rewardVestingSeconds} seconds. Each owner chooses their own health target. Eligible questions can be registered separately or by their first purchase in the origin universe.`
}
