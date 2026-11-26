import { formatUnits, parseUnits, type Address } from '@zoltar/core-shared/evm/ethereum'
import { validateSecurityPoolEconomics, type SecurityPoolOriginConfig } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS, MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS } from '@zoltar/statoblast-shared/initialReport/oracleInitialReport'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import type { NetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { parseSecurityPoolAmount, securityPoolAmountOrUndefined, securityPoolUnsignedId } from './draft.js'
import { securityPoolCollateral, type CollateralSymbol } from '../../../protocol/collateral.js'
import { requireFixedAdmissionQuestionLimit } from '../../../protocol/securityPoolAdmission.js'
import { deployment as copy } from '../../../copy/securityPoolTransactions.js'
import { creationInvalid, enterOrigin, horizonInvalid } from '../../../copy/securityPool.js'

export type CuratedAdmissionMode = 'open' | 'fixed'
export type SecurityPoolCreationDraft = {
	annualFeePercent: string
	purchaseFeePercent: string
	minimumPurchaseFee: string
	minimumCommitment: string
	minimumOutcomeRate: string
	rewardVestingHours: string
}

export type DeploymentDraft = {
	collateralSymbol: CollateralSymbol
	reportFloor: string
	originInput: string
	multiplierInput: string
	priorityFeeInput: string
	horizonDays: string
	admissionMode: CuratedAdmissionMode
	fixedQuestions: string
	economicsDraft: SecurityPoolCreationDraft
}

const MINIMUM_SECURITY_MULTIPLIER_BPS = 10_500n

const defaultSecurityPoolCreationDraft = (): SecurityPoolCreationDraft => ({
	annualFeePercent: '10',
	purchaseFeePercent: '1',
	minimumPurchaseFee: '0.001',
	minimumCommitment: '1',
	minimumOutcomeRate: '0.01',
	rewardVestingHours: '24',
})

export function initialDeploymentDraft(originInput: string): DeploymentDraft {
	return {
		collateralSymbol: 'WETH',
		reportFloor: '0.01',
		originInput,
		multiplierInput: '200',
		priorityFeeInput: (DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS / 10n ** 9n).toString(),
		horizonDays: '30',
		admissionMode: 'open',
		fixedQuestions: '',
		economicsDraft: defaultSecurityPoolCreationDraft(),
	}
}

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

function parseFixedSecurityPoolQuestions(input: string) {
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

export function parseDeploymentDraft(draft: DeploymentDraft, profile: NetworkProfile) {
	const collateral = securityPoolCollateral(profile, draft.collateralSymbol)
	let fixedQuestionIds: bigint[] | undefined
	let fixedQuestionError: string | undefined
	if (draft.admissionMode === 'fixed') {
		try {
			fixedQuestionIds = parseFixedSecurityPoolQuestions(draft.fixedQuestions)
		} catch (failure) {
			fixedQuestionError = getErrorMessage(failure, creationInvalid)
		}
	}
	const approvedQuestions = fixedQuestionIds ?? []
	let creationError: string | undefined
	let origin: SecurityPoolOriginConfig | undefined
	let economics: ReturnType<typeof parseSecurityPoolCreationEconomics> | undefined
	let horizon: bigint | undefined
	try {
		const originUniverse = securityPoolUnsignedId(draft.originInput, 248)
		if (originUniverse === undefined) throw new Error(enterOrigin)
		const securityMultiplierBps = parseUnits(draft.multiplierInput, 2)
		const reportPriorityFeeAttoEthPerGas = parseUnits(draft.priorityFeeInput, 9)
		if (securityMultiplierBps < MINIMUM_SECURITY_MULTIPLIER_BPS) throw new Error(copy.securityMultiplierTooLow)
		if (reportPriorityFeeAttoEthPerGas <= 0n) throw new Error(copy.priorityFeeRequired)
		if (reportPriorityFeeAttoEthPerGas > MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS) throw new Error(copy.priorityFeeAboveLimit)
		if (collateral.address === undefined) throw new Error(copy.collateralUnavailable)
		const minimumReportCollateral = securityPoolAmountOrUndefined(draft.reportFloor, collateral.decimals)
		if (minimumReportCollateral === undefined || minimumReportCollateral === 0n) throw new Error(copy.reportStakeRequired(collateral.decimals))
		origin = { collateralToken: collateral.address, minimumReportCollateral, universeId: originUniverse, securityMultiplierBps, reportPriorityFeeAttoEthPerGas }
		if (fixedQuestionError !== undefined) throw new Error(fixedQuestionError)
		economics = parseSecurityPoolCreationEconomics(draft.economicsDraft, collateral.decimals)
		if (!/^\d+$/.test(draft.horizonDays)) throw new Error(horizonInvalid)
		horizon = BigInt(draft.horizonDays) * 86400n
		if (horizon === 0n || horizon >= 1n << 48n) throw new Error(horizonInvalid)
	} catch (failure) {
		creationError = getErrorMessage(failure, creationInvalid)
	}
	return { collateral, approvedQuestions, fixedQuestionIds, fixedQuestionError, creationError, origin, economics, horizon }
}

/** Describes the immutable values captured by the deployment transaction. */
export function securityPoolDeploymentReviewDescription(mode: CuratedAdmissionMode, config: ReturnType<typeof parseSecurityPoolCreationEconomics>, collateral: Readonly<{ decimals: number; symbol: string }>, deployment: Readonly<{ origin: SecurityPoolOriginConfig; horizon: bigint; policy: Address }>) {
	const amount = (value: bigint) => `${formatUnits(value, collateral.decimals)} ${collateral.symbol}`
	const duration = (seconds: bigint) => {
		const days = copy.reviewDuration(formatUnits((seconds * 10_000n + 43_200n) / 86_400n, 4))
		return seconds % 86_400n === 0n ? days : copy.reviewDurationExact(days, seconds)
	}
	return [
		copy.reviewOrigin(deployment.origin.universeId, deployment.origin.collateralToken, deployment.policy),
		copy.reviewQuestionRules(mode, duration(deployment.horizon)),
		copy.reviewFees(formatUnits(config.annualFeeBps, 2), formatUnits(config.purchaseFeeBps, 2), amount(config.minimumPurchaseFeeAttoEth)),
		copy.reviewCommitment(amount(config.minimumCommitmentAttoEth), duration(config.rewardVestingSeconds)),
		copy.reviewBacking(formatUnits(deployment.origin.securityMultiplierBps, 2), `${formatUnits(config.minimumOutcomeRate, 18)} ${collateral.symbol}`),
		copy.reviewPriceReport(amount(deployment.origin.minimumReportCollateral), formatUnits(deployment.origin.reportPriorityFeeAttoEthPerGas, 9)),
	].join(' ')
}
