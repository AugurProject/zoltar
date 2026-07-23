import { useSignal } from '@preact/signals'
import type { Address, Hash } from '@zoltar/shared/ethereum'
import { executeOracleManagerStagedOperation, loadCoordinatorInitialReportFundingRequirement, loadOracleManagerDetails, requestOraclePrice } from '../../../protocol/index.js'
import { useLoadController } from '../../../hooks/useLoadController.js'
import { createConnectedReadClient, createWalletWriteClient } from '../../../lib/clients.js'
import { sameAddress } from '../../../lib/address.js'
import { getErrorMessage } from '../../../lib/errors.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '../../../lib/actionFeedback.js'
import type { ActionFeedback } from '../../../lib/actionFeedback.js'
import { getOracleRequestEthGuardMessage } from '../lib/oracleRequestEth.js'
import { formatCurrencyBalance } from '../../../lib/formatters.js'
import { createPoolOracleSuccessPresentation, createPoolOracleTransactionIntent, createPoolOracleWarningPresentation } from '../../transactionPresentations.js'
import { useRequestGuard } from '../../../lib/requestGuard.js'
import { runWriteAction } from '../../../lib/writeAction.js'
import { refreshWalletStateOnly } from '../../../lib/refreshState.js'
import type { WriteOperationsParameters } from '../../../types/app.js'
import type { OpenOracleActionResult, OracleManagerDetails } from '../../../types/contracts.js'

type UsePriceOracleManagerParameters = {
	accountAddress: Address | undefined
	onTransactionFailed?: WriteOperationsParameters['onTransactionFailed']
	onTransactionFinished: () => void
	onTransactionPresented: WriteOperationsParameters['onTransactionPresented']
	onTransactionPrepared?: WriteOperationsParameters['onTransactionPrepared']
	onTransactionRequested: WriteOperationsParameters['onTransactionRequested']
	onTransactionSubmitted: (hash: Hash) => void
	refreshState: WriteOperationsParameters['refreshState']
}

export function usePriceOracleManager({ accountAddress, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState }: UsePriceOracleManagerParameters) {
	const poolOracleManagerLoad = useLoadController()
	const poolOracleActiveAction = useSignal<OpenOracleActionResult['action'] | undefined>(undefined)
	const poolOracleFeedback = useSignal<ActionFeedback<OpenOracleActionResult['action']> | undefined>(undefined)
	const poolOracleManagerDetails = useSignal<OracleManagerDetails | undefined>(undefined)
	const poolOracleManagerError = useSignal<string | undefined>(undefined)
	const poolOracleManagerErrorAddress = useSignal<Address | undefined>(undefined)
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
				poolOracleManagerErrorAddress.value = undefined
			},
			load: async () => await loadOracleManagerDetails(createConnectedReadClient(), managerAddress),
			onSuccess: details => {
				poolOracleManagerDetails.value = details
			},
			onError: error => {
				poolOracleManagerError.value = getErrorMessage(error, 'Failed to load price oracle details')
				poolOracleManagerErrorAddress.value = managerAddress
			},
		})
	}

	const requestPoolPrice = async (managerAddress: Address, securityPoolAddress: Address, reviewedRequestEthValue: bigint) => {
		const transactionContext = { managerAddress, securityPoolAddress }
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
						if (result !== undefined) onTransactionPresented(createPoolOracleWarningPresentation(result, message, transactionContext))
					},
					onTransactionFailed,
					onTransactionFinished,
					onTransactionRequested: () => onTransactionRequested(createPoolOracleTransactionIntent('requestPrice', transactionContext)),
					onWriteError: message => {
						poolOracleFeedback.value = createErrorActionFeedback('requestPrice', getFailureTitle('requestPrice'), message)
					},
					refreshErrorFallback: 'Price request succeeded, but refreshing price oracle details failed',
					refreshState: async () => {
						await refreshWalletStateOnly(refreshState)
						await loadPoolOracleManager(managerAddress)
					},
					setErrorMessage: message => {
						poolOracleManagerError.value = message
						poolOracleManagerErrorAddress.value = managerAddress
					},
				},
				async walletAddress => {
					const currentManagerDetails = poolOracleManagerDetails.value
					if (currentManagerDetails === undefined || !sameAddress(currentManagerDetails.managerAddress, managerAddress)) poolOracleManagerDetails.value = await loadOracleManagerDetails(createConnectedReadClient(), managerAddress)
					const refreshedManagerDetails = poolOracleManagerDetails.value
					if (refreshedManagerDetails?.isPriceValid) throw new Error('A fresh oracle price is already available')
					if ((refreshedManagerDetails?.pendingReportId ?? 0n) > 0n) throw new Error('Oracle price request is already pending')
					const writeClient = createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted })
					const initialReportFunding = await loadCoordinatorInitialReportFundingRequirement(writeClient, managerAddress, walletAddress)
					if (initialReportFunding.currentRepBalance < initialReportFunding.initialReportAmount2) {
						throw new Error(`Need ${formatCurrencyBalance(initialReportFunding.initialReportAmount2 - initialReportFunding.currentRepBalance)} more REP in this wallet to fund the initial report.`)
					}
					const walletEthBalance = await createConnectedReadClient().getBalance({ address: walletAddress })
					const totalRequiredEth = reviewedRequestEthValue + initialReportFunding.wethShortfall
					if (walletEthBalance < totalRequiredEth) {
						throw new Error(`Need ${formatCurrencyBalance(totalRequiredEth - walletEthBalance)} more ETH in this wallet to fund the initial report and request a new price.`)
					}
					const requestPriceGuardMessage = getOracleRequestEthGuardMessage({
						actionLabel: 'request a new price',
						requiredEthCost: reviewedRequestEthValue,
						walletEthBalance,
					})
					if (requestPriceGuardMessage !== undefined) throw new Error(requestPriceGuardMessage)
					return await requestOraclePrice(writeClient, managerAddress, initialReportFunding.proposedRepPerEthPrice, 0n, reviewedRequestEthValue)
				},
				'Failed to request price',
				result => {
					poolPriceOracleResult.value = result
					poolOracleFeedback.value = createSuccessActionFeedback('requestPrice', getSuccessTitle('requestPrice'), result.hash)
					onTransactionPresented(createPoolOracleSuccessPresentation(result, transactionContext))
				},
			)
		} finally {
			poolOracleActiveAction.value = undefined
		}
	}

	const executePendingPoolOperation = async (managerAddress: Address, operationId: bigint, securityPoolAddress?: Address) => {
		const transactionContext = { managerAddress, securityPoolAddress }
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
						if (result !== undefined) onTransactionPresented(createPoolOracleWarningPresentation(result, message, transactionContext))
					},
					onTransactionFailed,
					onTransactionFinished,
					onTransactionRequested: () => onTransactionRequested(createPoolOracleTransactionIntent('executeStagedOperation', transactionContext)),
					onWriteError: message => {
						poolOracleFeedback.value = createErrorActionFeedback('executeStagedOperation', getFailureTitle('executeStagedOperation'), message)
					},
					refreshErrorFallback: 'Staged operation execution succeeded, but refreshing price oracle details failed',
					refreshState: async () => {
						await refreshWalletStateOnly(refreshState)
						await loadPoolOracleManager(managerAddress)
					},
					setErrorMessage: message => {
						poolOracleManagerError.value = message
						poolOracleManagerErrorAddress.value = managerAddress
					},
				},
				async walletAddress => await executeOracleManagerStagedOperation(createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), managerAddress, operationId),
				'Failed to execute staged operation',
				result => {
					poolPriceOracleResult.value = result
					poolOracleFeedback.value = createSuccessActionFeedback('executeStagedOperation', getSuccessTitle('executeStagedOperation'), result.hash)
					onTransactionPresented(createPoolOracleSuccessPresentation(result, transactionContext))
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
		poolOracleManagerErrorAddress: poolOracleManagerErrorAddress.value,
		poolPriceOracleResult: poolPriceOracleResult.value,
		requestPoolPrice,
	}
}
