import { useSignal } from '@preact/signals'
import { useCallback } from 'preact/hooks'
import { useFormState } from '@zoltar/ui-core-shared/hooks/useFormState.js'
import type { Address } from '@zoltar/shared/ethereum'
import { migrateInternalRepInZoltar, prepareRepForMigrationInZoltar } from '../../../protocol/index.js'
import { createWalletWriteClient } from '@zoltar/ui-core-shared/lib/clients.js'
import { formatRefreshErrorMessage, formatWriteErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '@zoltar/ui-core-shared/lib/actionFeedback.js'
import type { ActionFeedback } from '@zoltar/ui-core-shared/lib/actionFeedback.js'
import { createZoltarMigrationSuccessPresentation, createZoltarMigrationTransactionIntent, createZoltarMigrationWarningPresentation } from '../../transactionPresentations.js'
import { requireWallet } from '@zoltar/ui-core-shared/lib/requireWalletConnection.js'
import { assertActiveWallet } from '@zoltar/ui-core-shared/lib/assertActiveWallet.js'
import { parseBigIntListInput } from '@zoltar/ui-core-shared/lib/inputs.js'
import { getDefaultZoltarMigrationFormState } from '../../../lib/formDefaults.js'
import { parseRepAmountInput } from '@zoltar/ui-core-shared/lib/formInputs.js'
import { refreshWalletStateOnly } from '@zoltar/ui-core-shared/lib/refreshState.js'
import type { TransactionLifecycleParameters, WriteOperationContext, ZoltarMigrationFormState } from '../../../types/app.js'
import type { ZoltarMigrationActionResult, ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'

type UseZoltarMigrationParameters = TransactionLifecycleParameters &
	WriteOperationContext & {
		activeUniverseId: bigint
		ensureZoltarUniverse: () => Promise<ZoltarUniverseSummary>
		refreshZoltarForkAccess: (universe?: ZoltarUniverseSummary) => Promise<void>
		refreshZoltarUniverse: () => Promise<ZoltarUniverseSummary | undefined>
		zoltarForkRepBalanceAttoRep: bigint | undefined
		zoltarMigrationPreparedRepBalanceAttoRep: bigint | undefined
	}

type RunZoltarMigrationActionParameters = {
	actionName: 'prepare' | 'split'
	action: (walletAddress: Address, universe: ZoltarUniverseSummary, amount: bigint, outcomeIndexes: bigint[]) => Promise<ZoltarMigrationActionResult>
	errorFallback: string
	refreshAfter: boolean
	requiresOutcomeIndexes: boolean
	resolveAmount?: (amountAttoRep: bigint, preparedRepBalanceAttoRep: bigint | undefined, repBalanceAttoRep: bigint | undefined) => bigint
}

function resolvePrepareMigrationAmount(amountAttoRep: bigint, preparedRepBalanceAttoRep: bigint | undefined, repBalanceAttoRep: bigint | undefined) {
	const currentPreparedBalanceAttoRep = preparedRepBalanceAttoRep ?? 0n
	const missingAmountAttoRep = amountAttoRep > currentPreparedBalanceAttoRep ? amountAttoRep - currentPreparedBalanceAttoRep : 0n
	if (missingAmountAttoRep === 0n) throw new Error('Selected amount is already prepared')
	const currentRepBalanceAttoRep = repBalanceAttoRep ?? 0n
	if (currentRepBalanceAttoRep < missingAmountAttoRep) throw new Error('Not enough REP in this universe to prepare the selected amount')
	return missingAmountAttoRep
}

export function useZoltarMigration({
	accountAddress,
	activeUniverseId,
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
	zoltarForkRepBalanceAttoRep,
	zoltarMigrationPreparedRepBalanceAttoRep,
}: UseZoltarMigrationParameters) {
	const zoltarMigrationError = useSignal<string | undefined>(undefined)
	const zoltarMigrationPending = useSignal(false)
	const zoltarMigrationFeedback = useSignal<ActionFeedback<ZoltarMigrationActionResult['action']> | undefined>(undefined)
	const zoltarMigrationResult = useSignal<ZoltarMigrationActionResult | undefined>(undefined)
	const zoltarMigrationActiveAction = useSignal<'prepare' | 'split' | undefined>(undefined)
	const { state: zoltarMigrationForm, setState: setZoltarMigrationForm } = useFormState<ZoltarMigrationFormState>(getDefaultZoltarMigrationFormState())
	const resolveActionResultName = (actionName: 'prepare' | 'split') => (actionName === 'prepare' ? 'addRepToMigrationBalance' : 'splitMigrationRep')
	const getPendingTitle = (actionName: 'prepare' | 'split') => (actionName === 'prepare' ? 'Preparing REP for migration' : 'Migrating REP')
	const getSuccessTitle = (actionName: 'prepare' | 'split') => (actionName === 'prepare' ? 'REP prepared for migration' : 'REP migrated')
	const getFailureTitle = (actionName: 'prepare' | 'split') => (actionName === 'prepare' ? 'REP preparation failed' : 'REP migration failed')

	const runZoltarMigrationAction = useCallback(
		async ({ actionName, action, errorFallback, refreshAfter, requiresOutcomeIndexes, resolveAmount = amount => amount }: RunZoltarMigrationActionParameters) => {
			let writeFailed = false
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

			zoltarMigrationPending.value = true
			zoltarMigrationActiveAction.value = actionName
			zoltarMigrationError.value = undefined
			zoltarMigrationFeedback.value = createPendingActionFeedback(resolveActionResultName(actionName), getPendingTitle(actionName))
			zoltarMigrationResult.value = undefined
			const submittedForm = zoltarMigrationForm.value

			try {
				await assertActiveWallet(accountAddress)
				onTransactionRequested(
					createZoltarMigrationTransactionIntent(actionName, {
						amount: submittedForm.amount,
						outcomeIndexes: actionName === 'split' ? submittedForm.outcomeIndexes : undefined,
						universeId: activeUniverseId,
					}),
				)
				const universe = await ensureZoltarUniverse()
				if (!universe.hasForked) throw new Error('Migration is unavailable because this universe has not forked.')
				const amount = parseRepAmountInput(submittedForm.amount, 'Migration amount')
				if (amount <= 0n) throw new Error('Migration amount must be greater than zero')
				const resolvedAmount = resolveAmount(amount, zoltarMigrationPreparedRepBalanceAttoRep, zoltarForkRepBalanceAttoRep)
				const outcomeIndexes = requiresOutcomeIndexes ? parseBigIntListInput(submittedForm.outcomeIndexes, 'Outcome indexes') : []
				const result = await action(accountAddress, universe, resolvedAmount, outcomeIndexes)
				zoltarMigrationResult.value = result
				zoltarMigrationFeedback.value = createSuccessActionFeedback(result.action, getSuccessTitle(actionName), result.hash)
				onTransactionPresented(createZoltarMigrationSuccessPresentation(result))
			} catch (error) {
				const message = formatWriteErrorMessage(error, errorFallback)
				writeFailed = true
				onTransactionFailed?.(message)
				zoltarMigrationFeedback.value = createErrorActionFeedback(resolveActionResultName(actionName), getFailureTitle(actionName), message)
			} finally {
				zoltarMigrationPending.value = false
				zoltarMigrationActiveAction.value = undefined
				onTransactionFinished()
			}

			try {
				if (writeFailed) return
				let refreshedUniverse: ZoltarUniverseSummary | undefined
				if (refreshAfter) {
					await refreshWalletStateOnly(refreshState)
					refreshedUniverse = await refreshZoltarUniverse()
				}
				await refreshZoltarForkAccess(refreshedUniverse)
			} catch (error) {
				const message = formatRefreshErrorMessage(error, 'Migration succeeded, but refreshing the UI failed')
				const latestResult = zoltarMigrationResult.value
				zoltarMigrationFeedback.value = createWarningActionFeedback(latestResult?.action ?? resolveActionResultName(actionName), getSuccessTitle(actionName), message, latestResult?.hash)
				if (latestResult !== undefined) onTransactionPresented(createZoltarMigrationWarningPresentation(latestResult, message))
			}
		},
		[
			accountAddress,
			ensureZoltarUniverse,
			onTransactionFinished,
			onTransactionFailed,
			onTransactionPresented,
			onTransactionRequested,
			onTransactionSubmitted,
			refreshState,
			refreshZoltarForkAccess,
			refreshZoltarUniverse,
			zoltarForkRepBalanceAttoRep,
			zoltarMigrationPreparedRepBalanceAttoRep,
			zoltarMigrationError,
			zoltarMigrationPending,
			zoltarMigrationResult,
			zoltarMigrationActiveAction,
		],
	)

	const prepareRepForMigration = useCallback(async () => {
		await runZoltarMigrationAction({
			actionName: 'prepare',
			action: async (walletAddress, universe, amount) => await prepareRepForMigrationInZoltar(createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), universe.universeId, amount),
			errorFallback: 'Failed to prepare REP for migration',
			refreshAfter: false,
			requiresOutcomeIndexes: false,
			resolveAmount: resolvePrepareMigrationAmount,
		})
	}, [onTransactionPrepared, onTransactionSubmitted, runZoltarMigrationAction])

	const migrateInternalRep = useCallback(async () => {
		await runZoltarMigrationAction({
			actionName: 'split',
			action: async (walletAddress, universe, amount, outcomeIndexes) => await migrateInternalRepInZoltar(createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), universe.universeId, amount, outcomeIndexes),
			errorFallback: 'Failed to migrate REP',
			refreshAfter: true,
			requiresOutcomeIndexes: true,
		})
	}, [onTransactionPrepared, onTransactionSubmitted, runZoltarMigrationAction])

	return {
		migrateInternalRep,
		prepareRepForMigration,
		setZoltarMigrationForm,
		zoltarMigrationActiveAction: zoltarMigrationActiveAction.value,
		zoltarMigrationError: zoltarMigrationError.value,
		zoltarMigrationFeedback: zoltarMigrationFeedback.value,
		zoltarMigrationForm: zoltarMigrationForm.value,
		zoltarMigrationPending: zoltarMigrationPending.value,
	}
}
