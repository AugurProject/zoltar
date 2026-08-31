import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as transactionCopy from '@zoltar/ui-core-shared/copy/transaction.js'
import * as marketCopy from '../copy/market.js'
import type { Hash } from '@zoltar/shared/ethereum'
import { IdentifierValue } from '@zoltar/ui-core-shared/components/IdentifierValue.js'
import { formatCurrencyBalanceWithUnit, formatValueWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
import { getMarketTypeLabel } from '@zoltar/ui-core-shared/lib/marketType.js'
import { buildIntent, buildPresentation, withWarning } from '@zoltar/ui-core-shared/lib/transactionPresentations.js'
import type { MarketCreationResult, ZoltarChildUniverseActionResult, ZoltarForkActionResult, ZoltarMigrationActionResult } from '@zoltar/ui-core-shared/types/contracts.js'

export function createDeploymentTransactionIntent(stepLabel: string) {
	return buildIntent({ action: 'deploy', source: 'deployment', submittedTitle: transactionCopy.formatDeployingValue(stepLabel) })
}

export function createDeploymentSuccessPresentation(stepLabel: string, hash: Hash) {
	return buildPresentation({ hash, title: transactionCopy.formatValueDeployed(stepLabel), tone: 'success' })
}

type MarketCreationTransactionContext = {
	marketType: MarketCreationResult['marketType']
	title?: string | undefined
}

function getMarketCreationTransactionRows(context: MarketCreationTransactionContext) {
	return [...(context.title === undefined || context.title.trim() === '' ? [] : [{ label: marketCopy.title, value: context.title.trim() }]), { label: marketCopy.questionType, value: getMarketTypeLabel(context.marketType) }]
}

export function createMarketCreationTransactionIntent(context: MarketCreationTransactionContext) {
	return buildIntent({ action: 'createMarket', rows: getMarketCreationTransactionRows(context), source: 'zoltar', submittedTitle: transactionCopy.creatingQuestion })
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

type QuestionUniverseTransactionContext = { questionId?: string | undefined; universeId?: bigint | undefined }

function getQuestionUniverseTransactionRows(context: QuestionUniverseTransactionContext | undefined) {
	if (context === undefined) return undefined
	return [...(context.questionId === undefined || context.questionId.trim() === '' ? [] : [{ label: commonCopy.questionId, value: <IdentifierValue value={context.questionId.trim()} /> }])]
}

export function createZoltarForkTransactionIntent(actionName: 'approve' | 'fork', context?: QuestionUniverseTransactionContext) {
	return buildIntent({ action: actionName, rows: getQuestionUniverseTransactionRows(context), source: 'zoltar', submittedTitle: actionName === 'approve' ? transactionCopy.approvingForkRep : transactionCopy.forkingZoltar, universeId: context?.universeId })
}

export function createZoltarForkSuccessPresentation(result: ZoltarForkActionResult) {
	return buildPresentation({
		hash: result.hash,
		rows: [{ label: commonCopy.questionId, value: <IdentifierValue value={result.questionId} /> }],
		title: result.action === 'approveForkRep' ? transactionCopy.forkRepApproved : transactionCopy.zoltarForkSubmitted,
		tone: 'success',
		universeId: result.universeId,
	})
}

export function createZoltarForkWarningPresentation(result: ZoltarForkActionResult, message: string) {
	return withWarning(createZoltarForkSuccessPresentation(result), message)
}

type ChildUniverseTransactionContext = { outcomeIndex?: bigint | undefined; universeId?: bigint | undefined }

function getChildUniverseTransactionRows(context: ChildUniverseTransactionContext | undefined) {
	if (context === undefined) return undefined
	return context.outcomeIndex === undefined ? [] : [{ label: commonCopy.outcomeIndex, value: context.outcomeIndex.toString() }]
}

export function createChildUniverseTransactionIntent(source: 'fork-auction' | 'zoltar', context?: ChildUniverseTransactionContext) {
	return buildIntent({ action: 'createChildUniverse', rows: getChildUniverseTransactionRows(context), source, submittedTitle: transactionCopy.deployingChildUniverse, universeId: context?.universeId })
}

export function createChildUniverseSuccessPresentation(result: ZoltarChildUniverseActionResult) {
	return buildPresentation({ hash: result.hash, rows: [{ label: commonCopy.outcomeIndex, value: result.outcomeIndex.toString() }], title: transactionCopy.childUniverseDeployed, tone: 'success', universeId: result.universeId })
}

export function createChildUniverseWarningPresentation(result: ZoltarChildUniverseActionResult, message: string) {
	return withWarning(createChildUniverseSuccessPresentation(result), message)
}

type ZoltarMigrationTransactionContext = { amount?: string | undefined; outcomeIndexes?: string | undefined; universeId?: bigint | undefined }

function getZoltarMigrationTransactionRows(context: ZoltarMigrationTransactionContext | undefined) {
	if (context === undefined) return undefined
	return [
		...(context.amount === undefined || context.amount.trim() === '' ? [] : [{ label: commonCopy.amount, value: formatValueWithUnit(context.amount.trim(), commonCopy.rep) }]),
		...(context.outcomeIndexes === undefined || context.outcomeIndexes.trim() === '' ? [] : [{ label: transactionCopy.outcomeIndexes, value: context.outcomeIndexes.trim() }]),
	]
}

export function createZoltarMigrationTransactionIntent(actionName: 'prepare' | 'split', context?: ZoltarMigrationTransactionContext) {
	return buildIntent({ action: actionName, rows: getZoltarMigrationTransactionRows(context), source: 'zoltar', submittedTitle: actionName === 'prepare' ? transactionCopy.preparingRep : transactionCopy.splittingRep, universeId: context?.universeId })
}

export function createZoltarMigrationSuccessPresentation(result: ZoltarMigrationActionResult) {
	return buildPresentation({
		detail: result.action === 'addRepToMigrationBalance' ? transactionCopy.migrationRepPreparationSuccessDetail : transactionCopy.repSplitSuccessDetail,
		hash: result.hash,
		rows: [
			{ label: commonCopy.amount, value: formatCurrencyBalanceWithUnit(result.amountAttoRep, commonCopy.rep) },
			{ label: transactionCopy.outcomeIndexes, value: result.outcomeIndexes.length === 0 ? commonCopy.none : result.outcomeIndexes.join(', ') },
		],
		title: result.action === 'addRepToMigrationBalance' ? transactionCopy.repPrepared : transactionCopy.repSplit,
		tone: 'success',
		universeId: result.universeId,
	})
}

export function createZoltarMigrationWarningPresentation(result: ZoltarMigrationActionResult, message: string) {
	return withWarning(createZoltarMigrationSuccessPresentation(result), message)
}
