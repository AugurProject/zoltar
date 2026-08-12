import { useSignal } from '@preact/signals'
import type { Address, Hash } from '@zoltar/shared/ethereum'
import { acceptOracleOperationBounty, claimOracleOperationBounty, executeOracleManagerStagedOperation, loadCoordinatorInitialReportFundingRequirement, loadOracleManagerDetails, loadOracleOperationBounty, postOracleOperationBounty, refundOracleOperationBounty, requestOraclePrice } from '../../../protocol/index.js'
import { useLoadController } from '../../../hooks/useLoadController.js'
import { createConnectedReadClient, createWalletWriteClient } from '../../../lib/clients.js'
import { getErrorMessage } from '../../../lib/errors.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '../../../lib/actionFeedback.js'
import type { ActionFeedback } from '../../../lib/actionFeedback.js'
import { getOracleRequestEthGuardMessage } from '../lib/oracleRequestEth.js'
import { formatCurrencyBalance } from '../../../lib/formatters.js'
import { createOpenOracleSuccessPresentation, createOpenOracleTransactionIntent, createOpenOracleWarningPresentation, createPoolOracleSuccessPresentation, createPoolOracleTransactionIntent, createPoolOracleWarningPresentation } from '../../transactionPresentations.js'
import { useRequestGuard } from '../../../lib/requestGuard.js'
import { runWriteAction } from '../../../lib/writeAction.js'
import { refreshWalletStateOnly } from '../../../lib/refreshState.js'
import { sameAddress } from '../../../lib/address.js'
import type { WriteOperationsParameters } from '../../../types/app.js'
import type { OpenOracleActionResult, OracleManagerDetails, OracleOperationBountyInput } from '../../../types/contracts.js'

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

type PriceOracleReadClient = Pick<ReturnType<typeof createConnectedReadClient>, 'getBalance'>
type PriceOracleProductionWriteClient = ReturnType<typeof createWalletWriteClient>
type CoordinatorInitialReportFunding = Awaited<ReturnType<typeof loadCoordinatorInitialReportFundingRequirement>>

export type UsePriceOracleManagerDependencies<TWriteClient = PriceOracleProductionWriteClient> = {
	acceptOracleOperationBounty: (client: TWriteClient, managerAddress: Address, bountyId: bigint) => Promise<OpenOracleActionResult>
	claimOracleOperationBounty: (client: TWriteClient, managerAddress: Address, bountyId: bigint) => Promise<OpenOracleActionResult>
	createConnectedReadClient: () => PriceOracleReadClient
	createWalletWriteClient: (accountAddress: Address, callbacks?: Parameters<typeof createWalletWriteClient>[1]) => TWriteClient
	executeOracleManagerStagedOperation: (client: TWriteClient, managerAddress: Address, operationId: bigint) => Promise<OpenOracleActionResult>
	loadCoordinatorInitialReportFundingRequirement: (client: TWriteClient, managerAddress: Address, walletAddress: Address) => Promise<CoordinatorInitialReportFunding>
	loadOracleManagerDetails: (managerAddress: Address) => Promise<OracleManagerDetails>
	loadOracleOperationBounty: (managerAddress: Address, boardAddress: Address, bountyId: bigint) => ReturnType<typeof loadOracleOperationBounty>
	postOracleOperationBounty: (client: TWriteClient, managerAddress: Address, bounty: OracleOperationBountyInput) => Promise<OpenOracleActionResult>
	refundOracleOperationBounty: (client: TWriteClient, managerAddress: Address, bountyId: bigint) => Promise<OpenOracleActionResult>
	requestOraclePrice: (client: TWriteClient, managerAddress: Address, proposedRepPerEthPrice: bigint, requestedInitialAttoWeth: bigint, reviewedRequestValueAttoEth: bigint) => Promise<OpenOracleActionResult>
}

const defaultUsePriceOracleManagerDependencies: UsePriceOracleManagerDependencies = {
	acceptOracleOperationBounty: async (client, managerAddress, bountyId) => await acceptOracleOperationBounty(client, managerAddress, bountyId),
	claimOracleOperationBounty: async (client, managerAddress, bountyId) => await claimOracleOperationBounty(client, managerAddress, bountyId),
	createConnectedReadClient,
	createWalletWriteClient,
	executeOracleManagerStagedOperation: async (client, managerAddress, operationId) => await executeOracleManagerStagedOperation(client, managerAddress, operationId),
	loadCoordinatorInitialReportFundingRequirement: async (client, managerAddress, walletAddress) => await loadCoordinatorInitialReportFundingRequirement(client, managerAddress, walletAddress),
	loadOracleManagerDetails: async managerAddress => await loadOracleManagerDetails(createConnectedReadClient(), managerAddress),
	loadOracleOperationBounty: async (managerAddress, boardAddress, bountyId) => await loadOracleOperationBounty(createConnectedReadClient(), managerAddress, boardAddress, bountyId),
	postOracleOperationBounty: async (client, managerAddress, bounty) => await postOracleOperationBounty(client, managerAddress, bounty),
	refundOracleOperationBounty: async (client, managerAddress, bountyId) => await refundOracleOperationBounty(client, managerAddress, bountyId),
	requestOraclePrice: async (client, managerAddress, proposedRepPerEthPrice, requestedInitialAttoWeth, reviewedRequestValueAttoEth) => await requestOraclePrice(client, managerAddress, proposedRepPerEthPrice, requestedInitialAttoWeth, reviewedRequestValueAttoEth),
}

function usePriceOracleManagerWithDependencies<TWriteClient>(
	{ accountAddress, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState }: UsePriceOracleManagerParameters,
	dependencies: UsePriceOracleManagerDependencies<TWriteClient>,
) {
	const poolOracleManagerLoad = useLoadController()
	const poolOperationBountyLookupLoad = useLoadController()
	const poolOracleActiveAction = useSignal<OpenOracleActionResult['action'] | undefined>(undefined)
	const poolOracleActiveBountyId = useSignal<bigint | undefined>(undefined)
	const poolOracleFeedback = useSignal<ActionFeedback<OpenOracleActionResult['action']> | undefined>(undefined)
	const poolOracleManagerDetails = useSignal<OracleManagerDetails | undefined>(undefined)
	const poolOracleManagerError = useSignal<string | undefined>(undefined)
	const poolOracleManagerErrorAddress = useSignal<Address | undefined>(undefined)
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
				poolOracleManagerErrorAddress.value = undefined
				poolOperationBountyLookupError.value = undefined
			},
			load: async () => await dependencies.loadOracleManagerDetails(managerAddress),
			onSuccess: details => {
				poolOracleManagerDetails.value = details
			},
			onError: error => {
				poolOracleManagerError.value = getErrorMessage(error, 'Failed to load price oracle details')
				poolOracleManagerErrorAddress.value = managerAddress
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

	const requestPoolPrice = async (managerAddress: Address, securityPoolAddress: Address, reviewedRequestValueAttoEth: bigint) => {
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
					const refreshedManagerDetails = await dependencies.loadOracleManagerDetails(managerAddress)
					poolOracleManagerDetails.value = refreshedManagerDetails
					if (refreshedManagerDetails?.isPriceValid) throw new Error('A fresh oracle price is already available')
					if ((refreshedManagerDetails?.pendingReportId ?? 0n) > 0n) throw new Error('Oracle price request is already pending')
					const writeClient = dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted })
					const initialReportFunding = await dependencies.loadCoordinatorInitialReportFundingRequirement(writeClient, managerAddress, walletAddress)
					if (initialReportFunding.currentRepBalanceAttoRep < initialReportFunding.initialReportAmount2) {
						throw new Error(`Need ${formatCurrencyBalance(initialReportFunding.initialReportAmount2 - initialReportFunding.currentRepBalanceAttoRep)} more REP in this wallet to fund the initial report.`)
					}
					const walletBalanceAttoEth = await dependencies.createConnectedReadClient().getBalance({ address: walletAddress })
					const totalRequiredEth = reviewedRequestValueAttoEth + initialReportFunding.wethShortfallAttoEth
					if (walletBalanceAttoEth < totalRequiredEth) {
						throw new Error(`Need ${formatCurrencyBalance(totalRequiredEth - walletBalanceAttoEth)} more ETH in this wallet to fund the initial report and request a new price.`)
					}
					const requestPriceGuardMessage = getOracleRequestEthGuardMessage({
						actionLabel: 'request a new price',
						requiredCostAttoEth: reviewedRequestValueAttoEth,
						walletBalanceAttoEth,
					})
					if (requestPriceGuardMessage !== undefined) throw new Error(requestPriceGuardMessage)
					return await dependencies.requestOraclePrice(writeClient, managerAddress, initialReportFunding.proposedRepPerEthPrice, 0n, reviewedRequestValueAttoEth)
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
				async walletAddress => await dependencies.executeOracleManagerStagedOperation(dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), managerAddress, operationId),
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
				getFailureTitle(actionName),
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
		await runOperationBountyAction('postOperationBounty', managerAddress, undefined, async walletAddress => await dependencies.postOracleOperationBounty(dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), managerAddress, bounty))

	const acceptPoolOperationBounty = async (managerAddress: Address, bountyId: bigint) =>
		await runOperationBountyAction('acceptOperationBounty', managerAddress, bountyId, async walletAddress => await dependencies.acceptOracleOperationBounty(dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), managerAddress, bountyId))

	const claimPoolOperationBounty = async (managerAddress: Address, bountyId: bigint) =>
		await runOperationBountyAction('claimOperationBounty', managerAddress, bountyId, async walletAddress => await dependencies.claimOracleOperationBounty(dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), managerAddress, bountyId))

	const refundPoolOperationBounty = async (managerAddress: Address, bountyId: bigint) =>
		await runOperationBountyAction('refundOperationBounty', managerAddress, bountyId, async walletAddress => await dependencies.refundOracleOperationBounty(dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), managerAddress, bountyId))

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
		poolOracleManagerErrorAddress: poolOracleManagerErrorAddress.value,
		poolOperationBountyLookupError: poolOperationBountyLookupError.value,
		poolPriceOracleResult: poolPriceOracleResult.value,
		postPoolOperationBounty,
		refundPoolOperationBounty,
		requestPoolPrice,
	}
}

export function usePriceOracleManager(parameters: UsePriceOracleManagerParameters): ReturnType<typeof usePriceOracleManagerWithDependencies<PriceOracleProductionWriteClient>>
export function usePriceOracleManager<TWriteClient>(parameters: UsePriceOracleManagerParameters, dependencies: UsePriceOracleManagerDependencies<TWriteClient>): ReturnType<typeof usePriceOracleManagerWithDependencies<TWriteClient>>
export function usePriceOracleManager<TWriteClient>(parameters: UsePriceOracleManagerParameters, dependencies?: UsePriceOracleManagerDependencies<TWriteClient>) {
	if (dependencies === undefined) return usePriceOracleManagerWithDependencies(parameters, defaultUsePriceOracleManagerDependencies)
	return usePriceOracleManagerWithDependencies(parameters, dependencies)
}
