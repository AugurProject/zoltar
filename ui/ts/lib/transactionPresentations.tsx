import * as commonCopy from '../copy/common.js'
import * as transactionCopy from '../copy/transaction.js'
import type { ComponentChildren } from 'preact'
import type { Account, Hash } from '@zoltar/shared/ethereum'
import { AddressValue } from '../components/AddressValue.js'
import { UniverseLink } from '../components/UniverseLink.js'
import { formatCurrencyBalance } from './formatters.js'
import { AUCTIONED_BOND_ALLOWANCE_LABEL } from './forkAuction.js'
import type { TransactionRequestPreview } from './chainBackend.js'
import { getReportingOutcomeLabel } from './reporting.js'
import type { GlobalTransactionPresentation, GlobalTransactionRow, TransactionIntent } from '../types/components.js'
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

function buildPresentation({ detail, hash, rows, title, tone }: { detail: GlobalTransactionPresentation['detail']; hash: Hash; rows?: GlobalTransactionRow[]; title: GlobalTransactionPresentation['title']; tone: GlobalTransactionPresentation['tone'] }): GlobalTransactionPresentation {
	return {
		detail,
		dismissKey: hash,
		hash,
		...(rows === undefined ? {} : { rows }),
		title,
		tone,
	}
}

function buildHashlessPresentation({ detail, dismissKey, rows, title, tone }: { detail: ComponentChildren; dismissKey: string; rows?: GlobalTransactionRow[]; title: GlobalTransactionPresentation['title']; tone: GlobalTransactionPresentation['tone'] }): GlobalTransactionPresentation {
	return {
		detail,
		dismissKey,
		title,
		tone,
		...(rows === undefined ? {} : { rows }),
	}
}

function buildIntent({ action, rows, source, submittedDetail, submittedTitle }: { action: string; rows?: GlobalTransactionRow[]; source: string; submittedDetail: TransactionIntent['submittedDetail']; submittedTitle: TransactionIntent['submittedTitle'] }): TransactionIntent {
	return {
		action,
		...(rows === undefined ? {} : { rows }),
		source,
		submittedDetail,
		submittedTitle,
	}
}

function withWarning(base: GlobalTransactionPresentation, detail: string): GlobalTransactionPresentation {
	return {
		...base,
		detail,
		tone: 'warning',
	}
}

function humanizeAction(action: string) {
	return action.replace(/([A-Z])/g, ' $1').replace(/^./, value => value.toUpperCase())
}

function getPreviewAccountAddress(account: Account | string | undefined) {
	if (account === undefined) return undefined
	return typeof account === 'string' ? account : account.address
}

function formatPreviewArgument(value: unknown): string {
	if (typeof value === 'bigint') return value.toString()
	if (Array.isArray(value)) return `[${value.map(formatPreviewArgument).join(', ')}]`
	if (value === undefined) return transactionCopy.undefinedValue
	if (value === null) return transactionCopy.nullValue
	return String(value)
}

function formatPreviewData(data: string) {
	const byteLength = Math.max(0, (data.length - 2) / 2)
	if (data.length <= 74) return data
	return transactionCopy.formatValueTruncatedValueBytes(data.slice(0, 66), byteLength.toString())
}

function getPreparedTransactionRows(intent: TransactionIntent, preview: TransactionRequestPreview): GlobalTransactionRow[] {
	const senderAddress = getPreviewAccountAddress(preview.account)
	return [
		...(intent.rows ?? []),
		...(senderAddress === undefined ? [] : [{ label: transactionCopy.sender, value: senderAddress }]),
		...(preview.chainName === undefined ? [] : [{ label: transactionCopy.chain, value: preview.chainName }]),
		...(preview.contractAddress === undefined ? [] : [{ label: transactionCopy.contract, value: preview.contractAddress }]),
		...(preview.to === undefined ? [] : [{ label: transactionCopy.to, value: preview.to }]),
		{ label: transactionCopy.functionLabel, value: preview.functionName },
		...(preview.value === undefined || preview.value === 0n ? [] : [{ label: transactionCopy.ethValue, value: `${formatCurrencyBalance(preview.value)} ${commonCopy.eth}` }]),
		...(preview.data === undefined ? [] : [{ label: preview.dataLabel ?? transactionCopy.calldata, value: formatPreviewData(preview.data) }]),
		...(preview.args === undefined || preview.args.length === 0 ? [] : [{ label: transactionCopy.argumentListLabel, value: preview.args.map(formatPreviewArgument).join(', ') }]),
	]
}

export function createDeploymentTransactionIntent(stepLabel: string) {
	return buildIntent({
		action: 'deploy',
		source: 'deployment',
		submittedTitle: transactionCopy.formatDeployingValue(stepLabel),
		submittedDetail: transactionCopy.transactionConfirmationPendingDetail,
	})
}

export function createDeploymentSuccessPresentation(stepLabel: string, hash: Hash) {
	return buildPresentation({
		detail: transactionCopy.formatValueWasDeployedSuccessfully(stepLabel),
		hash,
		title: transactionCopy.formatValueDeployed(stepLabel),
		tone: 'success',
	})
}

export function createAwaitingWalletPresentation(intent: TransactionIntent, dismissKey: string) {
	if (intent.requiresWalletConfirmation === false)
		return buildHashlessPresentation({
			detail: transactionCopy.simulationSubmissionDetail,
			dismissKey,
			title: intent.submittedTitle,
			tone: 'preparing',
			...(intent.rows === undefined ? {} : { rows: intent.rows }),
		})

	return buildHashlessPresentation({
		detail: transactionCopy.walletConfirmationInstruction,
		dismissKey,
		title: intent.submittedTitle,
		tone: 'awaiting-wallet',
		...(intent.rows === undefined ? {} : { rows: intent.rows }),
	})
}

export function createPreparedWalletPresentation(intent: TransactionIntent, preview: TransactionRequestPreview, dismissKey: string): GlobalTransactionPresentation {
	const requiresWalletConfirmation = preview.requiresWalletConfirmation ?? intent.requiresWalletConfirmation ?? true
	return buildHashlessPresentation({
		detail: requiresWalletConfirmation ? transactionCopy.walletConfirmationReviewDetail : transactionCopy.simulationSubmissionReviewDetail,
		dismissKey,
		rows: getPreparedTransactionRows(intent, preview),
		title: intent.submittedTitle,
		tone: requiresWalletConfirmation ? 'awaiting-wallet' : 'preparing',
	})
}

export function createTransactionFailurePresentation(intent: TransactionIntent, message: string, dismissKey: string) {
	return buildHashlessPresentation({
		detail: message,
		dismissKey,
		title: intent.submittedTitle,
		tone: 'error',
		...(intent.rows === undefined ? {} : { rows: intent.rows }),
	})
}

export function createMarketCreationTransactionIntent() {
	return buildIntent({
		action: 'createMarket',
		source: 'zoltar',
		submittedTitle: transactionCopy.creatingQuestion,
		submittedDetail: transactionCopy.questionCreationSubmittedDetail,
	})
}

export function createMarketCreationSuccessPresentation(result: MarketCreationResult) {
	return buildPresentation({
		detail: transactionCopy.questionCreatedDetail,
		hash: result.createQuestionHash,
		rows: [
			{ label: commonCopy.questionId, value: result.questionId },
			{ label: transactionCopy.marketType, value: result.marketType },
		],
		title: transactionCopy.questionCreated,
		tone: 'success',
	})
}

export function createMarketCreationWarningPresentation(result: MarketCreationResult, message: string) {
	return withWarning(createMarketCreationSuccessPresentation(result), message)
}

export function createZoltarForkTransactionIntent(actionName: 'approve' | 'fork') {
	return buildIntent({
		action: actionName,
		source: 'zoltar',
		submittedTitle: actionName === 'approve' ? transactionCopy.approvingForkRep : transactionCopy.forkingZoltar,
		submittedDetail: actionName === 'approve' ? transactionCopy.repApprovalSubmittedDetail : transactionCopy.zoltarForkSubmittedDetail,
	})
}

export function createZoltarForkSuccessPresentation(result: ZoltarForkActionResult) {
	const title = result.action === 'approveForkRep' ? transactionCopy.forkRepApproved : transactionCopy.zoltarForkSubmitted
	const detail = result.action === 'approveForkRep' ? transactionCopy.forkRepApprovalSuccessDetail : transactionCopy.universeForkSubmittedDetail
	return buildPresentation({
		detail,
		hash: result.hash,
		rows: [
			{ label: commonCopy.universe, value: <UniverseLink universeId={result.universeId} /> },
			{ label: commonCopy.questionId, value: result.questionId },
		],
		title,
		tone: 'success',
	})
}

export function createZoltarForkWarningPresentation(result: ZoltarForkActionResult, message: string) {
	return withWarning(createZoltarForkSuccessPresentation(result), message)
}

export function createChildUniverseTransactionIntent(source: 'fork-auction' | 'zoltar') {
	return buildIntent({
		action: 'createChildUniverse',
		source,
		submittedTitle: transactionCopy.deployingChildUniverse,
		submittedDetail: transactionCopy.childUniverseDeploymentSubmittedDetail,
	})
}

export function createChildUniverseSuccessPresentation(result: ZoltarChildUniverseActionResult) {
	return buildPresentation({
		detail: transactionCopy.childUniverseDeployedDetail,
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

export function createZoltarMigrationTransactionIntent(actionName: 'prepare' | 'split') {
	return buildIntent({
		action: actionName,
		source: 'zoltar',
		submittedTitle: actionName === 'prepare' ? transactionCopy.preparingRep : transactionCopy.splittingRep,
		submittedDetail: actionName === 'prepare' ? transactionCopy.repPreparationSubmittedDetail : transactionCopy.repMigrationSubmittedDetail,
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

export function createSecurityPoolCreationTransactionIntent() {
	return buildIntent({
		action: 'createSecurityPool',
		source: 'security-pools',
		submittedTitle: transactionCopy.creatingSecurityPool,
		submittedDetail: transactionCopy.securityPoolDeploymentSubmittedDetail,
	})
}

export function createSecurityPoolCreationSuccessPresentation(result: SecurityPoolCreationResult) {
	return buildPresentation({
		detail: transactionCopy.securityPoolCreatedDetail,
		hash: result.deployPoolHash,
		rows: [
			{ label: transactionCopy.pool, value: <AddressValue address={result.securityPoolAddress} /> },
			{ label: commonCopy.universe, value: <UniverseLink universeId={result.universeId} /> },
			{ label: commonCopy.questionId, value: result.questionId },
			{ label: commonCopy.securityMultiplier, value: result.securityMultiplier.toString() },
		],
		title: transactionCopy.securityPoolCreated,
		tone: 'success',
	})
}

export function createSecurityPoolCreationWarningPresentation(result: SecurityPoolCreationResult, message: string) {
	return withWarning(createSecurityPoolCreationSuccessPresentation(result), message)
}

export function createSecurityVaultTransactionIntent(actionName: SecurityVaultActionResult['action']) {
	return buildIntent({
		action: actionName,
		source: 'security-vault',
		submittedTitle: humanizeAction(actionName),
		submittedDetail: transactionCopy.formatTransactionSubmitted(humanizeAction(actionName)),
	})
}

export function createSecurityVaultSuccessPresentation(result: SecurityVaultActionResult) {
	let queuedOperationDetail: string | undefined
	if (result.queuedOperation !== undefined) {
		queuedOperationDetail = result.queuedOperation.isPendingSlot ? transactionCopy.formatQueuedOperationAutoExecutionDetail(result.queuedOperation.operationId.toString()) : transactionCopy.formatQueuedOperationManualExecutionDetail(result.queuedOperation.operationId.toString())
	}
	return buildPresentation({
		detail: queuedOperationDetail ?? transactionCopy.formatCompletedSuccessfully(humanizeAction(result.action)),
		hash: result.hash,
		rows: [{ label: transactionCopy.action, value: humanizeAction(result.action) }, ...(result.queuedOperation === undefined ? [] : [{ label: commonCopy.stagedOperation, value: `#${result.queuedOperation.operationId.toString()}` }])],
		title: humanizeAction(result.action),
		tone: 'success',
	})
}

export function createSecurityVaultWarningPresentation(result: SecurityVaultActionResult, message: string) {
	return withWarning(createSecurityVaultSuccessPresentation(result), message)
}

export function createTradingTransactionIntent(actionName: TradingActionResult['action']) {
	return buildIntent({
		action: actionName,
		source: 'trading',
		submittedTitle: humanizeAction(actionName),
		submittedDetail: transactionCopy.formatTransactionSubmitted(humanizeAction(actionName)),
	})
}

export function createTradingSuccessPresentation(result: TradingActionResult) {
	const detail = (() => {
		if (result.action === 'createCompleteSet') return transactionCopy.tradingCompleteSetCreatedDetail
		if (result.action === 'redeemCompleteSet') return transactionCopy.completeSetBurnSuccessDetail
		if (result.action === 'migrateShares') return transactionCopy.parentPoolSharesMigratedDetail
		return transactionCopy.shareRedemptionSuccessDetail
	})()
	return buildPresentation({
		detail,
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

export function createReportingTransactionIntent(actionName: ReportingActionResult['action']) {
	return buildIntent({
		action: actionName,
		source: 'reporting',
		submittedTitle: humanizeAction(actionName),
		submittedDetail: transactionCopy.formatTransactionSubmitted(humanizeAction(actionName)),
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

export function createLiquidationTransactionIntent() {
	return buildIntent({
		action: 'queueLiquidation',
		source: 'security-pools',
		submittedTitle: transactionCopy.submittingLiquidation,
		submittedDetail: transactionCopy.liquidationSubmittedDetail,
	})
}

export function createLiquidationSuccessPresentation(result: SecurityPoolOverviewActionResult) {
	let queuedOperationDetail: string = transactionCopy.liquidationRequestSubmittedDetail
	if (result.queuedOperation !== undefined) {
		queuedOperationDetail = result.queuedOperation.isPendingSlot ? transactionCopy.formatQueuedLiquidationAutoExecutionDetail(result.queuedOperation.operationId.toString()) : transactionCopy.formatQueuedLiquidationManualExecutionDetail(result.queuedOperation.operationId.toString())
	}
	return buildPresentation({
		detail: result.stagedExecution?.success === true ? transactionCopy.liquidationExecutedImmediatelyDetail : queuedOperationDetail,
		hash: result.hash,
		rows: [{ label: transactionCopy.pool, value: <AddressValue address={result.securityPoolAddress} /> }, ...(result.queuedOperation === undefined ? [] : [{ label: commonCopy.stagedOperation, value: `#${result.queuedOperation.operationId.toString()}` }])],
		title: result.stagedExecution?.success === true ? commonCopy.liquidationExecuted : commonCopy.liquidationSubmitted,
		tone: 'success',
	})
}

export function createLiquidationFailurePresentation(result: SecurityPoolOverviewActionResult, detail: string) {
	return buildPresentation({
		detail,
		hash: result.hash,
		rows: [{ label: transactionCopy.pool, value: <AddressValue address={result.securityPoolAddress} /> }, ...(result.stagedExecution === undefined ? [] : [{ label: commonCopy.stagedOperation, value: `#${result.stagedExecution.operationId.toString()}` }])],
		title: commonCopy.liquidationFailed,
		tone: 'error',
	})
}

export function createLiquidationWarningPresentation(result: SecurityPoolOverviewActionResult, message: string) {
	return withWarning(createLiquidationSuccessPresentation(result), message)
}

export function createPoolOracleTransactionIntent(actionName: 'executeStagedOperation' | 'requestPrice') {
	let submittedTitle: string = transactionCopy.executingStagedOperation
	let submittedDetail: string = transactionCopy.stagedOperationSubmittedDetail
	if (actionName === 'requestPrice') {
		submittedTitle = transactionCopy.requestingPrice
		submittedDetail = transactionCopy.priceRequestSubmittedDetail
	}
	return buildIntent({
		action: actionName,
		source: 'pool-oracle',
		submittedTitle,
		submittedDetail,
	})
}

export function createPoolOracleSuccessPresentation(result: OpenOracleActionResult) {
	let detail: string = transactionCopy.stagedOracleOperationExecutedDetail
	let title: string = transactionCopy.stagedOperationExecuted
	if (result.action === 'requestPrice') {
		detail = transactionCopy.priceRequestSuccessDetail
		title = transactionCopy.priceRequested
	}
	return buildPresentation({
		detail,
		hash: result.hash,
		rows: [{ label: transactionCopy.action, value: humanizeAction(result.action) }],
		title,
		tone: 'success',
	})
}

export function createPoolOracleWarningPresentation(result: OpenOracleActionResult, message: string) {
	return withWarning(createPoolOracleSuccessPresentation(result), message)
}

export function createOpenOracleTransactionIntent(actionName: OpenOracleActionResult['action']) {
	return buildIntent({
		action: actionName,
		source: 'open-oracle',
		submittedTitle: humanizeAction(actionName),
		submittedDetail: transactionCopy.formatTransactionSubmitted(humanizeAction(actionName)),
	})
}

export function createOpenOracleSuccessPresentation(result: OpenOracleActionResult) {
	return buildPresentation({
		detail: transactionCopy.formatCompletedSuccessfully(humanizeAction(result.action)),
		hash: result.hash,
		rows: [{ label: transactionCopy.action, value: humanizeAction(result.action) }],
		title: humanizeAction(result.action),
		tone: 'success',
	})
}

export function createOpenOracleWarningPresentation(result: OpenOracleActionResult, message: string) {
	return withWarning(createOpenOracleSuccessPresentation(result), message)
}

export function createForkAuctionTransactionIntent(actionName: ForkAuctionActionResult['action'], { submittedTitle }: { submittedTitle?: TransactionIntent['submittedTitle'] } = {}) {
	const resolvedSubmittedTitle = submittedTitle ?? humanizeAction(actionName)
	return buildIntent({
		action: actionName,
		source: 'fork-auction',
		submittedTitle: resolvedSubmittedTitle,
		submittedDetail: transactionCopy.formatTransactionSubmitted(String(resolvedSubmittedTitle)),
	})
}

export function createForkAuctionSuccessPresentation(result: ForkAuctionActionResult) {
	const title = result.action === 'claimAuctionProceeds' && result.settlementMode === 'refund' ? transactionCopy.settleFinalizedRefunds : humanizeAction(result.action)
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
			case 'migrateEscalationDeposits':
				return transactionCopy.escalationDepositsMigratedDetail
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
				return transactionCopy.formatCompletedSuccessfully(humanizeAction(result.action))
		}
	})()
	return buildPresentation({
		detail,
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
