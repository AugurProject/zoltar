import { useSignal } from '@preact/signals'
import type { Address, Hash } from '@zoltar/shared/ethereum'
import { executeOracleManagerStagedOperation, loadOracleManagerDetails, requestOraclePrice } from '../contracts.js'
import { useLoadController } from './useLoadController.js'
import { createConnectedReadClient, createWalletWriteClient } from '../lib/clients.js'
import { sameAddress } from '../lib/address.js'
import { getErrorMessage } from '../lib/errors.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '../lib/actionFeedback.js'
import type { ActionFeedback } from '../lib/actionFeedback.js'
import { getOracleRequestEthGuardMessage } from '../lib/oracleRequestEth.js'
import { createPoolOracleSuccessPresentation, createPoolOracleTransactionIntent, createPoolOracleWarningPresentation } from '../lib/transactionPresentations.js'
import { useRequestGuard } from '../lib/requestGuard.js'
import { runWriteAction } from '../lib/writeAction.js'
import type { WriteOperationsParameters } from '../types/app.js'
import type { OpenOracleActionResult, OracleManagerDetails } from '../types/contracts.js'

type UsePriceOracleManagerParameters = {
	accountAddress: Address | undefined
	onTransactionFailed?: WriteOperationsParameters['onTransactionFailed']
	onTransactionFinished: () => void
	onTransactionPresented: WriteOperationsParameters['onTransactionPresented']
	onTransactionPrepared?: WriteOperationsParameters['onTransactionPrepared']
	onTransactionRequested: WriteOperationsParameters['onTransactionRequested']
	onTransactionSubmitted: (hash: Hash) => void
	refreshState: () => Promise<void>
}

export function usePriceOracleManager({ accountAddress, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState }: UsePriceOracleManagerParameters) {
	const poolOracleManagerLoad = useLoadController()
	const poolOracleActiveAction = useSignal<OpenOracleActionResult['action'] | undefined>(undefined)
	const poolOracleFeedback = useSignal<ActionFeedback<OpenOracleActionResult['action']> | undefined>(undefined)
	const poolOracleManagerDetails = useSignal<OracleManagerDetails | undefined>(undefined)
	const poolOracleManagerError = useSignal<string | undefined>(undefined)
	const poolPriceOracleResult = useSignal<OpenOracleActionResult | undefined>(undefined)
	const nextPoolOracleManagerLoad = useRequestGuard()
	const getPendingTitle = (actionName: OpenOracleActionResult['action']) => {
		if (actionName === 'requestPrice') return 'Requesting price'
		return 'Executing staged operation'
	}
	const getSuccessTitle = (actionName: OpenOracleActionResult['action']) => {
		if (actionName === 'requestPrice') return 'Price requested'
		return 'Staged operation executed'
	}
	const getFailureTitle = (actionName: OpenOracleActionResult['action']) => {
		if (actionName === 'requestPrice') return 'Price request failed'
		return 'Staged operation failed'
	}

	const loadPoolOracleManager = async (managerAddress: Address) => {
		const isCurrent = nextPoolOracleManagerLoad()
		await poolOracleManagerLoad.run({
			isCurrent,
			onStart: () => {
				poolOracleManagerError.value = undefined
			},
			load: async () => await loadOracleManagerDetails(createConnectedReadClient(), managerAddress),
			onSuccess: details => {
				poolOracleManagerDetails.value = details
			},
			onError: error => {
				poolOracleManagerError.value = getErrorMessage(error, 'Failed to load price oracle details')
			},
		})
	}

	const requestPoolPrice = async (managerAddress: Address) => {
		poolPriceOracleResult.value = undefined
		try {
			poolOracleActiveAction.value = 'requestPrice'
			poolOracleFeedback.value = createPendingActionFeedback('requestPrice', getPendingTitle('requestPrice'))
			await runWriteAction(
				{
					accountAddress,
					missingWalletMessage: 'Connect a wallet before requesting a price',
					onRefreshError: (message, hash) => {
						poolOracleFeedback.value = createWarningActionFeedback('requestPrice', getSuccessTitle('requestPrice'), message, hash)
						const result = poolPriceOracleResult.value
						if (result !== undefined) onTransactionPresented(createPoolOracleWarningPresentation(result, message))
					},
					onTransactionFailed,
					onTransactionFinished,
					onTransactionRequested: () => onTransactionRequested(createPoolOracleTransactionIntent('requestPrice')),
					onWriteError: message => {
						poolOracleFeedback.value = createErrorActionFeedback('requestPrice', getFailureTitle('requestPrice'), message)
					},
					refreshErrorFallback: 'Price request succeeded, but refreshing price oracle details failed',
					refreshState: async () => {
						await refreshState()
						await loadPoolOracleManager(managerAddress)
					},
					setErrorMessage: message => {
						poolOracleManagerError.value = message
					},
				},
				async walletAddress => {
					const currentManagerDetails = poolOracleManagerDetails.value
					if (currentManagerDetails === undefined || !sameAddress(currentManagerDetails.managerAddress, managerAddress)) poolOracleManagerDetails.value = await loadOracleManagerDetails(createConnectedReadClient(), managerAddress)
					const refreshedManagerDetails = poolOracleManagerDetails.value
					const walletEthBalance = await createConnectedReadClient().getBalance({ address: walletAddress })
					const requestPriceGuardMessage = getOracleRequestEthGuardMessage({
						actionLabel: 'request a new price',
						requestPriceEthCost: refreshedManagerDetails?.requestPriceEthCost,
						walletEthBalance,
					})
					if (requestPriceGuardMessage !== undefined) throw new Error(requestPriceGuardMessage)
					return await requestOraclePrice(createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), managerAddress)
				},
				'Failed to request price',
				result => {
					poolPriceOracleResult.value = result
					poolOracleFeedback.value = createSuccessActionFeedback('requestPrice', getSuccessTitle('requestPrice'), result.hash)
					onTransactionPresented(createPoolOracleSuccessPresentation(result))
				},
			)
		} finally {
			poolOracleActiveAction.value = undefined
		}
	}

	const executePendingPoolOperation = async (managerAddress: Address, operationId: bigint) => {
		poolPriceOracleResult.value = undefined
		try {
			poolOracleActiveAction.value = 'executeStagedOperation'
			poolOracleFeedback.value = createPendingActionFeedback('executeStagedOperation', getPendingTitle('executeStagedOperation'))
			await runWriteAction(
				{
					accountAddress,
					missingWalletMessage: 'Connect a wallet before executing a staged operation',
					onRefreshError: (message, hash) => {
						poolOracleFeedback.value = createWarningActionFeedback('executeStagedOperation', getSuccessTitle('executeStagedOperation'), message, hash)
						const result = poolPriceOracleResult.value
						if (result !== undefined) onTransactionPresented(createPoolOracleWarningPresentation(result, message))
					},
					onTransactionFailed,
					onTransactionFinished,
					onTransactionRequested: () => onTransactionRequested(createPoolOracleTransactionIntent('executeStagedOperation')),
					onWriteError: message => {
						poolOracleFeedback.value = createErrorActionFeedback('executeStagedOperation', getFailureTitle('executeStagedOperation'), message)
					},
					refreshErrorFallback: 'Staged operation execution succeeded, but refreshing price oracle details failed',
					refreshState: async () => {
						await refreshState()
						await loadPoolOracleManager(managerAddress)
					},
					setErrorMessage: message => {
						poolOracleManagerError.value = message
					},
				},
				async walletAddress => await executeOracleManagerStagedOperation(createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), managerAddress, operationId),
				'Failed to execute staged operation',
				result => {
					poolPriceOracleResult.value = result
					poolOracleFeedback.value = createSuccessActionFeedback('executeStagedOperation', getSuccessTitle('executeStagedOperation'), result.hash)
					onTransactionPresented(createPoolOracleSuccessPresentation(result))
				},
			)
		} finally {
			poolOracleActiveAction.value = undefined
		}
	}

	return {
		executePendingPoolOperation,
		loadingPoolOracleManager: poolOracleManagerLoad.isLoading.value,
		loadPoolOracleManager,
		poolOracleActiveAction: poolOracleActiveAction.value,
		poolOracleFeedback: poolOracleFeedback.value,
		poolOracleManagerDetails: poolOracleManagerDetails.value,
		poolOracleManagerError: poolOracleManagerError.value,
		poolPriceOracleResult: poolPriceOracleResult.value,
		requestPoolPrice,
	}
}
