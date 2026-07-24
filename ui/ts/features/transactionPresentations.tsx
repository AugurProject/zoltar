import * as commonCopy from '../copy/common.js'
import * as transactionCopy from '../copy/transaction.js'
import * as marketCopy from '../copy/market.js'
import * as openOracleCopy from '../copy/openOracle.js'
import * as securityPoolCopy from '../copy/securityPool.js'
import type { Hash } from '@zoltar/shared/ethereum'
import { AddressValue } from '../components/AddressValue.js'
import { IdentifierValue } from '../components/IdentifierValue.js'
import { UniverseLink } from './universes/components/UniverseLink.js'
import { formatCurrencyBalance } from '../lib/formatters.js'
import { AUCTIONED_BOND_ALLOWANCE_LABEL } from './truth-auctions/lib/forkAuction.js'
import { getReportingOutcomeLabel } from './reporting/lib/reporting.js'
import { getMarketTypeLabel } from './markets/lib/marketType.js'
import { buildIntent, buildPresentation, withWarning } from '../lib/transactionPresentations.js'
import type { TransactionIntent } from '../types/components.js'
import type {
	ForkAuctionActionResult,
	MarketCreationResult,
	OpenOracleActionResult,
	ReportingActionResult,
	SecurityPoolCreationResult,
	SecurityPoolOverviewActionResult,
	SecurityVaultActionResult,
	TradingActionResult,
	ZoltarChildUniverseActionResult,
	ZoltarForkActionResult,
	ZoltarMigrationActionResult,
} from '../types/contracts.js'
function humanizeAction(action: string) {
	return action
		.replace(/([A-Z])/g, ' $1')
		.replace(/^./, value => value.toUpperCase())
		.replaceAll(/\bRep\b/g, commonCopy.rep)
		.replaceAll(/\bEth\b/g, commonCopy.eth)
		.replaceAll(/\bWeth\b/g, commonCopy.weth)
}

export function createDeploymentTransactionIntent(stepLabel: string) {
	return buildIntent({
		action: 'deploy',
		source: 'deployment',
		submittedTitle: transactionCopy.formatDeployingValue(stepLabel),
	})
}

export function createDeploymentSuccessPresentation(stepLabel: string, hash: Hash) {
	return buildPresentation({
		hash,
		title: transactionCopy.formatValueDeployed(stepLabel),
		tone: 'success',
	})
}

type MarketCreationTransactionContext = {
	marketType: MarketCreationResult['marketType']
	title?: string | undefined
	universeId?: bigint | undefined
}

function getMarketCreationTransactionRows(context: MarketCreationTransactionContext) {
	return [
		...(context.title === undefined || context.title.trim() === '' ? [] : [{ label: marketCopy.title, value: context.title.trim() }]),
		{ label: marketCopy.questionType, value: getMarketTypeLabel(context.marketType) },
		...(context.universeId === undefined ? [] : [{ label: commonCopy.universe, value: <UniverseLink universeId={context.universeId} /> }]),
	]
}

export function createMarketCreationTransactionIntent(context: MarketCreationTransactionContext) {
	return buildIntent({
		action: 'createMarket',
		rows: getMarketCreationTransactionRows(context),
		source: 'zoltar',
		submittedTitle: transactionCopy.creatingQuestion,
	})
}

export function createMarketCreationSuccessPresentation(result: MarketCreationResult, context?: Omit<MarketCreationTransactionContext, 'marketType'>) {
	return buildPresentation({
		hash: result.createQuestionHash,
		rows: [{ label: commonCopy.questionId, value: <IdentifierValue value={result.questionId} /> }, ...getMarketCreationTransactionRows({ ...context, marketType: result.marketType })],
		title: transactionCopy.questionCreated,
		tone: 'success',
	})
}

export function createMarketCreationWarningPresentation(result: MarketCreationResult, message: string, context?: Omit<MarketCreationTransactionContext, 'marketType'>) {
	return withWarning(createMarketCreationSuccessPresentation(result, context), message)
}

type QuestionUniverseTransactionContext = {
	questionId?: string | undefined
	universeId?: bigint | undefined
}

function getQuestionUniverseTransactionRows(context: QuestionUniverseTransactionContext | undefined) {
	if (context === undefined) return undefined
	return [
		...(context.universeId === undefined ? [] : [{ label: commonCopy.universe, value: <UniverseLink universeId={context.universeId} /> }]),
		...(context.questionId === undefined || context.questionId.trim() === '' ? [] : [{ label: commonCopy.questionId, value: <IdentifierValue value={context.questionId.trim()} /> }]),
	]
}

export function createZoltarForkTransactionIntent(actionName: 'approve' | 'fork', context?: QuestionUniverseTransactionContext) {
	return buildIntent({
		action: actionName,
		rows: getQuestionUniverseTransactionRows(context),
		source: 'zoltar',
		submittedTitle: actionName === 'approve' ? transactionCopy.approvingForkRep : transactionCopy.forkingZoltar,
	})
}

export function createZoltarForkSuccessPresentation(result: ZoltarForkActionResult) {
	const title = result.action === 'approveForkRep' ? transactionCopy.forkRepApproved : transactionCopy.zoltarForkSubmitted
	return buildPresentation({
		hash: result.hash,
		rows: [
			{ label: commonCopy.universe, value: <UniverseLink universeId={result.universeId} /> },
			{ label: commonCopy.questionId, value: <IdentifierValue value={result.questionId} /> },
		],
		title,
		tone: 'success',
	})
}

export function createZoltarForkWarningPresentation(result: ZoltarForkActionResult, message: string) {
	return withWarning(createZoltarForkSuccessPresentation(result), message)
}

type ChildUniverseTransactionContext = {
	outcomeIndex?: bigint | undefined
	universeId?: bigint | undefined
}

function getChildUniverseTransactionRows(context: ChildUniverseTransactionContext | undefined) {
	if (context === undefined) return undefined
	return [...(context.universeId === undefined ? [] : [{ label: commonCopy.universe, value: <UniverseLink universeId={context.universeId} /> }]), ...(context.outcomeIndex === undefined ? [] : [{ label: commonCopy.outcomeIndex, value: context.outcomeIndex.toString() }])]
}

export function createChildUniverseTransactionIntent(source: 'fork-auction' | 'zoltar', context?: ChildUniverseTransactionContext) {
	return buildIntent({
		action: 'createChildUniverse',
		rows: getChildUniverseTransactionRows(context),
		source,
		submittedTitle: transactionCopy.deployingChildUniverse,
	})
}

export function createChildUniverseSuccessPresentation(result: ZoltarChildUniverseActionResult) {
	return buildPresentation({
		hash: result.hash,
		rows: [
			{ label: commonCopy.universe, value: <UniverseLink universeId={result.universeId} /> },
			{ label: commonCopy.outcomeIndex, value: result.outcomeIndex.toString() },
		],
		title: transactionCopy.childUniverseDeployed,
		tone: 'success',
	})
}

export function createChildUniverseWarningPresentation(result: ZoltarChildUniverseActionResult, message: string) {
	return withWarning(createChildUniverseSuccessPresentation(result), message)
}

type ZoltarMigrationTransactionContext = {
	amount?: string | undefined
	outcomeIndexes?: string | undefined
	universeId?: bigint | undefined
}

function getZoltarMigrationTransactionRows(context: ZoltarMigrationTransactionContext | undefined) {
	if (context === undefined) return undefined
	return [
		...(context.universeId === undefined ? [] : [{ label: commonCopy.universe, value: <UniverseLink universeId={context.universeId} /> }]),
		...(context.amount === undefined || context.amount.trim() === '' ? [] : [{ label: commonCopy.amount, value: `${context.amount.trim()} ${commonCopy.rep}` }]),
		...(context.outcomeIndexes === undefined || context.outcomeIndexes.trim() === '' ? [] : [{ label: transactionCopy.outcomeIndexes, value: context.outcomeIndexes.trim() }]),
	]
}

export function createZoltarMigrationTransactionIntent(actionName: 'prepare' | 'split', context?: ZoltarMigrationTransactionContext) {
	return buildIntent({
		action: actionName,
		rows: getZoltarMigrationTransactionRows(context),
		source: 'zoltar',
		submittedTitle: actionName === 'prepare' ? transactionCopy.preparingRep : transactionCopy.splittingRep,
	})
}

export function createZoltarMigrationSuccessPresentation(result: ZoltarMigrationActionResult) {
	return buildPresentation({
		detail: result.action === 'addRepToMigrationBalance' ? transactionCopy.migrationRepPreparationSuccessDetail : transactionCopy.repSplitSuccessDetail,
		hash: result.hash,
		rows: [
			{ label: commonCopy.universe, value: <UniverseLink universeId={result.universeId} /> },
			{ label: commonCopy.amount, value: `${formatCurrencyBalance(result.amount)} ${commonCopy.rep}` },
			{ label: transactionCopy.outcomeIndexes, value: result.outcomeIndexes.length === 0 ? commonCopy.none : result.outcomeIndexes.join(', ') },
		],
		title: result.action === 'addRepToMigrationBalance' ? transactionCopy.repPrepared : transactionCopy.repSplit,
		tone: 'success',
	})
}

export function createZoltarMigrationWarningPresentation(result: ZoltarMigrationActionResult, message: string) {
	return withWarning(createZoltarMigrationSuccessPresentation(result), message)
}

type SecurityPoolCreationTransactionContext = {
	initialReportPriorityFeeGwei?: string | undefined
	questionId?: string | undefined
	securityMultiplier?: string | undefined
}

function getSecurityPoolCreationTransactionRows(context: SecurityPoolCreationTransactionContext | undefined) {
	if (context === undefined) return undefined
	return [
		...(context.initialReportPriorityFeeGwei === undefined || context.initialReportPriorityFeeGwei.trim() === '' ? [] : [{ label: commonCopy.initialReportPriorityFee, value: `${context.initialReportPriorityFeeGwei.trim()} gwei` }]),
		...(context.questionId === undefined || context.questionId.trim() === '' ? [] : [{ label: commonCopy.questionId, value: <IdentifierValue value={context.questionId.trim()} /> }]),
		...(context.securityMultiplier === undefined || context.securityMultiplier.trim() === '' ? [] : [{ label: commonCopy.securityMultiplier, value: context.securityMultiplier.trim() }]),
	]
}

export function createSecurityPoolCreationTransactionIntent(context?: SecurityPoolCreationTransactionContext) {
	return buildIntent({
		action: 'createSecurityPool',
		rows: getSecurityPoolCreationTransactionRows(context),
		source: 'security-pools',
		submittedTitle: transactionCopy.creatingSecurityPool,
	})
}

export function createSecurityPoolCreationSuccessPresentation(result: SecurityPoolCreationResult) {
	return buildPresentation({
		detail: transactionCopy.securityPoolCreatedDetail,
		hash: result.deployPoolHash,
		rows: [
			{ label: transactionCopy.pool, value: <AddressValue address={result.securityPoolAddress} /> },
			{ label: commonCopy.universe, value: <UniverseLink universeId={result.universeId} /> },
			{ label: commonCopy.questionId, value: <IdentifierValue value={result.questionId} /> },
			{ label: commonCopy.securityMultiplier, value: result.securityMultiplier.toString() },
			{ label: commonCopy.initialReportPriorityFee, value: `${formatCurrencyBalance(result.initialReportPriorityFeeWeiPerGas, 9)} gwei` },
		],
		title: transactionCopy.securityPoolCreated,
		tone: 'success',
	})
}

export function createSecurityPoolCreationWarningPresentation(result: SecurityPoolCreationResult, message: string) {
	return withWarning(createSecurityPoolCreationSuccessPresentation(result), message)
}

type SecurityVaultTransactionContext = {
	securityPoolAddress?: string | undefined
	vaultAddress?: string | undefined
}

function getSecurityVaultTransactionRows(context: SecurityVaultTransactionContext | undefined) {
	if (context === undefined) return undefined
	return [
		...(context.securityPoolAddress === undefined || context.securityPoolAddress.trim() === '' ? [] : [{ label: commonCopy.securityPoolAddress, value: <AddressValue address={context.securityPoolAddress} /> }]),
		...(context.vaultAddress === undefined || context.vaultAddress.trim() === '' ? [] : [{ label: securityPoolCopy.vault, value: <AddressValue address={context.vaultAddress} /> }]),
	]
}

export function createSecurityVaultTransactionIntent(actionName: SecurityVaultActionResult['action'], context?: SecurityVaultTransactionContext) {
	return buildIntent({
		action: actionName,
		rows: getSecurityVaultTransactionRows(context),
		source: 'security-vault',
		submittedTitle: humanizeAction(actionName),
	})
}

export function createSecurityVaultSuccessPresentation(result: SecurityVaultActionResult, context?: SecurityVaultTransactionContext) {
	let queuedOperationDetail: string | undefined
	if (result.queuedOperation !== undefined) {
		queuedOperationDetail = result.queuedOperation.isPendingSlot ? transactionCopy.formatQueuedOperationAutoExecutionDetail(result.queuedOperation.operationId.toString()) : transactionCopy.formatQueuedOperationManualExecutionDetail(result.queuedOperation.operationId.toString())
	}
	return buildPresentation({
		...(queuedOperationDetail === undefined ? {} : { detail: queuedOperationDetail }),
		hash: result.hash,
		rows: [...(getSecurityVaultTransactionRows(context) ?? []), ...(result.queuedOperation === undefined ? [] : [{ label: commonCopy.stagedOperation, value: `#${result.queuedOperation.operationId.toString()}` }])],
		title: humanizeAction(result.action),
		tone: 'success',
	})
}

export function createSecurityVaultWarningPresentation(result: SecurityVaultActionResult, message: string, context?: SecurityVaultTransactionContext) {
	return withWarning(createSecurityVaultSuccessPresentation(result, context), message)
}

type PoolUniverseTransactionContext = {
	securityPoolAddress?: string | undefined
	universeId?: bigint | undefined
}

function getPoolUniverseTransactionRows(context: PoolUniverseTransactionContext | undefined) {
	if (context === undefined) return undefined
	return [
		...(context.securityPoolAddress === undefined || context.securityPoolAddress.trim() === '' ? [] : [{ label: transactionCopy.pool, value: <AddressValue address={context.securityPoolAddress} /> }]),
		...(context.universeId === undefined ? [] : [{ label: commonCopy.universe, value: <UniverseLink universeId={context.universeId} /> }]),
	]
}

type TradingTransactionContext = PoolUniverseTransactionContext & {
	shareOutcome?: ReportingActionResult['outcome'] | undefined
}

function getTradingTransactionRows(context: TradingTransactionContext | undefined) {
	return [...(getPoolUniverseTransactionRows(context) ?? []), ...(context?.shareOutcome === undefined ? [] : [{ label: transactionCopy.shareOutcome, value: getReportingOutcomeLabel(context.shareOutcome) }])]
}

export function createTradingTransactionIntent(actionName: TradingActionResult['action'], context?: TradingTransactionContext) {
	return buildIntent({
		action: actionName,
		rows: getTradingTransactionRows(context),
		source: 'trading',
		submittedTitle: humanizeAction(actionName),
	})
}

export function createTradingSuccessPresentation(result: TradingActionResult) {
	const detail = (() => {
		if (result.action === 'createCompleteSet') return undefined
		if (result.action === 'redeemCompleteSet') return transactionCopy.completeSetBurnSuccessDetail
		if (result.action === 'migrateShares') return transactionCopy.parentPoolSharesMigratedDetail
		return undefined
	})()
	return buildPresentation({
		...(detail === undefined ? {} : { detail }),
		hash: result.hash,
		rows: [
			{ label: transactionCopy.pool, value: <AddressValue address={result.securityPoolAddress} /> },
			{ label: commonCopy.universe, value: <UniverseLink universeId={result.universeId} /> },
			...(result.shareOutcome === undefined ? [] : [{ label: transactionCopy.shareOutcome, value: getReportingOutcomeLabel(result.shareOutcome) }]),
			...(result.targetOutcomeIndexes === undefined ? [] : [{ label: transactionCopy.targetOutcomeIndexes, value: result.targetOutcomeIndexes.join(', ') }]),
		],
		title: humanizeAction(result.action),
		tone: 'success',
	})
}

export function createTradingWarningPresentation(result: TradingActionResult, message: string) {
	return withWarning(createTradingSuccessPresentation(result), message)
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
		submittedTitle: humanizeAction(actionName),
	})
}

export function createReportingSuccessPresentation(result: ReportingActionResult) {
	const detail = result.action === 'reportOutcome' ? transactionCopy.reportingContributionSuccessDetail : transactionCopy.escalationDepositsSettledDetail
	return buildPresentation({
		detail,
		hash: result.hash,
		rows: [
			{ label: transactionCopy.pool, value: <AddressValue address={result.securityPoolAddress} /> },
			{ label: commonCopy.universe, value: <UniverseLink universeId={result.universeId} /> },
			{ label: commonCopy.outcome, value: getReportingOutcomeLabel(result.outcome) },
		],
		title: humanizeAction(result.action),
		tone: 'success',
	})
}

export function createReportingWarningPresentation(result: ReportingActionResult, message: string) {
	return withWarning(createReportingSuccessPresentation(result), message)
}

type LiquidationTransactionContext = PoolUniverseTransactionContext & {
	amount?: string | undefined
	targetVault?: string | undefined
}

function getLiquidationTransactionRows(context: LiquidationTransactionContext | undefined) {
	return [
		...(getPoolUniverseTransactionRows(context) ?? []),
		...(context?.targetVault === undefined || context.targetVault.trim() === '' ? [] : [{ label: commonCopy.targetVault, value: <AddressValue address={context.targetVault} /> }]),
		...(context?.amount === undefined || context.amount.trim() === '' ? [] : [{ label: commonCopy.amount, value: `${context.amount.trim()} ${commonCopy.rep}` }]),
	]
}

export function createLiquidationTransactionIntent(context?: LiquidationTransactionContext) {
	return buildIntent({
		action: 'queueLiquidation',
		rows: getLiquidationTransactionRows(context),
		source: 'security-pools',
		submittedTitle: transactionCopy.submittingLiquidation,
	})
}

export function createLiquidationSuccessPresentation(result: SecurityPoolOverviewActionResult, context?: LiquidationTransactionContext) {
	let queuedOperationDetail: string = transactionCopy.liquidationRequestSubmittedDetail
	if (result.queuedOperation !== undefined) {
		queuedOperationDetail = result.queuedOperation.isPendingSlot ? transactionCopy.formatQueuedLiquidationAutoExecutionDetail(result.queuedOperation.operationId.toString()) : transactionCopy.formatQueuedLiquidationManualExecutionDetail(result.queuedOperation.operationId.toString())
	}
	return buildPresentation({
		detail: result.stagedExecution?.success === true ? transactionCopy.liquidationExecutedImmediatelyDetail : queuedOperationDetail,
		hash: result.hash,
		rows: [...getLiquidationTransactionRows({ ...context, securityPoolAddress: result.securityPoolAddress }), ...(result.queuedOperation === undefined ? [] : [{ label: commonCopy.stagedOperation, value: `#${result.queuedOperation.operationId.toString()}` }])],
		title: result.stagedExecution?.success === true ? commonCopy.liquidationExecuted : commonCopy.liquidationSubmitted,
		tone: 'success',
	})
}

export function createLiquidationFailurePresentation(result: SecurityPoolOverviewActionResult, detail: string, context?: LiquidationTransactionContext) {
	return buildPresentation({
		detail,
		hash: result.hash,
		rows: [...getLiquidationTransactionRows({ ...context, securityPoolAddress: result.securityPoolAddress }), ...(result.stagedExecution === undefined ? [] : [{ label: commonCopy.stagedOperation, value: `#${result.stagedExecution.operationId.toString()}` }])],
		title: commonCopy.liquidationFailed,
		tone: 'error',
	})
}

export function createLiquidationWarningPresentation(result: SecurityPoolOverviewActionResult, message: string, context?: LiquidationTransactionContext) {
	return withWarning(createLiquidationSuccessPresentation(result, context), message)
}

type PoolOracleTransactionContext = {
	managerAddress: string
	securityPoolAddress?: string | undefined
}

function getPoolOracleTransactionRows(context: PoolOracleTransactionContext | undefined) {
	if (context === undefined) return undefined
	return [...(context.securityPoolAddress === undefined ? [] : [{ label: commonCopy.securityPoolAddress, value: <AddressValue address={context.securityPoolAddress} /> }]), { label: securityPoolCopy.oracleManager, value: <AddressValue address={context.managerAddress} /> }]
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
	if (actionName === 'withdrawBalance') return openOracleCopy.withdrawBalance(context?.withdrawalTokenSymbol ?? openOracleCopy.oracleBalance)
	return humanizeAction(actionName)
}

function getOpenOracleSuccessTitle(actionName: OpenOracleActionResult['action'], context: OpenOracleTransactionContext | undefined) {
	if (actionName === 'approveToken1') return openOracleCopy.formatTokenApproved(context?.token1Symbol ?? openOracleCopy.baseToken)
	if (actionName === 'approveToken2') return openOracleCopy.formatTokenApproved(context?.token2Symbol ?? openOracleCopy.quoteToken)
	if (actionName === 'createReportInstance') return openOracleCopy.reportCreated
	if (actionName === 'withdrawBalance') return openOracleCopy.formatTokenWithdrawn(context?.withdrawalTokenSymbol ?? openOracleCopy.oracleBalance)
	return humanizeAction(actionName)
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
		title: getOpenOracleSuccessTitle(result.action, context),
		tone: 'success',
	})
}

export function createOpenOracleWarningPresentation(result: OpenOracleActionResult, message: string, context?: OpenOracleTransactionContext) {
	return withWarning(createOpenOracleSuccessPresentation(result, context), message)
}

export function createForkAuctionTransactionIntent(actionName: ForkAuctionActionResult['action'], { context, submittedTitle }: { context?: PoolUniverseTransactionContext; submittedTitle?: TransactionIntent['submittedTitle'] } = {}) {
	let resolvedSubmittedTitle = submittedTitle
	if (resolvedSubmittedTitle === undefined) {
		if (actionName === 'migrateUnresolvedEscalation') {
			resolvedSubmittedTitle = transactionCopy.clearParentEscalationLocks
		} else if (actionName === 'claimParentEscalationDeposits') {
			resolvedSubmittedTitle = transactionCopy.claimParentEscalationDeposits
		} else {
			resolvedSubmittedTitle = humanizeAction(actionName)
		}
	}
	return buildIntent({
		action: actionName,
		rows: getPoolUniverseTransactionRows(context),
		source: 'fork-auction',
		submittedTitle: resolvedSubmittedTitle,
	})
}

export function createForkAuctionSuccessPresentation(result: ForkAuctionActionResult) {
	let title = humanizeAction(result.action)
	if (result.action === 'claimAuctionProceeds' && result.settlementMode === 'refund') {
		title = transactionCopy.settleFinalizedRefunds
	} else if (result.action === 'migrateUnresolvedEscalation') {
		title = transactionCopy.clearParentEscalationLocks
	} else if (result.action === 'claimParentEscalationDeposits') {
		title = transactionCopy.claimParentEscalationDeposits
	}
	const detail = (() => {
		switch (result.action) {
			case 'claimAuctionProceeds':
				if (result.settlementMode === 'refund') {
					return transactionCopy.formatFinalizedRefundSettlementResultDetail(AUCTIONED_BOND_ALLOWANCE_LABEL)
				}
				if (result.settlementMode === 'claim') {
					return transactionCopy.formatWinningBidSettlementResultDetail(AUCTIONED_BOND_ALLOWANCE_LABEL)
				}
				return transactionCopy.formatMixedBidSettlementResultDetail(AUCTIONED_BOND_ALLOWANCE_LABEL)
			case 'createChildUniverse':
				return transactionCopy.childUniverseLinkedToForkPathDetail
			case 'forkWithOwnEscalation':
				return transactionCopy.ownEscalationForkSubmittedDetail
			case 'forkUniverse':
				return transactionCopy.zoltarUniverseForkSubmittedDetail
			case 'initiateFork':
				return transactionCopy.poolReadyForForkMigrationDetail
			case 'claimParentEscalationDeposits':
				return transactionCopy.parentEscalationDepositsClaimedDetail
			case 'migrateRepToZoltar':
				return transactionCopy.poolRepMigrationSuccessDetail
			case 'migrateUnresolvedEscalation':
				return transactionCopy.unresolvedEscalationMigratedDetail
			case 'migrateVault':
				return transactionCopy.vaultMigratedDetail
			case 'refundLosingBids':
				return transactionCopy.losingBidsRefundedDetail
			case 'settleForkedEscalation':
				return transactionCopy.forkDepositSettlementSuccessDetail
			case 'startTruthAuction':
				return transactionCopy.truthAuctionStartedSuccessDetail
			case 'submitBid':
				return transactionCopy.truthAuctionBidSuccessDetail
			default:
				return undefined
		}
	})()
	return buildPresentation({
		...(detail === undefined ? {} : { detail }),
		hash: result.hash,
		rows: [
			{ label: transactionCopy.pool, value: <AddressValue address={result.securityPoolAddress} /> },
			{ label: commonCopy.universe, value: <UniverseLink universeId={result.universeId} /> },
		],
		title,
		tone: 'success',
	})
}

export function createForkAuctionWarningPresentation(result: ForkAuctionActionResult, message: string) {
	return withWarning(createForkAuctionSuccessPresentation(result), message)
}
