import { useSignal } from '@preact/signals'
import type { Address, Hash } from 'viem'
import { migrateInternalRepInZoltar, prepareRepForMigrationInZoltar } from '../contracts.js'
import { createWalletWriteClient, getRequiredInjectedEthereum } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { parseBigIntListInput } from '../lib/inputs.js'
import { getDefaultZoltarMigrationFormState, parseRepAmountInput } from '../lib/marketForm.js'
import type { ZoltarMigrationFormState } from '../types/app.js'
import type { ZoltarMigrationActionResult, ZoltarUniverseSummary } from '../types/contracts.js'

type UseZoltarMigrationParameters = {
	accountAddress: Address | undefined
	ensureZoltarUniverse: () => Promise<ZoltarUniverseSummary>
	onTransaction: (hash: Hash) => void
	onTransactionFinished: () => void
	onTransactionRequested: () => void
	onTransactionSubmitted: (hash: Hash) => void
	refreshState: () => Promise<void>
	refreshZoltarForkAccess: () => Promise<void>
	refreshZoltarUniverse: () => Promise<void>
	zoltarForkRepBalance: bigint | undefined
	zoltarMigrationPreparedRepBalance: bigint | undefined
}

export function useZoltarMigration({ accountAddress, ensureZoltarUniverse, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted, refreshState, refreshZoltarForkAccess, refreshZoltarUniverse, zoltarForkRepBalance, zoltarMigrationPreparedRepBalance }: UseZoltarMigrationParameters) {
	const zoltarMigrationError = useSignal<string | undefined>(undefined)
	const zoltarMigrationPending = useSignal(false)
	const zoltarMigrationResult = useSignal<ZoltarMigrationActionResult | undefined>(undefined)
	const zoltarMigrationActiveAction = useSignal<'prepare' | 'split' | undefined>(undefined)
	const zoltarMigrationChildRepBalances = useSignal<Record<string, bigint | undefined>>({})
	const zoltarMigrationForm = useSignal<ZoltarMigrationFormState>(getDefaultZoltarMigrationFormState())

	const runZoltarMigrationAction = async (
		actionName: 'prepare' | 'split',
		action: (walletAddress: Address, universe: ZoltarUniverseSummary, amount: bigint, outcomeIndexes: bigint[]) => Promise<ZoltarMigrationActionResult>,
		errorFallback: string,
		refreshAfter: boolean,
		requiresOutcomeIndexes: boolean,
		resolveAmount: (amount: bigint, preparedRepBalance: bigint | undefined, repBalance: bigint | undefined) => bigint = amount => amount,
	) => {
		try {
			getRequiredInjectedEthereum()
		} catch {
			zoltarMigrationError.value = 'No injected wallet found'
			return
		}
		if (accountAddress === undefined) {
			zoltarMigrationError.value = 'Connect a wallet before using REP migration actions'
			return
		}

		zoltarMigrationPending.value = true
		zoltarMigrationActiveAction.value = actionName
		zoltarMigrationError.value = undefined
		zoltarMigrationResult.value = undefined

		try {
			onTransactionRequested()
			const universe = await ensureZoltarUniverse()
			if (!universe.hasForked) {
				throw new Error('Zoltar has not forked yet')
			}
			const amount = parseRepAmountInput(zoltarMigrationForm.value.amount, 'Migration amount')
			if (amount <= 0n) {
				throw new Error('Migration amount must be greater than zero')
			}
			const resolvedAmount = resolveAmount(amount, zoltarMigrationPreparedRepBalance, zoltarForkRepBalance)
			if (resolvedAmount <= 0n) {
				throw new Error('Selected amount is already prepared')
			}
			const outcomeIndexes = requiresOutcomeIndexes ? parseBigIntListInput(zoltarMigrationForm.value.outcomeIndexes, 'Outcome indexes') : []
			const result = await action(accountAddress, universe, resolvedAmount, outcomeIndexes)
			zoltarMigrationResult.value = result
			onTransaction(result.hash)
			if (refreshAfter) {
				await refreshState()
				await refreshZoltarUniverse()
			}
			await refreshZoltarForkAccess()
		} catch (error) {
			zoltarMigrationError.value = getErrorMessage(error, errorFallback)
		} finally {
			zoltarMigrationPending.value = false
			zoltarMigrationActiveAction.value = undefined
			onTransactionFinished()
		}
	}

	const prepareRepForMigration = async () =>
		await runZoltarMigrationAction(
			'prepare',
			async (walletAddress, universe, amount) => await prepareRepForMigrationInZoltar(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), universe.universeId, amount),
			'Failed to prepare REP for migration',
			false,
			false,
			(amount, preparedRepBalance, repBalance) => {
				const currentPreparedBalance = preparedRepBalance ?? 0n
				const missingAmount = amount > currentPreparedBalance ? amount - currentPreparedBalance : 0n
				if (missingAmount === 0n) {
					throw new Error('Selected amount is already prepared')
				}
				const currentRepBalance = repBalance ?? 0n
				if (currentRepBalance < missingAmount) {
					throw new Error('Not enough REP in this universe to prepare the selected amount')
				}
				return missingAmount
			},
		)

	const migrateInternalRep = async () =>
		await runZoltarMigrationAction('split', async (walletAddress, universe, amount, outcomeIndexes) => await migrateInternalRepInZoltar(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), universe.universeId, amount, outcomeIndexes), 'Failed to migrate REP', true, true)

	return {
		migrateInternalRep,
		prepareRepForMigration,
		setZoltarMigrationForm: (updater: (current: ZoltarMigrationFormState) => ZoltarMigrationFormState) => {
			zoltarMigrationForm.value = updater(zoltarMigrationForm.value)
		},
		zoltarMigrationActiveAction: zoltarMigrationActiveAction.value,
		zoltarMigrationChildRepBalances: zoltarMigrationChildRepBalances.value,
		zoltarMigrationError: zoltarMigrationError.value,
		zoltarMigrationForm: zoltarMigrationForm.value,
		zoltarMigrationPending: zoltarMigrationPending.value,
		zoltarMigrationResult: zoltarMigrationResult.value,
	}
}
