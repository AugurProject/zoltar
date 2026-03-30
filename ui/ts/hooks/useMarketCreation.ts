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
	accountRepBalance: bigint | undefined
	autoLoadInitialData: boolean
	deploymentStatuses: DeploymentStatus[]
	activeUniverseId: bigint
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

export function useMarketCreation({ accountAddress, accountRepBalance, activeUniverseId, autoLoadInitialData, deploymentStatuses, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted, refreshState }: UseMarketCreationParameters) {
	const marketForm = useSignal<MarketFormState>(getDefaultMarketFormState())
	const marketCreating = useSignal(false)
	const marketResult = useSignal<MarketCreationResult | undefined>(undefined)
	const marketError = useSignal<string | undefined>(undefined)
	const loadingZoltarUniverse = useSignal(false)
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
	const zoltarChildUniverseError = useSignal<string | undefined>(undefined)

	const ensureZoltarUniverse = async () => {
		if (zoltarUniverse.value !== undefined && zoltarUniverse.value.universeId === activeUniverseId) return zoltarUniverse.value
		return await loadZoltarUniverse()
	}

	const loadZoltarForkAccess = async () => {
		if (accountAddress === undefined || zoltarUniverse.value === undefined) {
			zoltarForkAllowance.value = undefined
			zoltarForkRepBalance.value = undefined
			return
		}

		loadingZoltarForkAccess.value = true
		try {
			const readClient = createReadClient()
			const [allowance, balance] = await Promise.all([loadErc20Allowance(readClient, zoltarUniverse.value.reputationToken, accountAddress, getZoltarAddress()), loadErc20Balance(readClient, zoltarUniverse.value.reputationToken, accountAddress)])
			zoltarForkAllowance.value = allowance
			zoltarForkRepBalance.value = balance
		} finally {
			loadingZoltarForkAccess.value = false
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
			const hash = await createZoltarChildUniverse(createWalletWriteClient(accountAddress, { onTransactionSubmitted }), universe.universeId, outcomeIndex)
			onTransaction(hash)
			await refreshState()
			await loadZoltarUniverse()
			await loadZoltarForkAccess()
		} catch (error) {
			zoltarChildUniverseError.value = getErrorMessage(error, 'Failed to deploy child universe')
		} finally {
			onTransactionFinished()
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
			marketResult.value = result
			zoltarForkQuestionId.value = result.questionId
			onTransaction(result.createQuestionHash)
			await refreshState()
			await loadQuestions()
		} catch (error) {
			marketError.value = getErrorMessage(error, 'Failed to create question')
		} finally {
			marketCreating.value = false
			onTransactionFinished()
		}
	}

	const loadZoltarUniverse = async () => {
		loadingZoltarUniverse.value = true
		zoltarUniverse.value = undefined
		zoltarForkAllowance.value = undefined
		zoltarForkRepBalance.value = undefined
		zoltarForkError.value = undefined
		zoltarForkResult.value = undefined
		zoltarChildUniverseError.value = undefined
		zoltarForkQuestionId.value = ''
		try {
			const universe = await loadZoltarUniverseSummary(createReadClient(), activeUniverseId)
			zoltarUniverse.value = universe
			return universe
		} finally {
			loadingZoltarUniverse.value = false
		}
	}

	const loadZoltarQuestionCountData = async () => {
		loadingZoltarQuestionCount.value = true
		try {
			zoltarQuestionCount.value = await loadZoltarQuestionCount(createReadClient())
		} finally {
			loadingZoltarQuestionCount.value = false
		}
	}

	const loadQuestions = async () => {
		loadingZoltarQuestions.value = true
		loadingZoltarQuestionCount.value = true
		try {
			const readClient = createReadClient()
			const [questions, questionCount] = await Promise.all([loadAllZoltarQuestions(readClient), loadZoltarQuestionCount(readClient)])
			zoltarQuestions.value = questions
			zoltarQuestionCount.value = questionCount
		} finally {
			loadingZoltarQuestions.value = false
			loadingZoltarQuestionCount.value = false
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
			const result = await action(accountAddress, universe, questionId)
			zoltarForkResult.value = result
			onTransaction(result.hash)
			if (refreshAfter) {
				await refreshState()
				await loadZoltarUniverse()
			}
			await loadZoltarForkAccess()
		} catch (error) {
			zoltarForkError.value = getErrorMessage(error, errorFallback)
		} finally {
			zoltarForkPending.value = false
			onTransactionFinished()
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
		void loadZoltarUniverse()
		void loadZoltarQuestionCountData()
	}, [activeUniverseId, autoLoadInitialData])

	useEffect(() => {
		void loadZoltarForkAccess()
	}, [accountAddress, accountRepBalance, zoltarUniverse.value?.reputationToken])

	const resetMarket = () => {
		marketForm.value = getDefaultMarketFormState()
		marketError.value = undefined
		marketResult.value = undefined
	}

	return {
		approveZoltarForkRep,
		createMarket,
		createChildUniverse,
		forkZoltar,
		marketCreating: marketCreating.value,
		marketError: marketError.value,
		marketForm: marketForm.value,
		marketResult: marketResult.value,
		loadingZoltarQuestionCount: loadingZoltarQuestionCount.value,
		loadingZoltarQuestions: loadingZoltarQuestions.value,
		loadingZoltarUniverse: loadingZoltarUniverse.value,
		loadZoltarQuestionCount: loadZoltarQuestionCountData,
		loadZoltarQuestions: loadQuestions,
		loadZoltarUniverse,
		zoltarQuestionCount: zoltarQuestionCount.value,
		zoltarForkError: zoltarForkError.value,
		zoltarForkAllowance: zoltarForkAllowance.value,
		zoltarForkPending: zoltarForkPending.value,
		zoltarForkQuestionId: zoltarForkQuestionId.value,
		zoltarForkRepBalance: zoltarForkRepBalance.value,
		zoltarForkResult: zoltarForkResult.value,
		zoltarChildUniverseError: zoltarChildUniverseError.value,
		zoltarQuestions: zoltarQuestions.value,
		zoltarUniverse: zoltarUniverse.value?.universeId === activeUniverseId ? zoltarUniverse.value : undefined,
		loadingZoltarForkAccess: loadingZoltarForkAccess.value,
		resetMarket,
		setMarketForm: (updater: (current: MarketFormState) => MarketFormState) => {
			marketForm.value = updater(marketForm.value)
		},
		setZoltarForkQuestionId: (questionId: string) => {
			zoltarForkQuestionId.value = questionId
		},
	}
}
