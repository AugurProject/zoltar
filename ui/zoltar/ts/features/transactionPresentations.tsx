import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as transactionCopy from '@zoltar/ui-core-shared/copy/transaction.js'
import * as marketCopy from '../copy/market.js'
import * as openOracleCopy from '../copy/openOracle.js'
import * as securityPoolCopy from '../copy/securityPool.js'
import type { Hash } from '@zoltar/shared/ethereum'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { IdentifierValue } from '@zoltar/ui-core-shared/components/IdentifierValue.js'
import { UniverseLink } from './universes/components/UniverseLink.js'
import { formatCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { getReportingOutcomeLabel } from './reporting/lib/reporting.js'
import { getMarketTypeLabel } from '@zoltar/ui-core-shared/lib/marketType.js'
import { buildIntent, buildPresentation, withWarning } from '@zoltar/ui-core-shared/lib/transactionPresentations.js'
import type { MarketCreationResult, OpenOracleActionResult, ReportingActionResult, ZoltarChildUniverseActionResult, ZoltarForkActionResult, ZoltarMigrationActionResult } from '@zoltar/ui-core-shared/types/contracts.js'
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
			{ label: commonCopy.amount, value: `${formatCurrencyBalance(result.amountAttoRep)} ${commonCopy.rep}` },
			{ label: transactionCopy.outcomeIndexes, value: result.outcomeIndexes.length === 0 ? commonCopy.none : result.outcomeIndexes.join(', ') },
		],
		title: result.action === 'addRepToMigrationBalance' ? transactionCopy.repPrepared : transactionCopy.repSplit,
		tone: 'success',
	})
}

export function createZoltarMigrationWarningPresentation(result: ZoltarMigrationActionResult, message: string) {
	return withWarning(createZoltarMigrationSuccessPresentation(result), message)
}

type PoolUniverseTransactionContext = {
	securityPoolAddress?: string | undefined
	universeId?: bigint | undefined
}

function getPoolUniverseTransactionRows(context: PoolUniverseTransactionContext | undefined) {
	if (context === undefined) return undefined
	return [
		...(context.securityPoolAddress === undefined || context.securityPoolAddress.trim() === '' ? [] : [{ identityKey: 'security-pool', label: transactionCopy.pool, value: <AddressValue address={context.securityPoolAddress} /> }]),
		...(context.universeId === undefined ? [] : [{ identityKey: 'universe', label: commonCopy.universe, value: <UniverseLink universeId={context.universeId} /> }]),
	]
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
	if (actionName === 'settle') return openOracleCopy.settlingReportTitle
	if (actionName === 'withdrawBalance') return openOracleCopy.withdrawBalance(context?.withdrawalTokenSymbol ?? openOracleCopy.oracleBalance)
	return humanizeAction(actionName)
}

function getOpenOracleSuccessTitle(actionName: OpenOracleActionResult['action'], context: OpenOracleTransactionContext | undefined) {
	if (actionName === 'approveToken1') return openOracleCopy.formatTokenApproved(context?.token1Symbol ?? openOracleCopy.baseToken)
	if (actionName === 'approveToken2') return openOracleCopy.formatTokenApproved(context?.token2Symbol ?? openOracleCopy.quoteToken)
	if (actionName === 'createReportInstance') return openOracleCopy.reportCreated
	if (actionName === 'settle') return openOracleCopy.reportSettled
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
