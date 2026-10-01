import { normalizeNumericInput } from '@zoltar/ui-core-shared/lib/numericInput.js'
import { bigintToSafeNumber, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import type { OpenOracleCreateFormState } from '../../../types/app.js'
import type { OpenOracleReportDetails, OpenOracleReportSummary } from '../../../types/contracts.js'
import { getWalletConnectionActiveAppChainGuardState } from '@zoltar/ui-core-shared/transactions/actionGuards.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { parseDecimalInput, tryParseDecimalInput } from '@zoltar/ui-core-shared/forms/decimal.js'
import { formatWriteErrorMessage, getErrorDetail } from '@zoltar/ui-core-shared/lib/errors.js'
import { formatAdditionalCurrencyBalance, formatAmountDisplay, formatDuration, formatMultiplier, formatScaledPercentage } from '@zoltar/ui-core-shared/lib/formatters.js'
import { getTimeRemaining } from '@zoltar/ui-core-shared/lib/time.js'
import { getOracleManagerPriceValidUntilTimestamp } from '../../../protocol/oracleTiming.js'
import { getOpenOracleDisputeSubmissionReserve, getOpenOracleDisputeSubmissionTimingGuard } from '../../../protocol/openOracleDisputeTiming.js'
import { parseAddressInput, tryParseAddressInput } from '@zoltar/ui-core-shared/forms/inputs.js'
import { parseBigIntInput, tryParseBigIntInput } from '@zoltar/ui-core-shared/forms/integerInput.js'
import type { TokenApprovalRequirement } from '@zoltar/ui-core-shared/transactions/tokenApproval.js'
import { addOpenOracleBountyBuffer } from '../../../protocol/openOracleMath.js'
import { getOpenOracleCreateParameterValidation } from '../../../protocol/openOracleValidation.js'
import * as openOracleCopy from '../../../copy/openOracle.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { getWethAddress } from '@zoltar/ui-zoltar-shared/protocol/uniswapQuoter.js'
const OPEN_ORACLE_DECIMAL_INPUT_PATTERN = /^-?(?:\d+\.?\d*|\.\d+)$/
type OpenOracleReportStatus = 'Pending' | 'Disputed' | 'Settled'
export type OpenOracleSelectedReportActionMode = 'dispute' | 'settle' | 'read-only'
export { addOpenOracleBountyBuffer }
export type OpenOracleDisputeInputField = 'disputeNewAmount1' | 'disputeNewAmount2' | 'disputeTokenToSwap'
export type OpenOracleGateMessage = {
	kind: 'hidden-loading' | 'visible'
	message: string
}
type OpenOracleReportActionAvailability = {
	canAct: boolean
	message: string | undefined
}
export type OpenOracleDisputeSubmissionDetails = {
	blockMessage: OpenOracleGateMessage | undefined
	canSubmit: boolean
	expectedNewAmount1: bigint | undefined
	inputFieldErrors: Partial<Record<OpenOracleDisputeInputField, string>>
	inputBlockMessage: OpenOracleGateMessage | undefined
	/** Highest allowed new base amount when flexible escalation lets the disputer choose it; undefined when the amount is exact. */
	maximumNewAmount1: bigint | undefined
	newAmount1: bigint | undefined
	newAmount2: bigint | undefined
	token1Approval: TokenApprovalRequirement
	token1ContributionAmount: bigint | undefined
	token1Decimals: number | undefined
	token2Approval: TokenApprovalRequirement
	token2ContributionAmount: bigint | undefined
	token2Decimals: number | undefined
}
export function formatOpenOracleSettleWriteErrorMessage(error: unknown, fallbackMessage = 'Failed to settle report') {
	const genericMessage = formatWriteErrorMessage(error, fallbackMessage)
	if (genericMessage === 'Action canceled in wallet.') return genericMessage
	const detail = getErrorDetail(error, fallbackMessage)
	const normalizedDetail = detail?.toLowerCase()
	if (normalizedDetail === undefined) return 'Transaction failed while settling the report. Try again; the latest report state will be checked automatically.'
	// Match only OpenOracle custom error names and their selectors.
	if (normalizedDetail.includes('invalidgaslimit') || normalizedDetail.includes('0x98bdb2e0')) return 'Settlement did not leave enough gas for this report’s settlement callback. Retry settling and keep the gas limit the wallet suggests; do not lower it.'
	if (normalizedDetail.includes('settletooearly') || normalizedDetail.includes('0x3edf6050')) return 'This report is not ready to settle.'
	if (normalizedDetail.includes('alreadysettled') || normalizedDetail.includes('0x560ff900')) return 'This report is already settled.'
	if (normalizedDetail.includes('noreportyet') || normalizedDetail.includes('0x15c7bbe9')) return 'This report is invalid because its atomic initial report is missing.'
	if (genericMessage === detail) return detail
	return `Transaction failed while settling the report. Reason: ${detail}`
}
export function formatOpenOracleDisputeWriteErrorMessage(error: unknown, fallbackMessage = 'Failed to dispute report') {
	const genericMessage = formatWriteErrorMessage(error, fallbackMessage)
	if (genericMessage === 'Action canceled in wallet.') return genericMessage
	const detail = getErrorDetail(error, fallbackMessage)
	const normalizedDetail = detail?.toLowerCase()
	if (normalizedDetail === undefined) return 'Transaction failed while disputing the report. Try again; the latest report state will be checked automatically.'
	if (genericMessage === detail) return detail
	if (normalizedDetail.includes('disputetooearly') || normalizedDetail.includes('dispute too early')) return 'This report is not ready to dispute.'
	if (normalizedDetail.includes('disputetoolate') || normalizedDetail.includes('dispute period expired')) return 'Dispute window closed. Settle report instead.'
	if (normalizedDetail.includes('alreadysettled') || normalizedDetail.includes('report settled')) return 'This report is already settled.'
	if (normalizedDetail.includes('noreporttodispute') || normalizedDetail.includes('no report to dispute')) return 'This report is invalid because its atomic initial report is missing.'
	return `Transaction failed while disputing the report. Reason: ${detail}`
}
export function getOpenOracleCreateGuardMessage({ ethValueInput, isOnActiveAppChain, settlerRewardInput, walletConnected, walletBalanceAttoEth }: { ethValueInput: string; isOnActiveAppChain: boolean; settlerRewardInput: string; walletConnected: boolean; walletBalanceAttoEth: bigint | undefined }) {
	const walletGuardState = getWalletConnectionActiveAppChainGuardState({
		isOnActiveAppChain,
		walletConnected,
		walletRequiredReason: commonCopy.formatConnectWalletBefore('creating a standalone OpenOracle report'),
	})
	if (walletGuardState.blocked) return walletGuardState.reason
	const ethValue = tryParseDecimalInput(ethValueInput)
	if (ethValue === undefined) return 'Enter a valid ETH value to send.'
	const settlerRewardAttoEth = tryParseDecimalInput(settlerRewardInput)
	if (settlerRewardAttoEth === undefined) return 'Enter a valid settler reward.'
	// Standalone reports are ERC-20 pairs, so the contract needs exactly the settler reward in ETH; the create validation enforces the same rule.
	if (ethValue !== settlerRewardAttoEth) return 'ETH value to send must equal the settler reward for ERC-20 token pairs.'
	if (walletBalanceAttoEth === undefined) return 'Loading wallet ETH balance.'
	if (ethValue > walletBalanceAttoEth) return `Need ${formatAdditionalCurrencyBalance(ethValue - walletBalanceAttoEth, 'ETH')} in this wallet to create the selected standalone OpenOracle report.`
	return undefined
}

function getOpenOracleCreateAddressValidationMessage(addressInput: string, role: 'base' | 'quote') {
	if (tryParseAddressInput(addressInput) !== undefined) return undefined
	return role === 'base' ? 'Enter a valid base token address.' : 'Enter a valid quote token address.'
}

export const OPEN_ORACLE_CREATE_FIELD_ORDER: ReadonlyArray<keyof OpenOracleCreateFormState> = ['token1Address', 'token2Address', 'exactToken1Report', 'initialToken2Amount', 'escalationHalt', 'ethValue', 'settlerRewardEthAmount', 'settlementTime', 'disputeDelay', 'multiplier', 'feePercentage', 'protocolFee']
export type OpenOracleCreateField = (typeof OPEN_ORACLE_CREATE_FIELD_ORDER)[number]
export type OpenOracleCreateContractFieldErrors = Partial<Record<'token1Address' | 'token2Address', string>>
type OpenOracleCreateValidation = {
	fieldErrors: Partial<Record<OpenOracleCreateField, string>>
	firstInvalidField: OpenOracleCreateField | undefined
	isValid: boolean
	message: string | undefined
}

function normalizeOpenOracleUnknownScaleDecimalInput(value: string) {
	const trimmed = normalizeNumericInput(value)
	if (trimmed === '') return trimmed
	if (trimmed === '.' || trimmed === '-.') return trimmed
	if (trimmed.startsWith('.')) return `0${trimmed}`
	if (trimmed.endsWith('.')) return `${trimmed}0`
	return trimmed
}

function isZeroOpenOracleDecimalInput(value: string) {
	return value
		.replace('-', '')
		.replace('.', '')
		.split('')
		.every(digit => digit === '0')
}

function getOpenOracleUnknownScaleDecimalValidationMessage({ allowZero = true, input, invalidMessage, negativeMessage, zeroMessage }: { allowZero?: boolean; input: string; invalidMessage: string; negativeMessage: string; zeroMessage?: string }) {
	const normalized = normalizeOpenOracleUnknownScaleDecimalInput(input)
	if (normalized === '' || !OPEN_ORACLE_DECIMAL_INPUT_PATTERN.test(normalized)) return invalidMessage
	if (normalized.startsWith('-')) return negativeMessage
	if (!allowZero && isZeroOpenOracleDecimalInput(normalized)) return zeroMessage ?? negativeMessage
	return undefined
}

function setOpenOracleCreateFieldError(fieldErrors: Partial<Record<OpenOracleCreateField, string>>, field: OpenOracleCreateField, message: string | undefined) {
	if (message === undefined || fieldErrors[field] !== undefined) return
	fieldErrors[field] = message
}

export function getOpenOracleCreateValidation({ form, token1Decimals, token2Decimals }: { form: OpenOracleCreateFormState; token1Decimals?: number; token2Decimals?: number }): OpenOracleCreateValidation {
	const fieldErrors: Partial<Record<OpenOracleCreateField, string>> = {}
	const token1AddressValidationMessage = getOpenOracleCreateAddressValidationMessage(form.token1Address, 'base')
	setOpenOracleCreateFieldError(fieldErrors, 'token1Address', token1AddressValidationMessage)
	const token1Address = token1AddressValidationMessage === undefined ? parseAddressInput(form.token1Address, 'Base token address') : undefined
	const token2AddressValidationMessage = getOpenOracleCreateAddressValidationMessage(form.token2Address, 'quote')
	setOpenOracleCreateFieldError(fieldErrors, 'token2Address', token2AddressValidationMessage)
	const token2Address = token2AddressValidationMessage === undefined ? parseAddressInput(form.token2Address, 'Quote token address') : undefined
	const exactToken1Report =
		token1Decimals === undefined
			? (() => {
					const validationMessage = getOpenOracleUnknownScaleDecimalValidationMessage({
						allowZero: false,
						input: form.exactToken1Report,
						invalidMessage: 'Enter a valid base token amount.',
						negativeMessage: 'Base token amount must be greater than zero.',
						zeroMessage: 'Base token amount must be greater than zero.',
					})
					setOpenOracleCreateFieldError(fieldErrors, 'exactToken1Report', validationMessage)
					if (validationMessage !== undefined) return undefined
					return 1n
				})()
			: tryParseDecimalInput(form.exactToken1Report, token1Decimals)
	if (token1Decimals !== undefined && exactToken1Report === undefined) setOpenOracleCreateFieldError(fieldErrors, 'exactToken1Report', 'Enter a valid base token amount.')
	const initialToken2Amount =
		token2Decimals === undefined
			? (() => {
					const validationMessage = getOpenOracleUnknownScaleDecimalValidationMessage({
						allowZero: false,
						input: form.initialToken2Amount,
						invalidMessage: 'Enter a valid quote token amount.',
						negativeMessage: 'Quote token amount must be greater than zero.',
						zeroMessage: 'Quote token amount must be greater than zero.',
					})
					setOpenOracleCreateFieldError(fieldErrors, 'initialToken2Amount', validationMessage)
					if (validationMessage !== undefined) return undefined
					return 1n
				})()
			: tryParseDecimalInput(form.initialToken2Amount, token2Decimals)
	if (token2Decimals !== undefined && initialToken2Amount === undefined) setOpenOracleCreateFieldError(fieldErrors, 'initialToken2Amount', 'Enter a valid quote token amount.')

	const escalationHalt =
		token1Decimals === undefined
			? (() => {
					const validationMessage = getOpenOracleUnknownScaleDecimalValidationMessage({
						input: form.escalationHalt,
						invalidMessage: 'Enter a valid escalation halt.',
						negativeMessage: 'Escalation halt must be non-negative.',
					})
					setOpenOracleCreateFieldError(fieldErrors, 'escalationHalt', validationMessage)
					if (validationMessage !== undefined) return undefined
					return 0n
				})()
			: tryParseDecimalInput(form.escalationHalt, token1Decimals)
	if (token1Decimals !== undefined && escalationHalt === undefined) setOpenOracleCreateFieldError(fieldErrors, 'escalationHalt', 'Enter a valid escalation halt.')

	const ethValue = tryParseDecimalInput(form.ethValue)
	if (ethValue === undefined) setOpenOracleCreateFieldError(fieldErrors, 'ethValue', 'Enter a valid ETH value to send.')
	const settlerRewardAttoEth = tryParseDecimalInput(form.settlerRewardEthAmount)
	if (settlerRewardAttoEth === undefined) setOpenOracleCreateFieldError(fieldErrors, 'settlerRewardEthAmount', 'Enter a valid settler reward.')

	const settlementTime = tryParseBigIntInput(form.settlementTime)
	if (settlementTime === undefined) setOpenOracleCreateFieldError(fieldErrors, 'settlementTime', 'Enter a valid settlement time.')
	const disputeDelay = tryParseBigIntInput(form.disputeDelay)
	if (disputeDelay === undefined) setOpenOracleCreateFieldError(fieldErrors, 'disputeDelay', 'Enter a valid dispute delay.')

	const multiplier = tryParseBigIntInput(form.multiplier)
	if (multiplier === undefined || multiplier < 0n) setOpenOracleCreateFieldError(fieldErrors, 'multiplier', 'Enter a valid multiplier.')

	const feePercentage = tryParseDecimalInput(form.feePercentage, 5)
	if (feePercentage === undefined) setOpenOracleCreateFieldError(fieldErrors, 'feePercentage', 'Enter a valid fee percentage.')
	const protocolFee = tryParseDecimalInput(form.protocolFee, 5)
	if (protocolFee === undefined) setOpenOracleCreateFieldError(fieldErrors, 'protocolFee', 'Enter a valid protocol fee.')

	if (
		token1Address !== undefined &&
		token2Address !== undefined &&
		exactToken1Report !== undefined &&
		initialToken2Amount !== undefined &&
		escalationHalt !== undefined &&
		ethValue !== undefined &&
		settlerRewardAttoEth !== undefined &&
		settlementTime !== undefined &&
		disputeDelay !== undefined &&
		multiplier !== undefined &&
		multiplier >= 0n &&
		feePercentage !== undefined &&
		protocolFee !== undefined
	) {
		const parameterValidation = getOpenOracleCreateParameterValidation(
			{
				disputeDelay,
				escalationHalt,
				exactToken1Report,
				initialToken2Amount,
				ethValueAttoEth: ethValue,
				feePercentage,
				multiplier,
				protocolFee,
				settlementTime,
				settlerRewardAttoEth,
				token1Address,
				token2Address,
			},
			{ skipToken1MagnitudeValidation: token1Decimals === undefined },
		)
		if (parameterValidation !== undefined) {
			if (parameterValidation.field === 'settlerRewardAttoEth') setOpenOracleCreateFieldError(fieldErrors, 'settlerRewardEthAmount', parameterValidation.message)
			else if (parameterValidation.field === 'ethValueAttoEth') setOpenOracleCreateFieldError(fieldErrors, 'ethValue', parameterValidation.message)
			else setOpenOracleCreateFieldError(fieldErrors, parameterValidation.field, parameterValidation.message)
		}
	}

	const firstInvalidField = OPEN_ORACLE_CREATE_FIELD_ORDER.find(field => fieldErrors[field] !== undefined)
	return {
		fieldErrors,
		firstInvalidField,
		isValid: firstInvalidField === undefined,
		message: firstInvalidField === undefined ? undefined : fieldErrors[firstInvalidField],
	}
}

export function getOpenOracleCreateValidationMessage(parameters: { form: OpenOracleCreateFormState; token1Decimals?: number; token2Decimals?: number }) {
	return getOpenOracleCreateValidation(parameters).message
}
export function getOpenOracleReportStatus(report: Pick<OpenOracleReportSummary, 'currentReporter' | 'disputeOccurred' | 'isDistributed' | 'reportTimestamp'>): OpenOracleReportStatus {
	if (report.reportTimestamp === 0n || report.currentReporter === zeroAddress) throw new Error('OpenOracle report is missing its atomic initial report')
	if (report.isDistributed) return 'Settled'
	if (report.disputeOccurred) return 'Disputed'
	return 'Pending'
}
export function getOpenOracleReportStatusTone(status: OpenOracleReportStatus): 'blocked' | 'danger' | 'muted' | 'ok' {
	switch (status) {
		case 'Pending':
			return 'muted'
		case 'Disputed':
			return 'danger'
		case 'Settled':
			return 'ok'
		default:
			return assertNever(status)
	}
}
export function getOpenOracleSelectedReportActionMode(report: Pick<OpenOracleReportDetails, 'currentBlockNumber' | 'currentReporter' | 'currentTime' | 'disputeDelay' | 'disputeOccurred' | 'isDistributed' | 'reportTimestamp' | 'settlementTime' | 'timeType'>): OpenOracleSelectedReportActionMode {
	const status = getOpenOracleReportStatus(report)
	switch (status) {
		case 'Settled':
			return 'read-only'
		case 'Pending':
		case 'Disputed': {
			const disputeAvailability = getOpenOracleDisputeAvailability(report)
			const settleAvailability = getOpenOracleSettleAvailability(report)
			if (!disputeAvailability.canAct && settleAvailability.canAct) return 'settle'
			return 'dispute'
		}
		default:
			return assertNever(status)
	}
}
function hasOpenOracleAtomicInitialReport(report: Pick<OpenOracleReportDetails, 'currentReporter' | 'reportTimestamp'>) {
	return report.reportTimestamp !== 0n && report.currentReporter !== zeroAddress
}
function getOpenOracleLifecycleClockValue(report: Pick<OpenOracleReportDetails, 'currentBlockNumber' | 'currentTime' | 'timeType'>) {
	return report.timeType ? report.currentTime : report.currentBlockNumber
}
function formatOpenOracleLifecycleRemaining(remaining: bigint, timeType: boolean) {
	if (timeType) return formatDuration(remaining)
	return `${remaining.toString()} block${remaining === 1n ? '' : 's'}`
}
export function getOpenOracleDisputeAvailability(report: Pick<OpenOracleReportDetails, 'currentBlockNumber' | 'currentReporter' | 'currentTime' | 'disputeDelay' | 'isDistributed' | 'reportTimestamp' | 'settlementTime' | 'timeType'>): OpenOracleReportActionAvailability {
	if (!hasOpenOracleAtomicInitialReport(report))
		return {
			canAct: false,
			message: 'This report is invalid because its atomic initial report is missing.',
		}
	if (report.isDistributed)
		return {
			canAct: false,
			message: 'This report is already settled.',
		}
	const currentClock = getOpenOracleLifecycleClockValue(report)
	const disputeStart = report.reportTimestamp + report.disputeDelay
	const settlementStart = report.reportTimestamp + report.settlementTime
	if (currentClock < disputeStart)
		return {
			canAct: false,
			message: 'This report is not ready to dispute.',
		}
	if (currentClock >= settlementStart)
		return {
			canAct: false,
			message: 'Dispute window closed. Settle report instead.',
		}
	const submissionGuard = getOpenOracleDisputeSubmissionTimingGuard({ ...report, currentClock })
	if (submissionGuard !== undefined) return { canAct: false, message: submissionGuard }
	return {
		canAct: true,
		message: undefined,
	}
}
export function getOpenOracleLiveReportDetails<TReport extends Pick<OpenOracleReportDetails, 'currentTime' | 'timeType'>>(report: TReport, elapsedSeconds: bigint): TReport {
	if (!report.timeType || elapsedSeconds <= 0n) return report
	return { ...report, currentTime: report.currentTime + elapsedSeconds }
}
// Seconds after the report was read at which dispute or settlement availability changes; block-based reports have no wall-clock boundaries.
export function getOpenOracleLifecycleBoundaryOffsets(report: Pick<OpenOracleReportDetails, 'currentReporter' | 'currentTime' | 'disputeDelay' | 'isDistributed' | 'reportTimestamp' | 'settlementTime' | 'timeType'>) {
	if (!report.timeType || report.isDistributed || !hasOpenOracleAtomicInitialReport(report)) return []
	const settlementStart = report.reportTimestamp + report.settlementTime
	return [...new Set([report.reportTimestamp + report.disputeDelay, settlementStart - getOpenOracleDisputeSubmissionReserve(report.timeType), settlementStart])]
		.sort((left, right) => {
			if (left < right) return -1
			if (left > right) return 1
			return 0
		})
		.filter(boundary => boundary > report.currentTime)
		.map(boundary => boundary - report.currentTime)
}
export function getOpenOracleSettleAvailability(report: Pick<OpenOracleReportDetails, 'currentBlockNumber' | 'currentReporter' | 'currentTime' | 'isDistributed' | 'reportTimestamp' | 'settlementTime' | 'timeType'>): OpenOracleReportActionAvailability {
	if (!hasOpenOracleAtomicInitialReport(report))
		return {
			canAct: false,
			message: 'This report is invalid because its atomic initial report is missing.',
		}
	if (report.isDistributed)
		return {
			canAct: false,
			message: 'This report is already settled.',
		}
	const currentClock = getOpenOracleLifecycleClockValue(report)
	const settlementStart = report.reportTimestamp + report.settlementTime
	if (currentClock < settlementStart) {
		const remaining = settlementStart - currentClock
		return {
			canAct: false,
			message: `This report can be settled in ${formatOpenOracleLifecycleRemaining(remaining, report.timeType)} if no disputes occur.`,
		}
	}
	return {
		canAct: true,
		message: undefined,
	}
}

export function formatOpenOracleFeePercentage(feePercentage: bigint | undefined) {
	if (feePercentage === undefined) return '—'
	return formatScaledPercentage(feePercentage, 5)
}
function parseOpenOracleFeePercentageInput(value: string, label: string) {
	const trimmed = value.trim()
	if (trimmed === '') throw new Error(`${label} is required`)
	const parsed = tryParseDecimalInput(trimmed, 5)
	if (parsed === undefined) throw new Error(`${label} must be a decimal percentage`)
	if (parsed < 0n) throw new Error(`${label} must be non-negative`)
	if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label} exceeds the maximum safe integer range`)
	return bigintToSafeNumber(parsed, label)
}
export function parseOpenOracleCreateFormSubmission({ form, token1Decimals, token2Decimals }: { form: OpenOracleCreateFormState; token1Decimals: number; token2Decimals: number }) {
	const validationMessage = getOpenOracleCreateValidationMessage({ form, token1Decimals, token2Decimals })
	if (validationMessage !== undefined) throw new Error(validationMessage)
	return {
		disputeDelay: bigintToSafeNumber(parseBigIntInput(form.disputeDelay, 'Dispute delay'), 'Dispute delay'),
		escalationHalt: parseDecimalInput(form.escalationHalt, 'Escalation halt', token1Decimals),
		exactToken1Report: parseDecimalInput(form.exactToken1Report, 'Base token amount', token1Decimals),
		initialToken2Amount: parseDecimalInput(form.initialToken2Amount, 'Quote token amount', token2Decimals),
		ethValueAttoEth: parseDecimalInput(form.ethValue, 'ETH value'),
		feePercentage: parseOpenOracleFeePercentageInput(form.feePercentage, 'Fee percentage'),
		multiplier: bigintToSafeNumber(parseBigIntInput(form.multiplier, 'Multiplier'), 'Multiplier'),
		protocolFee: parseOpenOracleFeePercentageInput(form.protocolFee, 'Protocol fee'),
		settlementTime: bigintToSafeNumber(parseBigIntInput(form.settlementTime, 'Settlement time'), 'Settlement time'),
		settlerRewardAttoEth: parseDecimalInput(form.settlerRewardEthAmount, 'Settler reward'),
		token1Address: parseAddressInput(form.token1Address, 'Base token address'),
		token2Address: parseAddressInput(form.token2Address, 'Quote token address'),
	}
}
export function formatOpenOracleMultiplier(multiplier: bigint | undefined) {
	if (multiplier === undefined) return '—'
	return formatMultiplier(multiplier, 2)
}

/** Price directions name the deployment's canonical WETH as ETH so pool-coordinator reports read REP per ETH like the rest of Statoblast. */
function getOpenOraclePriceTokenLabel(tokenAddress: string, tokenSymbol: string) {
	return sameAddress(tokenAddress, getWethAddress()) ? commonCopy.eth : tokenSymbol
}

export function formatOpenOracleReportPriceUnit(report: Pick<OpenOracleReportSummary, 'token1' | 'token1Symbol' | 'token2' | 'token2Symbol'>) {
	return openOracleCopy.formatReportPriceUnit(getOpenOraclePriceTokenLabel(report.token1, report.token1Symbol), getOpenOraclePriceTokenLabel(report.token2, report.token2Symbol))
}

export function getOracleLastPriceDisplay({ lastPrice, lastSettlementTimestamp }: { lastPrice: bigint; lastSettlementTimestamp: bigint }) {
	if (lastSettlementTimestamp === 0n) return commonCopy.metricUnavailablePlaceholder
	return `${formatAmountDisplay(lastPrice)}\u00a0REP per ETH`
}

export function getOraclePriceValidityPresentation({ currentTimestamp, lastSettlementTimestamp, priceValidUntilTimestamp }: { currentTimestamp: bigint; lastSettlementTimestamp: bigint; priceValidUntilTimestamp: bigint | undefined }) {
	if (lastSettlementTimestamp === 0n) return undefined
	const validUntilTimestamp = priceValidUntilTimestamp ?? getOracleManagerPriceValidUntilTimestamp(lastSettlementTimestamp)
	if (validUntilTimestamp === undefined) return undefined
	const timeRemaining = getTimeRemaining(validUntilTimestamp, currentTimestamp)
	if (timeRemaining === undefined) return undefined
	if (timeRemaining === 0n) {
		const expiredFor = currentTimestamp > validUntilTimestamp ? currentTimestamp - validUntilTimestamp : 0n
		return { text: `(expired ${expiredFor === 0n ? 'less than a minute' : formatDuration(expiredFor)} ago)`, tone: 'danger' as const }
	}
	return { text: `(Valid for ${formatDuration(timeRemaining)})`, tone: 'success' as const }
}
