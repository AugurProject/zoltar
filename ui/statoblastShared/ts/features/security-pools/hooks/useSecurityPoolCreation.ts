import { withReadTimeout } from '@zoltar/ui-core-shared/lib/promise.js'
import { getQuestionId, getQuestionIdHex } from '@zoltar/ui-zoltar-shared/protocol/helpers.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { createSecurityPool, getOriginSecurityPoolAddress, originSecurityPoolExists } from '../../../protocol/securityPools.js'
import { loadMarketDetails } from '@zoltar/ui-zoltar-shared/protocol/zoltar.js'
import { useLoadController } from '@zoltar/ui-core-shared/hooks/useLoadController.js'
import { createConnectedReadClient, createWalletWriteClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { embeddedTransactionSteps } from '@zoltar/ui-core-shared/components/TransactionStepsModal.js'
import { useRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import { getErrorMessage, isRecoverableContractReadError } from '@zoltar/ui-core-shared/lib/errors.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '@zoltar/ui-core-shared/transactions/actionFeedback.js'
import type { ActionFeedback } from '@zoltar/ui-core-shared/transactions/actionFeedback.js'
import { createSecurityPoolCreationSuccessPresentation, createSecurityPoolCreationTransactionIntent, createSecurityPoolCreationWarningPresentation } from '../../transactionPresentations.js'
import { runWriteAction } from '@zoltar/ui-core-shared/transactions/writeAction.js'
import { createMarketParameters, createSecurityPoolParameters } from '../../markets/lib/marketCreation.js'
import { hasDeployedStep } from '@zoltar/ui-core-shared/lib/deploymentStatus.js'
import { tryParseBigIntInput } from '@zoltar/ui-core-shared/forms/integerInput.js'
import { getDefaultSecurityPoolFormState, tryParseStatoblastSecurityMultiplierBpsInput } from '../../markets/lib/marketForm.js'
import { tryParseDecimalInput } from '@zoltar/ui-core-shared/forms/decimal.js'
import { validateMarketForm } from '@zoltar/ui-zoltar-shared/features/questions/lib/questionCreation.js'
import type { MarketFormState, SecurityPoolFormState, TransactionLifecycleParameters, WriteOperationContext } from '../../../types/app.js'
import type { DeploymentStatus, MarketDetails, SecurityPoolCreationResult } from '@zoltar/ui-core-shared/types/contracts.js'

type UseSecurityPoolCreationParameters = TransactionLifecycleParameters &
	WriteOperationContext & {
		activeUniverseId?: bigint | undefined
		deploymentStatuses: DeploymentStatus[]
		enabled: boolean
		newQuestionForm?: MarketFormState | undefined
		zoltarUniverseHasForked: boolean
	}

function resolveSecurityPoolQuestionLookupInput(marketIdInput: string) {
	const marketId = marketIdInput.trim()
	if (marketId === '') return undefined
	return tryParseBigIntInput(marketId) === undefined ? undefined : marketId
}

function parseQuestionIdInput(marketId: string) {
	const trimmedMarketId = marketId.trim()
	if (trimmedMarketId === '') throw new Error('Question ID is required')
	return BigInt(trimmedMarketId)
}

export function useSecurityPoolCreation({
	accountAddress,
	activeUniverseId,
	deploymentStatuses,
	enabled,
	newQuestionForm,
	onTransactionFailed,
	onTransactionFinished,
	onTransactionPresented,
	onTransactionPrepared,
	onTransactionRequested,
	onTransactionSubmitted,
	refreshState,
	zoltarUniverseHasForked,
}: UseSecurityPoolCreationParameters) {
	const marketDetailsLoad = useLoadController()
	const duplicateOriginPoolCheckLoad = useLoadController()
	const marketDetails = useSignal<MarketDetails | undefined>(undefined)
	const poolCreationMarketDetails = useSignal<MarketDetails | undefined>(undefined)
	const securityPoolCreating = useSignal(false)
	// The transaction review for pool creation renders inside the Create Pool card instead of the global modal.
	const securityPoolReview = useSignal<AbortController | undefined>(undefined)
	const dismissSecurityPoolReview = () => {
		const review = securityPoolReview.value
		if (review === undefined) return
		review.abort()
		if (embeddedTransactionSteps.value === review.signal) embeddedTransactionSteps.value = undefined
		securityPoolReview.value = undefined
	}
	useEffect(() => dismissSecurityPoolReview, [])
	const securityPoolSubmissionInProgress = useSignal(false)
	const securityPoolError = useSignal<string | undefined>(undefined)
	const securityPoolForm = useSignal<SecurityPoolFormState>(getDefaultSecurityPoolFormState())
	const securityPoolCreationFeedback = useSignal<ActionFeedback<'createSecurityPool'> | undefined>(undefined)
	const securityPoolResult = useSignal<SecurityPoolCreationResult | undefined>(undefined)
	const duplicateOriginPoolExists = useSignal(false)
	const duplicateOriginPoolAddress = useSignal<Address | undefined>(undefined)
	const existingQuestionCheck = useSignal<{ status: 'available' | 'checking' | 'error' } | { status: 'existing'; questionId: string; poolAddress?: Address | undefined } | undefined>(undefined)
	const existingQuestionCheckRetry = useSignal(0)
	const nextMarketDetailsLoad = useRequestGuard()
	const nextDuplicateCheck = useRequestGuard()
	const nextExistingQuestionCheck = useRequestGuard()
	const questionDataDeployed = hasDeployedStep(deploymentStatuses, 'zoltarQuestionData')
	const isCurrentSubmittedQuestion = (questionId: bigint) => tryParseBigIntInput(securityPoolForm.value.marketId) === questionId

	const loadDuplicateOriginPoolState = async () => {
		const isCurrent = nextDuplicateCheck()
		const marketId = securityPoolForm.value.marketId.trim()
		const statoblastSecurityMultiplierBpsInput = securityPoolForm.value.statoblastSecurityMultiplierBps.trim()
		const initialReportPriorityFeeInput = securityPoolForm.value.initialReportPriorityFeeEth.trim()
		if (marketId === '' || statoblastSecurityMultiplierBpsInput === '' || initialReportPriorityFeeInput === '') {
			duplicateOriginPoolExists.value = false
			duplicateOriginPoolAddress.value = undefined
			return
		}

		const questionId = tryParseBigIntInput(marketId)
		const statoblastSecurityMultiplierBps = tryParseStatoblastSecurityMultiplierBpsInput(statoblastSecurityMultiplierBpsInput)
		const initialReportPriorityFeeAttoEthPerGas = tryParseDecimalInput(initialReportPriorityFeeInput, 18)
		if (questionId === undefined || statoblastSecurityMultiplierBps === undefined || initialReportPriorityFeeAttoEthPerGas === undefined || initialReportPriorityFeeAttoEthPerGas <= 0n) {
			duplicateOriginPoolExists.value = false
			duplicateOriginPoolAddress.value = undefined
			return
		}

		await duplicateOriginPoolCheckLoad.track(async () => {
			try {
				const exists = await withReadTimeout(originSecurityPoolExists(createConnectedReadClient(), questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas))
				if (!isCurrent()) return
				duplicateOriginPoolExists.value = exists
				duplicateOriginPoolAddress.value = undefined
				if (!exists) return
				try {
					const address = await withReadTimeout(getOriginSecurityPoolAddress(createConnectedReadClient(), questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas))
					if (isCurrent()) duplicateOriginPoolAddress.value = address
				} catch (error) {
					if (!isRecoverableContractReadError(error)) throw error
					// The existence read already confirmed the duplicate; keep creation blocked.
				}
			} catch (error) {
				if (!isRecoverableContractReadError(error)) throw error
				if (!isCurrent()) return
				duplicateOriginPoolExists.value = false
				duplicateOriginPoolAddress.value = undefined
			}
		})
	}

	useEffect(() => {
		const isCurrent = nextExistingQuestionCheck()
		if (!enabled || newQuestionForm === undefined || newQuestionForm.marketType !== 'binary' || !validateMarketForm(newQuestionForm).isValid || !questionDataDeployed) {
			existingQuestionCheck.value = undefined
			return
		}
		const question = createMarketParameters(newQuestionForm)
		const questionId = getQuestionId(question.questionData, question.outcomeLabels)
		existingQuestionCheck.value = { status: 'checking' }
		void (async () => {
			try {
				const details = await withReadTimeout(loadMarketDetails(createConnectedReadClient(), questionId))
				if (!isCurrent()) return
				if (!details.exists) {
					existingQuestionCheck.value = { status: 'available' }
					return
				}
				existingQuestionCheck.value = { status: 'existing', questionId: questionId.toString(), poolAddress: undefined }
				const multiplier = tryParseStatoblastSecurityMultiplierBpsInput(securityPoolForm.value.statoblastSecurityMultiplierBps)
				const fee = tryParseDecimalInput(securityPoolForm.value.initialReportPriorityFeeEth, 18)
				if (multiplier === undefined || fee === undefined) return
				try {
					const poolAddress = await withReadTimeout(getOriginSecurityPoolAddress(createConnectedReadClient(), questionId, multiplier, fee))
					if (isCurrent()) existingQuestionCheck.value = { status: 'existing', questionId: questionId.toString(), poolAddress }
				} catch (error) {
					if (!isRecoverableContractReadError(error)) throw error
					// The question lookup already confirmed that the existing-question path is available.
				}
			} catch (error) {
				if (!isRecoverableContractReadError(error)) throw error
				if (isCurrent()) existingQuestionCheck.value = { status: 'error' }
			}
		})()
	}, [enabled, newQuestionForm, questionDataDeployed, securityPoolForm.value.statoblastSecurityMultiplierBps, securityPoolForm.value.initialReportPriorityFeeEth, existingQuestionCheckRetry.value])

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

	const createPool = async (questionIdOverride?: string, securityPoolFormOverride?: SecurityPoolFormState, newQuestionForm?: MarketFormState) => {
		if (securityPoolSubmissionInProgress.value) {
			securityPoolError.value = 'Security pool creation already in progress'
			return
		}
		const baseSecurityPoolForm = securityPoolFormOverride ?? securityPoolForm.value
		const submittedSecurityPoolForm = questionIdOverride === undefined ? baseSecurityPoolForm : { ...baseSecurityPoolForm, marketId: questionIdOverride }
		// A new question has no ID until the write derives it, and the existing-question field may hold a stale value.
		const transactionContext = {
			initialReportPriorityFeeEth: submittedSecurityPoolForm.initialReportPriorityFeeEth,
			questionId: newQuestionForm === undefined ? submittedSecurityPoolForm.marketId : undefined,
			questionTitle: newQuestionForm?.title,
			statoblastSecurityMultiplierBps: tryParseStatoblastSecurityMultiplierBpsInput(submittedSecurityPoolForm.statoblastSecurityMultiplierBps),
			universeId: activeUniverseId,
		}
		securityPoolSubmissionInProgress.value = true
		securityPoolResult.value = undefined
		poolCreationMarketDetails.value = undefined
		dismissSecurityPoolReview()
		const review = new AbortController()
		securityPoolReview.value = review
		embeddedTransactionSteps.value = review.signal
		securityPoolCreationFeedback.value = createPendingActionFeedback('createSecurityPool', 'Creating security pool')

		let capturedDetails: MarketDetails | undefined
		let capturedQuestionId: bigint | undefined

		try {
			await runWriteAction(
				{
					accountAddress,
					missingWalletMessage: 'Connect a wallet before creating a security pool',
					reviewSignal: review.signal,
					onRefreshError: (message, hash) => {
						securityPoolCreationFeedback.value = createWarningActionFeedback('createSecurityPool', 'Security pool created', message, hash)
						const result = securityPoolResult.value
						if (result !== undefined) onTransactionPresented(createSecurityPoolCreationWarningPresentation(result, message))
					},
					onTransactionRequested: () => {
						const accepted = onTransactionRequested(createSecurityPoolCreationTransactionIntent(transactionContext))
						if (accepted === false) return false
						securityPoolCreating.value = true
						return accepted
					},
					onTransactionFinished: () => {
						securityPoolCreating.value = false
						onTransactionFinished()
					},
					onTransactionFailed,
					onWriteError: message => {
						securityPoolError.value = message
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

					if (newQuestionForm !== undefined && newQuestionForm.marketType !== 'binary') throw new Error('Security pools require a binary question')
					const newQuestion = newQuestionForm === undefined ? undefined : createMarketParameters(newQuestionForm)
					const parameters = createSecurityPoolParameters(newQuestion === undefined ? submittedSecurityPoolForm : { ...submittedSecurityPoolForm, marketId: getQuestionId(newQuestion.questionData, newQuestion.outcomeLabels).toString() })
					capturedQuestionId = parameters.questionId
					if (newQuestion !== undefined && (await loadMarketDetails(createConnectedReadClient(), parameters.questionId)).exists) {
						let poolAddress: Address | undefined
						try {
							poolAddress = await getOriginSecurityPoolAddress(createConnectedReadClient(), parameters.questionId, parameters.statoblastSecurityMultiplierBps, parameters.initialReportPriorityFeeAttoEthPerGas)
						} catch (error) {
							if (!isRecoverableContractReadError(error)) throw error
							// The question is already known to exist even if the pool lookup fails.
						}
						existingQuestionCheck.value = { status: 'existing', questionId: parameters.questionId.toString(), poolAddress }
						throw new Error('This question already exists. Use its question ID to create a pool instead.')
					}
					let details: MarketDetails
					if (newQuestion === undefined) {
						details = marketDetails.value?.questionId === parameters.questionId.toString() ? marketDetails.value : await loadMarketDetails(createConnectedReadClient(), parameters.questionId)
					} else {
						details = { ...newQuestion.questionData, marketType: 'binary', outcomeLabels: newQuestion.outcomeLabels, questionId: getQuestionIdHex(parameters.questionId), exists: true, createdAt: 0n }
					}
					if (!details.exists) throw new Error('No market found for that ID')
					if (details.marketType !== 'binary') {
						if (isCurrentSubmittedQuestion(parameters.questionId)) {
							marketDetails.value = details
						}
						throw new Error('Security pools can only be deployed for binary markets')
					}
					if (await originSecurityPoolExists(createConnectedReadClient(), parameters.questionId, parameters.statoblastSecurityMultiplierBps, parameters.initialReportPriorityFeeAttoEthPerGas)) {
						if (isCurrentSubmittedQuestion(parameters.questionId)) {
							marketDetails.value = details
						}
						throw new Error('A security pool for this question, Statoblast security multiplier, and priority fee already exists.')
					}

					const reviewLabels = { title: newQuestion === undefined ? securityPoolCopy.createPoolReviewTitle : securityPoolCopy.createQuestionAndPoolReviewTitle }
					const result = await createSecurityPool(createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted, reviewSignal: review.signal, skipAppReview: true }), parameters, newQuestion?.questionData, reviewLabels)
					capturedDetails = result.questionCreatedAt === undefined ? details : { ...details, createdAt: result.questionCreatedAt }
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
					onTransactionPresented(createSecurityPoolCreationSuccessPresentation(result))
					securityPoolCreationFeedback.value = createSuccessActionFeedback('createSecurityPool', 'Security pool created', result.hash)
				},
			)
		} finally {
			dismissSecurityPoolReview()
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
	}, [enabled, securityPoolForm.value.initialReportPriorityFeeEth, securityPoolForm.value.marketId, securityPoolForm.value.statoblastSecurityMultiplierBps])

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
		duplicateOriginPoolAddress: duplicateOriginPoolAddress.value,
		duplicateOriginPoolExists: duplicateOriginPoolExists.value,
		existingQuestionCheck: existingQuestionCheck.value,
		retryExistingQuestionCheck: () => {
			existingQuestionCheckRetry.value += 1
		},
		loadMarketById,
		loadingMarketDetails: marketDetailsLoad.isLoading.value,
		marketDetails: marketDetails.value,
		securityPoolCreationFeedback: securityPoolCreationFeedback.value,
		securityPoolCreating: securityPoolCreating.value,
		securityPoolError: securityPoolError.value,
		securityPoolForm: securityPoolForm.value,
		securityPoolResult: securityPoolResult.value,
		securityPoolReviewSignal: securityPoolReview.value?.signal,
		poolCreationMarketDetails: poolCreationMarketDetails.value,
		dismissSecurityPoolReview,
		resetSecurityPoolCreation,
		setSecurityPoolForm: (updater: (current: SecurityPoolFormState) => SecurityPoolFormState) => {
			securityPoolForm.value = updater(securityPoolForm.value)
		},
		createPool,
	}
}
