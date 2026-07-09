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
import { TSX_STRINGS, UI_STRINGS } from './uiStrings.js'

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
	if (value === undefined) return TSX_STRINGS.libTransactionPresentations.copy001
	if (value === null) return TSX_STRINGS.libTransactionPresentations.copy002
	return String(value)
}

function formatPreviewData(data: string) {
	const byteLength = Math.max(0, (data.length - 2) / 2)
	if (data.length <= 74) return data
	return TSX_STRINGS.libTransactionPresentations.copy003(data.slice(0, 66), byteLength.toString())
}

function getPreparedTransactionRows(intent: TransactionIntent, preview: TransactionRequestPreview): GlobalTransactionRow[] {
	const senderAddress = getPreviewAccountAddress(preview.account)
	return [
		...(intent.rows ?? []),
		...(senderAddress === undefined ? [] : [{ label: TSX_STRINGS.libTransactionPresentations.copy004, value: senderAddress }]),
		...(preview.chainName === undefined ? [] : [{ label: TSX_STRINGS.libTransactionPresentations.copy005, value: preview.chainName }]),
		...(preview.contractAddress === undefined ? [] : [{ label: TSX_STRINGS.libTransactionPresentations.copy006, value: preview.contractAddress }]),
		...(preview.to === undefined ? [] : [{ label: TSX_STRINGS.libTransactionPresentations.copy007, value: preview.to }]),
		{ label: TSX_STRINGS.libTransactionPresentations.copy008, value: preview.functionName },
		...(preview.value === undefined || preview.value === 0n ? [] : [{ label: TSX_STRINGS.libTransactionPresentations.copy009, value: `${formatCurrencyBalance(preview.value)} ${UI_STRINGS.common.ethSuffix}` }]),
		...(preview.data === undefined ? [] : [{ label: preview.dataLabel ?? TSX_STRINGS.libTransactionPresentations.copy010, value: formatPreviewData(preview.data) }]),
		...(preview.args === undefined || preview.args.length === 0 ? [] : [{ label: TSX_STRINGS.libTransactionPresentations.copy011, value: preview.args.map(formatPreviewArgument).join(', ') }]),
	]
}

export function createDeploymentTransactionIntent(stepLabel: string) {
	return buildIntent({
		action: 'deploy',
		source: 'deployment',
		submittedTitle: TSX_STRINGS.libTransactionPresentations.copy012(stepLabel),
		submittedDetail: TSX_STRINGS.libTransactionPresentations.copy013,
	})
}

export function createDeploymentSuccessPresentation(stepLabel: string, hash: Hash) {
	return buildPresentation({
		detail: TSX_STRINGS.libTransactionPresentations.copy014(stepLabel),
		hash,
		title: TSX_STRINGS.libTransactionPresentations.copy015(stepLabel),
		tone: 'success',
	})
}

export function createAwaitingWalletPresentation(intent: TransactionIntent, dismissKey: string) {
	if (intent.requiresWalletConfirmation === false)
		return buildHashlessPresentation({
			detail: TSX_STRINGS.libTransactionPresentations.copy016,
			dismissKey,
			title: intent.submittedTitle,
			tone: 'preparing',
			...(intent.rows === undefined ? {} : { rows: intent.rows }),
		})

	return buildHashlessPresentation({
		detail: TSX_STRINGS.libTransactionPresentations.copy017,
		dismissKey,
		title: intent.submittedTitle,
		tone: 'awaiting-wallet',
		...(intent.rows === undefined ? {} : { rows: intent.rows }),
	})
}

export function createPreparedWalletPresentation(intent: TransactionIntent, preview: TransactionRequestPreview, dismissKey: string): GlobalTransactionPresentation {
	const requiresWalletConfirmation = preview.requiresWalletConfirmation ?? intent.requiresWalletConfirmation ?? true
	return buildHashlessPresentation({
		detail: requiresWalletConfirmation ? TSX_STRINGS.libTransactionPresentations.copy018 : TSX_STRINGS.libTransactionPresentations.copy019,
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
		submittedTitle: TSX_STRINGS.libTransactionPresentations.copy020,
		submittedDetail: TSX_STRINGS.libTransactionPresentations.copy021,
	})
}

export function createMarketCreationSuccessPresentation(result: MarketCreationResult) {
	return buildPresentation({
		detail: TSX_STRINGS.libTransactionPresentations.copy022,
		hash: result.createQuestionHash,
		rows: [
			{ label: TSX_STRINGS.libTransactionPresentations.copy023, value: result.questionId },
			{ label: TSX_STRINGS.libTransactionPresentations.copy024, value: result.marketType },
		],
		title: TSX_STRINGS.libTransactionPresentations.copy025,
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
		submittedTitle: actionName === 'approve' ? TSX_STRINGS.libTransactionPresentations.copy026 : TSX_STRINGS.libTransactionPresentations.copy027,
		submittedDetail: actionName === 'approve' ? TSX_STRINGS.libTransactionPresentations.copy028 : TSX_STRINGS.libTransactionPresentations.copy029,
	})
}

export function createZoltarForkSuccessPresentation(result: ZoltarForkActionResult) {
	const title = result.action === 'approveForkRep' ? TSX_STRINGS.libTransactionPresentations.copy030 : TSX_STRINGS.libTransactionPresentations.copy031
	const detail = result.action === 'approveForkRep' ? TSX_STRINGS.libTransactionPresentations.copy032 : TSX_STRINGS.libTransactionPresentations.copy033
	return buildPresentation({
		detail,
		hash: result.hash,
		rows: [
			{ label: TSX_STRINGS.libTransactionPresentations.copy034, value: <UniverseLink universeId={result.universeId} /> },
			{ label: TSX_STRINGS.libTransactionPresentations.copy035, value: result.questionId },
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
		submittedTitle: TSX_STRINGS.libTransactionPresentations.copy036,
		submittedDetail: TSX_STRINGS.libTransactionPresentations.copy037,
	})
}

export function createChildUniverseSuccessPresentation(result: ZoltarChildUniverseActionResult) {
	return buildPresentation({
		detail: TSX_STRINGS.libTransactionPresentations.copy038,
		hash: result.hash,
		rows: [
			{ label: TSX_STRINGS.libTransactionPresentations.copy039, value: <UniverseLink universeId={result.universeId} /> },
			{ label: TSX_STRINGS.libTransactionPresentations.copy040, value: result.outcomeIndex.toString() },
		],
		title: TSX_STRINGS.libTransactionPresentations.copy041,
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
		submittedTitle: actionName === 'prepare' ? TSX_STRINGS.libTransactionPresentations.copy042 : TSX_STRINGS.libTransactionPresentations.copy043,
		submittedDetail: actionName === 'prepare' ? TSX_STRINGS.libTransactionPresentations.copy044 : TSX_STRINGS.libTransactionPresentations.copy045,
	})
}

export function createZoltarMigrationSuccessPresentation(result: ZoltarMigrationActionResult) {
	return buildPresentation({
		detail: result.action === 'addRepToMigrationBalance' ? TSX_STRINGS.libTransactionPresentations.copy046 : TSX_STRINGS.libTransactionPresentations.copy047,
		hash: result.hash,
		rows: [
			{ label: TSX_STRINGS.libTransactionPresentations.copy048, value: <UniverseLink universeId={result.universeId} /> },
			{ label: TSX_STRINGS.libTransactionPresentations.copy049, value: `${formatCurrencyBalance(result.amount)} ${UI_STRINGS.common.repLabel}` },
			{ label: TSX_STRINGS.libTransactionPresentations.copy050, value: result.outcomeIndexes.length === 0 ? UI_STRINGS.common.noneLabel : result.outcomeIndexes.join(', ') },
		],
		title: result.action === 'addRepToMigrationBalance' ? TSX_STRINGS.libTransactionPresentations.copy051 : TSX_STRINGS.libTransactionPresentations.copy052,
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
		submittedTitle: TSX_STRINGS.libTransactionPresentations.copy053,
		submittedDetail: TSX_STRINGS.libTransactionPresentations.copy054,
	})
}

export function createSecurityPoolCreationSuccessPresentation(result: SecurityPoolCreationResult) {
	return buildPresentation({
		detail: TSX_STRINGS.libTransactionPresentations.copy055,
		hash: result.deployPoolHash,
		rows: [
			{ label: TSX_STRINGS.libTransactionPresentations.copy056, value: <AddressValue address={result.securityPoolAddress} /> },
			{ label: TSX_STRINGS.libTransactionPresentations.copy057, value: <UniverseLink universeId={result.universeId} /> },
			{ label: TSX_STRINGS.libTransactionPresentations.copy058, value: result.questionId },
			{ label: TSX_STRINGS.libTransactionPresentations.copy059, value: result.securityMultiplier.toString() },
		],
		title: TSX_STRINGS.libTransactionPresentations.copy060,
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
		submittedDetail: TSX_STRINGS.libTransactionPresentations.copy061(humanizeAction(actionName)),
	})
}

export function createSecurityVaultSuccessPresentation(result: SecurityVaultActionResult) {
	let queuedOperationDetail: string | undefined
	if (result.queuedOperation !== undefined) {
		queuedOperationDetail = result.queuedOperation.isPendingSlot ? TSX_STRINGS.libTransactionPresentations.copy062(result.queuedOperation.operationId.toString()) : TSX_STRINGS.libTransactionPresentations.copy063(result.queuedOperation.operationId.toString())
	}
	return buildPresentation({
		detail: queuedOperationDetail ?? TSX_STRINGS.libTransactionPresentations.copy064(humanizeAction(result.action)),
		hash: result.hash,
		rows: [{ label: TSX_STRINGS.libTransactionPresentations.copy065, value: humanizeAction(result.action) }, ...(result.queuedOperation === undefined ? [] : [{ label: TSX_STRINGS.libTransactionPresentations.copy066, value: `#${result.queuedOperation.operationId.toString()}` }])],
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
		submittedDetail: TSX_STRINGS.libTransactionPresentations.copy067(humanizeAction(actionName)),
	})
}

export function createTradingSuccessPresentation(result: TradingActionResult) {
	const detail = (() => {
		if (result.action === 'createCompleteSet') return TSX_STRINGS.libTransactionPresentations.copy068
		if (result.action === 'redeemCompleteSet') return TSX_STRINGS.libTransactionPresentations.copy069
		if (result.action === 'migrateShares') return TSX_STRINGS.libTransactionPresentations.copy070
		return TSX_STRINGS.libTransactionPresentations.copy071
	})()
	return buildPresentation({
		detail,
		hash: result.hash,
		rows: [
			{ label: TSX_STRINGS.libTransactionPresentations.copy072, value: <AddressValue address={result.securityPoolAddress} /> },
			{ label: TSX_STRINGS.libTransactionPresentations.copy073, value: <UniverseLink universeId={result.universeId} /> },
			...(result.shareOutcome === undefined ? [] : [{ label: TSX_STRINGS.libTransactionPresentations.copy074, value: getReportingOutcomeLabel(result.shareOutcome) }]),
			...(result.targetOutcomeIndexes === undefined ? [] : [{ label: TSX_STRINGS.libTransactionPresentations.copy075, value: result.targetOutcomeIndexes.join(', ') }]),
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
		submittedDetail: TSX_STRINGS.libTransactionPresentations.copy076(humanizeAction(actionName)),
	})
}

export function createReportingSuccessPresentation(result: ReportingActionResult) {
	const detail = result.action === 'reportOutcome' ? TSX_STRINGS.libTransactionPresentations.copy077 : TSX_STRINGS.libTransactionPresentations.copy078
	return buildPresentation({
		detail,
		hash: result.hash,
		rows: [
			{ label: TSX_STRINGS.libTransactionPresentations.copy079, value: <AddressValue address={result.securityPoolAddress} /> },
			{ label: TSX_STRINGS.libTransactionPresentations.copy080, value: <UniverseLink universeId={result.universeId} /> },
			{ label: TSX_STRINGS.libTransactionPresentations.copy081, value: getReportingOutcomeLabel(result.outcome) },
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
		submittedTitle: TSX_STRINGS.libTransactionPresentations.copy082,
		submittedDetail: TSX_STRINGS.libTransactionPresentations.copy083,
	})
}

export function createLiquidationSuccessPresentation(result: SecurityPoolOverviewActionResult) {
	let queuedOperationDetail: string = TSX_STRINGS.libTransactionPresentations.copy084
	if (result.queuedOperation !== undefined) {
		queuedOperationDetail = result.queuedOperation.isPendingSlot ? TSX_STRINGS.libTransactionPresentations.copy085(result.queuedOperation.operationId.toString()) : TSX_STRINGS.libTransactionPresentations.copy086(result.queuedOperation.operationId.toString())
	}
	return buildPresentation({
		detail: result.stagedExecution?.success === true ? TSX_STRINGS.libTransactionPresentations.copy087 : queuedOperationDetail,
		hash: result.hash,
		rows: [{ label: TSX_STRINGS.libTransactionPresentations.copy088, value: <AddressValue address={result.securityPoolAddress} /> }, ...(result.queuedOperation === undefined ? [] : [{ label: TSX_STRINGS.libTransactionPresentations.copy089, value: `#${result.queuedOperation.operationId.toString()}` }])],
		title: result.stagedExecution?.success === true ? TSX_STRINGS.libTransactionPresentations.copy090 : TSX_STRINGS.libTransactionPresentations.copy091,
		tone: 'success',
	})
}

export function createLiquidationWarningPresentation(result: SecurityPoolOverviewActionResult, message: string) {
	return withWarning(createLiquidationSuccessPresentation(result), message)
}

export function createPoolOracleTransactionIntent(actionName: 'executeStagedOperation' | 'requestPrice') {
	let submittedTitle: string = TSX_STRINGS.libTransactionPresentations.copy092
	let submittedDetail: string = TSX_STRINGS.libTransactionPresentations.copy093
	if (actionName === 'requestPrice') {
		submittedTitle = TSX_STRINGS.libTransactionPresentations.copy094
		submittedDetail = TSX_STRINGS.libTransactionPresentations.copy095
	}
	return buildIntent({
		action: actionName,
		source: 'pool-oracle',
		submittedTitle,
		submittedDetail,
	})
}

export function createPoolOracleSuccessPresentation(result: OpenOracleActionResult) {
	let detail: string = TSX_STRINGS.libTransactionPresentations.copy096
	let title: string = TSX_STRINGS.libTransactionPresentations.copy097
	if (result.action === 'requestPrice') {
		detail = TSX_STRINGS.libTransactionPresentations.copy098
		title = TSX_STRINGS.libTransactionPresentations.copy099
	}
	return buildPresentation({
		detail,
		hash: result.hash,
		rows: [{ label: TSX_STRINGS.libTransactionPresentations.copy100, value: humanizeAction(result.action) }],
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
		submittedDetail: TSX_STRINGS.libTransactionPresentations.copy101(humanizeAction(actionName)),
	})
}

export function createOpenOracleSuccessPresentation(result: OpenOracleActionResult) {
	return buildPresentation({
		detail: TSX_STRINGS.libTransactionPresentations.copy102(humanizeAction(result.action)),
		hash: result.hash,
		rows: [{ label: TSX_STRINGS.libTransactionPresentations.copy103, value: humanizeAction(result.action) }],
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
		submittedDetail: TSX_STRINGS.libTransactionPresentations.copy104(String(resolvedSubmittedTitle)),
	})
}

export function createForkAuctionSuccessPresentation(result: ForkAuctionActionResult) {
	const title = result.action === 'claimAuctionProceeds' && result.settlementMode === 'refund' ? TSX_STRINGS.libTransactionPresentations.copy105 : humanizeAction(result.action)
	const detail = (() => {
		switch (result.action) {
			case 'claimAuctionProceeds':
				if (result.settlementMode === 'refund') {
					return TSX_STRINGS.libTransactionPresentations.copy106(AUCTIONED_BOND_ALLOWANCE_LABEL)
				}
				if (result.settlementMode === 'claim') {
					return TSX_STRINGS.libTransactionPresentations.copy107(AUCTIONED_BOND_ALLOWANCE_LABEL)
				}
				return TSX_STRINGS.libTransactionPresentations.copy108(AUCTIONED_BOND_ALLOWANCE_LABEL)
			case 'createChildUniverse':
				return TSX_STRINGS.libTransactionPresentations.copy109
			case 'forkWithOwnEscalation':
				return TSX_STRINGS.libTransactionPresentations.copy110
			case 'forkUniverse':
				return TSX_STRINGS.libTransactionPresentations.copy111
			case 'initiateFork':
				return TSX_STRINGS.libTransactionPresentations.copy112
			case 'migrateEscalationDeposits':
				return TSX_STRINGS.libTransactionPresentations.copy113
			case 'migrateRepToZoltar':
				return TSX_STRINGS.libTransactionPresentations.copy114
			case 'migrateUnresolvedEscalation':
				return TSX_STRINGS.libTransactionPresentations.copy115
			case 'migrateVault':
				return TSX_STRINGS.libTransactionPresentations.copy116
			case 'refundLosingBids':
				return TSX_STRINGS.libTransactionPresentations.copy117
			case 'settleForkedEscalation':
				return TSX_STRINGS.libTransactionPresentations.copy118
			case 'startTruthAuction':
				return TSX_STRINGS.libTransactionPresentations.copy119
			case 'submitBid':
				return TSX_STRINGS.libTransactionPresentations.copy120
			default:
				return TSX_STRINGS.libTransactionPresentations.copy121(humanizeAction(result.action))
		}
	})()
	return buildPresentation({
		detail,
		hash: result.hash,
		rows: [
			{ label: TSX_STRINGS.libTransactionPresentations.copy122, value: <AddressValue address={result.securityPoolAddress} /> },
			{ label: TSX_STRINGS.libTransactionPresentations.copy123, value: <UniverseLink universeId={result.universeId} /> },
		],
		title,
		tone: 'success',
	})
}

export function createForkAuctionWarningPresentation(result: ForkAuctionActionResult, message: string) {
	return withWarning(createForkAuctionSuccessPresentation(result), message)
}
