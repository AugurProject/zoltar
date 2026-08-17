import { bigintToSafeNumber, zeroAddress, type Address } from '@zoltar/shared/ethereum'
import type { OpenOracleCreateFormState } from '../../../types/app.js'
import type { OpenOracleReportDetails, OpenOracleReportSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { getWalletConnectionActiveAppChainGuardState } from '@zoltar/ui-core-shared/lib/actionGuards.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { parseDecimalInput, tryParseDecimalInput } from '@zoltar/ui-core-shared/lib/decimal.js'
import { formatWriteErrorMessage, getErrorDetail, sanitizeErrorDetail } from '@zoltar/ui-core-shared/lib/errors.js'
import { formatCurrencyBalance, formatCurrencyInputBalance, formatDuration } from '@zoltar/ui-core-shared/lib/formatters.js'
import { parseAddressInput, tryParseAddressInput } from '@zoltar/ui-core-shared/lib/inputs.js'
import { parseBigIntInput, tryParseBigIntInput } from '@zoltar/ui-core-shared/lib/integerInput.js'
import { deriveTokenApprovalRequirement, formatTokenApprovalUnavailableMessage, type TokenApprovalRequirement } from '@zoltar/ui-core-shared/lib/tokenApproval.js'
import { addOpenOracleBountyBuffer, getOpenOracleDisputeSwapTokenKey } from '../../../protocol/openOracleMath.js'
import { getOpenOracleCreateParameterValidation, OPEN_ORACLE_MULTIPLIER_PRECISION, OPEN_ORACLE_PERCENTAGE_PRECISION } from '../../../protocol/openOracleValidation.js'
const OPEN_ORACLE_DECIMAL_INPUT_PATTERN = /^-?(?:\d+\.?\d*|\.\d+)$/
type OpenOracleReportStatus = 'Pending' | 'Disputed' | 'Settled'
export type OpenOracleSelectedReportActionMode = 'dispute' | 'settle' | 'read-only'
export { addOpenOracleBountyBuffer }
export type OpenOracleDisputeInputField = 'disputeNewAmount1' | 'disputeNewAmount2' | 'disputeTokenToSwap'
type OpenOracleGateMessage = {
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
	if (genericMessage === detail) return detail
	if (normalizedDetail.includes('0x98bdb2e0') || normalizedDetail.includes('invalidgaslimit') || normalizedDetail.includes('invalid gas limit')) return 'This report requires a higher settlement gas limit because it executes a callback on settlement. Retry with the updated UI.'
	if (normalizedDetail.includes('settletooearly') || normalizedDetail.includes('settlement')) return 'This report is not ready to settle.'
	if (normalizedDetail.includes('alreadysettled') || normalizedDetail.includes('report settled')) return 'This report is already settled.'
	if (normalizedDetail.includes('noreportyet') || normalizedDetail.includes('no initial report')) return 'This report is invalid because its atomic initial report is missing.'
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
		walletRequiredReason: 'Connect a wallet before creating a standalone Open Oracle report.',
	})
	if (walletGuardState.blocked) return walletGuardState.reason
	const ethValue = tryParseDecimalInput(ethValueInput)
	if (ethValue === undefined) return 'Enter a valid ETH value to send.'
	const settlerRewardAttoEth = tryParseDecimalInput(settlerRewardInput)
	if (settlerRewardAttoEth === undefined) return 'Enter a valid settler reward.'
	if (ethValue < settlerRewardAttoEth) return 'ETH value to send must be at least the settler reward.'
	if (walletBalanceAttoEth === undefined) return 'Loading wallet ETH balance.'
	if (ethValue > walletBalanceAttoEth) return `Need ${formatCurrencyBalance(ethValue - walletBalanceAttoEth)} more ETH in this wallet to create the selected standalone Open Oracle report.`
	return undefined
}

function getOpenOracleCreateAddressValidationMessage(addressInput: string, role: 'base' | 'quote') {
	if (tryParseAddressInput(addressInput) !== undefined) return undefined
	return role === 'base' ? 'Enter a valid base token address.' : 'Enter a valid quote token address.'
}

export const OPEN_ORACLE_CREATE_FIELD_ORDER: ReadonlyArray<keyof OpenOracleCreateFormState> = ['token1Address', 'token2Address', 'exactToken1Report', 'initialToken2Amount', 'escalationHalt', 'ethValue', 'settlerRewardEthAmount', 'settlementTime', 'disputeDelay', 'multiplier', 'feePercentage', 'protocolFee']
export type OpenOracleCreateField = (typeof OPEN_ORACLE_CREATE_FIELD_ORDER)[number]
export type OpenOracleCreateContractFieldErrors = Partial<Record<'token1Address' | 'token2Address', string>>
export type OpenOracleCreateValidation = {
	fieldErrors: Partial<Record<OpenOracleCreateField, string>>
	firstInvalidField: OpenOracleCreateField | undefined
	isValid: boolean
	message: string | undefined
}

function normalizeOpenOracleUnknownScaleDecimalInput(value: string) {
	const trimmed = value.trim()
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
function createHiddenLoadingGateMessage(message: string): OpenOracleGateMessage {
	return { kind: 'hidden-loading', message }
}
function createVisibleGateMessage(message: string): OpenOracleGateMessage {
	return { kind: 'visible', message }
}
export function getOpenOracleReportStatus(report: Pick<OpenOracleReportSummary, 'currentReporter' | 'disputeOccurred' | 'isDistributed' | 'reportTimestamp'>): OpenOracleReportStatus {
	if (report.reportTimestamp === 0n || report.currentReporter === zeroAddress) throw new Error('Open Oracle report is missing its atomic initial report')
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
	return {
		canAct: true,
		message: undefined,
	}
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

function formatGroupedInteger(value: bigint) {
	return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function formatScaledBigInt(value: bigint, scale: bigint, minimumFractionDigits = 0, groupInteger = false) {
	const isNegative = value < 0n
	const absoluteValue = isNegative ? -value : value
	const integerPart = absoluteValue / scale
	const fractionPart = absoluteValue % scale
	const scaleDigits = scale.toString().length - 1
	let fractionText = fractionPart.toString().padStart(scaleDigits, '0').replace(/0+$/, '')
	while (fractionText.length < minimumFractionDigits) {
		fractionText += '0'
	}

	const integerText = groupInteger ? formatGroupedInteger(integerPart) : integerPart.toString()
	return `${isNegative ? '-' : ''}${integerText}${fractionText === '' ? '' : `.${fractionText}`}`
}

export function formatOpenOracleFeePercentage(feePercentage: bigint | undefined) {
	if (feePercentage === undefined) return '—'
	return `${formatScaledBigInt(feePercentage, 100_000n, 0, true)}%`
}
export function formatOpenOracleFeePercentageInput(feePercentage: bigint) {
	return formatScaledBigInt(feePercentage, 100_000n)
}
export function parseOpenOracleFeePercentageInput(value: string, label: string) {
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
	return `${formatScaledBigInt(multiplier, 100n, 2)}x`
}
function resolveOpenOracleTokenLabel({ fallbackLabel, tokenAddress, tokenSymbol }: { fallbackLabel: string; tokenAddress: string | undefined; tokenSymbol: string | undefined }) {
	const resolvedSymbol = tokenSymbol?.trim()
	if (resolvedSymbol !== undefined && resolvedSymbol !== '') return resolvedSymbol
	const resolvedAddress = tokenAddress?.trim()
	if (resolvedAddress !== undefined && resolvedAddress !== '') return resolvedAddress
	return fallbackLabel
}
function formatOpenOracleDisputeApprovalStatusUnavailableMessage({ reason, tokenLabel }: { reason: string | undefined; tokenLabel: string | undefined }) {
	return formatTokenApprovalUnavailableMessage({
		actionLabel: 'disputing the report',
		reason,
		tokenLabel,
	})
}
function formatOpenOracleDisputeBalanceStatusUnavailableMessage({ reason, tokenLabel }: { reason: string | undefined; tokenLabel: string | undefined }) {
	const resolvedTokenLabel = tokenLabel?.trim() || 'token'
	const segments = [`Unable to verify ${resolvedTokenLabel} balance for this dispute.`]
	const sanitizedReason = sanitizeErrorDetail(reason)
	if (sanitizedReason !== undefined) segments.push(`Reason: ${sanitizedReason}.`)
	segments.push('Retry loading the report or balance status before disputing this report.')
	return segments.join(' ')
}
function formatOpenOracleDisputeInsufficientBalanceMessage({ available, required, tokenDecimals, tokenLabel }: { available: bigint; required: bigint; tokenDecimals: number | undefined; tokenLabel: string }) {
	return `Insufficient ${tokenLabel} balance for this dispute. Need ${formatCurrencyBalance(required, tokenDecimals ?? 18)}, wallet has ${formatCurrencyBalance(available, tokenDecimals ?? 18)}.`
}
function resolveOpenOracleDisputeToken1Contribution({ feePercentage, isSelfDispute, oldAmount1, protocolFee, requiredToken1Contribution, tokenToSwap }: { feePercentage: bigint; isSelfDispute: boolean; oldAmount1: bigint; protocolFee: bigint; requiredToken1Contribution: bigint; tokenToSwap: 'token1' | 'token2' }) {
	if (tokenToSwap === 'token1') {
		const protocolFeeAmountAttoEth = (oldAmount1 * protocolFee) / OPEN_ORACLE_PERCENTAGE_PRECISION
		if (isSelfDispute) return requiredToken1Contribution - oldAmount1 + protocolFeeAmountAttoEth
		const fee = (oldAmount1 * feePercentage) / OPEN_ORACLE_PERCENTAGE_PRECISION
		return requiredToken1Contribution + oldAmount1 + fee + protocolFeeAmountAttoEth
	}
	return requiredToken1Contribution > oldAmount1 ? requiredToken1Contribution - oldAmount1 : 0n
}
function resolveOpenOracleDisputeToken2Contribution({ feePercentage, isSelfDispute, newAmount2, oldAmount2, protocolFee, tokenToSwap }: { feePercentage: bigint; isSelfDispute: boolean; newAmount2: bigint; oldAmount2: bigint; protocolFee: bigint; tokenToSwap: 'token1' | 'token2' }) {
	if (tokenToSwap === 'token1') {
		return newAmount2 >= oldAmount2 ? newAmount2 - oldAmount2 : 0n
	}
	const protocolFeeAmountAttoEth = (oldAmount2 * protocolFee) / OPEN_ORACLE_PERCENTAGE_PRECISION
	if (isSelfDispute) {
		const token2Needed = newAmount2 + protocolFeeAmountAttoEth
		return token2Needed >= oldAmount2 ? token2Needed - oldAmount2 : 0n
	}
	const fee = (oldAmount2 * feePercentage) / OPEN_ORACLE_PERCENTAGE_PRECISION
	return newAmount2 + oldAmount2 + fee + protocolFeeAmountAttoEth
}
export function deriveOpenOracleDisputeSubmissionDetails({
	accountAddress,
	approvedToken1Amount,
	approvedToken2Amount,
	disputeNewAmount1Input,
	disputeNewAmount2Input,
	disputeTokenToSwap,
	reportDetails,
	token1AllowanceError,
	token1Balance,
	token1BalanceError,
	token1Decimals,
	token2AllowanceError,
	token2Balance,
	token2BalanceError,
	token2Decimals,
}: {
	accountAddress?: Address | undefined
	approvedToken1Amount: bigint | undefined
	approvedToken2Amount: bigint | undefined
	disputeNewAmount1Input: string
	disputeNewAmount2Input: string
	disputeTokenToSwap: 'token1' | 'token2'
	reportDetails:
		| Pick<
				OpenOracleReportDetails,
				'currentAmount1' | 'currentAmount2' | 'currentBlockNumber' | 'currentReporter' | 'currentTime' | 'disputeDelay' | 'escalationHalt' | 'feePercentage' | 'isDistributed' | 'multiplier' | 'protocolFee' | 'reportTimestamp' | 'settlementTime' | 'timeType' | 'token1' | 'token1Symbol' | 'token2' | 'token2Symbol'
		  >
		| undefined
	token1AllowanceError: string | undefined
	token1Balance: bigint | undefined
	token1BalanceError: string | undefined
	token1Decimals: number | undefined
	token2AllowanceError: string | undefined
	token2Balance: bigint | undefined
	token2BalanceError: string | undefined
	token2Decimals: number | undefined
}): OpenOracleDisputeSubmissionDetails {
	const token1Label = resolveOpenOracleTokenLabel({
		fallbackLabel: 'Token1',
		tokenAddress: reportDetails?.token1,
		tokenSymbol: reportDetails?.token1Symbol,
	})
	const token2Label = resolveOpenOracleTokenLabel({
		fallbackLabel: 'Token2',
		tokenAddress: reportDetails?.token2,
		tokenSymbol: reportDetails?.token2Symbol,
	})
	let expectedNewAmount1: bigint | undefined
	let newAmount1: bigint | undefined
	let newAmount2: bigint | undefined
	if (reportDetails !== undefined)
		expectedNewAmount1 =
			reportDetails.escalationHalt > reportDetails.currentAmount1
				? (() => {
						const multiplied = (reportDetails.currentAmount1 * reportDetails.multiplier) / OPEN_ORACLE_MULTIPLIER_PRECISION
						return multiplied > reportDetails.escalationHalt ? reportDetails.escalationHalt : multiplied
					})()
				: reportDetails.currentAmount1 + 1n
	newAmount1 = token1Decimals === undefined ? undefined : tryParseDecimalInput(disputeNewAmount1Input, token1Decimals)
	newAmount2 = token2Decimals === undefined ? undefined : tryParseDecimalInput(disputeNewAmount2Input, token2Decimals)
	const isSelfDispute = accountAddress !== undefined && reportDetails !== undefined && sameAddress(accountAddress, reportDetails.currentReporter)
	const token1ContributionAmount =
		reportDetails === undefined || newAmount2 === undefined || expectedNewAmount1 === undefined
			? undefined
			: resolveOpenOracleDisputeToken1Contribution({
					feePercentage: reportDetails.feePercentage,
					isSelfDispute,
					oldAmount1: reportDetails.currentAmount1,
					protocolFee: reportDetails.protocolFee,
					requiredToken1Contribution: expectedNewAmount1,
					tokenToSwap: disputeTokenToSwap,
				})
	const token2ContributionAmount =
		reportDetails === undefined || newAmount2 === undefined
			? undefined
			: resolveOpenOracleDisputeToken2Contribution({
					feePercentage: reportDetails.feePercentage,
					isSelfDispute,
					newAmount2,
					oldAmount2: reportDetails.currentAmount2,
					protocolFee: reportDetails.protocolFee,
					tokenToSwap: disputeTokenToSwap,
				})
	const token1Approval = deriveTokenApprovalRequirement(token1ContributionAmount, approvedToken1Amount)
	const token2Approval = deriveTokenApprovalRequirement(token2ContributionAmount, approvedToken2Amount)
	let blockMessage: OpenOracleGateMessage | undefined
	const inputFieldErrors: Partial<Record<OpenOracleDisputeInputField, string>> = {}
	let inputBlockMessage: OpenOracleGateMessage | undefined
	const setInputBlockMessage = (message: OpenOracleGateMessage, field?: OpenOracleDisputeInputField) => {
		inputBlockMessage = message
		blockMessage = message
		if (field !== undefined) inputFieldErrors[field] = message.message
	}
	if (reportDetails === undefined) {
		setInputBlockMessage(createVisibleGateMessage('Select a report first'))
	} else {
		const disputeAvailability = getOpenOracleDisputeAvailability(reportDetails)
		if (!disputeAvailability.canAct) {
			setInputBlockMessage(createVisibleGateMessage(disputeAvailability.message ?? 'This report is not ready to dispute.'))
		} else if (token1Decimals === undefined) {
			setInputBlockMessage(createHiddenLoadingGateMessage(`Loading ${token1Label} decimal metadata.`))
		} else if (token2Decimals === undefined) {
			setInputBlockMessage(createHiddenLoadingGateMessage(`Loading ${token2Label} decimal metadata.`))
		} else if (newAmount1 === undefined) {
			setInputBlockMessage(createVisibleGateMessage('Enter a valid new base token amount.'), 'disputeNewAmount1')
		} else if (newAmount2 === undefined || newAmount2 <= 0n) {
			setInputBlockMessage(createVisibleGateMessage('Enter a valid new quote token amount greater than zero.'), 'disputeNewAmount2')
		} else if (expectedNewAmount1 === undefined) {
			setInputBlockMessage(createVisibleGateMessage('Unable to determine the required new base token amount.'))
		} else if (newAmount1 !== expectedNewAmount1) {
			setInputBlockMessage(createVisibleGateMessage(`New base token amount must be exactly ${formatCurrencyInputBalance(expectedNewAmount1, token1Decimals)} for this dispute.`), 'disputeNewAmount1')
		} else {
			const expectedSwapToken = getOpenOracleDisputeSwapTokenKey({
				currentAmount1: reportDetails.currentAmount1,
				currentAmount2: reportDetails.currentAmount2,
				newAmount1,
				newAmount2,
			})
			if (expectedSwapToken !== disputeTokenToSwap) {
				const expectedTokenLabel = expectedSwapToken === 'token1' ? token1Label : token2Label
				const selectedTokenLabel = disputeTokenToSwap === 'token1' ? token1Label : token2Label
				setInputBlockMessage(createVisibleGateMessage(`These amounts would swap out ${expectedTokenLabel}, not ${selectedTokenLabel}. Select ${expectedTokenLabel} or change the proposed price.`), 'disputeTokenToSwap')
			}
		}
		if (inputBlockMessage === undefined) {
			if (approvedToken1Amount === undefined && token1AllowanceError !== undefined) {
				blockMessage = createVisibleGateMessage(
					formatOpenOracleDisputeApprovalStatusUnavailableMessage({
						reason: token1AllowanceError,
						tokenLabel: token1Label,
					}),
				)
			} else if (approvedToken2Amount === undefined && token2AllowanceError !== undefined) {
				blockMessage = createVisibleGateMessage(
					formatOpenOracleDisputeApprovalStatusUnavailableMessage({
						reason: token2AllowanceError,
						tokenLabel: token2Label,
					}),
				)
			} else if (token1Balance === undefined && token1BalanceError !== undefined) {
				blockMessage = createVisibleGateMessage(
					formatOpenOracleDisputeBalanceStatusUnavailableMessage({
						reason: token1BalanceError,
						tokenLabel: token1Label,
					}),
				)
			} else if (token2Balance === undefined && token2BalanceError !== undefined) {
				blockMessage = createVisibleGateMessage(
					formatOpenOracleDisputeBalanceStatusUnavailableMessage({
						reason: token2BalanceError,
						tokenLabel: token2Label,
					}),
				)
			} else if (token1Balance === undefined) {
				blockMessage = createHiddenLoadingGateMessage(`Loading current ${token1Label} balance.`)
			} else if (token2Balance === undefined) {
				blockMessage = createHiddenLoadingGateMessage(`Loading current ${token2Label} balance.`)
			} else if (token1ContributionAmount !== undefined && token1Balance < token1ContributionAmount) {
				blockMessage = createVisibleGateMessage(
					formatOpenOracleDisputeInsufficientBalanceMessage({
						available: token1Balance,
						required: token1ContributionAmount,
						tokenDecimals: token1Decimals,
						tokenLabel: token1Label,
					}),
				)
			} else if (token2ContributionAmount !== undefined && token2Balance < token2ContributionAmount) {
				blockMessage = createVisibleGateMessage(
					formatOpenOracleDisputeInsufficientBalanceMessage({
						available: token2Balance,
						required: token2ContributionAmount,
						tokenDecimals: token2Decimals,
						tokenLabel: token2Label,
					}),
				)
			} else if (approvedToken1Amount === undefined) {
				blockMessage = createHiddenLoadingGateMessage(`Loading current ${token1Label} approval.`)
			} else if (approvedToken2Amount === undefined) {
				blockMessage = createHiddenLoadingGateMessage(`Loading current ${token2Label} approval.`)
			} else if (!token1Approval.hasSufficientApproval) {
				blockMessage = createVisibleGateMessage(`${token1Label} approval required`)
			} else if (!token2Approval.hasSufficientApproval) blockMessage = createVisibleGateMessage(`${token2Label} approval required`)
		}
	}
	return {
		blockMessage,
		canSubmit: blockMessage === undefined,
		expectedNewAmount1,
		inputFieldErrors,
		inputBlockMessage,
		newAmount1,
		newAmount2,
		token1Approval,
		token1ContributionAmount,
		token1Decimals,
		token2Approval,
		token2ContributionAmount,
		token2Decimals,
	}
}
