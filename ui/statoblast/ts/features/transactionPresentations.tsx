import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as statoblastAppCopy from '../copy/app.js'
import * as transactionCopy from '@zoltar/ui-core-shared/copy/transaction.js'
import * as securityPoolCopy from '../copy/securityPool.js'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { IdentifierValue } from '@zoltar/ui-core-shared/components/IdentifierValue.js'
import { formatCurrencyBalanceWithUnit, formatValueWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
import { getReportingOutcomeLabel } from '@zoltar/ui-zoltar/features/reporting/lib/reporting.js'
import { buildIntent, buildPresentation, getPoolUniverseTransactionRows, humanizeTransactionAction, withWarning } from '@zoltar/ui-core-shared/lib/transactionPresentations.js'
import type { PoolUniverseTransactionContext } from '@zoltar/ui-core-shared/lib/transactionPresentations.js'
import type { TransactionIntent } from '@zoltar/ui-core-shared/types/components.js'
import type { ForkAuctionActionResult, ReportingActionResult, SecurityPoolCreationResult, SecurityPoolOverviewActionResult, SecurityVaultActionResult, TradingActionResult } from '@zoltar/ui-core-shared/types/contracts.js'
import { AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL } from './truth-auctions/lib/forkAuction.js'
import { formatStatoblastSecurityMultiplier } from './markets/lib/trading.js'

type SecurityPoolCreationTransactionContext = {
	initialReportPriorityFeeGwei?: string | undefined
	questionId?: string | undefined
	statoblastSecurityMultiplierBps?: bigint | undefined
	universeId?: bigint | undefined
}

function getSecurityPoolCreationTransactionRows(context: SecurityPoolCreationTransactionContext | undefined) {
	if (context === undefined) return undefined
	return [
		...(context.initialReportPriorityFeeGwei === undefined || context.initialReportPriorityFeeGwei.trim() === '' ? [] : [{ label: commonCopy.initialReportPriorityFee, value: formatValueWithUnit(context.initialReportPriorityFeeGwei.trim(), commonCopy.gwei) }]),
		...(context.questionId === undefined || context.questionId.trim() === '' ? [] : [{ label: commonCopy.questionId, value: <IdentifierValue value={context.questionId.trim()} /> }]),
		...(context.statoblastSecurityMultiplierBps === undefined ? [] : [{ label: statoblastAppCopy.statoblastSecurityMultiplierBps, value: `${formatStatoblastSecurityMultiplier(context.statoblastSecurityMultiplierBps)}x` }]),
	]
}

export function createSecurityPoolCreationTransactionIntent(context?: SecurityPoolCreationTransactionContext) {
	return buildIntent({
		action: 'createSecurityPool',
		rows: getSecurityPoolCreationTransactionRows(context),
		source: 'security-pools',
		submittedTitle: transactionCopy.creatingSecurityPool,
		universeId: context?.universeId,
	})
}

export function createSecurityPoolCreationSuccessPresentation(result: SecurityPoolCreationResult) {
	return buildPresentation({
		detail: transactionCopy.securityPoolCreatedDetail,
		hash: result.deployPoolHash,
		rows: [
			{ label: transactionCopy.pool, value: <AddressValue address={result.securityPoolAddress} /> },
			{ label: commonCopy.questionId, value: <IdentifierValue value={result.questionId} /> },
			{ label: statoblastAppCopy.statoblastSecurityMultiplierBps, value: `${formatStatoblastSecurityMultiplier(result.statoblastSecurityMultiplierBps)}x` },
			{ label: commonCopy.initialReportPriorityFee, value: formatCurrencyBalanceWithUnit(result.initialReportPriorityFeeAttoEthPerGas, commonCopy.gwei, 9) },
		],
		title: transactionCopy.securityPoolCreated,
		tone: 'success',
		universeId: result.universeId,
	})
}

export function createSecurityPoolCreationWarningPresentation(result: SecurityPoolCreationResult, message: string) {
	return withWarning(createSecurityPoolCreationSuccessPresentation(result), message)
}

type SecurityVaultTransactionContext = {
	securityPoolAddress?: string | undefined
	universeId?: bigint | undefined
	vaultAddress?: string | undefined
}

function getSecurityVaultTransactionRows(context: SecurityVaultTransactionContext | undefined) {
	if (context === undefined) return undefined
	return [
		...(context.securityPoolAddress === undefined || context.securityPoolAddress.trim() === '' ? [] : [{ label: commonCopy.securityPoolAddress, value: <AddressValue address={context.securityPoolAddress} /> }]),
		...(context.vaultAddress === undefined || context.vaultAddress.trim() === '' ? [] : [{ label: securityPoolCopy.vault, value: <AddressValue address={context.vaultAddress} /> }]),
	]
}

function getSecurityVaultActionTitle(actionName: SecurityVaultActionResult['action']) {
	if (actionName === 'depositRepToVault') return securityPoolCopy.depositRepToVault
	if (actionName === 'queueWithdrawRep') return securityPoolCopy.withdrawRep
	return humanizeTransactionAction(actionName)
}

export function createSecurityVaultTransactionIntent(actionName: SecurityVaultActionResult['action'], context?: SecurityVaultTransactionContext) {
	return buildIntent({
		action: actionName,
		rows: getSecurityVaultTransactionRows(context),
		source: 'security-vault',
		submittedTitle: getSecurityVaultActionTitle(actionName),
		universeId: context?.universeId,
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
		title: getSecurityVaultActionTitle(result.action),
		tone: 'success',
		universeId: context?.universeId,
	})
}

export function createSecurityVaultWarningPresentation(result: SecurityVaultActionResult, message: string, context?: SecurityVaultTransactionContext) {
	return withWarning(createSecurityVaultSuccessPresentation(result, context), message)
}

type TradingTransactionContext = PoolUniverseTransactionContext & {
	shareOutcome?: ReportingActionResult['outcome'] | undefined
}

function getTradingTransactionRows(context: TradingTransactionContext | undefined) {
	return [...(getPoolUniverseTransactionRows(context) ?? []), ...(context?.shareOutcome === undefined ? [] : [{ identityKey: 'outcome', label: transactionCopy.shareOutcome, value: getReportingOutcomeLabel(context.shareOutcome) }])]
}

export function createTradingTransactionIntent(actionName: TradingActionResult['action'], context?: TradingTransactionContext) {
	return buildIntent({
		action: actionName,
		rows: getTradingTransactionRows(context),
		source: 'trading',
		submittedTitle: humanizeTransactionAction(actionName),
		universeId: context?.universeId,
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
			{ identityKey: 'security-pool', label: transactionCopy.pool, value: <AddressValue address={result.securityPoolAddress} /> },
			...(result.shareOutcome === undefined ? [] : [{ identityKey: 'outcome', label: transactionCopy.shareOutcome, value: getReportingOutcomeLabel(result.shareOutcome) }]),
			...(result.targetOutcomeIndexes === undefined ? [] : [{ label: transactionCopy.targetOutcomeIndexes, value: result.targetOutcomeIndexes.join(', ') }]),
		],
		title: humanizeTransactionAction(result.action),
		tone: 'success',
		universeId: result.universeId,
	})
}

export function createTradingWarningPresentation(result: TradingActionResult, message: string) {
	return withWarning(createTradingSuccessPresentation(result), message)
}

type LiquidationTransactionContext = PoolUniverseTransactionContext & {
	amount?: string | undefined
	targetVault?: string | undefined
}

function getLiquidationTransactionRows(context: LiquidationTransactionContext | undefined) {
	return [
		...(getPoolUniverseTransactionRows(context) ?? []),
		...(context?.targetVault === undefined || context.targetVault.trim() === '' ? [] : [{ label: commonCopy.targetVault, value: <AddressValue address={context.targetVault} /> }]),
		...(context?.amount === undefined || context.amount.trim() === '' ? [] : [{ label: securityPoolCopy.requestedLiquidationDebt, value: formatValueWithUnit(context.amount.trim(), commonCopy.eth) }]),
	]
}

export function createLiquidationTransactionIntent(context?: LiquidationTransactionContext) {
	return buildIntent({
		action: 'queueLiquidation',
		rows: getLiquidationTransactionRows(context),
		source: 'security-pools',
		submittedTitle: transactionCopy.submittingLiquidation,
		universeId: context?.universeId,
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
		universeId: context?.universeId,
	})
}

export function createLiquidationFailurePresentation(result: SecurityPoolOverviewActionResult, detail: string, context?: LiquidationTransactionContext) {
	return buildPresentation({
		detail,
		hash: result.hash,
		rows: [...getLiquidationTransactionRows({ ...context, securityPoolAddress: result.securityPoolAddress }), ...(result.stagedExecution === undefined ? [] : [{ label: commonCopy.stagedOperation, value: `#${result.stagedExecution.operationId.toString()}` }])],
		title: commonCopy.liquidationFailed,
		tone: 'error',
		universeId: context?.universeId,
	})
}

export function createLiquidationWarningPresentation(result: SecurityPoolOverviewActionResult, message: string, context?: LiquidationTransactionContext) {
	return withWarning(createLiquidationSuccessPresentation(result, context), message)
}
export function createForkAuctionTransactionIntent(actionName: ForkAuctionActionResult['action'], { context, submittedTitle }: { context?: PoolUniverseTransactionContext; submittedTitle?: TransactionIntent['submittedTitle'] } = {}) {
	let resolvedSubmittedTitle = submittedTitle
	if (resolvedSubmittedTitle === undefined) {
		if (actionName === 'migrateUnresolvedEscalation') {
			resolvedSubmittedTitle = transactionCopy.clearUnresolvedParentEscalationDepositAccounting
		} else if (actionName === 'claimParentEscalationDeposits') {
			resolvedSubmittedTitle = transactionCopy.claimParentEscalationDeposits
		} else {
			resolvedSubmittedTitle = humanizeTransactionAction(actionName)
		}
	}
	return buildIntent({
		action: actionName,
		rows: getPoolUniverseTransactionRows(context),
		source: 'fork-auction',
		submittedTitle: resolvedSubmittedTitle,
		universeId: context?.universeId,
	})
}

export function createForkAuctionSuccessPresentation(result: ForkAuctionActionResult) {
	let title = humanizeTransactionAction(result.action)
	if (result.action === 'claimAuctionProceeds' && result.settlementMode === 'refund') {
		title = transactionCopy.settleFinalizedRefunds
	} else if (result.action === 'migrateUnresolvedEscalation') {
		title = transactionCopy.clearUnresolvedParentEscalationDepositAccounting
	} else if (result.action === 'claimParentEscalationDeposits') {
		title = transactionCopy.claimParentEscalationDeposits
	}
	const detail = (() => {
		switch (result.action) {
			case 'claimAuctionProceeds':
				if (result.settlementMode === 'refund') {
					return transactionCopy.formatFinalizedRefundSettlementResultDetail(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL)
				}
				if (result.settlementMode === 'claim') {
					return transactionCopy.formatWinningBidSettlementResultDetail(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL)
				}
				return transactionCopy.formatMixedBidSettlementResultDetail(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL)
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
		rows: [{ label: transactionCopy.pool, value: <AddressValue address={result.securityPoolAddress} /> }],
		title,
		tone: 'success',
		universeId: result.universeId,
	})
}

export function createForkAuctionWarningPresentation(result: ForkAuctionActionResult, message: string) {
	return withWarning(createForkAuctionSuccessPresentation(result), message)
}

export {
	createMarketCreationSuccessPresentation,
	createMarketCreationTransactionIntent,
	createMarketCreationWarningPresentation,
	createOpenOracleSuccessPresentation,
	createOpenOracleTransactionIntent,
	createPoolOracleSuccessPresentation,
	createPoolOracleTransactionIntent,
	createReportingSuccessPresentation,
	createReportingTransactionIntent,
} from '@zoltar/ui-zoltar/features/transactionPresentations.js'
