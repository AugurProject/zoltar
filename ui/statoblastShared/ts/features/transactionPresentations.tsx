import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as statoblastAppCopy from '../copy/app.js'
import * as transactionCopy from '@zoltar/ui-core-shared/copy/transaction.js'
import * as securityPoolCopy from '../copy/securityPool.js'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { IdentifierValue } from '@zoltar/ui-core-shared/components/IdentifierValue.js'
import { formatCurrencyBalanceWithUnit, formatValueWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
import { tryParseRepAmountInput } from '@zoltar/ui-core-shared/forms/formInputs.js'
import { getReportingOutcomeLabel } from './reporting/lib/reporting.js'
import { buildIntent, buildPresentation, getPoolUniverseTransactionRows, humanizeTransactionAction, withWarning } from '@zoltar/ui-core-shared/transactions/transactionPresentations.js'
import type { PoolUniverseTransactionContext } from '@zoltar/ui-core-shared/transactions/transactionPresentations.js'
import { securityPoolTransactionScope } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import type { TransactionIntent } from '@zoltar/ui-core-shared/types/components.js'
import type { SecurityVaultFormState } from '../types/app.js'
import type { ForkAuctionActionResult, ReportingActionResult, SecurityPoolCreationResult, SecurityPoolOverviewActionResult, SecurityVaultActionResult, TradingActionResult } from '../types/contracts.js'
import { AUCTIONED_UNDERWRITING_LIMIT_ATTO_ETH_LABEL } from './truth-auctions/lib/forkAuction.js'
import { formatStatoblastSecurityMultiplier } from './markets/lib/trading.js'
import { formatInitialReportPriorityFee, formatInitialReportPriorityFeeInput } from './security-pools/lib/priorityFee.js'
import { getLiquidationExecutionFailureDetail } from './security-pools/lib/liquidation.js'
import * as liquidationCopy from '../copy/liquidation.js'

type SecurityPoolCreationTransactionContext = {
	initialReportPriorityFeeNanoEth?: string | undefined
	questionId?: string | undefined
	questionTitle?: string | undefined
	statoblastSecurityMultiplierBps?: bigint | undefined
	universeId?: bigint | undefined
}

function getSecurityPoolCreationTransactionRows(context: SecurityPoolCreationTransactionContext | undefined) {
	if (context === undefined) return undefined
	// Keep the same order as the success presentation so the review dialog does not reflow on confirmation.
	return [
		...(context.questionTitle === undefined || context.questionTitle.trim() === '' ? [] : [{ label: commonCopy.question, value: context.questionTitle.trim() }]),
		...(context.questionId === undefined || context.questionId.trim() === '' ? [] : [{ label: commonCopy.questionId, value: <IdentifierValue value={context.questionId.trim()} /> }]),
		...(context.statoblastSecurityMultiplierBps === undefined ? [] : [{ label: statoblastAppCopy.statoblastSecurityMultiplierBps, value: formatStatoblastSecurityMultiplier(context.statoblastSecurityMultiplierBps) }]),
		...(context.initialReportPriorityFeeNanoEth === undefined || context.initialReportPriorityFeeNanoEth.trim() === '' ? [] : [{ label: commonCopy.initialReportPriorityFee, value: formatInitialReportPriorityFeeInput(context.initialReportPriorityFeeNanoEth) }]),
	]
}

export function createSecurityPoolCreationTransactionIntent(context?: SecurityPoolCreationTransactionContext) {
	return buildIntent({
		action: 'createSecurityPool',
		failedTitle: transactionCopy.securityPoolCreation,
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
			{ label: statoblastAppCopy.statoblastSecurityMultiplierBps, value: formatStatoblastSecurityMultiplier(result.statoblastSecurityMultiplierBps) },
			{ label: commonCopy.initialReportPriorityFee, value: formatInitialReportPriorityFee(result.initialReportPriorityFeeAttoEthPerGas) },
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
	repAmountAttoRep?: bigint | undefined
	repTokenSymbol?: string | undefined
	securityPoolAddress?: string | undefined
	universeId?: bigint | undefined
	vaultAddress?: string | undefined
}

function getSecurityVaultTransactionRows(context: SecurityVaultTransactionContext | undefined) {
	if (context === undefined) return undefined
	return [
		...(context.repAmountAttoRep === undefined ? [] : [{ label: commonCopy.amount, value: formatCurrencyBalanceWithUnit(context.repAmountAttoRep, context.repTokenSymbol ?? commonCopy.rep) }]),
		...(context.securityPoolAddress === undefined || context.securityPoolAddress.trim() === '' ? [] : [{ label: commonCopy.securityPoolAddress, value: <AddressValue address={context.securityPoolAddress} /> }]),
		...(context.vaultAddress === undefined || context.vaultAddress.trim() === '' ? [] : [{ label: securityPoolCopy.vault, value: <AddressValue address={context.vaultAddress} /> }]),
	]
}

/** The REP a vault deposit or withdrawal moves, so its review and result state the amount, not only the addresses. */
export function getSecurityVaultActionRepAmount(actionName: SecurityVaultActionResult['action'], form: Pick<SecurityVaultFormState, 'depositAmount' | 'repWithdrawAmount'>) {
	let input: string | undefined
	if (actionName === 'depositRepToVault') input = form.depositAmount
	if (actionName === 'queueWithdrawRep') input = form.repWithdrawAmount
	const amount = input === undefined ? undefined : tryParseRepAmountInput(input)
	return amount !== undefined && amount > 0n ? amount : undefined
}

function getSecurityVaultActionTitle(actionName: SecurityVaultActionResult['action'], repTokenSymbol = commonCopy.rep) {
	if (actionName === 'setVaultUnderwritingLimit') return securityPoolCopy.setCommitmentLimit
	if (actionName === 'depositRepToVault') return securityPoolCopy.formatDepositRepToVault(repTokenSymbol)
	if (actionName === 'queueWithdrawRep') return securityPoolCopy.formatWithdrawRep(repTokenSymbol)
	if (actionName === 'redeemRepFromVault') return securityPoolCopy.formatRedeemRepFromVault(repTokenSymbol)
	return humanizeTransactionAction(actionName)
}

export function createSecurityVaultTransactionIntent(actionName: SecurityVaultActionResult['action'], context?: SecurityVaultTransactionContext) {
	return buildIntent({
		action: actionName,
		rows: getSecurityVaultTransactionRows(context),
		scope: securityPoolTransactionScope(context?.securityPoolAddress),
		source: 'security-vault',
		submittedTitle: getSecurityVaultActionTitle(actionName, context?.repTokenSymbol),
		universeId: context?.universeId,
	})
}

export function createSecurityVaultSuccessPresentation(result: SecurityVaultActionResult, context?: SecurityVaultTransactionContext) {
	// A staged operation that ran and reverted is a failure, not a completed vault action.
	if (result.stagedExecution?.success === false) {
		return buildPresentation({
			detail: result.stagedExecution.errorMessage ?? securityPoolCopy.stagedOperationFailedDetail,
			hash: result.hash,
			rows: [...(getSecurityVaultTransactionRows(context) ?? []), { label: commonCopy.stagedOperation, value: `#${result.stagedExecution.operationId.toString()}` }],
			title: getSecurityVaultActionTitle(result.action, context?.repTokenSymbol),
			tone: 'error',
			universeId: context?.universeId,
		})
	}
	let queuedOperationDetail: string | undefined
	if (result.queuedOperation !== undefined && result.stagedExecution === undefined) {
		queuedOperationDetail = result.queuedOperation.isPendingSlot ? transactionCopy.formatQueuedOperationAutoExecutionDetail(result.queuedOperation.operationId.toString()) : transactionCopy.formatQueuedOperationManualExecutionDetail(result.queuedOperation.operationId.toString())
	}
	return buildPresentation({
		...(queuedOperationDetail === undefined ? {} : { detail: queuedOperationDetail }),
		hash: result.hash,
		rows: [...(getSecurityVaultTransactionRows(context) ?? []), ...(result.queuedOperation === undefined ? [] : [{ label: commonCopy.stagedOperation, value: `#${result.queuedOperation.operationId.toString()}` }])],
		title: getSecurityVaultActionTitle(result.action, context?.repTokenSymbol),
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
		scope: securityPoolTransactionScope(context?.securityPoolAddress),
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
		...(context?.amount === undefined || context.amount.trim() === '' ? [] : [{ label: liquidationCopy.requestedLiquidationDebt, value: formatValueWithUnit(context.amount.trim(), commonCopy.eth) }]),
	]
}

export function createLiquidationTransactionIntent(context?: LiquidationTransactionContext) {
	return buildIntent({
		action: 'queueLiquidation',
		rows: getLiquidationTransactionRows(context),
		scope: securityPoolTransactionScope(context?.securityPoolAddress),
		source: 'security-pools',
		submittedTitle: transactionCopy.submittingLiquidation,
		universeId: context?.universeId,
	})
}

export function createLiquidationSuccessPresentation(result: SecurityPoolOverviewActionResult, context?: LiquidationTransactionContext) {
	// A staged liquidation that ran and reverted is a failure, whichever caller builds the presentation.
	if (result.stagedExecution?.success === false) return createLiquidationFailurePresentation(result, getLiquidationExecutionFailureDetail(result.stagedExecution.errorMessage) ?? securityPoolCopy.stagedOperationFailedDetail, context)
	let queuedOperationDetail: string = transactionCopy.liquidationRequestSubmittedDetail
	if (result.queuedOperation !== undefined && result.stagedExecution === undefined) {
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
		scope: securityPoolTransactionScope(context?.securityPoolAddress),
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
					return transactionCopy.formatFinalizedRefundSettlementResultDetail(AUCTIONED_UNDERWRITING_LIMIT_ATTO_ETH_LABEL)
				}
				if (result.settlementMode === 'claim') {
					return transactionCopy.formatWinningBidSettlementResultDetail(AUCTIONED_UNDERWRITING_LIMIT_ATTO_ETH_LABEL)
				}
				return transactionCopy.formatMixedBidSettlementResultDetail(AUCTIONED_UNDERWRITING_LIMIT_ATTO_ETH_LABEL)
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
			case 'withdrawAuctionRefund':
				return transactionCopy.auctionRefundWithdrawnDetail
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
