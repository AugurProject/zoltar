import { zeroAddress, type Address } from '@zoltar/shared/ethereum'
import type { OpenOracleCreateFormState } from '../../../types/app.js'
import type { OpenOracleReportDetails, OpenOracleReportSummary } from '../../../types/contracts.js'
import { getWalletConnectionMainnetGuardState } from '../../../lib/actionGuards.js'
import { sameAddress } from '../../../lib/address.js'
import { assertNever } from '../../../lib/assert.js'
import { parseDecimalInput, tryParseDecimalInput } from '../../../lib/decimal.js'
import { formatWriteErrorMessage, getErrorDetail, sanitizeErrorDetail } from '../../../lib/errors.js'
import { formatCurrencyBalance, formatDuration } from '../../../lib/formatters.js'
import { parseAddressInput, tryParseAddressInput } from '../../../lib/inputs.js'
import { parseBigIntInput, tryParseBigIntInput } from '../../markets/lib/marketForm.js'
import { deriveTokenApprovalRequirement, formatTokenApprovalUnavailableMessage, type TokenApprovalRequirement } from '../../../lib/tokenApproval.js'
import { addOpenOracleBountyBuffer } from '../../../protocol/openOracleMath.js'
import { getOpenOracleCreateParameterValidationMessage, OPEN_ORACLE_MULTIPLIER_PRECISION, OPEN_ORACLE_PERCENTAGE_PRECISION } from '../../../protocol/openOracleValidation.js'
const OPEN_ORACLE_DECIMAL_INPUT_PATTERN = /^-?(?:\d+\.?\d*|\.\d+)$/
type OpenOracleReportStatus = 'Pending' | 'Disputed' | 'Settled'
export type OpenOracleSelectedReportActionMode = 'dispute' | 'settle' | 'read-only'
export { addOpenOracleBountyBuffer }
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
	if (normalizedDetail === undefined) return 'Transaction failed while settling the report. Reload the report and try again.'
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
	if (normalizedDetail === undefined) return 'Transaction failed while disputing the report. Reload the report and try again.'
	if (genericMessage === detail) return detail
	if (normalizedDetail.includes('disputetooearly') || normalizedDetail.includes('dispute too early')) return 'This report is not ready to dispute.'
	if (normalizedDetail.includes('disputetoolate') || normalizedDetail.includes('dispute period expired')) return 'Dispute window closed. Settle Report instead.'
	if (normalizedDetail.includes('alreadysettled') || normalizedDetail.includes('report settled')) return 'This report is already settled.'
	if (normalizedDetail.includes('noreporttodispute') || normalizedDetail.includes('no report to dispute')) return 'This report is invalid because its atomic initial report is missing.'
	return `Transaction failed while disputing the report. Reason: ${detail}`
}
export function getOpenOracleCreateGuardMessage({ ethValueInput, isMainnet, settlerRewardInput, walletConnected, walletEthBalance }: { ethValueInput: string; isMainnet: boolean; settlerRewardInput: string; walletConnected: boolean; walletEthBalance: bigint | undefined }) {
	const walletGuardState = getWalletConnectionMainnetGuardState({
		isMainnet,
		walletConnected,
		walletRequiredReason: 'Connect a wallet before creating a standalone Open Oracle report.',
	})
	if (walletGuardState.blocked) return walletGuardState.reason
	const ethValue = tryParseDecimalInput(ethValueInput)
	if (ethValue === undefined) return 'Enter a valid ETH value to send.'
	const settlerReward = tryParseDecimalInput(settlerRewardInput)
	if (settlerReward === undefined) return 'Enter a valid settler reward.'
	if (ethValue < settlerReward) return 'ETH value to send must be at least the settler reward.'
	if (walletEthBalance === undefined) return 'Loading wallet ETH balance.'
	if (ethValue > walletEthBalance) return `Need ${formatCurrencyBalance(ethValue - walletEthBalance)} more ETH in this wallet to create the selected standalone Open Oracle report.`
	return undefined
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

export function getOpenOracleCreateValidationMessage({ form, token1Decimals, token2Decimals }: { form: OpenOracleCreateFormState; token1Decimals?: number; token2Decimals?: number }) {
	const token1Address = tryParseAddressInput(form.token1Address)
	if (token1Address === undefined) return 'Enter a valid base token address.'
	const token2Address = tryParseAddressInput(form.token2Address)
	if (token2Address === undefined) return 'Enter a valid quote token address.'
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
					if (validationMessage !== undefined) return validationMessage
					return 1n
				})()
			: tryParseDecimalInput(form.exactToken1Report, token1Decimals)
	if (typeof exactToken1Report === 'string') return exactToken1Report
	if (exactToken1Report === undefined) return 'Enter a valid base token amount.'
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
					if (validationMessage !== undefined) return validationMessage
					return 1n
				})()
			: tryParseDecimalInput(form.initialToken2Amount, token2Decimals)
	if (typeof initialToken2Amount === 'string') return initialToken2Amount
	if (initialToken2Amount === undefined) return 'Enter a valid quote token amount.'

	const escalationHalt =
		token1Decimals === undefined
			? (() => {
					const validationMessage = getOpenOracleUnknownScaleDecimalValidationMessage({
						input: form.escalationHalt,
						invalidMessage: 'Enter a valid escalation halt.',
						negativeMessage: 'Escalation halt must be non-negative.',
					})
					if (validationMessage !== undefined) return validationMessage
					return 0n
				})()
			: tryParseDecimalInput(form.escalationHalt, token1Decimals)
	if (typeof escalationHalt === 'string') return escalationHalt
	if (escalationHalt === undefined) return 'Enter a valid escalation halt.'

	const ethValue = tryParseDecimalInput(form.ethValue)
	if (ethValue === undefined) return 'Enter a valid ETH value to send.'
	const settlerReward = tryParseDecimalInput(form.settlerReward)
	if (settlerReward === undefined) return 'Enter a valid settler reward.'

	const settlementTime = tryParseBigIntInput(form.settlementTime)
	if (settlementTime === undefined) return 'Enter a valid settlement time.'
	const disputeDelay = tryParseBigIntInput(form.disputeDelay)
	if (disputeDelay === undefined) return 'Enter a valid dispute delay.'

	const multiplier = tryParseBigIntInput(form.multiplier)
	if (multiplier === undefined || multiplier < 0n) return 'Enter a valid multiplier.'

	const feePercentage = tryParseDecimalInput(form.feePercentage, 5)
	if (feePercentage === undefined) return 'Enter a valid fee percentage.'
	const protocolFee = tryParseDecimalInput(form.protocolFee, 5)
	if (protocolFee === undefined) return 'Enter a valid protocol fee.'

	return getOpenOracleCreateParameterValidationMessage(
		{
			disputeDelay,
			escalationHalt,
			exactToken1Report,
			initialToken2Amount,
			ethValue,
			feePercentage,
			multiplier,
			protocolFee,
			settlementTime,
			settlerReward,
			token1Address,
			token2Address,
		},
		{ skipToken1MagnitudeValidation: token1Decimals === undefined },
	)
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
			message: 'Dispute window closed. Settle Report instead.',
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
	return Number(parsed)
}
export function parseOpenOracleCreateFormSubmission({ form, token1Decimals, token2Decimals }: { form: OpenOracleCreateFormState; token1Decimals: number; token2Decimals: number }) {
	const validationMessage = getOpenOracleCreateValidationMessage({ form, token1Decimals, token2Decimals })
	if (validationMessage !== undefined) throw new Error(validationMessage)
	return {
		disputeDelay: Number(parseBigIntInput(form.disputeDelay, 'Dispute delay')),
		escalationHalt: parseDecimalInput(form.escalationHalt, 'Escalation halt', token1Decimals),
		exactToken1Report: parseDecimalInput(form.exactToken1Report, 'Base token amount', token1Decimals),
		initialToken2Amount: parseDecimalInput(form.initialToken2Amount, 'Quote token amount', token2Decimals),
		ethValue: parseDecimalInput(form.ethValue, 'ETH value'),
		feePercentage: parseOpenOracleFeePercentageInput(form.feePercentage, 'Fee percentage'),
		multiplier: Number(parseBigIntInput(form.multiplier, 'Multiplier')),
		protocolFee: parseOpenOracleFeePercentageInput(form.protocolFee, 'Protocol fee'),
		settlementTime: Number(parseBigIntInput(form.settlementTime, 'Settlement time')),
		settlerReward: parseDecimalInput(form.settlerReward, 'Settler reward'),
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
		const protocolFeeAmount = (oldAmount1 * protocolFee) / OPEN_ORACLE_PERCENTAGE_PRECISION
		if (isSelfDispute) return requiredToken1Contribution - oldAmount1 + protocolFeeAmount
		const fee = (oldAmount1 * feePercentage) / OPEN_ORACLE_PERCENTAGE_PRECISION
		return requiredToken1Contribution + oldAmount1 + fee + protocolFeeAmount
	}
	return requiredToken1Contribution > oldAmount1 ? requiredToken1Contribution - oldAmount1 : 0n
}
function resolveOpenOracleDisputeToken2Contribution({ feePercentage, isSelfDispute, newAmount2, oldAmount2, protocolFee, tokenToSwap }: { feePercentage: bigint; isSelfDispute: boolean; newAmount2: bigint; oldAmount2: bigint; protocolFee: bigint; tokenToSwap: 'token1' | 'token2' }) {
	if (tokenToSwap === 'token1') {
		return newAmount2 >= oldAmount2 ? newAmount2 - oldAmount2 : 0n
	}
	const protocolFeeAmount = (oldAmount2 * protocolFee) / OPEN_ORACLE_PERCENTAGE_PRECISION
	if (isSelfDispute) {
		const token2Needed = newAmount2 + protocolFeeAmount
		return token2Needed >= oldAmount2 ? token2Needed - oldAmount2 : 0n
	}
	const fee = (oldAmount2 * feePercentage) / OPEN_ORACLE_PERCENTAGE_PRECISION
	return newAmount2 + oldAmount2 + fee + protocolFeeAmount
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
	newAmount1 = tryParseBigIntInput(disputeNewAmount1Input)
	newAmount2 = tryParseBigIntInput(disputeNewAmount2Input)
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
	if (reportDetails === undefined) {
		blockMessage = createVisibleGateMessage('Load a report first')
	} else {
		const disputeAvailability = getOpenOracleDisputeAvailability(reportDetails)
		if (!disputeAvailability.canAct) {
			blockMessage = createVisibleGateMessage(disputeAvailability.message ?? 'This report is not ready to dispute.')
		} else if (newAmount1 === undefined) {
			blockMessage = createVisibleGateMessage('Enter a valid new base token amount.')
		} else if (newAmount2 === undefined || newAmount2 <= 0n) {
			blockMessage = createVisibleGateMessage('Enter a valid new quote token amount greater than zero.')
		} else if (expectedNewAmount1 === undefined) {
			blockMessage = createVisibleGateMessage('Unable to determine the required new base token amount.')
		} else if (newAmount1 !== expectedNewAmount1) {
			blockMessage = createVisibleGateMessage(`New base token amount must be exactly ${expectedNewAmount1.toString()} for this dispute.`)
		} else if (approvedToken1Amount === undefined && token1AllowanceError !== undefined) {
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
	return {
		blockMessage,
		canSubmit: blockMessage === undefined,
		expectedNewAmount1,
		token1Approval,
		token1ContributionAmount,
		token1Decimals,
		token2Approval,
		token2ContributionAmount,
		token2Decimals,
	}
}
