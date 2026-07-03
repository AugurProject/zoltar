import type { Address, Hash } from 'viem'
import { useCallback, useMemo } from 'preact/hooks'
import type { WriteOperationsParameters } from '../types/app.js'
import type { DeploymentStatus } from '../types/contracts.js'
import { useZoltarFork } from './useZoltarFork.js'
import { useZoltarMigration } from './useZoltarMigration.js'
import { useZoltarUniverse } from './useZoltarUniverse.js'

type UseZoltarOperationsParameters = {
	accountAddress: Address | undefined
	activeUniverseId: bigint
	activeZoltarView: 'create' | 'fork' | 'migrate' | 'questions'
	autoLoadInitialData: boolean
	deploymentStatuses: DeploymentStatus[]
	onTransactionFailed?: WriteOperationsParameters['onTransactionFailed']
	onTransactionFinished: () => void
	onTransactionPresented: WriteOperationsParameters['onTransactionPresented']
	onTransactionPrepared?: WriteOperationsParameters['onTransactionPrepared']
	onTransactionRequested: WriteOperationsParameters['onTransactionRequested']
	onTransactionSubmitted: (hash: Hash) => void
	refreshState: WriteOperationsParameters['refreshState']
}

export function useZoltarOperations({ accountAddress, activeUniverseId, activeZoltarView, autoLoadInitialData, deploymentStatuses, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState }: UseZoltarOperationsParameters) {
	const { createChildUniverse: createUniverseChildUniverse, ...universe } = useZoltarUniverse({ accountAddress, activeUniverseId, autoLoadInitialData, deploymentStatuses, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted })
	const refreshZoltarUniverse = useCallback(async () => {
		await universe.refreshZoltarUniverse()
	}, [universe.refreshZoltarUniverse])
	const fork = useZoltarFork({
		accountAddress,
		activeUniverseId,
		ensureZoltarUniverse: universe.ensureZoltarUniverse,
		onTransactionFailed,
		onTransactionFinished,
		onTransactionPresented,
		onTransactionPrepared,
		onTransactionRequested,
		onTransactionSubmitted,
		refreshState,
		refreshZoltarUniverse,
		// The overview header always displays the connected wallet's REP balance.
		// Keep fork access loaded whenever the app has enough context to do so.
		shouldAutoLoadForkAccess: autoLoadInitialData || activeZoltarView === 'fork' || activeZoltarView === 'migrate',
		zoltarUniverse: universe.zoltarUniverse,
	})
	const refreshZoltarForkAccess = useCallback(async () => {
		await fork.loadZoltarForkAccess()
	}, [fork.loadZoltarForkAccess])
	const migration = useZoltarMigration({
		accountAddress,
		ensureZoltarUniverse: universe.ensureZoltarUniverse,
		onTransactionFailed,
		onTransactionFinished,
		onTransactionPresented,
		onTransactionPrepared,
		onTransactionRequested,
		onTransactionSubmitted,
		refreshState,
		refreshZoltarForkAccess,
		refreshZoltarUniverse,
		zoltarForkRepBalance: fork.zoltarForkRepBalance,
		zoltarMigrationPreparedRepBalance: fork.zoltarMigrationPreparedRepBalance,
	})

	const createChildUniverse = useCallback(
		async (outcomeIndex: bigint) => {
			await createUniverseChildUniverse(outcomeIndex)
			await fork.loadZoltarForkAccess()
		},
		[createUniverseChildUniverse, fork.loadZoltarForkAccess],
	)

	return useMemo(() => {
		return {
			...universe,
			...fork,
			...migration,
			createChildUniverse,
		}
	}, [createChildUniverse, fork, migration, universe])
}
