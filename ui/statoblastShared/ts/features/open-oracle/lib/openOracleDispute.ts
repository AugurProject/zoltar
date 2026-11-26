import { resolveOpenOracleDisputeFlows } from '../../../protocol/openOracleDisputeFlows.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { OpenOracleReportDetails } from '../../../types/contracts.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { tryParseDecimalInput } from '@zoltar/ui-core-shared/forms/decimal.js'
import { sanitizeErrorDetail } from '@zoltar/ui-core-shared/lib/errors.js'
import { formatCeilingAmountDisplay, formatCurrencyBalance, formatCurrencyInputBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { deriveTokenApprovalRequirement, formatTokenApprovalUnavailableMessage } from '@zoltar/ui-core-shared/transactions/tokenApproval.js'
import { getOpenOracleDisputeSwapTokenKey } from '../../../protocol/openOracleMath.js'
import { calculateOpenOraclePrice } from '../../../protocol/openOracle.js'
import * as openOracleCopy from '../../../copy/openOracle.js'
import { OPEN_ORACLE_MULTIPLIER_PRECISION } from '../../../protocol/openOracleValidation.js'
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
		actionLabel: openOracleCopy.disputingReportAction,
		reason,
		tokenLabel,
	})
}
function formatOpenOracleDisputeBalanceStatusUnavailableMessage({ reason, tokenLabel }: { reason: string | undefined; tokenLabel: string | undefined }) {
	return openOracleCopy.formatDisputeBalanceStatusUnavailable(tokenLabel?.trim() || openOracleCopy.genericToken, sanitizeErrorDetail(reason))
}
/** Which report token is WETH, the only token a wallet can fund by wrapping ETH. */
function getOpenOracleWethTokenKey(report: Pick<OpenOracleReportDetails, 'token1' | 'token2'> | undefined, wethAddress: Address | undefined) {
	if (report === undefined || wethAddress === undefined) return undefined
	if (sameAddress(report.token1, wethAddress)) return 'token1'
	if (sameAddress(report.token2, wethAddress)) return 'token2'
	return undefined
}
function getOpenOracleDisputeWrapBlockMessage({
	inputBlocked,
	shortfallAttoEth,
	walletEthBalanceAttoEth,
	wethBalanceError,
	wethContributionAttoEth,
}: {
	inputBlocked: boolean
	shortfallAttoEth: bigint | undefined
	walletEthBalanceAttoEth: bigint | undefined
	wethBalanceError: string | undefined
	wethContributionAttoEth: bigint | undefined
}): OpenOracleGateMessage | undefined {
	if (inputBlocked || wethContributionAttoEth === undefined) return createVisibleGateMessage(openOracleCopy.disputeAmountsRequiredBeforeWrap)
	if (shortfallAttoEth === undefined) return wethBalanceError === undefined ? createHiddenLoadingGateMessage(openOracleCopy.loadingWethBalance) : createVisibleGateMessage(formatOpenOracleDisputeBalanceStatusUnavailableMessage({ reason: wethBalanceError, tokenLabel: 'WETH' }))
	if (shortfallAttoEth === 0n) return createVisibleGateMessage(openOracleCopy.wrapEthNotNeeded)
	if (walletEthBalanceAttoEth === undefined) return createHiddenLoadingGateMessage(openOracleCopy.loadingEthBalance)
	if (walletEthBalanceAttoEth < shortfallAttoEth) return createVisibleGateMessage(openOracleCopy.formatInsufficientEthToWrap(formatCurrencyBalance(shortfallAttoEth), formatCurrencyBalance(walletEthBalanceAttoEth)))
	return undefined
}
function formatOpenOracleDisputeInsufficientBalanceMessage({ available, required, tokenDecimals, tokenLabel }: { available: bigint; required: bigint; tokenDecimals: number | undefined; tokenLabel: string }) {
	return openOracleCopy.formatDisputeInsufficientBalance(tokenLabel, formatCurrencyBalance(required, tokenDecimals ?? 18), formatCurrencyBalance(available, tokenDecimals ?? 18))
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
	walletEthBalanceAttoEth,
	wethAddress,
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
				| 'callbackContract'
				| 'callbackGasLimit'
				| 'trustedSettlementCallback'
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
	/** The wallet's ETH, which can be wrapped when the report's WETH side needs more than the wallet holds. */
	walletEthBalanceAttoEth: bigint | undefined
	wethAddress: Address | undefined
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
	const wethTokenKey = getOpenOracleWethTokenKey(reportDetails, wethAddress)
	const wethContributionAttoEth = wethTokenKey === 'token1' ? token1ContributionAmount : token2ContributionAmount
	const wethBalanceAttoEth = wethTokenKey === 'token1' ? token1Balance : token2Balance
	const wethShortfallAttoEth = (() => {
		if (wethTokenKey === undefined || wethContributionAttoEth === undefined || wethBalanceAttoEth === undefined) return undefined
		return wethContributionAttoEth > wethBalanceAttoEth ? wethContributionAttoEth - wethBalanceAttoEth : 0n
	})()
	// A WETH shortfall the wallet's ETH covers is fixed by the wrap step, so the dispute names that step instead of the missing balance.
	const formatInsufficientBalanceMessage = (token: 'token1' | 'token2', parameters: Parameters<typeof formatOpenOracleDisputeInsufficientBalanceMessage>[0]) => {
		if (token === wethTokenKey && wethShortfallAttoEth !== undefined && walletEthBalanceAttoEth !== undefined && walletEthBalanceAttoEth >= wethShortfallAttoEth) return openOracleCopy.formatWrapEthFirst(formatCeilingAmountDisplay(wethShortfallAttoEth))
		return formatOpenOracleDisputeInsufficientBalanceMessage(parameters)
	}
	let blockMessage: OpenOracleGateMessage | undefined
	const inputFieldErrors: Partial<Record<OpenOracleDisputeInputField, string>> = {}
	let inputBlockMessage: OpenOracleGateMessage | undefined
	const setInputBlockMessage = (message: OpenOracleGateMessage, field?: OpenOracleDisputeInputField) => {
		inputBlockMessage = message
		blockMessage = message
		if (field !== undefined && message.message !== undefined) inputFieldErrors[field] = message.message
	}
	if (reportDetails === undefined) {
		setInputBlockMessage(createVisibleGateMessage(openOracleCopy.reportLoadRequired))
	} else {
		const disputeAvailability = getOpenOracleDisputeAvailability(reportDetails)
		if (!disputeAvailability.canAct) {
			setInputBlockMessage(createVisibleGateMessage(disputeAvailability.message ?? openOracleCopy.disputeNotReady))
		} else if (token1Decimals === undefined) {
			setInputBlockMessage(createHiddenLoadingGateMessage(openOracleCopy.formatLoadingDisputeTokenDetails(token1Label)))
		} else if (token2Decimals === undefined) {
			setInputBlockMessage(createHiddenLoadingGateMessage(openOracleCopy.formatLoadingDisputeTokenDetails(token2Label)))
		} else if (newAmount1 === undefined) {
			setInputBlockMessage(createVisibleGateMessage(openOracleCopy.formatInvalidNewDisputeAmount(token1Label)), 'disputeNewAmount1')
		} else if (newAmount2 === undefined) {
			if (disputeNewAmount2Input.trim() === '') setInputBlockMessage({ kind: 'incomplete', message: undefined })
			else setInputBlockMessage(createVisibleGateMessage(openOracleCopy.formatInvalidNewDisputeAmount(token2Label)), 'disputeNewAmount2')
		} else if (newAmount2 <= 0n) {
			setInputBlockMessage({ kind: 'incomplete', message: undefined })
		} else if (expectedNewAmount1 === undefined) {
			setInputBlockMessage(createVisibleGateMessage(openOracleCopy.formatRequiredNewDisputeAmountUnavailable(token1Label)))
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
				blockMessage = createHiddenLoadingGateMessage(openOracleCopy.formatLoadingDisputeTokenBalance(token1Label))
			} else if (token2Balance === undefined) {
				blockMessage = createHiddenLoadingGateMessage(openOracleCopy.formatLoadingDisputeTokenBalance(token2Label))
			} else if (token1ContributionAmount !== undefined && token1Balance < token1ContributionAmount) {
				blockMessage = createVisibleGateMessage(
					formatInsufficientBalanceMessage('token1', {
						available: token1Balance,
						required: token1ContributionAmount,
						tokenDecimals: token1Decimals,
						tokenLabel: token1Label,
					}),
				)
			} else if (token2ContributionAmount !== undefined && token2Balance < token2ContributionAmount) {
				blockMessage = createVisibleGateMessage(
					formatInsufficientBalanceMessage('token2', {
						available: token2Balance,
						required: token2ContributionAmount,
						tokenDecimals: token2Decimals,
						tokenLabel: token2Label,
					}),
				)
			} else if (approvedToken1Amount === undefined) {
				blockMessage = createHiddenLoadingGateMessage(openOracleCopy.formatLoadingDisputeTokenApproval(token1Label))
			} else if (approvedToken2Amount === undefined) {
				blockMessage = createHiddenLoadingGateMessage(openOracleCopy.formatLoadingDisputeTokenApproval(token2Label))
			} else if (!token1Approval.hasSufficientApproval) {
				blockMessage = createVisibleGateMessage(openOracleCopy.formatDisputeTokenApprovalRequired(token1Label))
			} else if (!token2Approval.hasSufficientApproval) blockMessage = createVisibleGateMessage(openOracleCopy.formatDisputeTokenApprovalRequired(token2Label))
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
		wethWrap:
			wethTokenKey === undefined
				? undefined
				: {
						amountAttoEth: wethShortfallAttoEth,
						blockMessage: getOpenOracleDisputeWrapBlockMessage({
							inputBlocked: inputBlockMessage !== undefined,
							shortfallAttoEth: wethShortfallAttoEth,
							walletEthBalanceAttoEth,
							wethBalanceError: wethTokenKey === 'token1' ? token1BalanceError : token2BalanceError,
							wethContributionAttoEth,
						}),
					},
	}
}
