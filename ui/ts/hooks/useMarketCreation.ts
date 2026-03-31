import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import type { Address, Hash } from 'viem'
import { approveErc20, createMarket as createMarketTransaction, createZoltarChildUniverse, forkZoltarUniverse, getDeploymentSteps, loadAllZoltarQuestions, loadErc20Allowance, loadErc20Balance, loadZoltarQuestionCount, loadZoltarUniverseSummary } from '../contracts.js'
import { createReadClient, createWalletWriteClient, getRequiredInjectedEthereum } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { createMarketParameters, hasDeployedStep } from '../lib/marketCreation.js'
import { getDefaultMarketFormState, parseBigIntInput } from '../lib/marketForm.js'
import type { MarketFormState } from '../types/app.js'
import type { DeploymentStatus, MarketCreationResult, MarketDetails, ZoltarForkActionResult, ZoltarUniverseSummary } from '../types/contracts.js'

type UseMarketCreationParameters = {
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

function formatQuestionId(questionId: bigint) {
	return `0x${ questionId.toString(16) }`
}

function getZoltarAddress() {
	const zoltarStep = getDeploymentSteps().find(step => step.id === 'zoltar')
	if (zoltarStep === undefined) throw new Error('Zoltar deployment step not found')
	return zoltarStep.address
}

export function useMarketCreation({ accountAddress, activeUniverseId, autoLoadInitialData, deploymentStatuses, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted, refreshState }: UseMarketCreationParameters) {
	const marketForm = useSignal<MarketFormState>(getDefaultMarketFormState())
	const marketCreating = useSignal(false)
	const marketResult = useSignal<MarketCreationResult | undefined>(undefined)
	const marketError = useSignal<string | undefined>(undefined)
	const isMounted = useSignal(true)
	const loadingZoltarUniverse = useSignal(false)
	const zoltarUniverseLoadRequestId = useSignal(0)
	const zoltarUniverseLoadedId = useSignal<bigint | undefined>(undefined)
	const loadingZoltarQuestionCount = useSignal(false)
	const loadingZoltarQuestions = useSignal(false)
	const zoltarQuestionCount = useSignal<bigint | undefined>(undefined)
	const zoltarQuestions = useSignal<MarketDetails[]>([])
	const zoltarUniverse = useSignal<ZoltarUniverseSummary | undefined>(undefined)
	const zoltarForkError = useSignal<string | undefined>(undefined)
	const zoltarForkPending = useSignal(false)
	const zoltarForkQuestionId = useSignal('')
	const zoltarForkResult = useSignal<ZoltarForkActionResult | undefined>(undefined)
	const zoltarForkAllowance = useSignal<bigint | undefined>(undefined)
	const zoltarForkRepBalance = useSignal<bigint | undefined>(undefined)
	const loadingZoltarForkAccess = useSignal(false)
	const zoltarForkAccessLoadRequestId = useSignal(0)
	const zoltarChildUniverseError = useSignal<string | undefined>(undefined)

	useEffect(
		() => () => {
			isMounted.value = false
		},
		[],
	)

	const ensureZoltarUniverse = async (): Promise<ZoltarUniverseSummary> => {
		if (zoltarUniverse.value !== undefined && zoltarUniverseLoadedId.value === activeUniverseId) return zoltarUniverse.value

		const loadedUniverse = await loadZoltarUniverse()
		if (loadedUniverse !== undefined) return loadedUniverse

		const reloadedUniverse = await loadZoltarUniverse()
		if (reloadedUniverse !== undefined) return reloadedUniverse

		throw new Error('Failed to load current Zoltar universe')
	}

	const loadZoltarForkAccess = async () => {
		if (accountAddress === undefined || zoltarUniverse.value === undefined) {
			zoltarForkAllowance.value = undefined
			zoltarForkRepBalance.value = undefined
			return
		}

		const requestId = zoltarForkAccessLoadRequestId.value + 1
		zoltarForkAccessLoadRequestId.value = requestId
		loadingZoltarForkAccess.value = true
		try {
			const readClient = createReadClient()
			const [allowance, balance] = await Promise.all([loadErc20Allowance(readClient, zoltarUniverse.value.reputationToken, accountAddress, getZoltarAddress()), loadErc20Balance(readClient, zoltarUniverse.value.reputationToken, accountAddress)])
			if (!isMounted.value || requestId !== zoltarForkAccessLoadRequestId.value) return
			zoltarForkAllowance.value = allowance
			zoltarForkRepBalance.value = balance
		} finally {
			if (isMounted.value && requestId === zoltarForkAccessLoadRequestId.value) {
				loadingZoltarForkAccess.value = false
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
			if (!isMounted.value) return
			if (!universe.hasForked) {
				throw new Error('Zoltar needs to fork before child universes can be deployed')
			}
			const result = await createZoltarChildUniverse(createWalletWriteClient(accountAddress, { onTransactionSubmitted }), universe.universeId, outcomeIndex)
			if (!isMounted.value) return
			onTransaction(result.hash)
			await refreshState()
			if (!isMounted.value) return
			await loadZoltarUniverse()
			if (!isMounted.value) return
			await loadZoltarForkAccess()
		} catch (error) {
			zoltarChildUniverseError.value = getErrorMessage(error, 'Failed to deploy child universe')
		} finally {
			if (isMounted.value) {
				onTransactionFinished()
			}
		}
	}

	const createMarket = async () => {
		try {
			getRequiredInjectedEthereum()
		} catch {
			marketError.value = 'No injected wallet found'
			return
		}
		if (accountAddress === undefined) {
			marketError.value = 'Connect a wallet before creating a question'
			return
		}
		const marketParameters = createMarketParameters(marketForm.value)
		if (!hasDeployedStep(deploymentStatuses, 'zoltarQuestionData')) {
			marketError.value = 'Deploy ZoltarQuestionData before creating a question'
			return
		}

		marketCreating.value = true
		marketError.value = undefined
		marketResult.value = undefined

		try {
			onTransactionRequested()
			const result = await createMarketTransaction(createWalletWriteClient(accountAddress, { onTransactionSubmitted }), marketParameters)
			if (!isMounted.value) return
			marketResult.value = result
			zoltarForkQuestionId.value = result.questionId
			onTransaction(result.createQuestionHash)
			await refreshState()
			if (!isMounted.value) return
			await loadQuestions()
		} catch (error) {
			marketError.value = getErrorMessage(error, 'Failed to create question')
		} finally {
			if (isMounted.value) {
				marketCreating.value = false
				onTransactionFinished()
			}
		}
	}

	const loadZoltarUniverse = async () => {
		const requestId = zoltarUniverseLoadRequestId.value + 1
		zoltarUniverseLoadRequestId.value = requestId
		const requestedUniverseId = activeUniverseId
		loadingZoltarUniverse.value = true
		zoltarUniverse.value = undefined
		zoltarUniverseLoadedId.value = undefined
		zoltarForkAllowance.value = undefined
		zoltarForkRepBalance.value = undefined
		zoltarForkError.value = undefined
		zoltarForkResult.value = undefined
		zoltarChildUniverseError.value = undefined
		zoltarForkQuestionId.value = ''
		try {
			const universe = await loadZoltarUniverseSummary(createReadClient(), requestedUniverseId)
			if (requestId !== zoltarUniverseLoadRequestId.value) return undefined
			if (requestedUniverseId !== activeUniverseId) return undefined
			if (!isMounted.value) return undefined
			zoltarUniverse.value = universe
			zoltarUniverseLoadedId.value = requestedUniverseId
			return universe
		} finally {
			if (requestId === zoltarUniverseLoadRequestId.value) {
				if (isMounted.value) {
					loadingZoltarUniverse.value = false
				}
			}
		}
	}

	const loadZoltarQuestionCountData = async () => {
		loadingZoltarQuestionCount.value = true
		try {
			const questionCount = await loadZoltarQuestionCount(createReadClient())
			if (!isMounted.value) return
			zoltarQuestionCount.value = questionCount
		} finally {
			if (isMounted.value) {
				loadingZoltarQuestionCount.value = false
			}
		}
	}

	const loadQuestions = async () => {
		loadingZoltarQuestions.value = true
		loadingZoltarQuestionCount.value = true
		try {
			const readClient = createReadClient()
			const [questions, questionCount] = await Promise.all([loadAllZoltarQuestions(readClient), loadZoltarQuestionCount(readClient)])
			if (!isMounted.value) return
			zoltarQuestions.value = questions
			zoltarQuestionCount.value = questionCount
		} finally {
			if (isMounted.value) {
				loadingZoltarQuestions.value = false
				loadingZoltarQuestionCount.value = false
			}
		}
	}

	const runZoltarForkAction = async (action: (walletAddress: Address, universe: ZoltarUniverseSummary, questionId: bigint) => Promise<ZoltarForkActionResult>, errorFallback: string, refreshAfter: boolean) => {
		try {
			getRequiredInjectedEthereum()
		} catch {
			zoltarForkError.value = 'No injected wallet found'
			return
		}
		if (accountAddress === undefined) {
			zoltarForkError.value = 'Connect a wallet before using Zoltar fork actions'
			return
		}

		zoltarForkPending.value = true
		zoltarForkError.value = undefined
		zoltarForkResult.value = undefined

		try {
			onTransactionRequested()
			const questionId = parseBigIntInput(zoltarForkQuestionId.value, 'Fork question ID')
			const universe = await ensureZoltarUniverse()
			if (!isMounted.value) return
			const result = await action(accountAddress, universe, questionId)
			if (!isMounted.value) return
			zoltarForkResult.value = result
			onTransaction(result.hash)
			if (refreshAfter) {
				await refreshState()
				if (!isMounted.value) return
				await loadZoltarUniverse()
			}
			if (!isMounted.value) return
			await loadZoltarForkAccess()
		} catch (error) {
			zoltarForkError.value = getErrorMessage(error, errorFallback)
		} finally {
			if (isMounted.value) {
				zoltarForkPending.value = false
				onTransactionFinished()
			}
		}
	}

	const approveZoltarForkRep = async () =>
		await runZoltarForkAction(
			async (walletAddress, universe, questionId) => {
				const approval = await approveErc20(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), universe.reputationToken, getZoltarAddress(), universe.forkThreshold, 'approveForkRep')
				return {
					action: 'approveForkRep',
					hash: approval.hash,
					questionId: formatQuestionId(questionId),
					universeId: universe.universeId,
				} satisfies ZoltarForkActionResult
			},
			'Failed to approve REP for Zoltar fork',
			false,
		)

	const forkZoltar = async () =>
		await runZoltarForkAction(
			async (walletAddress, universe, questionId) => {
				if (universe.hasForked) throw new Error('Zoltar has already forked')
				return await forkZoltarUniverse(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), universe.universeId, questionId)
			},
			'Failed to fork Zoltar',
			true,
		)

	useEffect(() => {
		if (!autoLoadInitialData) return
		void Promise.allSettled([loadZoltarUniverse(), loadZoltarQuestionCountData()])
	}, [activeUniverseId, autoLoadInitialData])

	useEffect(() => {
		void loadZoltarForkAccess().catch(() => undefined)
	}, [accountAddress, zoltarUniverse.value?.reputationToken])

	const resetMarket = () => {
		marketForm.value = getDefaultMarketFormState()
		marketError.value = undefined
		marketResult.value = undefined
	}

	return {
		approveZoltarForkRep,
		createChildUniverse,
		createMarket,
		forkZoltar,
		loadZoltarForkAccess: loadingZoltarForkAccess.value,
		loadZoltarQuestionCount: loadZoltarQuestionCountData,
		loadZoltarQuestions: loadQuestions,
		loadZoltarUniverse,
		loadingZoltarForkAccess: loadingZoltarForkAccess.value,
		loadingZoltarQuestionCount: loadingZoltarQuestionCount.value,
		loadingZoltarQuestions: loadingZoltarQuestions.value,
		loadingZoltarUniverse: loadingZoltarUniverse.value,
		marketCreating: marketCreating.value,
		marketError: marketError.value,
		marketForm: marketForm.value,
		marketResult: marketResult.value,
		resetMarket,
		setMarketForm: (updater: (current: MarketFormState) => MarketFormState) => {
			marketForm.value = updater(marketForm.value)
		},
		setZoltarForkQuestionId: (questionId: string) => {
			zoltarForkQuestionId.value = questionId
		},
		zoltarForkError: zoltarForkError.value,
		zoltarForkAllowance: zoltarForkAllowance.value,
		zoltarForkPending: zoltarForkPending.value,
		zoltarForkQuestionId: zoltarForkQuestionId.value,
		zoltarForkRepBalance: zoltarForkRepBalance.value,
		zoltarForkResult: zoltarForkResult.value,
		zoltarChildUniverseError: zoltarChildUniverseError.value,
		zoltarQuestionCount: zoltarQuestionCount.value,
		zoltarQuestions: zoltarQuestions.value,
		zoltarUniverse: zoltarUniverseLoadedId.value === activeUniverseId ? zoltarUniverse.value : undefined,
	}
}
