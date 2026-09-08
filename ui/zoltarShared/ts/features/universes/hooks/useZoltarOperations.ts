import { useCallback, useMemo } from 'preact/hooks'
import type { TransactionLifecycleParameters, WriteOperationContext } from '../../../types/app.js'
import type { DeploymentStatus, ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { useZoltarFork } from './useZoltarFork.js'
import { useZoltarMigration } from './useZoltarMigration.js'
import { useZoltarUniverse } from './useZoltarUniverse.js'
import { createActiveEnvironmentGuard } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'

type UseZoltarOperationsParameters = TransactionLifecycleParameters &
	WriteOperationContext & {
		activeUniverseId: bigint
		activeZoltarView: 'create' | 'fork' | 'migrate' | 'questions'
		autoLoadInitialData: boolean
		deploymentStatuses: DeploymentStatus[]
		environmentRefreshKey: number
	}

export function useZoltarOperations({
	accountAddress,
	activeUniverseId,
	activeZoltarView,
	autoLoadInitialData,
	deploymentStatuses,
	environmentRefreshKey,
	onTransactionFailed,
	onTransactionFinished,
	onTransactionPresented,
	onTransactionPrepared,
	onTransactionRequested,
	onTransactionSubmitted,
	refreshState,
}: UseZoltarOperationsParameters) {
	const { createChildUniverse: createUniverseChildUniverse, ...universe } = useZoltarUniverse({
		accountAddress,
		activeUniverseId,
		autoLoadInitialData,
		deploymentStatuses,
		environmentRefreshKey,
		onTransactionFailed,
		onTransactionFinished,
		onTransactionPresented,
		onTransactionPrepared,
		onTransactionRequested,
		onTransactionSubmitted,
	})
	const refreshZoltarUniverse = useCallback(async () => await universe.refreshZoltarUniverse(), [universe.refreshZoltarUniverse])
	const fork = useZoltarFork({
		accountAddress,
		activeUniverseId,
		environmentRefreshKey,
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
	const refreshZoltarForkAccess = useCallback(
		async (refreshedUniverse?: ZoltarUniverseSummary) => {
			await fork.loadZoltarForkAccess(refreshedUniverse)
		},
		[fork.loadZoltarForkAccess],
	)
	const migration = useZoltarMigration({
		accountAddress,
		activeUniverseId,
		environmentRefreshKey,
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
		zoltarForkRepBalanceAttoRep: fork.zoltarForkRepBalanceAttoRep,
		zoltarMigrationPreparedRepBalanceAttoRep: fork.zoltarMigrationPreparedRepBalanceAttoRep,
	})

	const createChildUniverse = useCallback(
		async (outcomeIndex: bigint) => {
			const environmentGuard = createActiveEnvironmentGuard()
			await createUniverseChildUniverse(outcomeIndex)
			if (!environmentGuard.isCurrent()) return
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
