import { normalizeNumericInput } from '@zoltar/ui-core-shared/lib/numericInput.js'
import { bigintToSafeNumber, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import type { OpenOracleCreateFormState } from '../../../types/app.js'
import type { OpenOracleReportDetails, OpenOracleReportSummary } from '../../../types/contracts.js'
import { getWalletConnectionActiveAppChainGuardState } from '@zoltar/ui-core-shared/transactions/actionGuards.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import type { BadgeTone } from '@zoltar/ui-core-shared/types/components.js'
import { parseDecimalInput, tryParseDecimalInput } from '@zoltar/ui-core-shared/forms/decimal.js'
import { ensureSentence, formatWriteErrorMessage, getErrorDetail, transactionErrorMessages } from '@zoltar/ui-core-shared/lib/errors.js'
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
import * as statoblastAppCopy from '../../../copy/app.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { getWethAddress } from '@zoltar/ui-zoltar-shared/protocol/uniswapQuoter.js'
const OPEN_ORACLE_DECIMAL_INPUT_PATTERN = /^-?(?:\d+\.?\d*|\.\d+)$/
type OpenOracleReportStatus = 'Pending' | 'Disputed' | 'Settled'
export type OpenOracleSelectedReportActionMode = 'dispute' | 'settle' | 'read-only'
export { addOpenOracleBountyBuffer }
export type OpenOracleDisputeInputField = 'disputeNewAmount1' | 'disputeNewAmount2'
export type OpenOracleGateMessage = { kind: 'hidden-loading' | 'visible'; message: string } | { kind: 'incomplete'; message?: undefined }
type OpenOracleReportActionAvailability = {
	canAct: boolean
	message: string | undefined
}
export type OpenOracleDisputeSubmissionDetails = {
	blockMessage: OpenOracleGateMessage | undefined
	canSubmit: boolean
	/** Fee paid to the current reporter in the swapped token; zero for a self-dispute or before fees apply. */
	disputeFeeAmount: bigint | undefined
	expectedNewAmount1: bigint | undefined
	inputFieldErrors: Partial<Record<OpenOracleDisputeInputField, string>>
	inputBlockMessage: OpenOracleGateMessage | undefined
	/** Highest allowed new base amount when flexible escalation lets the disputer choose it; undefined when the amount is exact. */
	maximumNewAmount1: bigint | undefined
	newAmount1: bigint | undefined
	newAmount2: bigint | undefined
	/** Price the dispute proposes, in quote tokens per base token scaled by 10^30. */
	proposedPrice: bigint | undefined
	protocolFeeAmount: bigint | undefined
	/** The token the dispute swaps out, which the proposed price direction determines. */
	swapTokenKey: 'token1' | 'token2' | undefined
	/** Quote tokens credited to the disputer's oracle balance when the new quote amount is below the current one. */
	token2CreditAmount: bigint | undefined
	token1Approval: TokenApprovalRequirement
	token1ContributionAmount: bigint | undefined
	token1Decimals: number | undefined
	token2Approval: TokenApprovalRequirement
	token2ContributionAmount: bigint | undefined
	token2Decimals: number | undefined
}
export function formatOpenOracleSettleWriteErrorMessage(error: unknown, fallbackMessage = 'Failed to settle report') {
	const genericMessage = formatWriteErrorMessage(error, fallbackMessage)
	if (genericMessage === transactionErrorMessages.walletRejected) return genericMessage
	const detail = getErrorDetail(error, fallbackMessage)
	if (detail === undefined) return 'Transaction failed while settling the report. Try again; the latest report state will be checked automatically.'
	const normalizedDetail = detail.toLowerCase()
	// Match only OpenOracle custom error names and their selectors.
	if (normalizedDetail.includes('invalidgaslimit') || normalizedDetail.includes('0x98bdb2e0')) return 'Settlement did not leave enough gas for this report’s settlement callback. Retry settling and keep the gas limit the wallet suggests; do not lower it.'
	if (normalizedDetail.includes('settletooearly') || normalizedDetail.includes('0x3edf6050')) return 'This report is not ready to settle.'
	if (normalizedDetail.includes('alreadysettled') || normalizedDetail.includes('0x560ff900')) return 'This report is already settled.'
	if (normalizedDetail.includes('noreportyet') || normalizedDetail.includes('0x15c7bbe9')) return 'This report is invalid because its initial report is missing.'
	if (genericMessage === ensureSentence(detail)) return genericMessage
	return `Transaction failed while settling the report. Reason: ${ensureSentence(detail)}`
}
export function formatOpenOracleDisputeWriteErrorMessage(error: unknown, fallbackMessage = 'Failed to dispute report') {
	const genericMessage = formatWriteErrorMessage(error, fallbackMessage)
	if (genericMessage === transactionErrorMessages.walletRejected) return genericMessage
	const detail = getErrorDetail(error, fallbackMessage)
	if (detail === undefined) return 'Transaction failed while disputing the report. Try again; the latest report state will be checked automatically.'
	const normalizedDetail = detail.toLowerCase()
	if (genericMessage === ensureSentence(detail)) return genericMessage
	if (normalizedDetail.includes('disputetooearly') || normalizedDetail.includes('dispute too early')) return 'This report is not ready to dispute.'
	if (normalizedDetail.includes('disputetoolate') || normalizedDetail.includes('dispute period expired')) return 'Dispute window closed. Settle report instead.'
	if (normalizedDetail.includes('alreadysettled') || normalizedDetail.includes('report settled')) return 'This report is already settled.'
	if (normalizedDetail.includes('noreporttodispute') || normalizedDetail.includes('no report to dispute')) return 'This report is invalid because its initial report is missing.'
	return `Transaction failed while disputing the report. Reason: ${ensureSentence(detail)}`
}
export function getOpenOracleCreateGuardMessage({ isOnActiveAppChain, settlerRewardInput, walletConnected, walletBalanceAttoEth }: { isOnActiveAppChain: boolean; settlerRewardInput: string; walletConnected: boolean; walletBalanceAttoEth: bigint | undefined }) {
	const walletGuardState = getWalletConnectionActiveAppChainGuardState({
		isOnActiveAppChain,
		walletConnected,
		walletRequiredReason: commonCopy.formatConnectWalletBefore('creating a standalone OpenOracle report'),
	})
	if (walletGuardState.blocked) return walletGuardState.reason
	// Standalone reports are ERC-20 pairs, so the transaction sends exactly the settler reward in ETH.
	const ethSentAttoEth = getOpenOracleCreateEthSent(settlerRewardInput)
	if (ethSentAttoEth === undefined) return 'Enter a valid settler reward.'
	if (walletBalanceAttoEth === undefined) return statoblastAppCopy.loadingWalletEthBalance
	if (ethSentAttoEth > walletBalanceAttoEth) return `Need ${formatAdditionalCurrencyBalance(ethSentAttoEth - walletBalanceAttoEth, 'ETH')} in this wallet to create the selected standalone OpenOracle report.`
	return undefined
}

/** ERC-20 report creation sends exactly the settler reward, so the ETH sent is derived instead of entered separately. */
export function getOpenOracleCreateEthSent(settlerRewardInput: string) {
	return tryParseDecimalInput(settlerRewardInput)
}

function getOpenOracleCreateAddressValidationMessage(addressInput: string, role: 'base' | 'quote') {
	if (tryParseAddressInput(addressInput) !== undefined) return undefined
	return role === 'base' ? 'Enter a valid base token address.' : 'Enter a valid quote token address.'
}

/** The ETH sent is derived from the settler reward, so it is not an editable field. */
export type OpenOracleCreateField = Exclude<keyof OpenOracleCreateFormState, 'ethValue'>
export const OPEN_ORACLE_CREATE_FIELD_ORDER: readonly OpenOracleCreateField[] = ['token1Address', 'token2Address', 'exactToken1Report', 'initialToken2Amount', 'escalationHalt', 'settlerRewardEthAmount', 'settlementTime', 'disputeDelay', 'multiplier', 'feePercentage', 'protocolFee']
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

function getOpenOracleUnknownScaleDecimalValidationMessage({ allowZero = true, input, invalidMessage, negativeMessage, zeroMessage }: { allowZero?: boolean; input: string; invalidMessage: string; negativeMessage: string | undefined; zeroMessage?: string }) {
	const normalized = normalizeOpenOracleUnknownScaleDecimalInput(input)
	if (normalized === '' || !OPEN_ORACLE_DECIMAL_INPUT_PATTERN.test(normalized)) return invalidMessage
	if (normalized.startsWith('-')) return negativeMessage
	if (!allowZero && isZeroOpenOracleDecimalInput(normalized)) return zeroMessage ?? negativeMessage
	return undefined
}

/** The contract stores the escalation multiplier scaled by 100, so the form takes a decimal multiplier such as 1.5. */
const OPEN_ORACLE_MULTIPLIER_DECIMALS = 2
function parseOpenOracleMultiplierInput(value: string) {
	return tryParseDecimalInput(value, OPEN_ORACLE_MULTIPLIER_DECIMALS)
}

function setOpenOracleCreateFieldError(fieldErrors: Partial<Record<OpenOracleCreateField, string>>, field: OpenOracleCreateField, message: string | undefined) {
	if (message === undefined || fieldErrors[field] !== undefined) return
	fieldErrors[field] = message
}

export function getOpenOracleCreateValidation({ form, token1Decimals, token2Decimals }: { form: OpenOracleCreateFormState; token1Decimals?: number | undefined; token2Decimals?: number | undefined }): OpenOracleCreateValidation {
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
						negativeMessage: undefined,
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
						negativeMessage: undefined,
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

	const settlerRewardAttoEth = tryParseDecimalInput(form.settlerRewardEthAmount)
	const ethValue = getOpenOracleCreateEthSent(form.settlerRewardEthAmount)
	if (settlerRewardAttoEth === undefined) setOpenOracleCreateFieldError(fieldErrors, 'settlerRewardEthAmount', 'Enter a valid settler reward.')

	const settlementTime = tryParseBigIntInput(form.settlementTime)
	if (settlementTime === undefined) setOpenOracleCreateFieldError(fieldErrors, 'settlementTime', 'Enter a valid settlement delay.')
	const disputeDelay = tryParseBigIntInput(form.disputeDelay)
	if (disputeDelay === undefined) setOpenOracleCreateFieldError(fieldErrors, 'disputeDelay', 'Enter a valid dispute delay.')

	const multiplier = parseOpenOracleMultiplierInput(form.multiplier)
	if (multiplier === undefined || multiplier < 0n) setOpenOracleCreateFieldError(fieldErrors, 'multiplier', 'Enter a valid multiplier, such as 1.5.')

	const feePercentage = tryParseDecimalInput(form.feePercentage, 5)
	if (feePercentage === undefined) setOpenOracleCreateFieldError(fieldErrors, 'feePercentage', 'Enter a valid dispute fee.')
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
			if (parameterValidation.field === 'settlerRewardAttoEth' || parameterValidation.field === 'ethValueAttoEth') setOpenOracleCreateFieldError(fieldErrors, 'settlerRewardEthAmount', parameterValidation.message)
			else setOpenOracleCreateFieldError(fieldErrors, parameterValidation.field, parameterValidation.message)
		}
	}

	const positiveAmountInvalid = (input: string) => {
		const normalized = normalizeOpenOracleUnknownScaleDecimalInput(input)
		return normalized !== '' && OPEN_ORACLE_DECIMAL_INPUT_PATTERN.test(normalized) && (normalized.startsWith('-') || isZeroOpenOracleDecimalInput(normalized))
	}
	const firstInvalidField = OPEN_ORACLE_CREATE_FIELD_ORDER.find(field => fieldErrors[field] !== undefined || (field === 'exactToken1Report' && positiveAmountInvalid(form.exactToken1Report)) || (field === 'initialToken2Amount' && positiveAmountInvalid(form.initialToken2Amount)))
	return {
		fieldErrors,
		firstInvalidField,
		isValid: firstInvalidField === undefined,
		message: firstInvalidField === undefined ? undefined : fieldErrors[firstInvalidField],
	}
}

function getOpenOracleReportStatus(report: Pick<OpenOracleReportSummary, 'currentReporter' | 'disputeOccurred' | 'isDistributed' | 'reportTimestamp'>): OpenOracleReportStatus {
	if (report.reportTimestamp === 0n || report.currentReporter === zeroAddress) throw new Error('OpenOracle report is missing its initial report.')
	if (report.isDistributed) return 'Settled'
	if (report.disputeOccurred) return 'Disputed'
	return 'Pending'
}
/**
 * Lifecycle progress shown in report badges and the browse filter. It combines the stored report state with the
 * current clock, so a report past its settlement time reads as ready to settle instead of pending. `pending` and an
 * untimed `disputed` remain only for cached summaries saved before their timing was recorded.
 */
export type OpenOracleReportProgress = 'awaiting-dispute-window' | 'dispute-window-open' | 'disputed' | 'ready-to-settle' | 'settled' | 'pending'
export const OPEN_ORACLE_REPORT_PROGRESS_ORDER: readonly OpenOracleReportProgress[] = ['awaiting-dispute-window', 'dispute-window-open', 'disputed', 'ready-to-settle', 'settled']
type OpenOracleReportProgressReport = Pick<OpenOracleReportSummary, 'currentReporter' | 'disputeOccurred' | 'isDistributed' | 'reportTimestamp' | 'timeType'> & { disputeDelay?: bigint | undefined; settlementTime?: bigint | undefined }
export function getOpenOracleReportProgress(report: OpenOracleReportProgressReport, clock: { currentBlockNumber?: bigint | undefined; currentTime?: bigint | undefined }): OpenOracleReportProgress {
	const status = getOpenOracleReportStatus(report)
	if (status === 'Settled') return 'settled'
	const currentClock = report.timeType ? clock.currentTime : clock.currentBlockNumber
	if (currentClock === undefined || report.settlementTime === undefined) return status === 'Disputed' ? 'disputed' : 'pending'
	if (currentClock >= report.reportTimestamp + report.settlementTime) return 'ready-to-settle'
	if (report.disputeOccurred) return 'disputed'
	if (report.disputeDelay !== undefined && currentClock < report.reportTimestamp + report.disputeDelay) return 'awaiting-dispute-window'
	return 'dispute-window-open'
}
export function getOpenOracleReportProgressLabel(progress: OpenOracleReportProgress) {
	switch (progress) {
		case 'awaiting-dispute-window':
			return openOracleCopy.awaitingDisputeWindow
		case 'dispute-window-open':
			return openOracleCopy.disputeWindowOpen
		case 'disputed':
			return openOracleCopy.disputed
		case 'ready-to-settle':
			return openOracleCopy.readyToSettle
		case 'settled':
			return commonCopy.settled
		case 'pending':
			return commonCopy.pending
		default:
			return assertNever(progress)
	}
}
/** A dispute is a normal step in the report lifecycle, so it reads as a caution rather than a failure. */
export function getOpenOracleReportProgressTone(progress: OpenOracleReportProgress): BadgeTone {
	switch (progress) {
		case 'awaiting-dispute-window':
		case 'pending':
			return 'muted'
		case 'dispute-window-open':
			return 'pending'
		case 'disputed':
			return 'warning'
		case 'ready-to-settle':
		case 'settled':
			return 'ok'
		default:
			return assertNever(progress)
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
			message: 'This report is invalid because its initial report is missing.',
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
			message: 'This report is invalid because its initial report is missing.',
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
	const validation = getOpenOracleCreateValidation({ form, token1Decimals, token2Decimals })
	if (!validation.isValid) throw new Error(validation.message ?? 'Invalid oracle report parameters.')
	return {
		disputeDelay: bigintToSafeNumber(parseBigIntInput(form.disputeDelay, 'Dispute delay'), 'Dispute delay'),
		escalationHalt: parseDecimalInput(form.escalationHalt, 'Escalation halt', token1Decimals),
		exactToken1Report: parseDecimalInput(form.exactToken1Report, 'Base token amount', token1Decimals),
		initialToken2Amount: parseDecimalInput(form.initialToken2Amount, 'Quote token amount', token2Decimals),
		ethValueAttoEth: parseDecimalInput(form.settlerRewardEthAmount, 'Settler reward'),
		feePercentage: parseOpenOracleFeePercentageInput(form.feePercentage, 'Dispute fee'),
		multiplier: bigintToSafeNumber(parseDecimalInput(form.multiplier, 'Multiplier', OPEN_ORACLE_MULTIPLIER_DECIMALS), 'Multiplier'),
		protocolFee: parseOpenOracleFeePercentageInput(form.protocolFee, 'Protocol fee'),
		settlementTime: bigintToSafeNumber(parseBigIntInput(form.settlementTime, 'Settlement delay'), 'Settlement delay'),
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
	return { text: `(valid for ${formatDuration(timeRemaining)})`, tone: 'success' as const }
}

/** Report timing values are seconds for time-based reports and blocks otherwise. */
export function formatOpenOracleTimingDuration(value: bigint, timeType: boolean) {
	if (!timeType) return openOracleCopy.formatTimingValue(value.toString(), openOracleCopy.blocks)
	if (value < 60n) return openOracleCopy.formatTimingValue(value.toString(), openOracleCopy.secondsAbbreviation)
	return formatDuration(value)
}

/** Hint for a seconds input, such as `86400 s = 1d 0h 0m`, so typed durations stay readable. */
export function formatOpenOracleSecondsInputHint(input: string) {
	const seconds = tryParseBigIntInput(input)
	if (seconds === undefined || seconds < 0n) return undefined
	return openOracleCopy.formatSecondsDurationHint(seconds.toString(), formatOpenOracleTimingDuration(seconds, true))
}

const OPEN_ORACLE_HUMAN_PRICE_PARSE_DECIMALS = 36
const OPEN_ORACLE_PRICE_DECIMALS = 30n
/** Implied price of the entered report amounts, in quote tokens per base token scaled by 10^30 like stored report prices. */
export function getOpenOracleImpliedPrice({ token1Amount, token2Amount }: { token1Amount: string; token2Amount: string }) {
	const amount1 = tryParseDecimalInput(token1Amount, OPEN_ORACLE_HUMAN_PRICE_PARSE_DECIMALS)
	const amount2 = tryParseDecimalInput(token2Amount, OPEN_ORACLE_HUMAN_PRICE_PARSE_DECIMALS)
	if (amount1 === undefined || amount2 === undefined || amount1 <= 0n || amount2 <= 0n) return undefined
	return (amount2 * 10n ** OPEN_ORACLE_PRICE_DECIMALS) / amount1
}

/**
 * Rounds a fixed-point price to a few significant digits for an editable input. The whole-number part is never rounded,
 * and the fraction keeps enough digits to show `significantDigits` meaningful figures for small prices.
 */
export function formatOpenOraclePriceInput(value: bigint, decimals: number, significantDigits = 6) {
	if (value <= 0n) return '0'
	const base = 10n ** BigInt(decimals)
	const whole = value / base
	const wholeDigits = whole === 0n ? 0 : whole.toString().length
	const fractionDigits = (() => {
		if (whole > 0n) return Math.max(0, significantDigits - wholeDigits)
		const fraction = (value % base).toString().padStart(decimals, '0')
		const leadingZeros = fraction.length - fraction.replace(/^0+/, '').length
		return leadingZeros + significantDigits
	})()
	const keptDigits = Math.min(fractionDigits, decimals)
	const scale = 10n ** BigInt(decimals - keptDigits)
	const rounded = (value + scale / 2n) / scale
	const roundedBase = 10n ** BigInt(keptDigits)
	const roundedWhole = rounded / roundedBase
	const roundedFraction = keptDigits === 0 ? '' : (rounded % roundedBase).toString().padStart(keptDigits, '0').replace(/0+$/, '')
	return roundedFraction === '' ? roundedWhole.toString() : `${roundedWhole.toString()}.${roundedFraction}`
}
