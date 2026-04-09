import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import type { Address, Hash } from 'viem'
import { createSecurityPool, loadMarketDetails, originSecurityPoolExists } from '../contracts.js'
import { createConnectedReadClient, createWalletWriteClient, getRequiredInjectedEthereum } from '../lib/clients.js'
import { useRequestGuard } from '../lib/requestGuard.js'
import { getErrorMessage } from '../lib/errors.js'
import { createSecurityPoolParameters, hasDeployedStep } from '../lib/marketCreation.js'
import { getDefaultSecurityPoolFormState, parseBigIntInput } from '../lib/marketForm.js'
import type { SecurityPoolFormState } from '../types/app.js'
import type { DeploymentStatus, MarketDetails, SecurityPoolCreationResult } from '../types/contracts.js'

type UseSecurityPoolCreationParameters = {
	accountAddress: Address | undefined
	deploymentStatuses: DeploymentStatus[]
	onTransaction: (hash: Hash) => void
	onTransactionFinished: () => void
	onTransactionRequested: () => void
	onTransactionSubmitted: (hash: Hash) => void
	refreshState: () => Promise<void>
	zoltarUniverseHasForked: boolean
}

export function useSecurityPoolCreation({ accountAddress, deploymentStatuses, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted, refreshState, zoltarUniverseHasForked }: UseSecurityPoolCreationParameters) {
	const loadingMarketDetails = useSignal(false)
	const marketDetails = useSignal<MarketDetails | undefined>(undefined)
	const poolCreationMarketDetails = useSignal<MarketDetails | undefined>(undefined)
	const securityPoolCreating = useSignal(false)
	const securityPoolError = useSignal<string | undefined>(undefined)
	const securityPoolForm = useSignal<SecurityPoolFormState>(getDefaultSecurityPoolFormState())
	const securityPoolResult = useSignal<SecurityPoolCreationResult | undefined>(undefined)
	const duplicateOriginPoolExists = useSignal(false)
	const checkingDuplicateOriginPool = useSignal(false)
	const nextMarketDetailsLoad = useRequestGuard()
	const nextDuplicateCheck = useRequestGuard()

	const loadDuplicateOriginPoolState = async () => {
		const marketId = securityPoolForm.value.marketId.trim()
		const securityMultiplierInput = securityPoolForm.value.securityMultiplier.trim()
		if (marketId === '' || securityMultiplierInput === '') {
			duplicateOriginPoolExists.value = false
			checkingDuplicateOriginPool.value = false
			return
		}

		let questionId: bigint
		let securityMultiplier: bigint
		try {
			questionId = BigInt(marketId)
			securityMultiplier = parseBigIntInput(securityMultiplierInput, 'Security multiplier')
		} catch {
			duplicateOriginPoolExists.value = false
			checkingDuplicateOriginPool.value = false
			return
		}

		const isCurrent = nextDuplicateCheck()
		checkingDuplicateOriginPool.value = true

		try {
			const exists = await originSecurityPoolExists(createConnectedReadClient(), questionId, securityMultiplier)
			if (!isCurrent()) return
			duplicateOriginPoolExists.value = exists
		} catch {
			if (!isCurrent()) return
			duplicateOriginPoolExists.value = false
		} finally {
			if (isCurrent()) {
				checkingDuplicateOriginPool.value = false
			}
		}
	}

	const loadMarketById = async (marketId: string) => {
		if (!hasDeployedStep(deploymentStatuses, 'zoltarQuestionData')) {
			securityPoolError.value = 'Deploy ZoltarQuestionData before loading a market'
			return
		}

		const isCurrent = nextMarketDetailsLoad()
		loadingMarketDetails.value = true
		securityPoolError.value = undefined
		try {
			const { questionId } = createSecurityPoolParameters({
				...securityPoolForm.value,
				marketId,
			})
			const details = await loadMarketDetails(createConnectedReadClient(), questionId)
			if (!isCurrent()) return
			if (!details.exists) {
				marketDetails.value = undefined
				securityPoolError.value = 'No market found for that ID'
				return
			}

			marketDetails.value = details
		} catch (error) {
			if (!isCurrent()) return
			marketDetails.value = undefined
			securityPoolError.value = getErrorMessage(error, 'Failed to load market')
		} finally {
			if (isCurrent()) {
				loadingMarketDetails.value = false
			}
		}
	}

	const loadMarket = async () => await loadMarketById(securityPoolForm.value.marketId)

	const createPool = async () => {
		try {
			getRequiredInjectedEthereum()
		} catch {
			securityPoolError.value = 'No injected wallet found'
			return
		}
		if (accountAddress === undefined) {
			securityPoolError.value = 'Connect a wallet before creating a security pool'
			return
		}
		if (!hasDeployedStep(deploymentStatuses, 'securityPoolFactory')) {
			securityPoolError.value = 'Deploy SecurityPoolFactory before creating a security pool'
			return
		}
		if (zoltarUniverseHasForked) {
			securityPoolError.value = 'Security pools cannot be created after the universe has forked'
			return
		}
		if (securityPoolCreating.value) {
			securityPoolError.value = 'Security pool creation already in progress'
			return
		}

		securityPoolCreating.value = true
		securityPoolError.value = undefined
		securityPoolResult.value = undefined
		poolCreationMarketDetails.value = undefined
		try {
			const parameters = createSecurityPoolParameters(securityPoolForm.value)
			const details = marketDetails.value?.questionId === parameters.questionId.toString() ? marketDetails.value : await loadMarketDetails(createConnectedReadClient(), parameters.questionId)
			if (!details.exists) {
				securityPoolError.value = 'No market found for that ID'
				return
			}
			if (details.marketType !== 'binary') {
				securityPoolError.value = 'Security pools can only be deployed for binary markets'
				marketDetails.value = details
				return
			}
			if (await originSecurityPoolExists(createConnectedReadClient(), parameters.questionId, parameters.securityMultiplier)) {
				securityPoolError.value = 'A security pool for this question and security multiplier already exists. Change the security multiplier to create a different pool.'
				marketDetails.value = details
				return
			}

			onTransactionRequested()
			const result = await createSecurityPool(createWalletWriteClient(accountAddress, { onTransactionSubmitted }), parameters)
			marketDetails.value = details
			poolCreationMarketDetails.value = details
			securityPoolResult.value = result
			onTransaction(result.deployPoolHash)
			await refreshState()
		} catch (error) {
			securityPoolError.value = getErrorMessage(error, 'Failed to create security pool')
		} finally {
			securityPoolCreating.value = false
			onTransactionFinished()
		}
	}

	const resetSecurityPoolCreation = () => {
		securityPoolError.value = undefined
		securityPoolResult.value = undefined
	}

	useEffect(() => {
		void loadDuplicateOriginPoolState()
	}, [securityPoolForm.value.marketId, securityPoolForm.value.securityMultiplier])

	return {
		checkingDuplicateOriginPool: checkingDuplicateOriginPool.value,
		duplicateOriginPoolExists: duplicateOriginPoolExists.value,
		loadMarketById,
		loadMarket,
		loadingMarketDetails: loadingMarketDetails.value,
		marketDetails: marketDetails.value,
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
