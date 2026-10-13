import { defaultUseZoltarUniverseDependencies, type UseZoltarUniverseDependencies } from './zoltarUniverseServices.js'
export type { UseZoltarUniverseDependencies } from './zoltarUniverseServices.js'
import { useZoltarQuestions } from './useZoltarQuestions.js'
import { useChildUniverseDeployment } from './useChildUniverseDeployment.js'
import * as zoltarCopy from '../../../copy/zoltar.js'
import * as userMessagesCopy from '@zoltar/ui-core-shared/copy/userMessages.js'

import { readOperationClient, runReadOperation } from '@zoltar/ui-core-shared/lib/readOperation.js'
import { useSignal } from '@preact/signals'

import { useCallback, useLayoutEffect, useRef } from 'preact/hooks'
import type { Address } from '@zoltar/core-shared/evm/ethereum'

import { useLoadController } from '@zoltar/ui-core-shared/hooks/useLoadController.js'
import { appQueryCache, isSameQueryData } from '@zoltar/ui-core-shared/lib/dataRefresh.js'
import { useBlockRefresh, useQueryState } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'

import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'

import { hasDeployedStep } from '@zoltar/ui-core-shared/lib/deploymentStatus.js'
import { useRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'

import type { TransactionLifecycleParameters } from '../../../types/app.js'

import type { DeploymentStatus, ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'

const zoltarUniverseQueries = appQueryCache.createStore<ZoltarUniverseSummary | undefined>()

type UseZoltarUniverseParameters = TransactionLifecycleParameters & {
	accountAddress: Address | undefined
	activeUniverseId: bigint
	autoLoadInitialData: boolean
	includeRelatedUniverses?: boolean
	deploymentStatuses: DeploymentStatus[]
	environmentRefreshKey: number
}

export function useZoltarUniverse(
	{ accountAddress, activeUniverseId, autoLoadInitialData, includeRelatedUniverses = false, deploymentStatuses, environmentRefreshKey, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted }: UseZoltarUniverseParameters,
	dependencies: UseZoltarUniverseDependencies = defaultUseZoltarUniverseDependencies,
) {
	const zoltarDeployed = hasDeployedStep(deploymentStatuses, 'zoltar')
	const { loadRequestedPageOrCount, refreshInBackground: refreshQuestions, ...questions } = useZoltarQuestions({ environmentRefreshKey, zoltarDeployed }, dependencies)
	const universeLoad = useLoadController()
	const zoltarUniverseMissing = useSignal(false)
	const zoltarUniverseLoadedId = useSignal<bigint | undefined>(undefined)
	const zoltarUniverseResolvedId = useSignal<bigint | undefined>(undefined)
	const zoltarUniverse = useSignal<ZoltarUniverseSummary | undefined>(undefined)
	const zoltarUniverseError = useSignal<string | undefined>(undefined)
	const isMounted = useRef(true)
	const currentZoltarContextRef = useRef({ activeUniverseId, environmentRefreshKey, zoltarDeployed, includeRelatedUniverses })
	const previousZoltarContextRef = useRef({ activeUniverseId, environmentRefreshKey, zoltarDeployed })
	const previousAutoLoadContextRef = useRef<{ activeUniverseId: bigint; environmentRefreshKey: number; zoltarDeployed: boolean; includeRelatedUniverses: boolean; autoLoadInitialData: boolean }>()
	const nextUniverseLoad = useRequestGuard()
	// Each background request and foreground commit retires older background answers.
	const universeCommitVersionRef = useRef(0)
	const scalarOutcomeIndexes = useRef<readonly bigint[]>([])
	const scalarSelectionKey = scalarOutcomeIndexes.current.join(',')
	const universeQueryKey = zoltarDeployed ? `${environmentRefreshKey}:${activeUniverseId}:${includeRelatedUniverses}:${scalarSelectionKey}` : undefined
	const universeQuery = useQueryState(zoltarUniverseQueries, universeQueryKey)
	currentZoltarContextRef.current = { activeUniverseId, environmentRefreshKey, zoltarDeployed, includeRelatedUniverses }

	const { reset: resetChildDeployment, ...childDeployment } = useChildUniverseDeployment(
		{ accountAddress, activeUniverseId, universe: zoltarUniverse.value, ensureZoltarUniverse: () => ensureZoltarUniverse(), refreshZoltarUniverse: () => refreshZoltarUniverse(), onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted },
		dependencies,
	)

	const resetZoltarUniverseState = () => {
		universeLoad.invalidate()
		zoltarUniverseMissing.value = false
		zoltarUniverse.value = undefined
		zoltarUniverseLoadedId.value = undefined
		zoltarUniverseResolvedId.value = undefined
		zoltarUniverseError.value = undefined
		resetChildDeployment()
	}
	const isCurrentZoltarContext = (context: { activeUniverseId: bigint; environmentRefreshKey: number; zoltarDeployed: boolean; includeRelatedUniverses: boolean }) => {
		const currentContext = currentZoltarContextRef.current
		return currentContext.activeUniverseId === context.activeUniverseId && currentContext.environmentRefreshKey === context.environmentRefreshKey && currentContext.zoltarDeployed === context.zoltarDeployed && currentContext.includeRelatedUniverses === context.includeRelatedUniverses
	}

	const ensureZoltarUniverse = async (): Promise<ZoltarUniverseSummary> => {
		if (zoltarUniverse.value !== undefined && zoltarUniverseLoadedId.value === activeUniverseId) return zoltarUniverse.value

		const loadedUniverse = await loadZoltarUniverse()
		if (loadedUniverse !== undefined) return loadedUniverse
		if (zoltarUniverseMissing.value) throw new Error(userMessagesCopy.missingUniverseDetail)
		throw new Error(zoltarCopy.universeUnavailableDetail)
	}

	const loadZoltarUniverse = async (options: { clearCurrentState?: boolean } = {}) => {
		if (!isMounted.current) return undefined
		const clearCurrentState = options.clearCurrentState ?? true
		const isCurrent = nextUniverseLoad()
		const requestedUniverseId = activeUniverseId
		const requestedScalarOutcomeIndexes = scalarOutcomeIndexes.current
		const universeLoadContext = { activeUniverseId, environmentRefreshKey, zoltarDeployed, includeRelatedUniverses }
		if (clearCurrentState) resetZoltarUniverseState()
		else zoltarUniverseError.value = undefined
		return await universeLoad.run({
			isCurrent,
			load: async operation => {
				if (!hasDeployedStep(deploymentStatuses, 'zoltar')) {
					zoltarUniverseMissing.value = false
					zoltarUniverse.value = undefined
					zoltarUniverseLoadedId.value = undefined
					zoltarUniverseResolvedId.value = undefined
					resetChildDeployment({ keepFeedback: true })
					return undefined
				}
				return await dependencies.loadZoltarUniverseSummary(readOperationClient(dependencies.createConnectedReadClient(), operation), requestedUniverseId, undefined, { includeRelatedUniverses, scalarOutcomeIndexes: requestedScalarOutcomeIndexes })
			},
			onSuccess: universe => {
				if (!isCurrentZoltarContext(universeLoadContext) || scalarOutcomeIndexes.current !== requestedScalarOutcomeIndexes) return
				if (universe === undefined) {
					zoltarUniverseResolvedId.value = requestedUniverseId
					zoltarUniverseMissing.value = requestedUniverseId !== 0n
					return
				}
				zoltarUniverseMissing.value = false
				zoltarUniverse.value = universe
				zoltarUniverseLoadedId.value = requestedUniverseId
				zoltarUniverseResolvedId.value = requestedUniverseId
				universeCommitVersionRef.current += 1
				zoltarUniverseQueries.set(`${universeLoadContext.environmentRefreshKey}:${requestedUniverseId}:${includeRelatedUniverses}:${requestedScalarOutcomeIndexes.join(',')}`, universe)
			},
			onError: error => {
				if (!isCurrentZoltarContext(universeLoadContext) || scalarOutcomeIndexes.current !== requestedScalarOutcomeIndexes) return
				zoltarUniverseError.value = getErrorMessage(error, zoltarCopy.universeUnavailableDetail)
			},
		})
	}

	const refreshZoltarUniverse = async () => await loadZoltarUniverse({ clearCurrentState: false })
	const refreshUniverseRef = useRef(refreshZoltarUniverse)
	refreshUniverseRef.current = refreshZoltarUniverse
	const selectScalarOutcomeIndexes = useCallback((indexes: readonly bigint[]) => {
		const next = [...new Set(indexes)]
		if (next.join(',') === scalarOutcomeIndexes.current.join(',')) return
		scalarOutcomeIndexes.current = next
		universeCommitVersionRef.current += 1
		void refreshUniverseRef.current()
	}, [])

	/** Re-reads the loaded universe and question page on a new block, keeping the current data visible until the read lands. */
	const refreshInBackground = async () => {
		if (!isMounted.current || !zoltarDeployed) return
		const requestedScalarOutcomeIndexes = scalarOutcomeIndexes.current
		const universeContext = { activeUniverseId, environmentRefreshKey, zoltarDeployed, includeRelatedUniverses }
		const tasks: Promise<void>[] = []
		if (universeQueryKey !== undefined && zoltarUniverseLoadedId.value === activeUniverseId && !universeLoad.isLoading.peek()) {
			const commitVersion = ++universeCommitVersionRef.current
			tasks.push(
				zoltarUniverseQueries
					.fetch(
						universeQueryKey,
						async () =>
							await runReadOperation(async operation => await dependencies.loadZoltarUniverseSummary(readOperationClient(dependencies.createConnectedReadClient(), operation), activeUniverseId, undefined, { includeRelatedUniverses, scalarOutcomeIndexes: requestedScalarOutcomeIndexes }), {
								isCurrent: () => isMounted.current && isCurrentZoltarContext(universeContext),
							}),
					)
					.then(universe => {
						if (universe === undefined || !isMounted.current || !isCurrentZoltarContext(universeContext) || universeLoad.isLoading.peek() || universeCommitVersionRef.current !== commitVersion) return
						if (!isSameQueryData(universe, zoltarUniverse.value)) zoltarUniverse.value = universe
					}),
			)
		}
		tasks.push(refreshQuestions())
		// A failed background read keeps the last data; its age stays visible and the next block retries.
		await Promise.allSettled(tasks)
	}
	useBlockRefresh(() => void refreshInBackground(), autoLoadInitialData && zoltarDeployed)

	useLayoutEffect(() => {
		const previousContext = previousZoltarContextRef.current
		const contextChanged = previousContext.activeUniverseId !== activeUniverseId || previousContext.environmentRefreshKey !== environmentRefreshKey || previousContext.zoltarDeployed !== zoltarDeployed
		previousZoltarContextRef.current = { activeUniverseId, environmentRefreshKey, zoltarDeployed }
		if (!contextChanged) return
		scalarOutcomeIndexes.current = []
		resetZoltarUniverseState()
	}, [activeUniverseId, environmentRefreshKey, zoltarDeployed])

	useLayoutEffect(() => {
		const previous = previousAutoLoadContextRef.current
		previousAutoLoadContextRef.current = { activeUniverseId, environmentRefreshKey, zoltarDeployed, includeRelatedUniverses, autoLoadInitialData }
		const scopeOnlyChanged =
			previous !== undefined && previous.activeUniverseId === activeUniverseId && previous.environmentRefreshKey === environmentRefreshKey && previous.zoltarDeployed === zoltarDeployed && previous.autoLoadInitialData === autoLoadInitialData && previous.includeRelatedUniverses !== includeRelatedUniverses
		if (scopeOnlyChanged) {
			// Retire reads from the old view, even if a later toggle returns to that same scope.
			nextUniverseLoad()
			universeLoad.invalidate()
			universeCommitVersionRef.current += 1
		}
		if (!autoLoadInitialData) return
		const currentUniverse = zoltarUniverse.value
		// Restore migration details immediately; the retained short summary still schedules an in-place refresh below.
		const cachedUniverse = scopeOnlyChanged && includeRelatedUniverses && currentUniverse?.relatedUniversesLoaded === false ? zoltarUniverseQueries.get(`${environmentRefreshKey}:${activeUniverseId}:true:${scalarSelectionKey}`).data : undefined
		if (cachedUniverse !== undefined && cachedUniverse.relatedUniversesLoaded !== false) zoltarUniverse.value = cachedUniverse
		if (scopeOnlyChanged && currentUniverse !== undefined && (!includeRelatedUniverses || currentUniverse.relatedUniversesLoaded !== false)) return
		const initialLoads: Promise<unknown>[] = [loadZoltarUniverse({ clearCurrentState: !scopeOnlyChanged })]
		if (zoltarDeployed && !scopeOnlyChanged) {
			initialLoads.push(loadRequestedPageOrCount())
		}
		void Promise.allSettled(initialLoads)
	}, [activeUniverseId, autoLoadInitialData, environmentRefreshKey, zoltarDeployed, includeRelatedUniverses])

	useLayoutEffect(() => {
		return () => {
			isMounted.current = false
		}
	}, [])

	return {
		...questions,
		...childDeployment,
		ensureZoltarUniverse,
		loadingZoltarUniverse: universeLoad.isLoading.value,
		loadZoltarUniverse,
		refreshZoltarUniverse,
		selectScalarOutcomeIndexes,
		zoltarUniverse: zoltarUniverseLoadedId.value === activeUniverseId ? zoltarUniverse.value : undefined,
		zoltarUniverseError: zoltarUniverseError.value,
		zoltarUniverseFreshness: { refreshing: universeQuery?.fetching === true, updatedAt: universeQuery?.updatedAt },
		zoltarUniverseLoadedId: zoltarUniverseLoadedId.value,
		zoltarUniverseResolvedId: zoltarUniverseResolvedId.value,
		zoltarUniverseMissing: zoltarUniverseMissing.value,
	}
}
