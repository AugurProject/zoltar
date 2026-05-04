import type { Address, Hash } from 'viem'
import { useCallback, useMemo } from 'preact/hooks'
import type { DeploymentStatus } from '../types/contracts.js'
import type { SupportedNetworkKey } from '../shared/networkConfig.js'
import { useZoltarFork } from './useZoltarFork.js'
import { useZoltarMigration } from './useZoltarMigration.js'
import { useZoltarUniverse } from './useZoltarUniverse.js'

type UseZoltarOperationsParameters = {
	accountAddress: Address | undefined
	activeNetworkKey: SupportedNetworkKey
	activeUniverseId: bigint
	autoLoadInitialData: boolean
	deploymentStatuses: DeploymentStatus[]
	onTransaction: (hash: Hash) => void
	onTransactionFinished: () => void
	onTransactionRequested: () => void
	onTransactionSubmitted: (hash: Hash) => void
	refreshState: () => Promise<void>
}

export function useZoltarOperations({ accountAddress, activeNetworkKey, activeUniverseId, autoLoadInitialData, deploymentStatuses, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted, refreshState }: UseZoltarOperationsParameters) {
	const { createChildUniverse: createUniverseChildUniverse, ...universe } = useZoltarUniverse({ accountAddress, activeNetworkKey, activeUniverseId, autoLoadInitialData, deploymentStatuses, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted })
	const refreshZoltarUniverse = useCallback(async () => {
		await universe.refreshZoltarUniverse()
	}, [universe.refreshZoltarUniverse])
	const fork = useZoltarFork({
		accountAddress,
		activeNetworkKey,
		activeUniverseId,
		ensureZoltarUniverse: universe.ensureZoltarUniverse,
		onTransaction,
		onTransactionFinished,
		onTransactionRequested,
		onTransactionSubmitted,
		refreshState,
		refreshZoltarUniverse,
		zoltarUniverse: universe.zoltarUniverse,
	})
	const refreshZoltarForkAccess = useCallback(async () => {
		await fork.loadZoltarForkAccess()
	}, [fork.loadZoltarForkAccess])
	const migration = useZoltarMigration({
		accountAddress,
		activeNetworkKey,
		ensureZoltarUniverse: universe.ensureZoltarUniverse,
		onTransaction,
		onTransactionFinished,
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
