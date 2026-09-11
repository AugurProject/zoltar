import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as transactionCopy from '@zoltar/ui-core-shared/copy/transaction.js'
import * as marketCopy from '@zoltar/ui-zoltar-shared/copy/market.js'
import * as openOracleCopy from '../copy/openOracle.js'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { IdentifierValue } from '@zoltar/ui-core-shared/components/IdentifierValue.js'
import { getReportingOutcomeLabel } from './reporting/lib/reporting.js'
import { getMarketTypeLabel } from '@zoltar/ui-core-shared/lib/marketType.js'
import { buildIntent, buildPresentation, getPoolUniverseTransactionRows, humanizeTransactionAction, withWarning } from '@zoltar/ui-core-shared/transactions/transactionPresentations.js'
import type { PoolUniverseTransactionContext } from '@zoltar/ui-core-shared/transactions/transactionPresentations.js'
import type { MarketCreationResult, OpenOracleActionResult, ReportingActionResult } from '@zoltar/ui-core-shared/types/contracts.js'

type MarketCreationTransactionContext = {
	marketType: MarketCreationResult['marketType']
	title?: string | undefined
	universeId?: bigint | undefined
}

function getMarketCreationTransactionRows(context: MarketCreationTransactionContext) {
	return [...(context.title === undefined || context.title.trim() === '' ? [] : [{ label: marketCopy.title, value: context.title.trim() }]), { label: marketCopy.questionType, value: getMarketTypeLabel(context.marketType) }]
}

export function createMarketCreationTransactionIntent(context: MarketCreationTransactionContext) {
	return buildIntent({
		action: 'createMarket',
		rows: getMarketCreationTransactionRows(context),
		source: 'zoltar',
		submittedTitle: transactionCopy.creatingQuestion,
		universeId: context.universeId,
	})
}

export function createMarketCreationSuccessPresentation(result: MarketCreationResult, context?: Omit<MarketCreationTransactionContext, 'marketType'>) {
	return buildPresentation({
		hash: result.createQuestionHash,
		rows: [{ label: commonCopy.questionId, value: <IdentifierValue value={result.questionId} /> }, ...getMarketCreationTransactionRows({ ...context, marketType: result.marketType })],
		title: transactionCopy.questionCreated,
		tone: 'success',
		universeId: context?.universeId,
	})
}

export function createMarketCreationWarningPresentation(result: MarketCreationResult, message: string, context?: Omit<MarketCreationTransactionContext, 'marketType'>) {
	return withWarning(createMarketCreationSuccessPresentation(result, context), message)
}

type ReportingTransactionContext = PoolUniverseTransactionContext & {
	outcome?: ReportingActionResult['outcome'] | undefined
}

function getReportingTransactionRows(context: ReportingTransactionContext | undefined) {
	return [...(getPoolUniverseTransactionRows(context) ?? []), ...(context?.outcome === undefined ? [] : [{ label: commonCopy.outcome, value: getReportingOutcomeLabel(context.outcome) }])]
}

export function createReportingTransactionIntent(actionName: ReportingActionResult['action'], context?: ReportingTransactionContext) {
	return buildIntent({
		action: actionName,
		rows: getReportingTransactionRows(context),
		source: 'reporting',
		submittedTitle: humanizeTransactionAction(actionName),
		universeId: context?.universeId,
	})
}

export function createReportingSuccessPresentation(result: ReportingActionResult) {
	let detail = transactionCopy.escalationDepositsSettledDetail
	if (result.action === 'approveReportingRep') detail = transactionCopy.reportingRepApprovalSuccessDetail
	if (result.action === 'reportOutcome') detail = transactionCopy.reportingContributionSuccessDetail
	return buildPresentation({
		detail,
		hash: result.hash,
		rows: [
			{ label: transactionCopy.pool, value: <AddressValue address={result.securityPoolAddress} /> },
			{ label: commonCopy.outcome, value: getReportingOutcomeLabel(result.outcome) },
		],
		title: humanizeTransactionAction(result.action),
		tone: 'success',
		universeId: result.universeId,
	})
}

export function createReportingWarningPresentation(result: ReportingActionResult, message: string) {
	return withWarning(createReportingSuccessPresentation(result), message)
}

type PoolOracleTransactionContext = {
	managerAddress: string
	securityPoolAddress?: string | undefined
	universeId?: bigint | undefined
}

function getPoolOracleTransactionRows(context: PoolOracleTransactionContext | undefined) {
	if (context === undefined) return undefined
	return [...(context.securityPoolAddress === undefined ? [] : [{ label: commonCopy.securityPoolAddress, value: <AddressValue address={context.securityPoolAddress} /> }]), { label: commonCopy.oracleManager, value: <AddressValue address={context.managerAddress} /> }]
}

export function createPoolOracleTransactionIntent(actionName: 'executeStagedOperation' | 'requestPrice', context?: PoolOracleTransactionContext) {
	let submittedTitle: string = transactionCopy.executingStagedOperation
	if (actionName === 'requestPrice') {
		submittedTitle = transactionCopy.requestingPrice
	}
	return buildIntent({
		action: actionName,
		rows: getPoolOracleTransactionRows(context),
		source: 'pool-oracle',
		submittedTitle,
		universeId: context?.universeId,
	})
}

export function createPoolOracleSuccessPresentation(result: OpenOracleActionResult, context?: PoolOracleTransactionContext) {
	let title: string = transactionCopy.stagedOperationExecuted
	if (result.action === 'requestPrice') {
		title = transactionCopy.priceRequested
	}
	return buildPresentation({
		hash: result.hash,
		rows: getPoolOracleTransactionRows(context),
		title,
		tone: 'success',
		universeId: context?.universeId,
	})
}

export function createPoolOracleWarningPresentation(result: OpenOracleActionResult, message: string, context?: PoolOracleTransactionContext) {
	return withWarning(createPoolOracleSuccessPresentation(result, context), message)
}

type OpenOracleTransactionContext = {
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
		...(context.openOracleAddress === undefined ? [] : [{ label: openOracleCopy.oracleAddress, value: <AddressValue address={context.openOracleAddress} /> }]),
	]
}

function getOpenOracleSubmittedTitle(actionName: OpenOracleActionResult['action'], context: OpenOracleTransactionContext | undefined) {
	if (actionName === 'approveToken1') return openOracleCopy.formatApproveToken(context?.token1Symbol ?? openOracleCopy.baseToken)
	if (actionName === 'approveToken2') return openOracleCopy.formatApproveToken(context?.token2Symbol ?? openOracleCopy.quoteToken)
	if (actionName === 'createReportInstance') return openOracleCopy.createReport
	if (actionName === 'settle') return openOracleCopy.settlingReportTitle
	if (actionName === 'withdrawBalance') return openOracleCopy.withdrawBalance(context?.withdrawalTokenSymbol ?? openOracleCopy.oracleBalance)
	return humanizeTransactionAction(actionName)
}

function getOpenOracleSuccessPresentationTitle(actionName: OpenOracleActionResult['action'], context: OpenOracleTransactionContext | undefined) {
	if (actionName === 'approveToken1') return openOracleCopy.formatTokenApproved(context?.token1Symbol ?? openOracleCopy.baseToken)
	if (actionName === 'approveToken2') return openOracleCopy.formatTokenApproved(context?.token2Symbol ?? openOracleCopy.quoteToken)
	if (actionName === 'createReportInstance') return openOracleCopy.reportCreated
	if (actionName === 'settle') return openOracleCopy.reportSettled
	if (actionName === 'withdrawBalance') return openOracleCopy.formatTokenWithdrawn(context?.withdrawalTokenSymbol ?? openOracleCopy.oracleBalance)
	return humanizeTransactionAction(actionName)
}

export function createOpenOracleTransactionIntent(actionName: OpenOracleActionResult['action'], context?: OpenOracleTransactionContext) {
	return buildIntent({
		action: actionName,
		rows: getOpenOracleTransactionRows(context),
		source: 'open-oracle',
		submittedTitle: getOpenOracleSubmittedTitle(actionName, context),
	})
}

export function createOpenOracleSuccessPresentation(result: OpenOracleActionResult, context?: OpenOracleTransactionContext) {
	return buildPresentation({
		hash: result.hash,
		rows: getOpenOracleTransactionRows(context),
		title: getOpenOracleSuccessPresentationTitle(result.action, context),
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
	createReportInstance: { failure: 'Report creation failed', pending: 'Creating standalone oracle report', success: 'Standalone oracle report created' },
	dispute: { failure: 'Dispute failed', pending: 'Submitting dispute', success: 'Dispute submitted' },
	executeStagedOperation: { failure: 'Staged operation failed', pending: 'Executing staged operation', success: 'Staged operation executed' },
	queueOperation: { failure: 'Queue operation failed', pending: 'Queueing operation', success: 'Operation queued' },
	requestPrice: { failure: 'Price request failed', pending: 'Requesting price', success: 'Price requested' },
	settle: { failure: 'Settlement failed', pending: 'Settling report', success: 'Report settled' },
	withdrawBalance: { failure: 'Oracle balance withdrawal failed', pending: 'Withdrawing Oracle balance', success: 'Oracle balance withdrawn' },
	wrapWeth: { failure: 'ETH wrap failed', pending: 'Wrapping ETH to WETH', success: 'ETH wrapped to WETH' },
} satisfies Record<OpenOracleAction, OpenOracleActionTitles>

export const getOpenOraclePendingTitle = (actionName: OpenOracleAction) => OPEN_ORACLE_ACTION_TITLES[actionName].pending
export const getOpenOracleSuccessTitle = (actionName: OpenOracleAction) => OPEN_ORACLE_ACTION_TITLES[actionName].success
export const getOpenOracleFailureTitle = (actionName: OpenOracleAction) => OPEN_ORACLE_ACTION_TITLES[actionName].failure
