import { type Address } from '@zoltar/core-shared/evm/ethereum'
import type { OpenOracleReportDetails } from '../../../types/contracts.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { tryParseDecimalInput } from '@zoltar/ui-core-shared/forms/decimal.js'
import { sanitizeErrorDetail } from '@zoltar/ui-core-shared/lib/errors.js'
import { formatCurrencyBalance, formatCurrencyInputBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { deriveTokenApprovalRequirement, formatTokenApprovalUnavailableMessage } from '@zoltar/ui-core-shared/transactions/tokenApproval.js'
import { getOpenOracleDisputeSwapTokenKey } from '../../../protocol/openOracleMath.js'
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
	if (sanitizedReason !== undefined) segments.push(`Reason: ${sanitizedReason}.`)
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
function resolveOpenOracleDisputeToken1Contribution({ chargeFees, feePercentage, isSelfDispute, newAmount1, oldAmount1, protocolFee, tokenToSwap }: { chargeFees: boolean; feePercentage: bigint; isSelfDispute: boolean; newAmount1: bigint; oldAmount1: bigint; protocolFee: bigint; tokenToSwap: 'token1' | 'token2' }) {
	if (tokenToSwap === 'token1') {
		const { fee, protocolFeeAmount } = getOpenOracleDisputeFees(oldAmount1, { chargeFees, feePercentage, protocolFee })
		if (isSelfDispute) return newAmount1 - oldAmount1 + protocolFeeAmount
		return newAmount1 + oldAmount1 + fee + protocolFeeAmount
	}
	return newAmount1 > oldAmount1 ? newAmount1 - oldAmount1 : 0n
}
function resolveOpenOracleDisputeToken2Contribution({ chargeFees, feePercentage, isSelfDispute, newAmount2, oldAmount2, protocolFee, tokenToSwap }: { chargeFees: boolean; feePercentage: bigint; isSelfDispute: boolean; newAmount2: bigint; oldAmount2: bigint; protocolFee: bigint; tokenToSwap: 'token1' | 'token2' }) {
	if (tokenToSwap === 'token1') {
		return newAmount2 >= oldAmount2 ? newAmount2 - oldAmount2 : 0n
	}
	const { fee, protocolFeeAmount } = getOpenOracleDisputeFees(oldAmount2, { chargeFees, feePercentage, protocolFee })
	if (isSelfDispute) {
		const token2Needed = newAmount2 + protocolFeeAmount
		return token2Needed >= oldAmount2 ? token2Needed - oldAmount2 : 0n
	}
	return newAmount2 + oldAmount2 + fee + protocolFeeAmount
}
function isOpenOracleDisputeAmount1Allowed(report: Pick<OpenOracleReportDetails, 'escalationHalt' | 'flexibleEscalation'>, expectedNewAmount1: bigint, newAmount1: bigint) {
	if (newAmount1 === expectedNewAmount1) return true
	return report.flexibleEscalation && newAmount1 >= expectedNewAmount1 && newAmount1 <= report.escalationHalt
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
	const maximumNewAmount1 = reportDetails !== undefined && expectedNewAmount1 !== undefined && reportDetails.flexibleEscalation && reportDetails.escalationHalt > expectedNewAmount1 ? reportDetails.escalationHalt : undefined
	const chargeFees = reportDetails === undefined || !reportDetails.feesOnlyAtHalt || reportDetails.currentAmount1 >= reportDetails.escalationHalt
	// Flexible escalation lets the disputer choose the base amount, so contributions follow the entered amount once it is allowed.
	const contributionNewAmount1 = reportDetails !== undefined && expectedNewAmount1 !== undefined && newAmount1 !== undefined && isOpenOracleDisputeAmount1Allowed(reportDetails, expectedNewAmount1, newAmount1) ? newAmount1 : expectedNewAmount1
	const token1ContributionAmount =
		reportDetails === undefined || newAmount2 === undefined || contributionNewAmount1 === undefined
			? undefined
			: resolveOpenOracleDisputeToken1Contribution({
					chargeFees,
					feePercentage: reportDetails.feePercentage,
					isSelfDispute,
					newAmount1: contributionNewAmount1,
					oldAmount1: reportDetails.currentAmount1,
					protocolFee: reportDetails.protocolFee,
					tokenToSwap: disputeTokenToSwap,
				})
	const token2ContributionAmount =
		reportDetails === undefined || newAmount2 === undefined
			? undefined
			: resolveOpenOracleDisputeToken2Contribution({
					chargeFees,
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
		} else if (!isOpenOracleDisputeAmount1Allowed(reportDetails, expectedNewAmount1, newAmount1)) {
			setInputBlockMessage(
				createVisibleGateMessage(
					maximumNewAmount1 !== undefined
						? `New base token amount must be between ${formatCurrencyInputBalance(expectedNewAmount1, token1Decimals)} and ${formatCurrencyInputBalance(maximumNewAmount1, token1Decimals)} for this dispute.`
						: `New base token amount must be exactly ${formatCurrencyInputBalance(expectedNewAmount1, token1Decimals)} for this dispute.`,
				),
				'disputeNewAmount1',
			)
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
		maximumNewAmount1,
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
