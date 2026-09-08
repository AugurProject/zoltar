import { useSignal } from '@preact/signals'
import { useCallback, useEffect } from 'preact/hooks'
import { useFormState } from '@zoltar/ui-core-shared/hooks/useFormState.js'
import { migrateInternalRepInZoltar } from '../../../protocol/zoltarForks.js'
import { createWalletWriteClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { formatRefreshErrorMessage, formatWriteErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '@zoltar/ui-core-shared/transactions/actionFeedback.js'
import type { ActionFeedback } from '@zoltar/ui-core-shared/transactions/actionFeedback.js'
import { createZoltarMigrationSuccessPresentation, createZoltarMigrationTransactionIntent, createZoltarMigrationWarningPresentation } from '../../zoltarTransactionPresentations.js'
import { requireWallet } from '@zoltar/ui-core-shared/wallet/requireWalletConnection.js'
import { assertActiveWallet } from '@zoltar/ui-core-shared/wallet/assertActiveWallet.js'
import { parseBigIntListInput } from '@zoltar/ui-core-shared/forms/inputs.js'
import { getDefaultZoltarMigrationFormState } from '../../../lib/formDefaults.js'
import { parseRepAmountInput } from '@zoltar/ui-core-shared/forms/formInputs.js'
import { refreshWalletStateOnly } from '@zoltar/ui-core-shared/lib/refreshState.js'
import type { TransactionLifecycleParameters, WriteOperationContext, ZoltarMigrationFormState } from '../../../types/app.js'
import type { ZoltarMigrationActionResult, ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { createActiveEnvironmentGuard } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { TRANSACTION_ACTION_LOCK_REASON } from '@zoltar/ui-core-shared/transactions/transactionTray.js'

type UseZoltarMigrationParameters = TransactionLifecycleParameters &
	WriteOperationContext & {
		activeUniverseId: bigint
		environmentRefreshKey: number
		ensureZoltarUniverse: () => Promise<ZoltarUniverseSummary>
		refreshZoltarForkAccess: (universe?: ZoltarUniverseSummary) => Promise<void>
		refreshZoltarUniverse: () => Promise<ZoltarUniverseSummary | undefined>
	}

export function useZoltarMigration({
	accountAddress,
	activeUniverseId,
	environmentRefreshKey,
	ensureZoltarUniverse,
	onTransactionFailed,
	onTransactionFinished,
	onTransactionPresented,
	onTransactionPrepared,
	onTransactionRequested,
	onTransactionSubmitted,
	refreshState,
	refreshZoltarForkAccess,
	refreshZoltarUniverse,
}: UseZoltarMigrationParameters) {
	const zoltarMigrationError = useSignal<string | undefined>(undefined)
	const zoltarMigrationPending = useSignal(false)
	const zoltarMigrationFeedback = useSignal<ActionFeedback<ZoltarMigrationActionResult['action']> | undefined>(undefined)
	const zoltarMigrationResult = useSignal<ZoltarMigrationActionResult | undefined>(undefined)
	const zoltarMigrationActiveAction = useSignal<'split' | undefined>(undefined)
	const { state: zoltarMigrationForm, setState: setZoltarMigrationForm } = useFormState<ZoltarMigrationFormState>(getDefaultZoltarMigrationFormState())
	useEffect(() => {
		zoltarMigrationError.value = undefined
		zoltarMigrationPending.value = false
		zoltarMigrationFeedback.value = undefined
		zoltarMigrationResult.value = undefined
		zoltarMigrationActiveAction.value = undefined
	}, [environmentRefreshKey])

	const migrateInternalRep = useCallback(
		async (preparationAttoRep: bigint) => {
			if (zoltarMigrationPending.value) return
			let writeFailed = false
			let ownsTransaction = false
			if (
				!requireWallet(
					accountAddress,
					message => {
						zoltarMigrationError.value = message
					},
					'using REP migration actions',
				)
			)
				return
			const environmentGuard = createActiveEnvironmentGuard()

			zoltarMigrationPending.value = true
			zoltarMigrationActiveAction.value = 'split'
			zoltarMigrationError.value = undefined
			zoltarMigrationFeedback.value = createPendingActionFeedback('splitMigrationRep', 'Splitting REP')
			zoltarMigrationResult.value = undefined
			const submittedForm = zoltarMigrationForm.value

			try {
				await assertActiveWallet(accountAddress)
				if (!environmentGuard.isCurrent()) return
				if (
					onTransactionRequested(
						createZoltarMigrationTransactionIntent('split', {
							amount: submittedForm.amount,
							outcomeIndexes: submittedForm.outcomeIndexes,
							universeId: activeUniverseId,
						}),
					) === false
				) {
					writeFailed = true
					zoltarMigrationFeedback.value = createErrorActionFeedback('splitMigrationRep', 'REP split failed', TRANSACTION_ACTION_LOCK_REASON)
					return
				}
				ownsTransaction = true
				const universe = await ensureZoltarUniverse()
				if (!environmentGuard.isCurrent()) return
				const amount = parseRepAmountInput(submittedForm.amount, 'Migration amount')
				if (amount <= 0n) throw new Error('Migration amount must be greater than zero')
				const outcomeIndexes = parseBigIntListInput(submittedForm.outcomeIndexes, 'Outcome indexes')
				const result = await migrateInternalRepInZoltar(createWalletWriteClient(accountAddress, { onTransactionPrepared, onTransactionSubmitted }), universe.universeId, amount, outcomeIndexes, preparationAttoRep)
				if (!environmentGuard.isCurrent()) return
				zoltarMigrationResult.value = result
				zoltarMigrationFeedback.value = createSuccessActionFeedback(result.action, 'REP split', result.hash)
				onTransactionPresented(createZoltarMigrationSuccessPresentation(result))
			} catch (error) {
				if (!environmentGuard.isCurrent()) return
				const message = formatWriteErrorMessage(error, 'Failed to migrate REP')
				writeFailed = true
				if (ownsTransaction) onTransactionFailed?.(message)
				zoltarMigrationFeedback.value = createErrorActionFeedback('splitMigrationRep', 'REP split failed', message)
			} finally {
				if (environmentGuard.isCurrent()) {
					zoltarMigrationPending.value = false
					zoltarMigrationActiveAction.value = undefined
					if (ownsTransaction) onTransactionFinished()
				}
			}

			try {
				if (writeFailed) return
				await refreshWalletStateOnly(refreshState)
				if (!environmentGuard.isCurrent()) return
				const refreshedUniverse = await refreshZoltarUniverse()
				if (!environmentGuard.isCurrent()) return
				await refreshZoltarForkAccess(refreshedUniverse)
			} catch (error) {
				if (!environmentGuard.isCurrent()) return
				const message = formatRefreshErrorMessage(error, 'Migration succeeded, but refreshing the UI failed')
				const latestResult = zoltarMigrationResult.value
				zoltarMigrationFeedback.value = createWarningActionFeedback(latestResult?.action ?? 'splitMigrationRep', 'REP split', message, latestResult?.hash)
				if (latestResult !== undefined) onTransactionPresented(createZoltarMigrationWarningPresentation(latestResult, message))
			}
		},
		[
			accountAddress,
			environmentRefreshKey,
			ensureZoltarUniverse,
			onTransactionFinished,
			onTransactionFailed,
			onTransactionPresented,
			onTransactionRequested,
			onTransactionPrepared,
			onTransactionSubmitted,
			refreshState,
			refreshZoltarForkAccess,
			refreshZoltarUniverse,
			zoltarMigrationError,
			zoltarMigrationPending,
			zoltarMigrationResult,
			zoltarMigrationActiveAction,
		],
	)

	return {
		migrateInternalRep,
		setZoltarMigrationForm,
		zoltarMigrationActiveAction: zoltarMigrationActiveAction.value,
		zoltarMigrationError: zoltarMigrationError.value,
		zoltarMigrationFeedback: zoltarMigrationFeedback.value,
		zoltarMigrationForm: zoltarMigrationForm.value,
		zoltarMigrationPending: zoltarMigrationPending.value,
	}
}
