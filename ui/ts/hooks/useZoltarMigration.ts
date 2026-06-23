import { useSignal } from '@preact/signals'
import { useCallback } from 'preact/hooks'
import { useFormState } from './useFormState.js'
import type { Address, Hash } from 'viem'
import { migrateInternalRepInZoltar, prepareRepForMigrationInZoltar } from '../contracts.js'
import { createWalletWriteClient } from '../lib/clients.js'
import { formatRefreshErrorMessage, formatWriteErrorMessage } from '../lib/errors.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '../lib/actionFeedback.js'
import type { ActionFeedback } from '../lib/actionFeedback.js'
import { createZoltarMigrationSuccessPresentation, createZoltarMigrationTransactionIntent, createZoltarMigrationWarningPresentation } from '../lib/transactionPresentations.js'
import { requireWallet } from '../lib/walletGuard.js'
import { assertActiveWallet } from '../lib/walletGuards.js'
import { parseBigIntListInput } from '../lib/inputs.js'
import { getDefaultZoltarMigrationFormState, parseRepAmountInput } from '../lib/marketForm.js'
import type { WriteOperationsParameters, ZoltarMigrationFormState } from '../types/app.js'
import type { ZoltarMigrationActionResult, ZoltarUniverseSummary } from '../types/contracts.js'

type UseZoltarMigrationParameters = {
	accountAddress: Address | undefined
	ensureZoltarUniverse: () => Promise<ZoltarUniverseSummary>
	onTransactionFailed?: WriteOperationsParameters['onTransactionFailed']
	onTransactionFinished: () => void
	onTransactionPresented: WriteOperationsParameters['onTransactionPresented']
	onTransactionPrepared?: WriteOperationsParameters['onTransactionPrepared']
	onTransactionRequested: WriteOperationsParameters['onTransactionRequested']
	onTransactionSubmitted: (hash: Hash) => void
	refreshState: () => Promise<void>
	refreshZoltarForkAccess: () => Promise<void>
	refreshZoltarUniverse: () => Promise<void>
	zoltarForkRepBalance: bigint | undefined
	zoltarMigrationPreparedRepBalance: bigint | undefined
}

type RunZoltarMigrationActionParameters = {
	actionName: 'prepare' | 'split'
	action: (walletAddress: Address, universe: ZoltarUniverseSummary, amount: bigint, outcomeIndexes: bigint[]) => Promise<ZoltarMigrationActionResult>
	errorFallback: string
	refreshAfter: boolean
	requiresOutcomeIndexes: boolean
	resolveAmount?: (amount: bigint, preparedRepBalance: bigint | undefined, repBalance: bigint | undefined) => bigint
}

function resolvePrepareMigrationAmount(amount: bigint, preparedRepBalance: bigint | undefined, repBalance: bigint | undefined) {
	const currentPreparedBalance = preparedRepBalance ?? 0n
	const missingAmount = amount > currentPreparedBalance ? amount - currentPreparedBalance : 0n
	if (missingAmount === 0n) throw new Error('Selected amount is already prepared')
	const currentRepBalance = repBalance ?? 0n
	if (currentRepBalance < missingAmount) throw new Error('Not enough REP in this universe to prepare the selected amount')
	return missingAmount
}

export function useZoltarMigration({
	accountAddress,
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
	zoltarForkRepBalance,
	zoltarMigrationPreparedRepBalance,
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

			try {
				await assertActiveWallet(accountAddress)
				onTransactionRequested(createZoltarMigrationTransactionIntent(actionName))
				const universe = await ensureZoltarUniverse()
				if (!universe.hasForked) throw new Error('Zoltar has not forked yet')
				const amount = parseRepAmountInput(zoltarMigrationForm.value.amount, 'Migration amount')
				if (amount <= 0n) throw new Error('Migration amount must be greater than zero')
				const resolvedAmount = resolveAmount(amount, zoltarMigrationPreparedRepBalance, zoltarForkRepBalance)
				const outcomeIndexes = requiresOutcomeIndexes ? parseBigIntListInput(zoltarMigrationForm.value.outcomeIndexes, 'Outcome indexes') : []
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
				if (refreshAfter) {
					await refreshState()
					await refreshZoltarUniverse()
				}
				await refreshZoltarForkAccess()
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
			zoltarForkRepBalance,
			zoltarMigrationPreparedRepBalance,
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
		zoltarMigrationResult: zoltarMigrationResult.value,
	}
}
