import { formatUnits } from '@zoltar/core-shared/evm/ethereum'
import { validateSecurityPoolEconomics } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { parseSecurityPoolAmount, securityPoolAmountOrUndefined } from './draft.js'
import { requireFixedAdmissionQuestionLimit } from '../../../protocol/securityPoolAdmission.js'
import { deployment as copy } from '../../../copy/securityPoolTransactions.js'

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
	if (amount === undefined) throw new Error(copy.invalidPercentage(label))
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
	if (amount === undefined) throw new Error(copy.invalidCollateral(decimals))
	return amount
}

export function parseSecurityPoolCreationEconomics(draft: SecurityPoolCreationDraft, decimals = 18) {
	const config = {
		annualFeeBps: securityPoolBasisPoints(draft.annualFeePercent, copy.annualHoldingFee),
		purchaseFeeBps: securityPoolBasisPoints(draft.purchaseFeePercent, copy.purchaseFee),
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
	if (values.length === 0) throw new Error(copy.fixedQuestionsRequired)
	const questions = [
		...new Set(
			values.map(value => {
				if (!/^(0x[\da-fA-F]+|\d+)$/.test(value)) throw new Error(copy.invalidQuestionList)
				const id = BigInt(value)
				if (id >= 1n << 256n) throw new Error(copy.questionIdTooLarge)
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
export function securityPoolDeploymentReviewDescription(mode: CuratedAdmissionMode, config: ReturnType<typeof parseSecurityPoolCreationEconomics>, collateral: Readonly<{ decimals: number; symbol: string }>, maximumQuestionHorizonSeconds: bigint) {
	const amount = (value: bigint) => `${formatUnits(value, collateral.decimals)} ${collateral.symbol}`
	const days = (seconds: bigint) => copy.reviewDuration(formatUnits((seconds * 10_000n + 43_200n) / 86_400n, 4))
	return [copy.reviewQuestionRules(mode, days(maximumQuestionHorizonSeconds)), copy.reviewFees(formatUnits(config.annualFeeBps, 2), formatUnits(config.purchaseFeeBps, 2), amount(config.minimumPurchaseFeeAttoEth)), copy.reviewCommitment(amount(config.minimumCommitmentAttoEth), days(config.rewardVestingSeconds))].join(
		' ',
	)
}
