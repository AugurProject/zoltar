import type { Address, Hash } from 'viem'
import type { DeploymentStatus } from '../types/contracts.js'
import { useZoltarFork } from './useZoltarFork.js'
import { useZoltarMigration } from './useZoltarMigration.js'
import { useZoltarUniverse } from './useZoltarUniverse.js'

type UseZoltarOperationsParameters = {
	accountAddress: Address | undefined
	activeUniverseId: bigint
	autoLoadInitialData: boolean
	deploymentStatuses: DeploymentStatus[]
	onTransaction: (hash: Hash) => void
	onTransactionFinished: () => void
	onTransactionRequested: () => void
	onTransactionSubmitted: (hash: Hash) => void
	refreshState: () => Promise<void>
}

export function useZoltarOperations({ accountAddress, activeUniverseId, autoLoadInitialData, deploymentStatuses, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted, refreshState }: UseZoltarOperationsParameters) {
	const { createChildUniverse: createUniverseChildUniverse, ...universe } = useZoltarUniverse({ accountAddress, activeUniverseId, autoLoadInitialData, deploymentStatuses, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted })
	const fork = useZoltarFork({
		accountAddress,
		activeUniverseId,
		ensureZoltarUniverse: universe.ensureZoltarUniverse,
		onTransaction,
		onTransactionFinished,
		onTransactionRequested,
		onTransactionSubmitted,
		refreshState,
		refreshZoltarUniverse: async () => {
			await universe.refreshZoltarUniverse()
		},
		zoltarUniverse: universe.zoltarUniverse,
	})
	const migration = useZoltarMigration({
		accountAddress,
		ensureZoltarUniverse: universe.ensureZoltarUniverse,
		onTransaction,
		onTransactionFinished,
		onTransactionRequested,
		onTransactionSubmitted,
		refreshState,
		refreshZoltarForkAccess: async () => {
			await fork.loadZoltarForkAccess()
		},
		refreshZoltarUniverse: async () => {
			await universe.refreshZoltarUniverse()
		},
		zoltarForkRepBalance: fork.zoltarForkRepBalance,
		zoltarMigrationPreparedRepBalance: fork.zoltarMigrationPreparedRepBalance,
	})

	return {
		...universe,
		...fork,
		...migration,
		createChildUniverse: async (outcomeIndex: bigint) => {
			await createUniverseChildUniverse(outcomeIndex)
			await fork.loadZoltarForkAccess()
		},
	}
}
