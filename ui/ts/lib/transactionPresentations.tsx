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
import {
	UI_STRING_ACTION,
	UI_STRING_UNRESOLVED_ESCALATION_MIGRATED_DETAIL,
	UI_STRING_AMOUNT,
	UI_STRING_APPROVING_FORK_REP,
	UI_STRING_ARGUMENTS,
	UI_STRING_TRADING_COMPLETE_SET_CREATED_DETAIL,
	UI_STRING_A_NEW_ORACLE_PRICE_WAS_REQUESTED_SUCCESSFULLY,
	UI_STRING_CALLDATA,
	UI_STRING_CHAIN,
	UI_STRING_CHILD_UNIVERSE_DEPLOYED,
	UI_STRING_CHILD_UNIVERSE_DEPLOYMENT_TRANSACTION_SUBMITTED,
	UI_STRING_CONFIRM_THE_TRANSACTION_IN_YOUR_WALLET,
	UI_STRING_CONTRACT,
	UI_STRING_CREATING_QUESTION,
	UI_STRING_CREATING_SECURITY_POOL,
	UI_STRING_DEPLOYING_CHILD_UNIVERSE,
	UI_STRING_ETH,
	UI_STRING_ETH_VALUE,
	UI_STRING_EXECUTING_STAGED_OPERATION,
	UI_STRING_FORKING_ZOLTAR,
	UI_STRING_FORK_REP_APPROVED,
	UI_STRING_FUNCTION,
	UI_STRING_IMPORTED_FORK_CARRIED_ESCALATION_DEPOSITS_WERE_SETTLED,
	UI_STRING_LIQUIDATION_EXECUTED,
	UI_STRING_LIQUIDATION_FAILED,
	UI_STRING_LIQUIDATION_SUBMITTED,
	UI_STRING_LIQUIDATION_TRANSACTION_SUBMITTED,
	UI_STRING_MARKET_TYPE,
	UI_STRING_MATCHING_SHARES_WERE_BURNED_AND_COLLATERAL_WAS_RETURNED_FROM_THE_SELECTED_POOL,
	UI_STRING_MIGRATION_REP_WAS_SPLIT_ACROSS_THE_SELECTED_CHILD_UNIVERSES,
	UI_STRING_NULL,
	UI_STRING_NONE,
	UI_STRING_OUTCOME,
	UI_STRING_OUTCOME_INDEX,
	UI_STRING_OUTCOME_INDEXES,
	UI_STRING_POOL,
	UI_STRING_CHILD_DESTINATION_REGISTERED_AND_AVAILABLE_POOL_REP_STAGED,
	UI_STRING_PREPARING_REP,
	UI_STRING_PRICE_REQUESTED,
	UI_STRING_PRICE_REQUEST_TRANSACTION_SUBMITTED,
	UI_STRING_QUESTION_CREATED,
	UI_STRING_QUESTION_CREATION_TRANSACTION_SUBMITTED,
	UI_STRING_QUESTION_ID,
	UI_STRING_REP_APPROVAL_TRANSACTION_SUBMITTED,
	UI_STRING_REP_APPROVAL_WAS_UPDATED_FOR_THE_ZOLTAR_FORK_FLOW,
	UI_STRING_REP_MIGRATION_TRANSACTION_SUBMITTED,
	UI_STRING_REP_PREPARATION_TRANSACTION_SUBMITTED,
	UI_STRING_REP_PREPARED,
	UI_STRING_REP,
	UI_STRING_REP_SPLIT,
	UI_STRING_REP_WAS_ADDED_TO_YOUR_MIGRATION_BALANCE,
	UI_STRING_REQUESTING_PRICE,
	UI_STRING_RESOLVED_WINNING_SHARES_WERE_REDEEMED_FROM_THE_SELECTED_POOL,
	UI_STRING_REVIEW_THE_PREPARED_TRANSACTION_BEFORE_IT_IS_SUBMITTED,
	UI_STRING_REVIEW_THE_PREPARED_TRANSACTION_THEN_CONFIRM_IT_IN_YOUR_WALLET,
	UI_STRING_SECURITY_MULTIPLIER,
	UI_STRING_SECURITY_POOL_CREATED,
	UI_STRING_SECURITY_POOL_DEPLOYMENT_TRANSACTION_SUBMITTED,
	UI_STRING_ESCALATION_DEPOSITS_MIGRATED_DETAIL,
	UI_STRING_ESCALATION_DEPOSITS_SETTLED_DETAIL,
	UI_STRING_LOSING_BIDS_REFUNDED_DETAIL,
	UI_STRING_PARENT_POOL_SHARES_MIGRATED_DETAIL,
	UI_STRING_SENDER,
	UI_STRING_SETTLE_FINALIZED_REFUNDS,
	UI_STRING_SHARE_OUTCOME,
	UI_STRING_SPLITTING_REP,
	UI_STRING_STAGED_OPERATION,
	UI_STRING_STAGED_OPERATION_EXECUTED,
	UI_STRING_STAGED_OPERATION_TRANSACTION_SUBMITTED,
	UI_STRING_SUBMITTING_IN_BROWSER_SIMULATION_NO_WALLET_CONFIRMATION_IS_REQUIRED,
	UI_STRING_SUBMITTING_LIQUIDATION,
	UI_STRING_TARGET_OUTCOME_INDEXES,
	UI_STRING_LIQUIDATION_EXECUTED_IMMEDIATELY_DETAIL,
	UI_STRING_LIQUIDATION_REQUEST_SUBMITTED_DETAIL,
	UI_STRING_SECURITY_POOL_CREATED_DETAIL,
	UI_STRING_CHILD_UNIVERSE_DEPLOYED_DETAIL,
	UI_STRING_CHILD_UNIVERSE_LINKED_TO_FORK_PATH_DETAIL,
	UI_STRING_QUESTION_CREATED_DETAIL,
	UI_STRING_UNIVERSE_FORK_SUBMITTED_DETAIL,
	UI_STRING_ZOLTAR_UNIVERSE_FORK_SUBMITTED_DETAIL,
	UI_STRING_STAGED_ORACLE_OPERATION_EXECUTED_DETAIL,
	UI_STRING_POOL_READY_FOR_FORK_MIGRATION_DETAIL,
	UI_STRING_OWN_ESCALATION_FORK_SUBMITTED_DETAIL,
	UI_STRING_TO,
	UI_STRING_TRANSACTION_SUBMITTED_WAITING_FOR_CONFIRMATION,
	UI_STRING_TRUTH_AUCTION_BID_SUBMITTED_BID_ETH_STAYS_COMMITTED_UNTIL_SETTLEMENT,
	UI_STRING_TRUTH_AUCTION_STATE_WAS_STARTED_FOR_THE_SELECTED_CHILD_UNIVERSE,
	UI_STRING_UNDEFINED,
	UI_STRING_UNIVERSE,
	UI_STRING_VAULT_MIGRATED_DETAIL,
	UI_STRING_YOUR_SELECTED_REP_WAS_COMMITTED_TO_THE_CHOSEN_ESCALATION_SIDE,
	UI_STRING_ZOLTAR_FORK_SUBMITTED,
	UI_STRING_ZOLTAR_FORK_TRANSACTION_SUBMITTED,
	UI_TEMPLATE_COMPLETED_SUCCESSFULLY,
	UI_TEMPLATE_DEPLOYING_VALUE,
	UI_TEMPLATE_LIQUIDATION_STAGED_AS_OPERATION_NUMBER_VALUE_AND_MUST_BE_EXECUTED_MANUALLY_AFTER,
	UI_TEMPLATE_LIQUIDATION_STAGED_AS_OPERATION_NUMBER_VALUE_FOR_THE_NEXT_ORACLE_SETTLEMENT,
	UI_TEMPLATE_FINALIZED_REFUND_SETTLEMENT_RESULT_DETAIL,
	UI_TEMPLATE_MIXED_BID_SETTLEMENT_RESULT_DETAIL,
	UI_TEMPLATE_WINNING_BID_SETTLEMENT_RESULT_DETAIL,
	UI_TEMPLATE_STAGED_OPERATION_NUMBER_VALUE_WAS_QUEUED_AND_MUST_BE_EXECUTED_MANUALLY_AFTER,
	UI_TEMPLATE_STAGED_OPERATION_NUMBER_VALUE_WAS_QUEUED_FOR_THE_NEXT_ORACLE_SETTLEMENT,
	UI_TEMPLATE_TRANSACTION_SUBMITTED,
	UI_TEMPLATE_VALUE_DEPLOYED,
	UI_TEMPLATE_VALUE_TRUNCATED_VALUE_BYTES,
	UI_TEMPLATE_VALUE_WAS_DEPLOYED_SUCCESSFULLY,
} from './uiStrings.js'

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
	if (value === undefined) return UI_STRING_UNDEFINED
	if (value === null) return UI_STRING_NULL
	return String(value)
}

function formatPreviewData(data: string) {
	const byteLength = Math.max(0, (data.length - 2) / 2)
	if (data.length <= 74) return data
	return UI_TEMPLATE_VALUE_TRUNCATED_VALUE_BYTES(data.slice(0, 66), byteLength.toString())
}

function getPreparedTransactionRows(intent: TransactionIntent, preview: TransactionRequestPreview): GlobalTransactionRow[] {
	const senderAddress = getPreviewAccountAddress(preview.account)
	return [
		...(intent.rows ?? []),
		...(senderAddress === undefined ? [] : [{ label: UI_STRING_SENDER, value: senderAddress }]),
		...(preview.chainName === undefined ? [] : [{ label: UI_STRING_CHAIN, value: preview.chainName }]),
		...(preview.contractAddress === undefined ? [] : [{ label: UI_STRING_CONTRACT, value: preview.contractAddress }]),
		...(preview.to === undefined ? [] : [{ label: UI_STRING_TO, value: preview.to }]),
		{ label: UI_STRING_FUNCTION, value: preview.functionName },
		...(preview.value === undefined || preview.value === 0n ? [] : [{ label: UI_STRING_ETH_VALUE, value: `${formatCurrencyBalance(preview.value)} ${UI_STRING_ETH}` }]),
		...(preview.data === undefined ? [] : [{ label: preview.dataLabel ?? UI_STRING_CALLDATA, value: formatPreviewData(preview.data) }]),
		...(preview.args === undefined || preview.args.length === 0 ? [] : [{ label: UI_STRING_ARGUMENTS, value: preview.args.map(formatPreviewArgument).join(', ') }]),
	]
}

export function createDeploymentTransactionIntent(stepLabel: string) {
	return buildIntent({
		action: 'deploy',
		source: 'deployment',
		submittedTitle: UI_TEMPLATE_DEPLOYING_VALUE(stepLabel),
		submittedDetail: UI_STRING_TRANSACTION_SUBMITTED_WAITING_FOR_CONFIRMATION,
	})
}

export function createDeploymentSuccessPresentation(stepLabel: string, hash: Hash) {
	return buildPresentation({
		detail: UI_TEMPLATE_VALUE_WAS_DEPLOYED_SUCCESSFULLY(stepLabel),
		hash,
		title: UI_TEMPLATE_VALUE_DEPLOYED(stepLabel),
		tone: 'success',
	})
}

export function createAwaitingWalletPresentation(intent: TransactionIntent, dismissKey: string) {
	if (intent.requiresWalletConfirmation === false)
		return buildHashlessPresentation({
			detail: UI_STRING_SUBMITTING_IN_BROWSER_SIMULATION_NO_WALLET_CONFIRMATION_IS_REQUIRED,
			dismissKey,
			title: intent.submittedTitle,
			tone: 'preparing',
			...(intent.rows === undefined ? {} : { rows: intent.rows }),
		})

	return buildHashlessPresentation({
		detail: UI_STRING_CONFIRM_THE_TRANSACTION_IN_YOUR_WALLET,
		dismissKey,
		title: intent.submittedTitle,
		tone: 'awaiting-wallet',
		...(intent.rows === undefined ? {} : { rows: intent.rows }),
	})
}

export function createPreparedWalletPresentation(intent: TransactionIntent, preview: TransactionRequestPreview, dismissKey: string): GlobalTransactionPresentation {
	const requiresWalletConfirmation = preview.requiresWalletConfirmation ?? intent.requiresWalletConfirmation ?? true
	return buildHashlessPresentation({
		detail: requiresWalletConfirmation ? UI_STRING_REVIEW_THE_PREPARED_TRANSACTION_THEN_CONFIRM_IT_IN_YOUR_WALLET : UI_STRING_REVIEW_THE_PREPARED_TRANSACTION_BEFORE_IT_IS_SUBMITTED,
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
		submittedTitle: UI_STRING_CREATING_QUESTION,
		submittedDetail: UI_STRING_QUESTION_CREATION_TRANSACTION_SUBMITTED,
	})
}

export function createMarketCreationSuccessPresentation(result: MarketCreationResult) {
	return buildPresentation({
		detail: UI_STRING_QUESTION_CREATED_DETAIL,
		hash: result.createQuestionHash,
		rows: [
			{ label: UI_STRING_QUESTION_ID, value: result.questionId },
			{ label: UI_STRING_MARKET_TYPE, value: result.marketType },
		],
		title: UI_STRING_QUESTION_CREATED,
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
		submittedTitle: actionName === 'approve' ? UI_STRING_APPROVING_FORK_REP : UI_STRING_FORKING_ZOLTAR,
		submittedDetail: actionName === 'approve' ? UI_STRING_REP_APPROVAL_TRANSACTION_SUBMITTED : UI_STRING_ZOLTAR_FORK_TRANSACTION_SUBMITTED,
	})
}

export function createZoltarForkSuccessPresentation(result: ZoltarForkActionResult) {
	const title = result.action === 'approveForkRep' ? UI_STRING_FORK_REP_APPROVED : UI_STRING_ZOLTAR_FORK_SUBMITTED
	const detail = result.action === 'approveForkRep' ? UI_STRING_REP_APPROVAL_WAS_UPDATED_FOR_THE_ZOLTAR_FORK_FLOW : UI_STRING_UNIVERSE_FORK_SUBMITTED_DETAIL
	return buildPresentation({
		detail,
		hash: result.hash,
		rows: [
			{ label: UI_STRING_UNIVERSE, value: <UniverseLink universeId={result.universeId} /> },
			{ label: UI_STRING_QUESTION_ID, value: result.questionId },
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
		submittedTitle: UI_STRING_DEPLOYING_CHILD_UNIVERSE,
		submittedDetail: UI_STRING_CHILD_UNIVERSE_DEPLOYMENT_TRANSACTION_SUBMITTED,
	})
}

export function createChildUniverseSuccessPresentation(result: ZoltarChildUniverseActionResult) {
	return buildPresentation({
		detail: UI_STRING_CHILD_UNIVERSE_DEPLOYED_DETAIL,
		hash: result.hash,
		rows: [
			{ label: UI_STRING_UNIVERSE, value: <UniverseLink universeId={result.universeId} /> },
			{ label: UI_STRING_OUTCOME_INDEX, value: result.outcomeIndex.toString() },
		],
		title: UI_STRING_CHILD_UNIVERSE_DEPLOYED,
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
		submittedTitle: actionName === 'prepare' ? UI_STRING_PREPARING_REP : UI_STRING_SPLITTING_REP,
		submittedDetail: actionName === 'prepare' ? UI_STRING_REP_PREPARATION_TRANSACTION_SUBMITTED : UI_STRING_REP_MIGRATION_TRANSACTION_SUBMITTED,
	})
}

export function createZoltarMigrationSuccessPresentation(result: ZoltarMigrationActionResult) {
	return buildPresentation({
		detail: result.action === 'addRepToMigrationBalance' ? UI_STRING_REP_WAS_ADDED_TO_YOUR_MIGRATION_BALANCE : UI_STRING_MIGRATION_REP_WAS_SPLIT_ACROSS_THE_SELECTED_CHILD_UNIVERSES,
		hash: result.hash,
		rows: [
			{ label: UI_STRING_UNIVERSE, value: <UniverseLink universeId={result.universeId} /> },
			{ label: UI_STRING_AMOUNT, value: `${formatCurrencyBalance(result.amount)} ${UI_STRING_REP}` },
			{ label: UI_STRING_OUTCOME_INDEXES, value: result.outcomeIndexes.length === 0 ? UI_STRING_NONE : result.outcomeIndexes.join(', ') },
		],
		title: result.action === 'addRepToMigrationBalance' ? UI_STRING_REP_PREPARED : UI_STRING_REP_SPLIT,
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
		submittedTitle: UI_STRING_CREATING_SECURITY_POOL,
		submittedDetail: UI_STRING_SECURITY_POOL_DEPLOYMENT_TRANSACTION_SUBMITTED,
	})
}

export function createSecurityPoolCreationSuccessPresentation(result: SecurityPoolCreationResult) {
	return buildPresentation({
		detail: UI_STRING_SECURITY_POOL_CREATED_DETAIL,
		hash: result.deployPoolHash,
		rows: [
			{ label: UI_STRING_POOL, value: <AddressValue address={result.securityPoolAddress} /> },
			{ label: UI_STRING_UNIVERSE, value: <UniverseLink universeId={result.universeId} /> },
			{ label: UI_STRING_QUESTION_ID, value: result.questionId },
			{ label: UI_STRING_SECURITY_MULTIPLIER, value: result.securityMultiplier.toString() },
		],
		title: UI_STRING_SECURITY_POOL_CREATED,
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
		submittedDetail: UI_TEMPLATE_TRANSACTION_SUBMITTED(humanizeAction(actionName)),
	})
}

export function createSecurityVaultSuccessPresentation(result: SecurityVaultActionResult) {
	let queuedOperationDetail: string | undefined
	if (result.queuedOperation !== undefined) {
		queuedOperationDetail = result.queuedOperation.isPendingSlot
			? UI_TEMPLATE_STAGED_OPERATION_NUMBER_VALUE_WAS_QUEUED_FOR_THE_NEXT_ORACLE_SETTLEMENT(result.queuedOperation.operationId.toString())
			: UI_TEMPLATE_STAGED_OPERATION_NUMBER_VALUE_WAS_QUEUED_AND_MUST_BE_EXECUTED_MANUALLY_AFTER(result.queuedOperation.operationId.toString())
	}
	return buildPresentation({
		detail: queuedOperationDetail ?? UI_TEMPLATE_COMPLETED_SUCCESSFULLY(humanizeAction(result.action)),
		hash: result.hash,
		rows: [{ label: UI_STRING_ACTION, value: humanizeAction(result.action) }, ...(result.queuedOperation === undefined ? [] : [{ label: UI_STRING_STAGED_OPERATION, value: `#${result.queuedOperation.operationId.toString()}` }])],
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
		submittedDetail: UI_TEMPLATE_TRANSACTION_SUBMITTED(humanizeAction(actionName)),
	})
}

export function createTradingSuccessPresentation(result: TradingActionResult) {
	const detail = (() => {
		if (result.action === 'createCompleteSet') return UI_STRING_TRADING_COMPLETE_SET_CREATED_DETAIL
		if (result.action === 'redeemCompleteSet') return UI_STRING_MATCHING_SHARES_WERE_BURNED_AND_COLLATERAL_WAS_RETURNED_FROM_THE_SELECTED_POOL
		if (result.action === 'migrateShares') return UI_STRING_PARENT_POOL_SHARES_MIGRATED_DETAIL
		return UI_STRING_RESOLVED_WINNING_SHARES_WERE_REDEEMED_FROM_THE_SELECTED_POOL
	})()
	return buildPresentation({
		detail,
		hash: result.hash,
		rows: [
			{ label: UI_STRING_POOL, value: <AddressValue address={result.securityPoolAddress} /> },
			{ label: UI_STRING_UNIVERSE, value: <UniverseLink universeId={result.universeId} /> },
			...(result.shareOutcome === undefined ? [] : [{ label: UI_STRING_SHARE_OUTCOME, value: getReportingOutcomeLabel(result.shareOutcome) }]),
			...(result.targetOutcomeIndexes === undefined ? [] : [{ label: UI_STRING_TARGET_OUTCOME_INDEXES, value: result.targetOutcomeIndexes.join(', ') }]),
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
		submittedDetail: UI_TEMPLATE_TRANSACTION_SUBMITTED(humanizeAction(actionName)),
	})
}

export function createReportingSuccessPresentation(result: ReportingActionResult) {
	const detail = result.action === 'reportOutcome' ? UI_STRING_YOUR_SELECTED_REP_WAS_COMMITTED_TO_THE_CHOSEN_ESCALATION_SIDE : UI_STRING_ESCALATION_DEPOSITS_SETTLED_DETAIL
	return buildPresentation({
		detail,
		hash: result.hash,
		rows: [
			{ label: UI_STRING_POOL, value: <AddressValue address={result.securityPoolAddress} /> },
			{ label: UI_STRING_UNIVERSE, value: <UniverseLink universeId={result.universeId} /> },
			{ label: UI_STRING_OUTCOME, value: getReportingOutcomeLabel(result.outcome) },
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
		submittedTitle: UI_STRING_SUBMITTING_LIQUIDATION,
		submittedDetail: UI_STRING_LIQUIDATION_TRANSACTION_SUBMITTED,
	})
}

export function createLiquidationSuccessPresentation(result: SecurityPoolOverviewActionResult) {
	let queuedOperationDetail: string = UI_STRING_LIQUIDATION_REQUEST_SUBMITTED_DETAIL
	if (result.queuedOperation !== undefined) {
		queuedOperationDetail = result.queuedOperation.isPendingSlot
			? UI_TEMPLATE_LIQUIDATION_STAGED_AS_OPERATION_NUMBER_VALUE_FOR_THE_NEXT_ORACLE_SETTLEMENT(result.queuedOperation.operationId.toString())
			: UI_TEMPLATE_LIQUIDATION_STAGED_AS_OPERATION_NUMBER_VALUE_AND_MUST_BE_EXECUTED_MANUALLY_AFTER(result.queuedOperation.operationId.toString())
	}
	return buildPresentation({
		detail: result.stagedExecution?.success === true ? UI_STRING_LIQUIDATION_EXECUTED_IMMEDIATELY_DETAIL : queuedOperationDetail,
		hash: result.hash,
		rows: [{ label: UI_STRING_POOL, value: <AddressValue address={result.securityPoolAddress} /> }, ...(result.queuedOperation === undefined ? [] : [{ label: UI_STRING_STAGED_OPERATION, value: `#${result.queuedOperation.operationId.toString()}` }])],
		title: result.stagedExecution?.success === true ? UI_STRING_LIQUIDATION_EXECUTED : UI_STRING_LIQUIDATION_SUBMITTED,
		tone: 'success',
	})
}

export function createLiquidationFailurePresentation(result: SecurityPoolOverviewActionResult, detail: string) {
	return buildPresentation({
		detail,
		hash: result.hash,
		rows: [{ label: UI_STRING_POOL, value: <AddressValue address={result.securityPoolAddress} /> }, ...(result.stagedExecution === undefined ? [] : [{ label: UI_STRING_STAGED_OPERATION, value: `#${result.stagedExecution.operationId.toString()}` }])],
		title: UI_STRING_LIQUIDATION_FAILED,
		tone: 'error',
	})
}

export function createLiquidationWarningPresentation(result: SecurityPoolOverviewActionResult, message: string) {
	return withWarning(createLiquidationSuccessPresentation(result), message)
}

export function createPoolOracleTransactionIntent(actionName: 'executeStagedOperation' | 'requestPrice') {
	let submittedTitle: string = UI_STRING_EXECUTING_STAGED_OPERATION
	let submittedDetail: string = UI_STRING_STAGED_OPERATION_TRANSACTION_SUBMITTED
	if (actionName === 'requestPrice') {
		submittedTitle = UI_STRING_REQUESTING_PRICE
		submittedDetail = UI_STRING_PRICE_REQUEST_TRANSACTION_SUBMITTED
	}
	return buildIntent({
		action: actionName,
		source: 'pool-oracle',
		submittedTitle,
		submittedDetail,
	})
}

export function createPoolOracleSuccessPresentation(result: OpenOracleActionResult) {
	let detail: string = UI_STRING_STAGED_ORACLE_OPERATION_EXECUTED_DETAIL
	let title: string = UI_STRING_STAGED_OPERATION_EXECUTED
	if (result.action === 'requestPrice') {
		detail = UI_STRING_A_NEW_ORACLE_PRICE_WAS_REQUESTED_SUCCESSFULLY
		title = UI_STRING_PRICE_REQUESTED
	}
	return buildPresentation({
		detail,
		hash: result.hash,
		rows: [{ label: UI_STRING_ACTION, value: humanizeAction(result.action) }],
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
		submittedDetail: UI_TEMPLATE_TRANSACTION_SUBMITTED(humanizeAction(actionName)),
	})
}

export function createOpenOracleSuccessPresentation(result: OpenOracleActionResult) {
	return buildPresentation({
		detail: UI_TEMPLATE_COMPLETED_SUCCESSFULLY(humanizeAction(result.action)),
		hash: result.hash,
		rows: [{ label: UI_STRING_ACTION, value: humanizeAction(result.action) }],
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
		submittedDetail: UI_TEMPLATE_TRANSACTION_SUBMITTED(String(resolvedSubmittedTitle)),
	})
}

export function createForkAuctionSuccessPresentation(result: ForkAuctionActionResult) {
	const title = result.action === 'claimAuctionProceeds' && result.settlementMode === 'refund' ? UI_STRING_SETTLE_FINALIZED_REFUNDS : humanizeAction(result.action)
	const detail = (() => {
		switch (result.action) {
			case 'claimAuctionProceeds':
				if (result.settlementMode === 'refund') {
					return UI_TEMPLATE_FINALIZED_REFUND_SETTLEMENT_RESULT_DETAIL(AUCTIONED_BOND_ALLOWANCE_LABEL)
				}
				if (result.settlementMode === 'claim') {
					return UI_TEMPLATE_WINNING_BID_SETTLEMENT_RESULT_DETAIL(AUCTIONED_BOND_ALLOWANCE_LABEL)
				}
				return UI_TEMPLATE_MIXED_BID_SETTLEMENT_RESULT_DETAIL(AUCTIONED_BOND_ALLOWANCE_LABEL)
			case 'createChildUniverse':
				return UI_STRING_CHILD_UNIVERSE_LINKED_TO_FORK_PATH_DETAIL
			case 'forkWithOwnEscalation':
				return UI_STRING_OWN_ESCALATION_FORK_SUBMITTED_DETAIL
			case 'forkUniverse':
				return UI_STRING_ZOLTAR_UNIVERSE_FORK_SUBMITTED_DETAIL
			case 'initiateFork':
				return UI_STRING_POOL_READY_FOR_FORK_MIGRATION_DETAIL
			case 'migrateEscalationDeposits':
				return UI_STRING_ESCALATION_DEPOSITS_MIGRATED_DETAIL
			case 'migrateRepToZoltar':
				return UI_STRING_CHILD_DESTINATION_REGISTERED_AND_AVAILABLE_POOL_REP_STAGED
			case 'migrateUnresolvedEscalation':
				return UI_STRING_UNRESOLVED_ESCALATION_MIGRATED_DETAIL
			case 'migrateVault':
				return UI_STRING_VAULT_MIGRATED_DETAIL
			case 'refundLosingBids':
				return UI_STRING_LOSING_BIDS_REFUNDED_DETAIL
			case 'settleForkedEscalation':
				return UI_STRING_IMPORTED_FORK_CARRIED_ESCALATION_DEPOSITS_WERE_SETTLED
			case 'startTruthAuction':
				return UI_STRING_TRUTH_AUCTION_STATE_WAS_STARTED_FOR_THE_SELECTED_CHILD_UNIVERSE
			case 'submitBid':
				return UI_STRING_TRUTH_AUCTION_BID_SUBMITTED_BID_ETH_STAYS_COMMITTED_UNTIL_SETTLEMENT
			default:
				return UI_TEMPLATE_COMPLETED_SUCCESSFULLY(humanizeAction(result.action))
		}
	})()
	return buildPresentation({
		detail,
		hash: result.hash,
		rows: [
			{ label: UI_STRING_POOL, value: <AddressValue address={result.securityPoolAddress} /> },
			{ label: UI_STRING_UNIVERSE, value: <UniverseLink universeId={result.universeId} /> },
		],
		title,
		tone: 'success',
	})
}

export function createForkAuctionWarningPresentation(result: ForkAuctionActionResult, message: string) {
	return withWarning(createForkAuctionSuccessPresentation(result), message)
}
