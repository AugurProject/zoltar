import { type Address } from '@zoltar/core-shared/evm/ethereum'
import type { OpenOracleReportDetails } from '../../../types/contracts.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { tryParseDecimalInput } from '@zoltar/ui-core-shared/forms/decimal.js'
import { ensureSentence, sanitizeErrorDetail } from '@zoltar/ui-core-shared/lib/errors.js'
import { formatCurrencyBalance, formatCurrencyInputBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { deriveTokenApprovalRequirement, formatTokenApprovalUnavailableMessage } from '@zoltar/ui-core-shared/transactions/tokenApproval.js'
import { getOpenOracleDisputeSwapTokenKey } from '../../../protocol/openOracleMath.js'
import { calculateOpenOraclePrice } from '../../../protocol/openOracle.js'
import * as openOracleCopy from '../../../copy/openOracle.js'
import { OPEN_ORACLE_MULTIPLIER_PRECISION, OPEN_ORACLE_PERCENTAGE_PRECISION } from '../../../protocol/openOracleValidation.js'
import { getOpenOracleDisputeAvailability, type OpenOracleDisputeInputField, type OpenOracleDisputeSubmissionDetails, type OpenOracleGateMessage } from './openOracle.js'

function createHiddenLoadingGateMessage(message: string): OpenOracleGateMessage {
	return { kind: 'hidden-loading', message }
}
function createVisibleGateMessage(message: string): OpenOracleGateMessage {
	return { kind: 'visible', message }
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
	if (sanitizedReason !== undefined) segments.push(`Reason: ${ensureSentence(sanitizedReason)}`)
	segments.push('Retry loading the report or balance status before disputing this report.')
	return segments.join(' ')
}
function formatOpenOracleDisputeInsufficientBalanceMessage({ available, required, tokenDecimals, tokenLabel }: { available: bigint; required: bigint; tokenDecimals: number | undefined; tokenLabel: string }) {
	return `Insufficient ${tokenLabel} balance for this dispute. Need ${formatCurrencyBalance(required, tokenDecimals ?? 18)}, wallet has ${formatCurrencyBalance(available, tokenDecimals ?? 18)}.`
}
// Mirrors OpenOracle.dispute fee and contribution math; chargeFees is false before the halt when FLAG_FEES_ONLY_AT_HALT is set.
function getOpenOracleDisputeFees(oldAmount: bigint, { chargeFees, feePercentage, protocolFee }: { chargeFees: boolean; feePercentage: bigint; protocolFee: bigint }) {
	if (!chargeFees) return { fee: 0n, protocolFeeAmount: 0n }
	return { fee: (oldAmount * feePercentage) / OPEN_ORACLE_PERCENTAGE_PRECISION, protocolFeeAmount: (oldAmount * protocolFee) / OPEN_ORACLE_PERCENTAGE_PRECISION }
}
type OpenOracleDisputeContributionParameters = { chargeFees: boolean; feePercentage: bigint; isSelfDispute: boolean; newAmount1: bigint; newAmount2: bigint; oldAmount1: bigint; oldAmount2: bigint; protocolFee: bigint; tokenToSwap: 'token1' | 'token2' }
/** Token amounts the disputer pays, the fees inside them, and the quote tokens credited back to the disputer's oracle balance. */
function resolveOpenOracleDisputeFlows({ chargeFees, feePercentage, isSelfDispute, newAmount1, newAmount2, oldAmount1, oldAmount2, protocolFee, tokenToSwap }: OpenOracleDisputeContributionParameters) {
	if (tokenToSwap === 'token1') {
		const { fee, protocolFeeAmount } = getOpenOracleDisputeFees(oldAmount1, { chargeFees, feePercentage, protocolFee })
		return {
			disputeFeeAmount: isSelfDispute ? 0n : fee,
			protocolFeeAmount,
			token1Contribution: isSelfDispute ? newAmount1 - oldAmount1 + protocolFeeAmount : newAmount1 + oldAmount1 + fee + protocolFeeAmount,
			token2Contribution: newAmount2 >= oldAmount2 ? newAmount2 - oldAmount2 : 0n,
			token2Credit: newAmount2 < oldAmount2 ? oldAmount2 - newAmount2 : 0n,
		}
	}
	const { fee, protocolFeeAmount } = getOpenOracleDisputeFees(oldAmount2, { chargeFees, feePercentage, protocolFee })
	const token1Contribution = newAmount1 > oldAmount1 ? newAmount1 - oldAmount1 : 0n
	if (isSelfDispute) {
		const token2Needed = newAmount2 + protocolFeeAmount
		return {
			disputeFeeAmount: 0n,
			protocolFeeAmount,
			token1Contribution,
			token2Contribution: token2Needed >= oldAmount2 ? token2Needed - oldAmount2 : 0n,
			token2Credit: token2Needed < oldAmount2 ? oldAmount2 - token2Needed : 0n,
		}
	}
	return { disputeFeeAmount: fee, protocolFeeAmount, token1Contribution, token2Contribution: newAmount2 + oldAmount2 + fee + protocolFeeAmount, token2Credit: 0n }
}
function isOpenOracleDisputeAmount1Allowed(report: Pick<OpenOracleReportDetails, 'escalationHalt' | 'flexibleEscalation'>, expectedNewAmount1: bigint, newAmount1: bigint) {
	if (newAmount1 === expectedNewAmount1) return true
	return report.flexibleEscalation && newAmount1 >= expectedNewAmount1 && newAmount1 <= report.escalationHalt
}
/** The base amount the next dispute must post: the escalated amount until the halt, then one unit more than the current amount. */
function getOpenOracleExpectedDisputeAmount1(report: Pick<OpenOracleReportDetails, 'currentAmount1' | 'escalationHalt' | 'multiplier'>) {
	if (report.escalationHalt <= report.currentAmount1) return report.currentAmount1 + 1n
	const multiplied = (report.currentAmount1 * report.multiplier) / OPEN_ORACLE_MULTIPLIER_PRECISION
	return multiplied > report.escalationHalt ? report.escalationHalt : multiplied
}
/** Highest base amount a flexible-escalation dispute may post; undefined when the amount is exact. */
function getOpenOracleMaximumDisputeAmount1(report: Pick<OpenOracleReportDetails, 'currentAmount1' | 'escalationHalt' | 'flexibleEscalation' | 'multiplier'>) {
	return report.flexibleEscalation && report.escalationHalt > getOpenOracleExpectedDisputeAmount1(report) ? report.escalationHalt : undefined
}
/** Dispute inputs for a freshly loaded report state: the base amount starts at the required amount and the disputer enters the quote amount. */
export function getOpenOracleDisputeFormDefaults(report: Pick<OpenOracleReportDetails, 'currentAmount1' | 'escalationHalt' | 'multiplier' | 'token1Decimals'>) {
	return { disputeNewAmount1: formatCurrencyInputBalance(getOpenOracleExpectedDisputeAmount1(report), report.token1Decimals), disputeNewAmount2: '' }
}
export function deriveOpenOracleDisputeSubmissionDetails({
	accountAddress,
	approvedToken1Amount,
	approvedToken2Amount,
	disputeNewAmount1Input,
	disputeNewAmount2Input,
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
	reportDetails:
		| Pick<
				OpenOracleReportDetails,
				| 'currentAmount1'
				| 'currentAmount2'
				| 'currentBlockNumber'
				| 'currentReporter'
				| 'currentTime'
				| 'disputeDelay'
				| 'escalationHalt'
				| 'feePercentage'
				| 'feesOnlyAtHalt'
				| 'flexibleEscalation'
				| 'isDistributed'
				| 'multiplier'
				| 'protocolFee'
				| 'reportTimestamp'
				| 'settlementTime'
				| 'timeType'
				| 'token1'
				| 'token1Symbol'
				| 'token2'
				| 'token2Symbol'
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
	const expectedNewAmount1 = reportDetails === undefined ? undefined : getOpenOracleExpectedDisputeAmount1(reportDetails)
	const maximumNewAmount1 = reportDetails === undefined ? undefined : getOpenOracleMaximumDisputeAmount1(reportDetails)
	// Without a flexible range the report fixes the base amount, so only flexible escalation reads it from the input.
	const enteredNewAmount1 = token1Decimals === undefined ? undefined : tryParseDecimalInput(disputeNewAmount1Input, token1Decimals)
	const newAmount1 = maximumNewAmount1 === undefined ? expectedNewAmount1 : enteredNewAmount1
	const newAmount2 = token2Decimals === undefined ? undefined : tryParseDecimalInput(disputeNewAmount2Input, token2Decimals)
	const isSelfDispute = accountAddress !== undefined && reportDetails !== undefined && sameAddress(accountAddress, reportDetails.currentReporter)
	const chargeFees = reportDetails === undefined || !reportDetails.feesOnlyAtHalt || reportDetails.currentAmount1 >= reportDetails.escalationHalt
	const amount1Allowed = reportDetails !== undefined && expectedNewAmount1 !== undefined && newAmount1 !== undefined && isOpenOracleDisputeAmount1Allowed(reportDetails, expectedNewAmount1, newAmount1)
	// The proposed price decides which token is swapped out, so the disputer never chooses it separately.
	const swapTokenKey = reportDetails === undefined || newAmount1 === undefined || newAmount2 === undefined || newAmount2 <= 0n || !amount1Allowed ? undefined : getOpenOracleDisputeSwapTokenKey({ currentAmount1: reportDetails.currentAmount1, currentAmount2: reportDetails.currentAmount2, newAmount1, newAmount2 })
	const flows =
		reportDetails === undefined || newAmount1 === undefined || newAmount2 === undefined || swapTokenKey === undefined
			? undefined
			: resolveOpenOracleDisputeFlows({
					chargeFees,
					feePercentage: reportDetails.feePercentage,
					isSelfDispute,
					newAmount1,
					newAmount2,
					oldAmount1: reportDetails.currentAmount1,
					oldAmount2: reportDetails.currentAmount2,
					protocolFee: reportDetails.protocolFee,
					tokenToSwap: swapTokenKey,
				})
	const token1ContributionAmount = flows?.token1Contribution
	const token2ContributionAmount = flows?.token2Contribution
	const proposedPrice = newAmount1 === undefined || newAmount2 === undefined || token1Decimals === undefined || token2Decimals === undefined || newAmount1 <= 0n || newAmount2 <= 0n ? undefined : calculateOpenOraclePrice(newAmount1, newAmount2, token1Decimals, token2Decimals)
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
		setInputBlockMessage(createVisibleGateMessage(openOracleCopy.reportLoadRequired))
	} else {
		const disputeAvailability = getOpenOracleDisputeAvailability(reportDetails)
		if (!disputeAvailability.canAct) {
			setInputBlockMessage(createVisibleGateMessage(disputeAvailability.message ?? 'This report is not ready to dispute.'))
		} else if (token1Decimals === undefined) {
			setInputBlockMessage(createHiddenLoadingGateMessage(`Loading ${token1Label} details…`))
		} else if (token2Decimals === undefined) {
			setInputBlockMessage(createHiddenLoadingGateMessage(`Loading ${token2Label} details…`))
		} else if (newAmount1 === undefined) {
			setInputBlockMessage(createVisibleGateMessage(`Enter a valid new ${token1Label} amount.`), 'disputeNewAmount1')
		} else if (newAmount2 === undefined || newAmount2 <= 0n) {
			setInputBlockMessage(createVisibleGateMessage(`Enter a valid new ${token2Label} amount greater than zero.`), 'disputeNewAmount2')
		} else if (expectedNewAmount1 === undefined) {
			setInputBlockMessage(createVisibleGateMessage(`Unable to determine the required new ${token1Label} amount.`))
		} else if (!amount1Allowed) {
			const minimumAmount = formatCurrencyInputBalance(expectedNewAmount1, token1Decimals)
			setInputBlockMessage(createVisibleGateMessage(maximumNewAmount1 === undefined ? openOracleCopy.formatNewAmountMustBeExactDetail(token1Label, minimumAmount) : openOracleCopy.formatNewAmountRangeDetail(token1Label, minimumAmount, formatCurrencyInputBalance(maximumNewAmount1, token1Decimals))), 'disputeNewAmount1')
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
				blockMessage = createHiddenLoadingGateMessage(`Loading current ${token1Label} balance…`)
			} else if (token2Balance === undefined) {
				blockMessage = createHiddenLoadingGateMessage(`Loading current ${token2Label} balance…`)
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
				blockMessage = createHiddenLoadingGateMessage(`Loading current ${token1Label} approval…`)
			} else if (approvedToken2Amount === undefined) {
				blockMessage = createHiddenLoadingGateMessage(`Loading current ${token2Label} approval…`)
			} else if (!token1Approval.hasSufficientApproval) {
				blockMessage = createVisibleGateMessage(`${token1Label} approval required`)
			} else if (!token2Approval.hasSufficientApproval) blockMessage = createVisibleGateMessage(`${token2Label} approval required`)
		}
	}
	return {
		blockMessage,
		canSubmit: blockMessage === undefined,
		disputeFeeAmount: flows?.disputeFeeAmount,
		expectedNewAmount1,
		inputFieldErrors,
		inputBlockMessage,
		maximumNewAmount1,
		newAmount1,
		newAmount2,
		proposedPrice,
		protocolFeeAmount: flows?.protocolFeeAmount,
		swapTokenKey,
		token2CreditAmount: flows?.token2Credit,
		token1Approval,
		token1ContributionAmount,
		token1Decimals,
		token2Approval,
		token2ContributionAmount,
		token2Decimals,
	}
}
