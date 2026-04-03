import { useSignal } from '@preact/signals'
import { useLayoutEffect } from 'preact/hooks'
import type { Address, Hash } from 'viem'
import { createZoltarChildUniverse, loadAllZoltarQuestions, loadZoltarQuestionCount, loadZoltarUniverseSummary } from '../contracts.js'
import { createReadClient, createWalletWriteClient, getRequiredInjectedEthereum } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { hasDeployedStep } from '../lib/marketCreation.js'
import { useRequestGuard } from '../lib/requestGuard.js'
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
	const loadingZoltarUniverse = useSignal(false)
	const zoltarUniverseMissing = useSignal(false)
	const zoltarUniverseLoadedId = useSignal<bigint | undefined>(undefined)
	const loadingZoltarQuestionCount = useSignal(false)
	const loadingZoltarQuestions = useSignal(false)
	const hasLoadedZoltarQuestions = useSignal(false)
	const zoltarQuestionCount = useSignal<bigint | undefined>(undefined)
	const zoltarQuestions = useSignal<MarketDetails[]>([])
	const zoltarUniverse = useSignal<ZoltarUniverseSummary | undefined>(undefined)
	const zoltarChildUniverseError = useSignal<string | undefined>(undefined)
	const nextUniverseLoad = useRequestGuard()
	const nextQuestionCountLoad = useRequestGuard()
	const nextQuestionsLoad = useRequestGuard()

	const resetZoltarUniverseState = () => {
		zoltarUniverseMissing.value = false
		loadingZoltarUniverse.value = true
		zoltarUniverse.value = undefined
		zoltarUniverseLoadedId.value = undefined
		zoltarChildUniverseError.value = undefined
	}

	const ensureZoltarUniverse = async (): Promise<ZoltarUniverseSummary> => {
		if (zoltarUniverse.value !== undefined && zoltarUniverseLoadedId.value === activeUniverseId) return zoltarUniverse.value

		const loadedUniverse = await loadZoltarUniverse()
		if (loadedUniverse !== undefined) return loadedUniverse
		if (zoltarUniverseMissing.value) throw new Error('Zoltar universe does not exist yet')

		throw new Error('Failed to load current Zoltar universe')
	}

	const loadZoltarUniverse = async (options: { clearCurrentState?: boolean } = {}) => {
		const clearCurrentState = options.clearCurrentState ?? true
		const isCurrent = nextUniverseLoad()
		const requestedUniverseId = activeUniverseId
		if (clearCurrentState) {
			resetZoltarUniverseState()
		} else {
			loadingZoltarUniverse.value = true
		}
		try {
			const universe = await loadZoltarUniverseSummary(createReadClient(), requestedUniverseId, hasDeployedStep(deploymentStatuses, 'zoltar'))
			if (!isCurrent()) return undefined
			if (requestedUniverseId !== activeUniverseId) return undefined
			if (universe === undefined) {
				zoltarUniverseMissing.value = requestedUniverseId !== 0n
				return undefined
			}
			zoltarUniverse.value = universe
			zoltarUniverseLoadedId.value = requestedUniverseId
			return universe
		} finally {
			if (isCurrent()) {
				loadingZoltarUniverse.value = false
			}
		}
	}

	const refreshZoltarUniverse = async () => await loadZoltarUniverse({ clearCurrentState: false })

	const loadZoltarQuestionCountData = async () => {
		const isCurrent = nextQuestionCountLoad()
		loadingZoltarQuestionCount.value = true
		try {
			const questionCount = await loadZoltarQuestionCount(createReadClient())
			if (!isCurrent()) return
			zoltarQuestionCount.value = questionCount
		} finally {
			if (isCurrent()) {
				loadingZoltarQuestionCount.value = false
			}
		}
	}

	const loadQuestions = async () => {
		const isCountCurrent = nextQuestionCountLoad()
		const isQuestionsCurrent = nextQuestionsLoad()
		loadingZoltarQuestions.value = true
		loadingZoltarQuestionCount.value = true
		hasLoadedZoltarQuestions.value = true
		try {
			const readClient = createReadClient()
			const [questions, questionCount] = await Promise.all([loadAllZoltarQuestions(readClient), loadZoltarQuestionCount(readClient)])
			if (!isQuestionsCurrent()) return
			zoltarQuestions.value = questions
			if (isCountCurrent()) {
				zoltarQuestionCount.value = questionCount
			}
		} finally {
			if (isQuestionsCurrent()) {
				loadingZoltarQuestions.value = false
			}
			if (isCountCurrent()) {
				loadingZoltarQuestionCount.value = false
			}
		}
	}

	const createChildUniverse = async (outcomeIndex: bigint) => {
		try {
			getRequiredInjectedEthereum()
		} catch {
			zoltarChildUniverseError.value = 'No injected wallet found'
			return
		}
		if (accountAddress === undefined) {
			zoltarChildUniverseError.value = 'Connect a wallet before deploying a child universe'
			return
		}

		zoltarChildUniverseError.value = undefined
		try {
			onTransactionRequested()
			const universe = await ensureZoltarUniverse()
			if (!universe.hasForked) {
				throw new Error('Zoltar needs to fork before child universes can be deployed')
			}
			const result = await createZoltarChildUniverse(createWalletWriteClient(accountAddress, { onTransactionSubmitted }), universe.universeId, outcomeIndex)
			onTransaction(result.hash)
			await refreshZoltarUniverse()
		} catch (error) {
			zoltarChildUniverseError.value = getErrorMessage(error, 'Failed to deploy child universe')
		} finally {
			onTransactionFinished()
		}
	}

	useLayoutEffect(() => {
		if (!autoLoadInitialData) return
		void Promise.allSettled([loadZoltarUniverse(), loadZoltarQuestionCountData()])
	}, [activeUniverseId, autoLoadInitialData])

	return {
		createChildUniverse,
		ensureZoltarUniverse,
		hasLoadedZoltarQuestions: hasLoadedZoltarQuestions.value,
		loadingZoltarQuestionCount: loadingZoltarQuestionCount.value,
		loadingZoltarQuestions: loadingZoltarQuestions.value,
		loadingZoltarUniverse: loadingZoltarUniverse.value,
		loadZoltarQuestionCount: loadZoltarQuestionCountData,
		loadZoltarQuestions: loadQuestions,
		loadZoltarUniverse,
		refreshZoltarUniverse,
		zoltarChildUniverseError: zoltarChildUniverseError.value,
		zoltarQuestionCount: zoltarQuestionCount.value,
		zoltarQuestions: zoltarQuestions.value,
		zoltarUniverse: zoltarUniverseLoadedId.value === activeUniverseId ? zoltarUniverse.value : undefined,
		zoltarUniverseLoadedId: zoltarUniverseLoadedId.value,
		zoltarUniverseMissing: zoltarUniverseMissing.value,
	}
}
