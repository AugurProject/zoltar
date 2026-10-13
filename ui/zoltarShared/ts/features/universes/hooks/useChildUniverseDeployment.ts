import * as marketCopy from '../../../copy/market.js'
import * as transactionCopy from '@zoltar/ui-core-shared/copy/transaction.js'

import { useSignal } from '@preact/signals'
import type { TransactionRequestKey } from '@zoltar/ui-core-shared/types/app.js'
import { getTransactionFailureKind } from '@zoltar/ui-core-shared/transactions/transactionLifecycle.js'

import type { Address } from '@zoltar/core-shared/evm/ethereum'

import { formatRefreshErrorMessage, formatWriteErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '@zoltar/ui-core-shared/transactions/actionFeedback.js'
import type { ActionFeedback } from '@zoltar/ui-core-shared/transactions/actionFeedback.js'
import { createChildUniverseSuccessPresentation, createChildUniverseTransactionIntent, createChildUniverseWarningPresentation } from '../../zoltarTransactionPresentations.js'
import { getOutcomeLabelForIndex } from '../lib/migrationWizard.js'

import { requireWallet } from '@zoltar/ui-core-shared/wallet/requireWalletConnection.js'

import { assertActiveWallet } from '@zoltar/ui-core-shared/wallet/assertActiveWallet.js'
import { createActiveEnvironmentGuard } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import type { TransactionLifecycleParameters } from '../../../types/app.js'

import type { ZoltarChildUniverseActionResult, ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'

import type { UseZoltarUniverseDependencies } from './zoltarUniverseServices.js'

type ChildUniverseDeploymentOptions = TransactionLifecycleParameters & {
	accountAddress: Address | undefined
	activeUniverseId: bigint
	universe: ZoltarUniverseSummary | undefined
	ensureZoltarUniverse: () => Promise<ZoltarUniverseSummary>
	refreshZoltarUniverse: () => Promise<unknown>
}

export function useChildUniverseDeployment(
	{ accountAddress, activeUniverseId, universe, ensureZoltarUniverse, refreshZoltarUniverse, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted }: ChildUniverseDeploymentOptions,
	dependencies: Pick<UseZoltarUniverseDependencies, 'createZoltarChildUniverse' | 'createWalletWriteClient'>,
) {
	const zoltarChildUniverseError = useSignal<string | undefined>(undefined)
	const zoltarChildUniverseFeedback = useSignal<ActionFeedback<'createChildUniverse'> | undefined>(undefined)
	const zoltarChildUniversePendingOutcomeIndex = useSignal<bigint | undefined>(undefined)
	const createChildUniverse = async (outcomeIndex: bigint) => {
		if (
			!requireWallet(
				accountAddress,
				message => {
					zoltarChildUniverseError.value = message
				},
				'creating a child universe',
			)
		)
			return
		const environmentGuard = createActiveEnvironmentGuard()

		zoltarChildUniverseError.value = undefined
		zoltarChildUniverseFeedback.value = createPendingActionFeedback('createChildUniverse', transactionCopy.deployingChildUniverse)
		zoltarChildUniversePendingOutcomeIndex.value = outcomeIndex
		let ownsTransaction = false
		let requestKey: TransactionRequestKey | undefined
		try {
			let result: ZoltarChildUniverseActionResult | undefined
			let outcomeLabel = getOutcomeLabelForIndex(universe?.childUniverses, outcomeIndex)
			try {
				await assertActiveWallet(accountAddress)
				if (!environmentGuard.isCurrent()) return
				const request = onTransactionRequested(createChildUniverseTransactionIntent('zoltar', { outcomeLabel, universeId: activeUniverseId }))
				if (request === false) {
					zoltarChildUniverseFeedback.value = undefined
					return
				}
				ownsTransaction = true
				requestKey = typeof request === 'string' ? request : undefined
				const universe = await ensureZoltarUniverse()
				if (!environmentGuard.isCurrent()) return
				if (!universe.hasForked) throw new Error(marketCopy.childUniversesNotForkedReason)
				const transaction = await dependencies.createZoltarChildUniverse(dependencies.createWalletWriteClient(accountAddress, { onTransactionPrepared, onTransactionSubmitted }), universe.universeId, outcomeIndex)
				if (!environmentGuard.isCurrent()) return
				result = {
					action: 'createChildUniverse',
					hash: transaction.hash,
					outcomeIndex,
					universeId: universe.universeId,
				}
				zoltarChildUniverseFeedback.value = createSuccessActionFeedback('createChildUniverse', transactionCopy.childUniverseDeployed, result.hash)
				outcomeLabel = getOutcomeLabelForIndex(universe.childUniverses, outcomeIndex)
				onTransactionPresented(createChildUniverseSuccessPresentation(result, outcomeLabel))
			} catch (error) {
				if (!environmentGuard.isCurrent()) return
				const message = formatWriteErrorMessage(error, 'Failed to deploy child universe')
				if (ownsTransaction) onTransactionFailed?.(message, { kind: getTransactionFailureKind(error), requestKey })
				if (!ownsTransaction) zoltarChildUniverseError.value = message
				zoltarChildUniverseFeedback.value = createErrorActionFeedback('createChildUniverse', 'Child universe deployment failed', message)
				return
			}

			try {
				await refreshZoltarUniverse()
			} catch (error) {
				if (!environmentGuard.isCurrent()) return
				const message = formatRefreshErrorMessage(error, 'The child universe was deployed, but the page could not be refreshed.')
				zoltarChildUniverseFeedback.value = createWarningActionFeedback('createChildUniverse', transactionCopy.childUniverseDeployed, message, result?.hash)
				if (result !== undefined) onTransactionPresented(createChildUniverseWarningPresentation(result, outcomeLabel, message))
			}
		} finally {
			if (environmentGuard.isCurrent()) {
				zoltarChildUniversePendingOutcomeIndex.value = undefined
				if (ownsTransaction) onTransactionFinished(requestKey)
			}
		}
	}

	return {
		createChildUniverse,
		zoltarChildUniverseFeedback: zoltarChildUniverseFeedback.value,
		zoltarChildUniverseError: zoltarChildUniverseError.value,
		zoltarChildUniversePendingOutcomeIndex: zoltarChildUniversePendingOutcomeIndex.value,
		reset: ({ keepFeedback = false }: { keepFeedback?: boolean } = {}) => {
			zoltarChildUniverseError.value = undefined
			zoltarChildUniversePendingOutcomeIndex.value = undefined
			if (!keepFeedback) zoltarChildUniverseFeedback.value = undefined
		},
	}
}
