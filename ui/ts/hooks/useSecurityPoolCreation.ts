import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import type { Address, Hash } from 'viem'
import { createSecurityPool, loadMarketDetails, originSecurityPoolExists } from '../contracts.js'
import { useLoadController } from './useLoadController.js'
import { createConnectedReadClient, createWalletWriteClient } from '../lib/clients.js'
import { useRequestGuard } from '../lib/requestGuard.js'
import { getErrorMessage, isRecoverableContractReadError } from '../lib/errors.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '../lib/actionFeedback.js'
import { runWriteAction } from '../lib/writeAction.js'
import { createSecurityPoolParameters, hasDeployedStep } from '../lib/marketCreation.js'
import { getDefaultSecurityPoolFormState, tryParseBigIntInput } from '../lib/marketForm.js'
import type { SecurityPoolFormState } from '../types/app.js'
import type { ActionFeedback } from '../types/components.js'
import type { DeploymentStatus, MarketDetails, SecurityPoolCreationResult } from '../types/contracts.js'

type UseSecurityPoolCreationParameters = {
	accountAddress: Address | undefined
	deploymentStatuses: DeploymentStatus[]
	enabled: boolean
	onTransaction: (hash: Hash) => void
	onTransactionFinished: () => void
	onTransactionRequested: () => void
	onTransactionSubmitted: (hash: Hash) => void
	refreshState: () => Promise<void>
	zoltarUniverseHasForked: boolean
}

export function resolveSecurityPoolQuestionLookupInput(marketIdInput: string) {
	const marketId = marketIdInput.trim()
	if (marketId === '') return undefined
	return tryParseBigIntInput(marketId) === undefined ? undefined : marketId
}

function parseQuestionIdInput(marketId: string) {
	const trimmedMarketId = marketId.trim()
	if (trimmedMarketId === '') throw new Error('Question ID is required')
	return BigInt(trimmedMarketId)
}

export function useSecurityPoolCreation({ accountAddress, deploymentStatuses, enabled, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted, refreshState, zoltarUniverseHasForked }: UseSecurityPoolCreationParameters) {
	const marketDetailsLoad = useLoadController()
	const duplicateOriginPoolCheckLoad = useLoadController()
	const marketDetails = useSignal<MarketDetails | undefined>(undefined)
	const poolCreationMarketDetails = useSignal<MarketDetails | undefined>(undefined)
	const securityPoolCreating = useSignal(false)
	const securityPoolError = useSignal<string | undefined>(undefined)
	const securityPoolForm = useSignal<SecurityPoolFormState>(getDefaultSecurityPoolFormState())
	const securityPoolCreationFeedback = useSignal<ActionFeedback<'createSecurityPool'> | undefined>(undefined)
	const securityPoolResult = useSignal<SecurityPoolCreationResult | undefined>(undefined)
	const duplicateOriginPoolExists = useSignal(false)
	const nextMarketDetailsLoad = useRequestGuard()
	const nextDuplicateCheck = useRequestGuard()

	const loadDuplicateOriginPoolState = async () => {
		const isCurrent = nextDuplicateCheck()
		const marketId = securityPoolForm.value.marketId.trim()
		const securityMultiplierInput = securityPoolForm.value.securityMultiplier.trim()
		if (marketId === '' || securityMultiplierInput === '') {
			duplicateOriginPoolExists.value = false
			return
		}

		const questionId = tryParseBigIntInput(marketId)
		const securityMultiplier = tryParseBigIntInput(securityMultiplierInput)
		if (questionId === undefined || securityMultiplier === undefined) {
			duplicateOriginPoolExists.value = false
			return
		}

		await duplicateOriginPoolCheckLoad.track(async () => {
			try {
				const exists = await originSecurityPoolExists(createConnectedReadClient(), questionId, securityMultiplier)
				if (!isCurrent()) return
				duplicateOriginPoolExists.value = exists
			} catch (error) {
				if (!isRecoverableContractReadError(error)) throw error
				if (!isCurrent()) return
				duplicateOriginPoolExists.value = false
			}
		})
	}

	const loadMarketById = async (marketId: string, options?: { clearExisting?: boolean; isCurrent?: () => boolean }) => {
		if (!hasDeployedStep(deploymentStatuses, 'zoltarQuestionData')) {
			securityPoolError.value = 'Deploy ZoltarQuestionData before loading a market'
			return
		}

		const isCurrent = options?.isCurrent ?? nextMarketDetailsLoad()
		await marketDetailsLoad.run({
			isCurrent,
			onStart: () => {
				securityPoolError.value = undefined
				if (options?.clearExisting === true) marketDetails.value = undefined
			},
			load: async () => {
				const questionId = parseQuestionIdInput(marketId)
				const details = await loadMarketDetails(createConnectedReadClient(), questionId)
				return details
			},
			onSuccess: details => {
				if (!details.exists) {
					marketDetails.value = undefined
					securityPoolError.value = 'No market found for that ID'
					return
				}
				marketDetails.value = details
			},
			onError: error => {
				marketDetails.value = undefined
				securityPoolError.value = getErrorMessage(error, 'Failed to load market')
			},
		})
	}

	const loadMarket = async () => await loadMarketById(securityPoolForm.value.marketId)

	const createPool = async () => {
		if (securityPoolCreating.value) {
			securityPoolError.value = 'Security pool creation already in progress'
			return
		}
		securityPoolResult.value = undefined
		poolCreationMarketDetails.value = undefined
		securityPoolCreationFeedback.value = createPendingActionFeedback('createSecurityPool', 'Creating security pool')

		let capturedDetails: MarketDetails | undefined

		await runWriteAction(
			{
				accountAddress,
				missingWalletMessage: 'Connect a wallet before creating a security pool',
				onRefreshError: (message, hash) => {
					securityPoolCreationFeedback.value = createWarningActionFeedback('createSecurityPool', 'Security pool created', message, hash)
				},
				onTransaction,
				onTransactionRequested: () => {
					securityPoolCreating.value = true
					onTransactionRequested()
				},
				onTransactionFinished: () => {
					securityPoolCreating.value = false
					onTransactionFinished()
				},
				onWriteError: message => {
					securityPoolCreationFeedback.value = createErrorActionFeedback('createSecurityPool', 'Security pool creation failed', message)
				},
				refreshState,
				setErrorMessage: message => {
					securityPoolError.value = message
				},
			},
			async walletAddress => {
				if (!hasDeployedStep(deploymentStatuses, 'securityPoolFactory')) throw new Error('Deploy SecurityPoolFactory before creating a security pool')
				if (zoltarUniverseHasForked) throw new Error('Security pools cannot be created after the universe has forked')

				const parameters = createSecurityPoolParameters(securityPoolForm.value)
				const details = marketDetails.value?.questionId === parameters.questionId.toString() ? marketDetails.value : await loadMarketDetails(createConnectedReadClient(), parameters.questionId)
				if (!details.exists) throw new Error('No market found for that ID')
				if (details.marketType !== 'binary') {
					marketDetails.value = details
					throw new Error('Security pools can only be deployed for binary markets')
				}
				if (await originSecurityPoolExists(createConnectedReadClient(), parameters.questionId, parameters.securityMultiplier)) {
					marketDetails.value = details
					throw new Error('A security pool for this question and security multiplier already exists. Change the security multiplier to create a different pool.')
				}

				capturedDetails = details
				const result = await createSecurityPool(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), parameters)
				return { ...result, hash: result.deployPoolHash }
			},
			'Failed to create security pool',
			result => {
				if (capturedDetails !== undefined) {
					marketDetails.value = capturedDetails
					poolCreationMarketDetails.value = capturedDetails
				}
				securityPoolResult.value = result
				securityPoolCreationFeedback.value = createSuccessActionFeedback('createSecurityPool', 'Security pool created', result.hash)
			},
		)
	}

	const resetSecurityPoolCreation = () => {
		securityPoolError.value = undefined
		securityPoolResult.value = undefined
	}

	useEffect(() => {
		if (!enabled) return
		void loadDuplicateOriginPoolState()
	}, [enabled, securityPoolForm.value.marketId, securityPoolForm.value.securityMultiplier])

	useEffect(() => {
		if (!enabled) return
		const marketId = resolveSecurityPoolQuestionLookupInput(securityPoolForm.value.marketId)
		const isCurrent = nextMarketDetailsLoad()

		if (marketId === undefined) {
			marketDetails.value = undefined
			securityPoolError.value = undefined
			return
		}

		void loadMarketById(marketId, { clearExisting: true, isCurrent })
	}, [deploymentStatuses, enabled, securityPoolForm.value.marketId])

	return {
		checkingDuplicateOriginPool: duplicateOriginPoolCheckLoad.isLoading.value,
		duplicateOriginPoolExists: duplicateOriginPoolExists.value,
		loadMarketById,
		loadMarket,
		loadingMarketDetails: marketDetailsLoad.isLoading.value,
		marketDetails: marketDetails.value,
		securityPoolCreationFeedback: securityPoolCreationFeedback.value,
		securityPoolCreating: securityPoolCreating.value,
		securityPoolError: securityPoolError.value,
		securityPoolForm: securityPoolForm.value,
		securityPoolResult: securityPoolResult.value,
		poolCreationMarketDetails: poolCreationMarketDetails.value,
		resetSecurityPoolCreation,
		setSecurityPoolForm: (updater: (current: SecurityPoolFormState) => SecurityPoolFormState) => {
			securityPoolForm.value = updater(securityPoolForm.value)
		},
		createPool,
	}
}
