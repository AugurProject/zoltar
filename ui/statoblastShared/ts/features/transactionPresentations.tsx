import * as transactionCopy from '@zoltar/ui-core-shared/copy/transaction.js'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { getReportingOutcomeLabel } from './reporting/lib/reporting.js'
import { buildIntent, buildPresentation, getPoolUniverseTransactionRows, humanizeTransactionAction, withWarning } from '@zoltar/ui-core-shared/transactions/transactionPresentations.js'
import type { PoolUniverseTransactionContext } from '@zoltar/ui-core-shared/transactions/transactionPresentations.js'
import { securityPoolTransactionScope } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import type { ReportingActionResult, TradingActionResult } from '../types/contracts.js'

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
