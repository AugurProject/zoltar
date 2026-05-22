import { useSignal } from '@preact/signals'
import { useLayoutEffect, useRef } from 'preact/hooks'
import type { Address, Hash } from 'viem'
import { createZoltarChildUniverse, loadAllZoltarQuestions, loadZoltarQuestionCount, loadZoltarUniverseSummary } from '../contracts.js'
import { useLoadController } from './useLoadController.js'
import { createConnectedReadClient, createWalletWriteClient } from '../lib/clients.js'
import { formatRefreshErrorMessage, formatWriteErrorMessage } from '../lib/errors.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '../lib/actionFeedback.js'
import { hasDeployedStep } from '../lib/marketCreation.js'
import { useRequestGuard } from '../lib/requestGuard.js'
import { requireWallet } from '../lib/walletGuard.js'
import type { ActionFeedback } from '../types/components.js'
import type { DeploymentStatus, MarketDetails, ZoltarUniverseSummary } from '../types/contracts.js'

type UseZoltarUniverseParameters = {
	accountAddress: Address | undefined
	activeUniverseId: bigint
	autoLoadInitialData: boolean
	deploymentStatuses: DeploymentStatus[]
	onTransaction: (hash: Hash) => void
	onTransactionFinished: () => void
	onTransactionRequested: () => void
	onTransactionSubmitted: (hash: Hash) => void
}

export function useZoltarUniverse({ accountAddress, activeUniverseId, autoLoadInitialData, deploymentStatuses, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted }: UseZoltarUniverseParameters) {
	const universeLoad = useLoadController()
	const questionCountLoad = useLoadController()
	const questionsLoad = useLoadController()
	const zoltarUniverseMissing = useSignal(false)
	const zoltarUniverseLoadedId = useSignal<bigint | undefined>(undefined)
	const zoltarUniverseResolvedId = useSignal<bigint | undefined>(undefined)
	const hasLoadedZoltarQuestions = useSignal(false)
	const zoltarQuestionCount = useSignal<bigint | undefined>(undefined)
	const zoltarQuestions = useSignal<MarketDetails[]>([])
	const zoltarUniverse = useSignal<ZoltarUniverseSummary | undefined>(undefined)
	const zoltarChildUniverseError = useSignal<string | undefined>(undefined)
	const zoltarChildUniverseFeedback = useSignal<ActionFeedback<'createChildUniverse'> | undefined>(undefined)
	const zoltarChildUniversePendingOutcomeIndex = useSignal<bigint | undefined>(undefined)
	const isMounted = useRef(true)
	const nextUniverseLoad = useRequestGuard()
	const nextQuestionCountLoad = useRequestGuard()
	const nextQuestionsLoad = useRequestGuard()

	const resetZoltarUniverseState = () => {
		zoltarUniverseMissing.value = false
		zoltarUniverse.value = undefined
		zoltarUniverseLoadedId.value = undefined
		zoltarUniverseResolvedId.value = undefined
		zoltarChildUniverseError.value = undefined
		zoltarChildUniversePendingOutcomeIndex.value = undefined
		hasLoadedZoltarQuestions.value = false
		zoltarQuestionCount.value = undefined
		zoltarQuestions.value = []
	}

	const ensureZoltarUniverse = async (): Promise<ZoltarUniverseSummary> => {
		if (zoltarUniverse.value !== undefined && zoltarUniverseLoadedId.value === activeUniverseId) return zoltarUniverse.value

		const loadedUniverse = await loadZoltarUniverse()
		if (loadedUniverse !== undefined) return loadedUniverse
		if (zoltarUniverseMissing.value) throw new Error('Zoltar universe does not exist yet')

		throw new Error('Failed to load current Zoltar universe')
	}

	const loadZoltarUniverse = async (options: { clearCurrentState?: boolean } = {}) => {
		if (!isMounted.current) return undefined
		const clearCurrentState = options.clearCurrentState ?? true
		const isCurrent = nextUniverseLoad()
		const requestedUniverseId = activeUniverseId
		if (clearCurrentState) {
			resetZoltarUniverseState()
		}
		return await universeLoad.run({
			isCurrent,
			load: async () => {
				if (!hasDeployedStep(deploymentStatuses, 'zoltar')) {
					zoltarUniverseMissing.value = false
					zoltarUniverse.value = undefined
					zoltarUniverseLoadedId.value = undefined
					zoltarUniverseResolvedId.value = undefined
					zoltarChildUniverseError.value = undefined
					zoltarChildUniversePendingOutcomeIndex.value = undefined
					return undefined
				}
				return await loadZoltarUniverseSummary(createConnectedReadClient(), requestedUniverseId)
			},
			onSuccess: universe => {
				if (requestedUniverseId !== activeUniverseId) return
				if (universe === undefined) {
					zoltarUniverseResolvedId.value = requestedUniverseId
					zoltarUniverseMissing.value = requestedUniverseId !== 0n
					return
				}
				zoltarUniverseMissing.value = false
				zoltarUniverse.value = universe
				zoltarUniverseLoadedId.value = requestedUniverseId
				zoltarUniverseResolvedId.value = requestedUniverseId
			},
			onError: () => undefined,
		})
	}

	const refreshZoltarUniverse = async () => await loadZoltarUniverse({ clearCurrentState: false })

	const loadZoltarQuestionCountData = async () => {
		if (!isMounted.current) return
		const isCurrent = nextQuestionCountLoad()
		await questionCountLoad.run({
			isCurrent,
			load: async () => await loadZoltarQuestionCount(createConnectedReadClient()),
			onSuccess: questionCount => {
				if (!isMounted.current) return
				zoltarQuestionCount.value = questionCount
			},
			onError: () => undefined,
		})
	}

	const loadQuestions = async (): Promise<void> => {
		if (!isMounted.current) return
		const isCountCurrent = nextQuestionCountLoad()
		const isQuestionsCurrent = nextQuestionsLoad()
		const readClient = createConnectedReadClient()
		let loadError: unknown

		const countTask = questionCountLoad.run({
			isCurrent: isCountCurrent,
			load: async () => await loadZoltarQuestionCount(readClient),
			onSuccess: questionCount => {
				if (!isMounted.current) return
				zoltarQuestionCount.value = questionCount
			},
			onError: error => {
				loadError = loadError ?? error
			},
		})

		const questionsTask = questionsLoad.run({
			isCurrent: isQuestionsCurrent,
			load: async () => await loadAllZoltarQuestions(readClient),
			onSuccess: questions => {
				if (!isMounted.current) return
				zoltarQuestions.value = questions
				hasLoadedZoltarQuestions.value = true
			},
			onError: error => {
				loadError = loadError ?? error
			},
		})

		await Promise.allSettled([countTask, questionsTask])
		if (loadError !== undefined) {
			throw loadError
		}
	}

	const createChildUniverse = async (outcomeIndex: bigint) => {
		if (
			!requireWallet(
				accountAddress,
				message => {
					zoltarChildUniverseError.value = message
				},
				'creating a child universe',
			)
		) {
			return
		}

		zoltarChildUniverseError.value = undefined
		zoltarChildUniverseFeedback.value = createPendingActionFeedback('createChildUniverse', 'Deploying child universe')
		zoltarChildUniversePendingOutcomeIndex.value = outcomeIndex
		try {
			let refreshRequired = false
			let resultHash: Hash | undefined
			try {
				onTransactionRequested()
				const universe = await ensureZoltarUniverse()
				if (!universe.hasForked) {
					throw new Error('Zoltar needs to fork before child universes can be deployed')
				}
				const result = await createZoltarChildUniverse(createWalletWriteClient(accountAddress, { onTransactionSubmitted }), universe.universeId, outcomeIndex)
				resultHash = result.hash
				zoltarChildUniverseFeedback.value = createSuccessActionFeedback('createChildUniverse', 'Child universe deployed', result.hash)
				onTransaction(result.hash)
				refreshRequired = true
			} catch (error) {
				const message = formatWriteErrorMessage(error, 'Failed to deploy child universe')
				zoltarChildUniverseError.value = message
				zoltarChildUniverseFeedback.value = createErrorActionFeedback('createChildUniverse', 'Child universe deployment failed', message)
				return
			}

			if (!refreshRequired) return

			try {
				await refreshZoltarUniverse()
			} catch (error) {
				const message = formatRefreshErrorMessage(error, 'Child universe transaction succeeded, but refreshing the UI failed')
				zoltarChildUniverseError.value = message
				zoltarChildUniverseFeedback.value = createWarningActionFeedback('createChildUniverse', 'Child universe deployed', message, resultHash)
			}
		} finally {
			zoltarChildUniversePendingOutcomeIndex.value = undefined
			onTransactionFinished()
		}
	}

	const zoltarDeployed = hasDeployedStep(deploymentStatuses, 'zoltar')
	useLayoutEffect(() => {
		if (!autoLoadInitialData) return
		void Promise.allSettled([loadZoltarUniverse(), loadZoltarQuestionCountData()])
	}, [activeUniverseId, autoLoadInitialData, zoltarDeployed])

	useLayoutEffect(() => {
		return () => {
			isMounted.current = false
		}
	}, [])

	return {
		createChildUniverse,
		ensureZoltarUniverse,
		hasLoadedZoltarQuestions: hasLoadedZoltarQuestions.value,
		loadingZoltarQuestionCount: questionCountLoad.isLoading.value,
		loadingZoltarQuestions: questionsLoad.isLoading.value,
		loadingZoltarUniverse: universeLoad.isLoading.value,
		loadZoltarQuestionCount: loadZoltarQuestionCountData,
		loadZoltarQuestions: loadQuestions,
		loadZoltarUniverse,
		zoltarChildUniverseFeedback: zoltarChildUniverseFeedback.value,
		refreshZoltarUniverse,
		zoltarChildUniverseError: zoltarChildUniverseError.value,
		zoltarChildUniversePendingOutcomeIndex: zoltarChildUniversePendingOutcomeIndex.value,
		zoltarQuestionCount: zoltarQuestionCount.value,
		zoltarQuestions: zoltarQuestions.value,
		zoltarUniverse: zoltarUniverseLoadedId.value === activeUniverseId ? zoltarUniverse.value : undefined,
		zoltarUniverseLoadedId: zoltarUniverseLoadedId.value,
		zoltarUniverseResolvedId: zoltarUniverseResolvedId.value,
		zoltarUniverseMissing: zoltarUniverseMissing.value,
	}
}
