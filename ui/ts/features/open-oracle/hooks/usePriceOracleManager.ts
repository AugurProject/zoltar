import { useSignal } from '@preact/signals'
import type { Address, Hash } from '@zoltar/shared/ethereum'
import { acceptOracleOperationBounty, claimOracleOperationBounty, executeOracleManagerStagedOperation, loadCoordinatorInitialReportFundingRequirement, loadOracleManagerDetails, loadOracleOperationBounty, postOracleOperationBounty, refundOracleOperationBounty, requestOraclePrice } from '../../../protocol/index.js'
import { useLoadController } from '../../../hooks/useLoadController.js'
import { createConnectedReadClient, createWalletWriteClient } from '../../../lib/clients.js'
import { sameAddress } from '../../../lib/address.js'
import { getErrorMessage } from '../../../lib/errors.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '../../../lib/actionFeedback.js'
import type { ActionFeedback } from '../../../lib/actionFeedback.js'
import { getOracleRequestEthGuardMessage } from '../lib/oracleRequestEth.js'
import { formatCurrencyBalance } from '../../../lib/formatters.js'
import { createOpenOracleSuccessPresentation, createOpenOracleTransactionIntent, createOpenOracleWarningPresentation, createPoolOracleSuccessPresentation, createPoolOracleTransactionIntent, createPoolOracleWarningPresentation } from '../../transactionPresentations.js'
import { useRequestGuard } from '../../../lib/requestGuard.js'
import { runWriteAction } from '../../../lib/writeAction.js'
import { refreshWalletStateOnly } from '../../../lib/refreshState.js'
import type { WriteOperationsParameters } from '../../../types/app.js'
import type { OpenOracleActionResult, OracleManagerDetails, OracleOperationBountyInput } from '../../../types/contracts.js'
import { addOpenOracleBountyBuffer } from '../lib/openOracle.js'

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

export type UsePriceOracleManagerDependencies = {
	loadOracleManagerDetails: (managerAddress: Address) => Promise<OracleManagerDetails>
	loadOracleOperationBounty: (managerAddress: Address, boardAddress: Address, bountyId: bigint) => ReturnType<typeof loadOracleOperationBounty>
}

const defaultUsePriceOracleManagerDependencies: UsePriceOracleManagerDependencies = {
	loadOracleManagerDetails: async managerAddress => await loadOracleManagerDetails(createConnectedReadClient(), managerAddress),
	loadOracleOperationBounty: async (managerAddress, boardAddress, bountyId) => await loadOracleOperationBounty(createConnectedReadClient(), managerAddress, boardAddress, bountyId),
}

export function usePriceOracleManager(
	{ accountAddress, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState }: UsePriceOracleManagerParameters,
	dependencies: UsePriceOracleManagerDependencies = defaultUsePriceOracleManagerDependencies,
) {
	const poolOracleManagerLoad = useLoadController()
	const poolOperationBountyLookupLoad = useLoadController()
	const poolOracleActiveAction = useSignal<OpenOracleActionResult['action'] | undefined>(undefined)
	const poolOracleActiveBountyId = useSignal<bigint | undefined>(undefined)
	const poolOracleFeedback = useSignal<ActionFeedback<OpenOracleActionResult['action']> | undefined>(undefined)
	const poolOracleManagerDetails = useSignal<OracleManagerDetails | undefined>(undefined)
	const poolOracleManagerError = useSignal<string | undefined>(undefined)
	const poolOperationBountyLookupError = useSignal<string | undefined>(undefined)
	const poolPriceOracleResult = useSignal<OpenOracleActionResult | undefined>(undefined)
	const nextPoolOracleManagerLoad = useRequestGuard()
	const nextPoolOperationBountyLookup = useRequestGuard()
	const getPendingTitle = (actionName: OpenOracleActionResult['action']) => {
		if (actionName === 'requestPrice') return 'Requesting price'
		if (actionName === 'postOperationBounty') return 'Posting operation bounty'
		if (actionName === 'acceptOperationBounty') return 'Accepting operation bounty'
		if (actionName === 'claimOperationBounty') return 'Claiming operation bounty'
		if (actionName === 'refundOperationBounty') return 'Refunding operation bounty'
		return 'Executing staged operation'
	}
	const getSuccessTitle = (actionName: OpenOracleActionResult['action']) => {
		if (actionName === 'requestPrice') return 'Price requested'
		if (actionName === 'postOperationBounty') return 'Operation bounty posted'
		if (actionName === 'acceptOperationBounty') return 'Operation bounty accepted'
		if (actionName === 'claimOperationBounty') return 'Operation bounty claimed'
		if (actionName === 'refundOperationBounty') return 'Operation bounty refunded'
		return 'Staged operation executed'
	}
	const getFailureTitle = (actionName: OpenOracleActionResult['action']) => {
		if (actionName === 'requestPrice') return 'Price request failed'
		if (actionName === 'postOperationBounty') return 'Operation bounty post failed'
		if (actionName === 'acceptOperationBounty') return 'Operation bounty acceptance failed'
		if (actionName === 'claimOperationBounty') return 'Operation bounty claim failed'
		if (actionName === 'refundOperationBounty') return 'Operation bounty refund failed'
		return 'Staged operation failed'
	}

	const loadPoolOracleManager = async (managerAddress: Address) => {
		nextPoolOperationBountyLookup()
		const isCurrent = nextPoolOracleManagerLoad()
		await poolOracleManagerLoad.run({
			isCurrent,
			onStart: () => {
				poolOracleManagerError.value = undefined
				poolOperationBountyLookupError.value = undefined
			},
			load: async () => await dependencies.loadOracleManagerDetails(managerAddress),
			onSuccess: details => {
				poolOracleManagerDetails.value = details
			},
			onError: error => {
				poolOracleManagerError.value = getErrorMessage(error, 'Failed to load price oracle details')
			},
		})
	}

	const loadPoolOperationBounty = async (managerAddress: Address, bountyId: bigint) => {
		const managerDetails = poolOracleManagerDetails.value
		if (managerDetails === undefined || !sameAddress(managerDetails.managerAddress, managerAddress) || managerDetails.operationBountyBoardAddress === undefined) {
			poolOperationBountyLookupError.value = 'Load this pool’s oracle details before looking up a bounty'
			return
		}
		const boardAddress = managerDetails.operationBountyBoardAddress
		const isCurrent = nextPoolOperationBountyLookup()
		await poolOperationBountyLookupLoad.run({
			isCurrent,
			onStart: () => {
				poolOperationBountyLookupError.value = undefined
			},
			load: async () => await dependencies.loadOracleOperationBounty(managerAddress, boardAddress, bountyId),
			onSuccess: bounty => {
				poolOperationBountyLookupError.value = undefined
				const currentDetails = poolOracleManagerDetails.value
				if (currentDetails === undefined || !sameAddress(currentDetails.managerAddress, managerAddress)) return
				const operationBounties = [bounty, ...(currentDetails.operationBounties ?? []).filter(current => current.bountyId !== bounty.bountyId)].sort((left, right) => {
					if (left.bountyId > right.bountyId) return -1
					if (left.bountyId < right.bountyId) return 1
					return 0
				})
				poolOracleManagerDetails.value = { ...currentDetails, operationBounties }
			},
			onError: error => {
				poolOperationBountyLookupError.value = getErrorMessage(error, 'Failed to load operation bounty')
			},
		})
	}
	const clearPoolOperationBountyLookupError = () => {
		poolOperationBountyLookupError.value = undefined
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
						await refreshWalletStateOnly(refreshState)
						await loadPoolOracleManager(managerAddress)
					},
					setErrorMessage: message => {
						poolOracleManagerError.value = message
					},
				},
				async walletAddress => {
					const currentManagerDetails = poolOracleManagerDetails.value
					if (currentManagerDetails === undefined || !sameAddress(currentManagerDetails.managerAddress, managerAddress)) poolOracleManagerDetails.value = await dependencies.loadOracleManagerDetails(managerAddress)
					const refreshedManagerDetails = poolOracleManagerDetails.value
					if (refreshedManagerDetails?.isPriceValid) throw new Error('A fresh oracle price is already available')
					if ((refreshedManagerDetails?.pendingReportId ?? 0n) > 0n) throw new Error('Oracle price request is already pending')
					const writeClient = createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted })
					const initialReportFunding = await loadCoordinatorInitialReportFundingRequirement(writeClient, managerAddress, walletAddress)
					if (initialReportFunding.currentRepBalance < initialReportFunding.exactToken1Report) {
						throw new Error(`Need ${formatCurrencyBalance(initialReportFunding.exactToken1Report - initialReportFunding.currentRepBalance)} more REP in this wallet to fund the initial report.`)
					}
					const walletEthBalance = await createConnectedReadClient().getBalance({ address: walletAddress })
					const totalRequiredEth = addOpenOracleBountyBuffer(refreshedManagerDetails?.requestPriceEthCost ?? 0n) + initialReportFunding.wethShortfall
					if (walletEthBalance < totalRequiredEth) {
						throw new Error(`Need ${formatCurrencyBalance(totalRequiredEth - walletEthBalance)} more ETH in this wallet to fund the initial report and request a new price.`)
					}
					const requestPriceGuardMessage = getOracleRequestEthGuardMessage({
						actionLabel: 'request a new price',
						includeBuffer: true,
						requiredEthCost: refreshedManagerDetails?.requestPriceEthCost,
						walletEthBalance,
					})
					if (requestPriceGuardMessage !== undefined) throw new Error(requestPriceGuardMessage)
					return await requestOraclePrice(writeClient, managerAddress, initialReportFunding.initialReportAmount2)
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
						await refreshWalletStateOnly(refreshState)
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

	const runOperationBountyAction = async (actionName: 'acceptOperationBounty' | 'claimOperationBounty' | 'postOperationBounty' | 'refundOperationBounty', managerAddress: Address, bountyId: bigint | undefined, write: (walletAddress: Address) => Promise<OpenOracleActionResult>) => {
		poolPriceOracleResult.value = undefined
		try {
			poolOracleActiveAction.value = actionName
			poolOracleActiveBountyId.value = bountyId
			poolOracleFeedback.value = createPendingActionFeedback(actionName, getPendingTitle(actionName))
			await runWriteAction(
				{
					accountAddress,
					missingWalletMessage: 'Connect a wallet before using operation bounties',
					onRefreshError: (message, hash) => {
						poolOracleFeedback.value = createWarningActionFeedback(actionName, getSuccessTitle(actionName), message, hash)
						const result = poolPriceOracleResult.value
						if (result !== undefined) onTransactionPresented(createOpenOracleWarningPresentation(result, message))
					},
					onTransactionFailed,
					onTransactionFinished,
					onTransactionRequested: () => onTransactionRequested(createOpenOracleTransactionIntent(actionName)),
					onWriteError: message => {
						poolOracleFeedback.value = createErrorActionFeedback(actionName, getFailureTitle(actionName), message)
					},
					refreshErrorFallback: 'Operation bounty transaction succeeded, but refreshing the bounty board failed',
					refreshState: async () => {
						await refreshWalletStateOnly(refreshState)
						await loadPoolOracleManager(managerAddress)
					},
					setErrorMessage: message => {
						poolOracleManagerError.value = message
					},
				},
				write,
				`Failed to ${actionName}`,
				result => {
					poolPriceOracleResult.value = result
					poolOracleFeedback.value = createSuccessActionFeedback(actionName, getSuccessTitle(actionName), result.hash)
					onTransactionPresented(createOpenOracleSuccessPresentation(result))
				},
			)
		} finally {
			poolOracleActiveAction.value = undefined
			poolOracleActiveBountyId.value = undefined
		}
	}

	const postPoolOperationBounty = async (managerAddress: Address, bounty: OracleOperationBountyInput) =>
		await runOperationBountyAction('postOperationBounty', managerAddress, undefined, async walletAddress => await postOracleOperationBounty(createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), managerAddress, bounty))

	const acceptPoolOperationBounty = async (managerAddress: Address, bountyId: bigint) =>
		await runOperationBountyAction('acceptOperationBounty', managerAddress, bountyId, async walletAddress => await acceptOracleOperationBounty(createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), managerAddress, bountyId))

	const claimPoolOperationBounty = async (managerAddress: Address, bountyId: bigint) =>
		await runOperationBountyAction('claimOperationBounty', managerAddress, bountyId, async walletAddress => await claimOracleOperationBounty(createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), managerAddress, bountyId))

	const refundPoolOperationBounty = async (managerAddress: Address, bountyId: bigint) =>
		await runOperationBountyAction('refundOperationBounty', managerAddress, bountyId, async walletAddress => await refundOracleOperationBounty(createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), managerAddress, bountyId))

	return {
		acceptPoolOperationBounty,
		claimPoolOperationBounty,
		clearPoolOperationBountyLookupError,
		executePendingPoolOperation,
		loadingPoolOracleManager: poolOracleManagerLoad.isLoading.value,
		loadingPoolOperationBounty: poolOperationBountyLookupLoad.isLoading.value,
		loadPoolOracleManager,
		loadPoolOperationBounty,
		poolOracleActiveAction: poolOracleActiveAction.value,
		poolOracleActiveBountyId: poolOracleActiveBountyId.value,
		poolOracleFeedback: poolOracleFeedback.value,
		poolOracleManagerDetails: poolOracleManagerDetails.value,
		poolOracleManagerError: poolOracleManagerError.value,
		poolOperationBountyLookupError: poolOperationBountyLookupError.value,
		poolPriceOracleResult: poolPriceOracleResult.value,
		postPoolOperationBounty,
		refundPoolOperationBounty,
		requestPoolPrice,
	}
}
