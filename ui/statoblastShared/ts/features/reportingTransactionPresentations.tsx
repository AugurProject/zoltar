import { formatUnits } from '@zoltar/core-shared/evm/ethereum'
import { formatCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { createTransactionScope, questionLedgerTransactionScope } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import * as reportingCopy from '../copy/reporting.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as transactionCopy from '@zoltar/ui-core-shared/copy/transaction.js'
import * as transactionStepsCopy from '@zoltar/ui-core-shared/copy/transactionSteps.js'
import * as openOracleCopy from '../copy/openOracle.js'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { getReportingOutcomeLabel } from './reporting/lib/reporting.js'
import { buildIntent, buildPresentation, getPoolUniverseTransactionRows, withWarning } from '@zoltar/ui-core-shared/transactions/transactionPresentations.js'
import type { PoolUniverseTransactionContext } from '@zoltar/ui-core-shared/transactions/transactionPresentations.js'
import type { OpenOracleActionResult, ReportingActionResult } from '../types/contracts.js'

type ReportingTransactionContext = PoolUniverseTransactionContext & {
	outcome?: ReportingActionResult['outcome'] | undefined
}

function getReportingTransactionRows(context: ReportingTransactionContext | undefined) {
	return [...(getPoolUniverseTransactionRows(context) ?? []), ...(context?.outcome === undefined ? [] : [{ label: commonCopy.outcome, value: getReportingOutcomeLabel(context.outcome) }])]
}

export function createReportingTransactionIntent(actionName: ReportingActionResult['action'], context?: ReportingTransactionContext) {
	let submittedTitle = reportingCopy.submittingReportTitle
	if (actionName === 'approveReportingRep') submittedTitle = reportingCopy.approvingRepTitle
	if (actionName === 'withdrawEscalation') submittedTitle = reportingCopy.settlingEscalationDepositsTitle
	return buildIntent({
		action: actionName,
		rows: getReportingTransactionRows(context),
		scope: questionLedgerTransactionScope(context?.questionLedgerAddress),
		source: 'reporting',
		submittedTitle,
		universeId: context?.universeId,
	})
}

export function createReportingSuccessPresentation(result: ReportingActionResult) {
	let title = transactionCopy.escalationDepositsSettled
	if (result.amountAttoRep !== undefined) title = result.amountAttoRep === 0n ? reportingCopy.clearedDeposits(getReportingOutcomeLabel(result.outcome)) : reportingCopy.claimedDeposits(getReportingOutcomeLabel(result.outcome), formatCurrencyBalance(result.amountAttoRep))
	if (result.action === 'reportOutcome') title = reportingCopy.reportedAmount(getReportingOutcomeLabel(result.outcome), formatCurrencyBalance(result.amountAttoRep ?? 0n))
	if (result.action === 'approveReportingRep') title = reportingCopy.approvedAmount(formatCurrencyBalance(result.amountAttoRep ?? 0n))
	let detail = transactionCopy.escalationDepositsSettledDetail
	if (result.action === 'approveReportingRep') detail = transactionCopy.reportingRepApprovalSuccessDetail
	if (result.action === 'reportOutcome') detail = transactionCopy.reportingContributionSuccessDetail
	return buildPresentation({
		detail,
		hash: result.hash,
		rows: [
			{ label: transactionCopy.questionLedger, value: <AddressValue longAbbreviation address={result.questionLedgerAddress} /> },
			{ label: commonCopy.outcome, value: getReportingOutcomeLabel(result.outcome) },
		],
		title,
		tone: 'success',
		universeId: result.universeId,
	})
}

export function createReportingWarningPresentation(result: ReportingActionResult, message: string) {
	return withWarning(createReportingSuccessPresentation(result), message)
}

type OpenOracleTransactionContext = {
	priceUnits?: { decimals: number; label: string } | undefined
	openOracleAddress?: string | undefined
	reportId?: string | undefined
	token1Symbol?: string | undefined
	token2Symbol?: string | undefined
	tokenPair?: string | undefined
	withdrawalTokenSymbol?: string | undefined
}

function getOpenOracleTransactionRows(context: OpenOracleTransactionContext | undefined) {
	if (context === undefined) return undefined
	return [
		...(context.reportId === undefined || context.reportId.trim() === '' ? [] : [{ label: openOracleCopy.reportId, value: context.reportId }]),
		...(context.tokenPair === undefined || context.tokenPair.trim() === '' ? [] : [{ label: openOracleCopy.tokenPair, value: context.tokenPair }]),
		...(context.openOracleAddress === undefined ? [] : [{ label: openOracleCopy.oracleAddress, value: <AddressValue longAbbreviation address={context.openOracleAddress} /> }]),
	]
}

function getOpenOracleSubmittedTitle(actionName: OpenOracleActionResult['action'], context: OpenOracleTransactionContext | undefined) {
	if (actionName === 'approveToken1' && context?.token1Symbol !== undefined) return openOracleCopy.formatApprovingTokenTitle(context.token1Symbol)
	if (actionName === 'approveToken2' && context?.token2Symbol !== undefined) return openOracleCopy.formatApprovingTokenTitle(context.token2Symbol)
	if (actionName === 'settle') return openOracleCopy.settlingReportTitle
	if (actionName === 'withdrawBalance' && context?.withdrawalTokenSymbol !== undefined) return openOracleCopy.formatWithdrawingTokenTitle(context.withdrawalTokenSymbol)
	return getOpenOraclePendingTitle(actionName)
}

function getOpenOracleSuccessPresentationTitle(actionName: OpenOracleActionResult['action'], context: OpenOracleTransactionContext | undefined) {
	if (actionName === 'approveToken1' && context?.token1Symbol !== undefined) return transactionStepsCopy.formatTokenApproved(context.token1Symbol)
	if (actionName === 'approveToken2' && context?.token2Symbol !== undefined) return transactionStepsCopy.formatTokenApproved(context.token2Symbol)
	if (actionName === 'createReportInstance') return openOracleCopy.reportCreated
	if (actionName === 'settle') return context?.reportId === undefined ? openOracleCopy.reportSettled : openOracleCopy.formatSettledReportNumber(context.reportId)
	if (actionName === 'withdrawBalance' && context?.withdrawalTokenSymbol !== undefined) return openOracleCopy.formatTokenWithdrawn(context.withdrawalTokenSymbol)
	return getOpenOracleSuccessTitle(actionName)
}

export function createOpenOracleTransactionIntent(actionName: OpenOracleActionResult['action'], context?: OpenOracleTransactionContext) {
	return buildIntent({
		action: actionName,
		rows: getOpenOracleTransactionRows(context),
		scope: createTransactionScope('open-oracle-report', context?.reportId),
		source: 'open-oracle',
		submittedTitle: getOpenOracleSubmittedTitle(actionName, context),
	})
}

function formatAcceptedPrice(price: bigint, units: OpenOracleTransactionContext['priceUnits']) {
	const { decimals, label } = units ?? { decimals: 0, label: openOracleCopy.rawPriceUnits }
	// Feed prices use an extra 1e18 scale over the two atomic token amounts.
	const formatted = decimals < 0 ? (price * 10n ** BigInt(-decimals)).toString() : formatUnits(price, decimals)
	return <span className='open-oracle-receipt-price'>{`${formatted} ${label}`}</span>
}

export function createOpenOracleSuccessPresentation(result: OpenOracleActionResult, context?: OpenOracleTransactionContext) {
	if (result.priceSettlement?.status === 'unconfirmed') return buildPresentation({ hash: result.hash, rows: getOpenOracleTransactionRows(context), title: openOracleCopy.priceSettlementUnconfirmed, detail: openOracleCopy.priceSettlementUnconfirmedDetail, tone: 'warning' })
	if (result.priceSettlement?.status === 'deferred')
		return buildPresentation({
			hash: result.hash,
			rows: getOpenOracleTransactionRows(context),
			title: openOracleCopy.reportPriceDeferred,
			detail: openOracleCopy.formatPriceSettlementDeferral(formatUnits(result.priceSettlement.maxSettlementBaseFee, 9)),
			tone: 'warning',
		})
	if (result.priceSettlement?.status === 'rejected')
		return buildPresentation({
			hash: result.hash,
			rows: getOpenOracleTransactionRows(context),
			title: openOracleCopy.reportPriceRejected,
			detail: openOracleCopy.formatPriceSettlementRejection(result.priceSettlement.reason),
			tone: 'warning',
		})
	let rows = getOpenOracleTransactionRows(context)
	let detail: string | undefined
	if (result.priceSettlement?.status === 'accepted') {
		const { candidate } = result.priceSettlement
		detail = openOracleCopy.poolPriceAccepted
		if (candidate !== undefined) {
			detail = candidate.canonicalUpdated ? openOracleCopy.poolPriceObservationUpdated : openOracleCopy.poolPriceObservationRetained
			rows = [...(rows ?? []), { label: openOracleCopy.candidatePrice, value: formatAcceptedPrice(candidate.candidatePrice, context?.priceUnits) }, { label: openOracleCopy.canonicalPrice, value: formatAcceptedPrice(candidate.canonicalPrice, context?.priceUnits) }]
		}
	}
	return buildPresentation({
		hash: result.hash,
		rows,
		title: getOpenOracleSuccessPresentationTitle(result.action, context),
		detail,
		tone: 'success',
	})
}

export function createOpenOracleWarningPresentation(result: OpenOracleActionResult, message: string, context?: OpenOracleTransactionContext) {
	return withWarning(createOpenOracleSuccessPresentation(result, context), message)
}

type OpenOracleAction = OpenOracleActionResult['action']
type OpenOracleActionTitles = Readonly<{ failure: string; pending: string; success: string }>

const OPEN_ORACLE_ACTION_TITLES = {
	approveToken1: { failure: 'Base token approval failed', pending: 'Approving base token', success: 'Base token approved' },
	approveToken2: { failure: 'Quote token approval failed', pending: 'Approving quote token', success: 'Quote token approved' },
	createReportInstance: { failure: 'Report creation failed', pending: openOracleCopy.creatingStandaloneReportTitle, success: openOracleCopy.standaloneReportCreated },
	dispute: { failure: 'Dispute failed', pending: 'Submitting dispute', success: 'Dispute submitted' },
	executeStagedOperation: { failure: 'Staged operation failed', pending: 'Executing staged operation', success: 'Staged operation executed' },
	queueOperation: { failure: 'Queue operation failed', pending: 'Queueing operation', success: 'Operation queued' },
	requestPrice: openOracleCopy.priceReportActionTitles,
	settle: { failure: 'Settlement failed', pending: openOracleCopy.settlingReportTitle, success: openOracleCopy.reportSettled },
	withdrawBalance: { failure: 'Oracle balance withdrawal failed', pending: 'Withdrawing oracle balance', success: 'Oracle balance withdrawn' },
	wrapWeth: { failure: 'ETH wrap failed', pending: 'Wrapping ETH to WETH', success: 'ETH wrapped to WETH' },
} satisfies Record<OpenOracleAction, OpenOracleActionTitles>

export const getOpenOraclePendingTitle = (actionName: OpenOracleAction) => OPEN_ORACLE_ACTION_TITLES[actionName].pending
export const getOpenOracleSuccessTitle = (actionName: OpenOracleAction) => OPEN_ORACLE_ACTION_TITLES[actionName].success
export const getOpenOracleFailureTitle = (actionName: OpenOracleAction) => OPEN_ORACLE_ACTION_TITLES[actionName].failure
