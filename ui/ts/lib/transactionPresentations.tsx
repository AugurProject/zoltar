import type { ComponentChildren } from 'preact'
import type { Hash } from 'viem'
import { AddressValue } from '../components/AddressValue.js'
import { UniverseLink } from '../components/UniverseLink.js'
import { formatCurrencyBalance } from './formatters.js'
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

export function createDeploymentTransactionIntent(stepLabel: string) {
	return buildIntent({
		action: 'deploy',
		source: 'deployment',
		submittedTitle: `Deploying ${stepLabel}`,
		submittedDetail: 'Transaction submitted. Waiting for confirmation.',
	})
}

export function createDeploymentSuccessPresentation(stepLabel: string, hash: Hash) {
	return buildPresentation({
		detail: `${stepLabel} was deployed successfully.`,
		hash,
		title: `${stepLabel} Deployed`,
		tone: 'success',
	})
}

export function createAwaitingWalletPresentation(intent: TransactionIntent, dismissKey: string) {
	return buildHashlessPresentation({
		detail: 'Confirm the transaction in your wallet.',
		dismissKey,
		title: intent.submittedTitle,
		tone: 'awaiting-wallet',
		...(intent.rows === undefined ? {} : { rows: intent.rows }),
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
		submittedTitle: 'Creating Question',
		submittedDetail: 'Question creation transaction submitted.',
	})
}

export function createMarketCreationSuccessPresentation(result: MarketCreationResult) {
	return buildPresentation({
		detail: 'The new Zoltar question is now on-chain.',
		hash: result.createQuestionHash,
		rows: [
			{ label: 'Question ID', value: result.questionId },
			{ label: 'Market Type', value: result.marketType },
		],
		title: 'Question Created',
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
		submittedTitle: actionName === 'approve' ? 'Approving Fork REP' : 'Forking Zoltar',
		submittedDetail: actionName === 'approve' ? 'REP approval transaction submitted.' : 'Zoltar fork transaction submitted.',
	})
}

export function createZoltarForkSuccessPresentation(result: ZoltarForkActionResult) {
	const title = result.action === 'approveForkRep' ? 'Fork REP Approved' : 'Zoltar Fork Submitted'
	const detail = result.action === 'approveForkRep' ? 'REP approval was updated for the Zoltar fork flow.' : 'The selected universe fork has been submitted on-chain.'
	return buildPresentation({
		detail,
		hash: result.hash,
		rows: [
			{ label: 'Universe', value: <UniverseLink universeId={result.universeId} /> },
			{ label: 'Question ID', value: result.questionId },
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
		submittedTitle: 'Deploying Child Universe',
		submittedDetail: 'Child-universe deployment transaction submitted.',
	})
}

export function createChildUniverseSuccessPresentation(result: ZoltarChildUniverseActionResult) {
	return buildPresentation({
		detail: 'The selected child universe was deployed successfully.',
		hash: result.hash,
		rows: [
			{ label: 'Universe', value: <UniverseLink universeId={result.universeId} /> },
			{ label: 'Outcome Index', value: result.outcomeIndex.toString() },
		],
		title: 'Child Universe Deployed',
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
		submittedTitle: actionName === 'prepare' ? 'Preparing REP' : 'Splitting REP',
		submittedDetail: actionName === 'prepare' ? 'REP preparation transaction submitted.' : 'REP migration transaction submitted.',
	})
}

export function createZoltarMigrationSuccessPresentation(result: ZoltarMigrationActionResult) {
	return buildPresentation({
		detail: result.action === 'addRepToMigrationBalance' ? 'REP was added to your migration balance.' : 'Migration REP was split across the selected child universes.',
		hash: result.hash,
		rows: [
			{ label: 'Universe', value: <UniverseLink universeId={result.universeId} /> },
			{ label: 'Amount', value: `${formatCurrencyBalance(result.amount)} REP` },
			{ label: 'Outcome Indexes', value: result.outcomeIndexes.length === 0 ? 'None' : result.outcomeIndexes.join(', ') },
		],
		title: result.action === 'addRepToMigrationBalance' ? 'REP Prepared' : 'REP Split',
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
		submittedTitle: 'Creating Security Pool',
		submittedDetail: 'Security-pool deployment transaction submitted.',
	})
}

export function createSecurityPoolCreationSuccessPresentation(result: SecurityPoolCreationResult) {
	return buildPresentation({
		detail: 'The new security pool is now available for operation.',
		hash: result.deployPoolHash,
		rows: [
			{ label: 'Pool', value: <AddressValue address={result.securityPoolAddress} /> },
			{ label: 'Universe', value: <UniverseLink universeId={result.universeId} /> },
			{ label: 'Question ID', value: result.questionId },
			{ label: 'Security Multiplier', value: result.securityMultiplier.toString() },
		],
		title: 'Security Pool Created',
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
		submittedDetail: `${humanizeAction(actionName)} transaction submitted.`,
	})
}

export function createSecurityVaultSuccessPresentation(result: SecurityVaultActionResult) {
	let queuedOperationDetail: string | undefined
	if (result.queuedOperation !== undefined) {
		queuedOperationDetail = result.queuedOperation.isPendingSlot
			? `Staged operation #${result.queuedOperation.operationId.toString()} was queued for the next oracle settlement.`
			: `Staged operation #${result.queuedOperation.operationId.toString()} was queued and must be executed manually after a valid oracle price is available.`
	}
	return buildPresentation({
		detail: queuedOperationDetail ?? `${humanizeAction(result.action)} completed successfully.`,
		hash: result.hash,
		rows: [{ label: 'Action', value: humanizeAction(result.action) }, ...(result.queuedOperation === undefined ? [] : [{ label: 'Staged Operation', value: `#${result.queuedOperation.operationId.toString()}` }])],
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
		submittedDetail: `${humanizeAction(actionName)} transaction submitted.`,
	})
}

export function createTradingSuccessPresentation(result: TradingActionResult) {
	return buildPresentation({
		detail: `${humanizeAction(result.action)} completed successfully.`,
		hash: result.hash,
		rows: [
			{ label: 'Pool', value: <AddressValue address={result.securityPoolAddress} /> },
			{ label: 'Universe', value: <UniverseLink universeId={result.universeId} /> },
			...(result.shareOutcome === undefined ? [] : [{ label: 'Share Outcome', value: getReportingOutcomeLabel(result.shareOutcome) }]),
			...(result.targetOutcomeIndexes === undefined ? [] : [{ label: 'Target Outcome Indexes', value: result.targetOutcomeIndexes.join(', ') }]),
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
		submittedDetail: `${humanizeAction(actionName)} transaction submitted.`,
	})
}

export function createReportingSuccessPresentation(result: ReportingActionResult) {
	return buildPresentation({
		detail: `${humanizeAction(result.action)} completed successfully.`,
		hash: result.hash,
		rows: [
			{ label: 'Pool', value: <AddressValue address={result.securityPoolAddress} /> },
			{ label: 'Universe', value: <UniverseLink universeId={result.universeId} /> },
			{ label: 'Outcome', value: getReportingOutcomeLabel(result.outcome) },
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
		submittedTitle: 'Submitting Liquidation',
		submittedDetail: 'Liquidation transaction submitted.',
	})
}

export function createLiquidationSuccessPresentation(result: SecurityPoolOverviewActionResult) {
	let queuedOperationDetail = 'The liquidation request was submitted successfully.'
	if (result.queuedOperation !== undefined) {
		queuedOperationDetail = result.queuedOperation.isPendingSlot
			? `Liquidation staged as operation #${result.queuedOperation.operationId.toString()} for the next oracle settlement.`
			: `Liquidation staged as operation #${result.queuedOperation.operationId.toString()} and must be executed manually after a valid oracle price is available.`
	}
	return buildPresentation({
		detail: result.stagedExecution?.success === true ? 'The liquidation executed immediately.' : queuedOperationDetail,
		hash: result.hash,
		rows: [{ label: 'Pool', value: <AddressValue address={result.securityPoolAddress} /> }, ...(result.queuedOperation === undefined ? [] : [{ label: 'Staged Operation', value: `#${result.queuedOperation.operationId.toString()}` }])],
		title: result.stagedExecution?.success === true ? 'Liquidation Executed' : 'Liquidation Submitted',
		tone: 'success',
	})
}

export function createLiquidationWarningPresentation(result: SecurityPoolOverviewActionResult, message: string) {
	return withWarning(createLiquidationSuccessPresentation(result), message)
}

export function createPoolOracleTransactionIntent(actionName: 'executeStagedOperation' | 'requestPrice') {
	return buildIntent({
		action: actionName,
		source: 'pool-oracle',
		submittedTitle: actionName === 'requestPrice' ? 'Requesting Price' : 'Executing Staged Operation',
		submittedDetail: actionName === 'requestPrice' ? 'Price request transaction submitted.' : 'Staged-operation transaction submitted.',
	})
}

export function createPoolOracleSuccessPresentation(result: OpenOracleActionResult) {
	return buildPresentation({
		detail: result.action === 'requestPrice' ? 'A new oracle price was requested successfully.' : 'The staged oracle-manager operation was executed successfully.',
		hash: result.hash,
		rows: [{ label: 'Action', value: humanizeAction(result.action) }],
		title: result.action === 'requestPrice' ? 'Price Requested' : 'Staged Operation Executed',
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
		submittedDetail: `${humanizeAction(actionName)} transaction submitted.`,
	})
}

export function createOpenOracleSuccessPresentation(result: OpenOracleActionResult) {
	return buildPresentation({
		detail: `${humanizeAction(result.action)} completed successfully.`,
		hash: result.hash,
		rows: [{ label: 'Action', value: humanizeAction(result.action) }],
		title: humanizeAction(result.action),
		tone: 'success',
	})
}

export function createOpenOracleWarningPresentation(result: OpenOracleActionResult, message: string) {
	return withWarning(createOpenOracleSuccessPresentation(result), message)
}

export function createForkAuctionTransactionIntent(actionName: ForkAuctionActionResult['action']) {
	return buildIntent({
		action: actionName,
		source: 'fork-auction',
		submittedTitle: humanizeAction(actionName),
		submittedDetail: `${humanizeAction(actionName)} transaction submitted.`,
	})
}

export function createForkAuctionSuccessPresentation(result: ForkAuctionActionResult) {
	return buildPresentation({
		detail: `${humanizeAction(result.action)} completed successfully.`,
		hash: result.hash,
		rows: [
			{ label: 'Pool', value: <AddressValue address={result.securityPoolAddress} /> },
			{ label: 'Universe', value: <UniverseLink universeId={result.universeId} /> },
		],
		title: humanizeAction(result.action),
		tone: 'success',
	})
}

export function createForkAuctionWarningPresentation(result: ForkAuctionActionResult, message: string) {
	return withWarning(createForkAuctionSuccessPresentation(result), message)
}
