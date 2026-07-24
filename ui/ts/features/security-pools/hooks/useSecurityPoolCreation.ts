import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import type { Address, Hash } from '@zoltar/shared/ethereum'
import { createSecurityPool, loadMarketDetails, originSecurityPoolExists } from '../../../protocol/index.js'
import { useLoadController } from '../../../hooks/useLoadController.js'
import { createConnectedReadClient, createWalletWriteClient } from '../../../lib/clients.js'
import { useRequestGuard } from '../../../lib/requestGuard.js'
import { getErrorMessage, isRecoverableContractReadError } from '../../../lib/errors.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '../../../lib/actionFeedback.js'
import type { ActionFeedback } from '../../../lib/actionFeedback.js'
import { createSecurityPoolCreationSuccessPresentation, createSecurityPoolCreationTransactionIntent, createSecurityPoolCreationWarningPresentation } from '../../transactionPresentations.js'
import { runWriteAction } from '../../../lib/writeAction.js'
import { createSecurityPoolParameters, hasDeployedStep } from '../../markets/lib/marketCreation.js'
import { getDefaultSecurityPoolFormState, tryParseBigIntInput } from '../../markets/lib/marketForm.js'
import { tryParseDecimalInput } from '../../../lib/decimal.js'
import type { SecurityPoolFormState, WriteOperationsParameters } from '../../../types/app.js'
import type { DeploymentStatus, MarketDetails, SecurityPoolCreationResult } from '../../../types/contracts.js'

type UseSecurityPoolCreationParameters = {
	accountAddress: Address | undefined
	deploymentStatuses: DeploymentStatus[]
	enabled: boolean
	onTransactionFailed?: WriteOperationsParameters['onTransactionFailed']
	onTransactionFinished: () => void
	onTransactionPresented: WriteOperationsParameters['onTransactionPresented']
	onTransactionPrepared?: WriteOperationsParameters['onTransactionPrepared']
	onTransactionRequested: WriteOperationsParameters['onTransactionRequested']
	onTransactionSubmitted: (hash: Hash) => void
	refreshState: WriteOperationsParameters['refreshState']
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

export function useSecurityPoolCreation({ accountAddress, deploymentStatuses, enabled, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState, zoltarUniverseHasForked }: UseSecurityPoolCreationParameters) {
	const marketDetailsLoad = useLoadController()
	const duplicateOriginPoolCheckLoad = useLoadController()
	const marketDetails = useSignal<MarketDetails | undefined>(undefined)
	const poolCreationMarketDetails = useSignal<MarketDetails | undefined>(undefined)
	const securityPoolCreating = useSignal(false)
	const securityPoolSubmissionInProgress = useSignal(false)
	const securityPoolError = useSignal<string | undefined>(undefined)
	const securityPoolForm = useSignal<SecurityPoolFormState>(getDefaultSecurityPoolFormState())
	const securityPoolCreationFeedback = useSignal<ActionFeedback<'createSecurityPool'> | undefined>(undefined)
	const securityPoolResult = useSignal<SecurityPoolCreationResult | undefined>(undefined)
	const duplicateOriginPoolExists = useSignal(false)
	const nextMarketDetailsLoad = useRequestGuard()
	const nextDuplicateCheck = useRequestGuard()
	const isCurrentSubmittedQuestion = (questionId: bigint) => tryParseBigIntInput(securityPoolForm.value.marketId) === questionId

	const loadDuplicateOriginPoolState = async () => {
		const isCurrent = nextDuplicateCheck()
		const marketId = securityPoolForm.value.marketId.trim()
		const securityMultiplierInput = securityPoolForm.value.securityMultiplier.trim()
		const initialReportPriorityFeeInput = securityPoolForm.value.initialReportPriorityFeeGwei.trim()
		if (marketId === '' || securityMultiplierInput === '' || initialReportPriorityFeeInput === '') {
			duplicateOriginPoolExists.value = false
			return
		}

		const questionId = tryParseBigIntInput(marketId)
		const securityMultiplier = tryParseBigIntInput(securityMultiplierInput)
		const initialReportPriorityFeeWeiPerGas = tryParseDecimalInput(initialReportPriorityFeeInput, 9)
		if (questionId === undefined || securityMultiplier === undefined || initialReportPriorityFeeWeiPerGas === undefined || initialReportPriorityFeeWeiPerGas <= 0n) {
			duplicateOriginPoolExists.value = false
			return
		}

		await duplicateOriginPoolCheckLoad.track(async () => {
			try {
				const exists = await originSecurityPoolExists(createConnectedReadClient(), questionId, securityMultiplier, initialReportPriorityFeeWeiPerGas)
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
			securityPoolError.value = 'Deploy ZoltarQuestionData before selecting a question'
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

	const createPool = async () => {
		if (securityPoolSubmissionInProgress.value) {
			securityPoolError.value = 'Security pool creation already in progress'
			return
		}
		const submittedSecurityPoolForm = securityPoolForm.value
		const transactionContext = {
			initialReportPriorityFeeGwei: submittedSecurityPoolForm.initialReportPriorityFeeGwei,
			questionId: submittedSecurityPoolForm.marketId,
			securityMultiplier: submittedSecurityPoolForm.securityMultiplier,
		}
		securityPoolSubmissionInProgress.value = true
		securityPoolResult.value = undefined
		poolCreationMarketDetails.value = undefined
		securityPoolCreationFeedback.value = createPendingActionFeedback('createSecurityPool', 'Creating security pool')

		let capturedDetails: MarketDetails | undefined
		let capturedQuestionId: bigint | undefined

		try {
			await runWriteAction(
				{
					accountAddress,
					missingWalletMessage: 'Connect a wallet before creating a security pool',
					onRefreshError: (message, hash) => {
						securityPoolCreationFeedback.value = createWarningActionFeedback('createSecurityPool', 'Security pool created', message, hash)
						const result = securityPoolResult.value
						if (result !== undefined) onTransactionPresented(createSecurityPoolCreationWarningPresentation(result, message))
					},
					onTransactionRequested: () => {
						securityPoolCreating.value = true
						onTransactionRequested(createSecurityPoolCreationTransactionIntent(transactionContext))
					},
					onTransactionFinished: () => {
						securityPoolCreating.value = false
						onTransactionFinished()
					},
					onTransactionFailed,
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

					const parameters = createSecurityPoolParameters(submittedSecurityPoolForm)
					capturedQuestionId = parameters.questionId
					const details = marketDetails.value?.questionId === parameters.questionId.toString() ? marketDetails.value : await loadMarketDetails(createConnectedReadClient(), parameters.questionId)
					if (!details.exists) throw new Error('No market found for that ID')
					if (details.marketType !== 'binary') {
						if (isCurrentSubmittedQuestion(parameters.questionId)) {
							marketDetails.value = details
						}
						throw new Error('Security pools can only be deployed for binary markets')
					}
					if (await originSecurityPoolExists(createConnectedReadClient(), parameters.questionId, parameters.securityMultiplier, parameters.initialReportPriorityFeeWeiPerGas)) {
						if (isCurrentSubmittedQuestion(parameters.questionId)) {
							marketDetails.value = details
						}
						throw new Error('A security pool for this question, security multiplier, and priority fee already exists.')
					}

					capturedDetails = details
					const result = await createSecurityPool(createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), parameters)
					return { ...result, hash: result.deployPoolHash }
				},
				'Failed to create security pool',
				result => {
					if (capturedDetails !== undefined) {
						poolCreationMarketDetails.value = capturedDetails
						if (capturedQuestionId !== undefined && isCurrentSubmittedQuestion(capturedQuestionId)) {
							marketDetails.value = capturedDetails
						}
					}
					securityPoolResult.value = result
					securityPoolCreationFeedback.value = createSuccessActionFeedback('createSecurityPool', 'Security pool created', result.hash)
					onTransactionPresented(createSecurityPoolCreationSuccessPresentation(result))
				},
			)
		} finally {
			securityPoolSubmissionInProgress.value = false
		}
	}

	const resetSecurityPoolCreation = () => {
		securityPoolError.value = undefined
		securityPoolResult.value = undefined
	}

	useEffect(() => {
		if (!enabled) return
		void loadDuplicateOriginPoolState()
	}, [enabled, securityPoolForm.value.initialReportPriorityFeeGwei, securityPoolForm.value.marketId, securityPoolForm.value.securityMultiplier])

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
