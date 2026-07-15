import { useSignal } from '@preact/signals'
import type { Address, Hash } from '@zoltar/shared/ethereum'
import { loadAllSecurityPools, loadCoordinatorInitialReportFundingRequirement, loadOracleManagerDetails, loadOracleManagerQueueOperationEthValue, loadSecurityPoolPage, queueSecurityPoolLiquidation } from '../../../protocol/index.js'
import { useLoadController } from '../../../hooks/useLoadController.js'
import { normalizeAddress } from '../../../lib/address.js'
import { createConnectedReadClient, createWalletWriteClient } from '../../../lib/clients.js'
import { getActiveBackend } from '../../../lib/activeEnvironment.js'
import { getErrorDetail, getErrorMessage } from '../../../lib/errors.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '../../../lib/actionFeedback.js'
import type { ActionFeedback } from '../../../lib/actionFeedback.js'
import { createLiquidationFailurePresentation, createLiquidationSuccessPresentation, createLiquidationTransactionIntent, createLiquidationWarningPresentation } from '../../transactionPresentations.js'
import { buildWriteActionConfig, runWriteAction } from '../../../lib/writeAction.js'
import { refreshWalletStateOnly } from '../../../lib/refreshState.js'
import { parseAddressInput } from '../../../lib/inputs.js'
import { parseBigIntInput, parseRepAmountInput } from '../../markets/lib/marketForm.js'
import { formatCurrencyBalance } from '../../../lib/formatters.js'
import { addOpenOracleBountyBuffer } from '../../open-oracle/lib/openOracle.js'
import { getLiquidationExecutionFailureDetail } from '../lib/liquidation.js'
import { useRequestGuard } from '../../../lib/requestGuard.js'
import { DEFAULT_STAGED_OPERATION_TIMEOUT_MINUTES, getStagedOperationTimeoutSeconds, MAX_STAGED_OPERATION_TIMEOUT_MINUTES, MIN_STAGED_OPERATION_TIMEOUT_MINUTES } from '../lib/securityVault.js'
import type { WriteOperationsParameters } from '../../../types/app.js'
import type { ListedSecurityPool, SecurityPoolBrowsePage, SecurityPoolOverviewActionResult, SecurityPoolPage } from '../../../types/contracts.js'

type UseSecurityPoolsOverviewParameters = {
	accountAddress: Address | undefined
	onTransactionCanceled?: WriteOperationsParameters['onTransactionCanceled']
	onTransactionFailed?: WriteOperationsParameters['onTransactionFailed']
	onTransactionFinished: () => void
	onTransactionPresented: WriteOperationsParameters['onTransactionPresented']
	onTransactionPrepared?: WriteOperationsParameters['onTransactionPrepared']
	onTransactionRequested: WriteOperationsParameters['onTransactionRequested']
	onTransactionSubmitted: (hash: Hash) => void
	refreshState: WriteOperationsParameters['refreshState']
}

type SecurityPoolsOverviewReadClient = {
	getBalance: (parameters: { address: Address }) => Promise<bigint>
}

type SecurityPoolsOverviewProductionWriteClient = ReturnType<typeof createWalletWriteClient>
type LoadAllSecurityPoolsOptions = Parameters<typeof loadAllSecurityPools>[1]
type SecurityPoolLiquidationQueueResult = Awaited<ReturnType<typeof queueSecurityPoolLiquidation>>

export type UseSecurityPoolsOverviewDependencies<TWriteClient = SecurityPoolsOverviewProductionWriteClient> = {
	createConnectedReadClient: () => SecurityPoolsOverviewReadClient
	createWalletWriteClient: (walletAddress: Address, callbacks?: Parameters<typeof createWalletWriteClient>[1]) => TWriteClient
	loadAllSecurityPools: (options: LoadAllSecurityPoolsOptions) => Promise<ListedSecurityPool[]>
	loadCoordinatorInitialReportFundingRequirement: (client: TWriteClient, managerAddress: Address, walletAddress: Address) => Promise<Awaited<ReturnType<typeof loadCoordinatorInitialReportFundingRequirement>>>
	loadOracleManagerDetails: (managerAddress: Address) => Promise<Awaited<ReturnType<typeof loadOracleManagerDetails>>>
	loadOracleManagerQueueOperationEthValue: (client: TWriteClient, managerAddress: Address) => Promise<bigint>
	loadSecurityPoolPage: (pageIndex: number, pageSize: number, accountAddress: Address | undefined) => Promise<SecurityPoolPage>
	queueSecurityPoolLiquidation: (client: TWriteClient, managerAddress: Address, targetVault: Address, amount: bigint, validForSeconds: bigint) => Promise<SecurityPoolLiquidationQueueResult>
	waitForSecurityPoolReadBackend: () => Promise<void>
}

const SECURITY_POOL_PAGE_FALLBACK_DETAILS = ['no contract data was returned', 'returned no data']

export function shouldFallbackToAllSecurityPoolsPage(error: unknown) {
	const detail = getErrorDetail(error)
	if (detail === undefined) return false
	const normalizedDetail = detail.toLowerCase()
	return SECURITY_POOL_PAGE_FALLBACK_DETAILS.some(fallbackDetail => normalizedDetail.includes(fallbackDetail))
}

export function createSecurityPoolPageFromLoadedPools(pools: ListedSecurityPool[], pageIndex: number, pageSize: number): SecurityPoolPage {
	const startIndex = pageIndex * pageSize
	return {
		pageIndex,
		pageSize,
		poolCount: BigInt(pools.length),
		pools: pools.slice(startIndex, startIndex + pageSize),
	}
}

async function waitForSecurityPoolReadBackend() {
	await getActiveBackend().waitUntilReady?.()
}

const defaultUseSecurityPoolsOverviewDependencies: UseSecurityPoolsOverviewDependencies = {
	createConnectedReadClient: () => createConnectedReadClient(),
	createWalletWriteClient,
	loadAllSecurityPools: async options => await loadAllSecurityPools(createConnectedReadClient(), options),
	loadCoordinatorInitialReportFundingRequirement: async (client, managerAddress, walletAddress) => await loadCoordinatorInitialReportFundingRequirement(client, managerAddress, walletAddress),
	loadOracleManagerDetails: async managerAddress => await loadOracleManagerDetails(createConnectedReadClient(), managerAddress),
	loadOracleManagerQueueOperationEthValue,
	loadSecurityPoolPage: async (pageIndex, pageSize, accountAddress) => await loadSecurityPoolPage(createConnectedReadClient(), pageIndex, pageSize, accountAddress),
	queueSecurityPoolLiquidation,
	waitForSecurityPoolReadBackend,
}

function useSecurityPoolsOverviewWithDependencies<TWriteClient>(
	{ accountAddress, onTransactionCanceled, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState }: UseSecurityPoolsOverviewParameters,
	dependencies: UseSecurityPoolsOverviewDependencies<TWriteClient>,
) {
	const liquidationAmount = useSignal('0')
	const liquidationMaxAmount = useSignal<bigint | undefined>(undefined)
	const liquidationTargetVault = useSignal('')
	const liquidationTimeoutMinutes = useSignal(DEFAULT_STAGED_OPERATION_TIMEOUT_MINUTES.toString())
	const liquidationManagerAddress = useSignal<Address | undefined>(undefined)
	const liquidationSecurityPoolAddress = useSignal<Address | undefined>(undefined)
	const liquidationModalOpen = useSignal(false)
	const securityPoolBrowseCount = useSignal<bigint | undefined>(undefined)
	const securityPoolPage = useSignal<SecurityPoolBrowsePage | undefined>(undefined)
	const securityPoolsLoad = useLoadController()
	const securityPoolPageLoad = useLoadController()
	const hasLoadedSecurityPools = useSignal(false)
	const hasLoadedSecurityPoolPage = useSignal(false)
	const checkedSecurityPoolAddress = useSignal<string | undefined>(undefined)
	const securityPoolOverviewActiveAction = useSignal<SecurityPoolOverviewActionResult['action'] | undefined>(undefined)
	const securityPoolOverviewFeedback = useSignal<ActionFeedback<SecurityPoolOverviewActionResult['action']> | undefined>(undefined)
	const securityPoolOverviewError = useSignal<string | undefined>(undefined)
	const securityPoolLiquidationError = useSignal<string | undefined>(undefined)
	const securityPoolOverviewResult = useSignal<SecurityPoolOverviewActionResult | undefined>(undefined)
	const securityPools = useSignal<ListedSecurityPool[]>([])
	const nextSecurityPoolsLoad = useRequestGuard()
	const nextSecurityPoolPageLoad = useRequestGuard()

	const loadSecurityPools = async (securityPoolAddress?: string) => {
		const normalizedCheckedAddress = normalizeAddress(securityPoolAddress)
		const isCurrent = nextSecurityPoolsLoad()
		const nextCheckedAddress = normalizedCheckedAddress ?? checkedSecurityPoolAddress.value
		await securityPoolsLoad.run({
			isCurrent,
			onStart: () => {
				if (!isCurrent()) return
				securityPoolOverviewError.value = undefined
			},
			load: async () => {
				await dependencies.waitForSecurityPoolReadBackend()
				const loadOptions =
					nextCheckedAddress === undefined
						? {
								...(accountAddress === undefined ? {} : { accountAddress }),
								vaultDetailMode: 'selected' as const,
							}
						: {
								...(accountAddress === undefined ? {} : { accountAddress }),
								selectedSecurityPoolAddress: nextCheckedAddress,
								vaultDetailMode: 'selected' as const,
							}
				return await dependencies.loadAllSecurityPools(loadOptions)
			},
			onSuccess: pools => {
				hasLoadedSecurityPools.value = true
				checkedSecurityPoolAddress.value = nextCheckedAddress
				securityPools.value = pools
			},
			onError: error => {
				securityPoolOverviewError.value = getErrorMessage(error, 'Failed to load security pools')
			},
		})
	}

	const loadBrowseSecurityPoolPage = async (pageIndex: number, pageSize: number, requestKey: string) => {
		const isCurrent = nextSecurityPoolPageLoad()
		await securityPoolPageLoad.run({
			isCurrent,
			onStart: () => {
				if (!isCurrent()) return
				securityPoolOverviewError.value = undefined
			},
			load: async () => {
				await dependencies.waitForSecurityPoolReadBackend()
				try {
					return await dependencies.loadSecurityPoolPage(pageIndex, pageSize, accountAddress)
				} catch (error) {
					if (!shouldFallbackToAllSecurityPoolsPage(error)) throw error
					const pools = await dependencies.loadAllSecurityPools({
						...(accountAddress === undefined ? {} : { accountAddress }),
						vaultDetailMode: 'selected',
					})
					return createSecurityPoolPageFromLoadedPools(pools, pageIndex, pageSize)
				}
			},
			onSuccess: page => {
				hasLoadedSecurityPoolPage.value = true
				securityPoolBrowseCount.value = page.poolCount
				securityPoolPage.value = { ...page, requestKey }
			},
			onError: error => {
				securityPoolOverviewError.value = getErrorMessage(error, 'Failed to load security pools')
			},
		})
	}

	const openLiquidationModal = (managerAddress: Address, securityPoolAddress: Address, vaultAddress: Address, maxAmount: bigint | undefined) => {
		securityPoolOverviewError.value = undefined
		securityPoolLiquidationError.value = undefined
		securityPoolOverviewFeedback.value = undefined
		securityPoolOverviewResult.value = undefined
		liquidationManagerAddress.value = managerAddress
		liquidationMaxAmount.value = maxAmount
		liquidationSecurityPoolAddress.value = securityPoolAddress
		liquidationTargetVault.value = vaultAddress
		liquidationTimeoutMinutes.value = DEFAULT_STAGED_OPERATION_TIMEOUT_MINUTES.toString()
		liquidationModalOpen.value = true
	}

	const closeLiquidationModal = () => {
		securityPoolLiquidationError.value = undefined
		securityPoolOverviewFeedback.value = undefined
		securityPoolOverviewResult.value = undefined
		liquidationModalOpen.value = false
	}

	const getLiquidationSubmittedFeedback = (hash: Hash) => createSuccessActionFeedback('queueLiquidation', 'Liquidation submitted', hash, 'Waiting for refreshed pool state.')

	const getLiquidationFeedbackFromResult = (result: SecurityPoolOverviewActionResult) => {
		if (result.stagedExecution?.success === false) return createErrorActionFeedback('queueLiquidation', 'Liquidation failed', getLiquidationExecutionFailureDetail(result.stagedExecution.errorMessage) ?? 'The liquidation execution failed.')
		if (result.stagedExecution?.success === true) return createSuccessActionFeedback('queueLiquidation', 'Liquidation executed', result.hash, 'Execution completed immediately.')
		return getLiquidationSubmittedFeedback(result.hash)
	}

	const isLiquidationSnapshotCurrent = (snapshot: { amount: string; managerAddress: Address; securityPoolAddress: Address; targetVault: string; timeoutMinutes: string }) =>
		liquidationAmount.value === snapshot.amount && liquidationManagerAddress.value === snapshot.managerAddress && liquidationSecurityPoolAddress.value === snapshot.securityPoolAddress && liquidationTargetVault.value === snapshot.targetVault && liquidationTimeoutMinutes.value === snapshot.timeoutMinutes

	const queueLiquidation = async (managerAddress: Address, securityPoolAddress: Address) => {
		securityPoolLiquidationError.value = undefined
		securityPoolOverviewResult.value = undefined
		const submittedLiquidation = {
			amount: liquidationAmount.value,
			managerAddress,
			securityPoolAddress,
			targetVault: liquidationTargetVault.value,
			timeoutMinutes: liquidationTimeoutMinutes.value,
		}
		let completedResult: SecurityPoolOverviewActionResult | undefined
		try {
			securityPoolOverviewActiveAction.value = 'queueLiquidation'
			securityPoolOverviewFeedback.value = createPendingActionFeedback('queueLiquidation', 'Submitting liquidation')
			await runWriteAction(
				{
					...buildWriteActionConfig(
						{ accountAddress, onTransactionCanceled, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, refreshState },
						securityPoolOverviewError,
						'Connect a wallet before queueing liquidation',
						createLiquidationTransactionIntent(),
					),
					onRefreshError: (message, hash) => {
						if (completedResult?.stagedExecution?.success === false) return
						securityPoolOverviewFeedback.value =
							completedResult?.stagedExecution?.success === true ? createWarningActionFeedback('queueLiquidation', 'Liquidation executed', message, hash ?? completedResult.hash) : createWarningActionFeedback('queueLiquidation', 'Liquidation submitted', message, hash ?? completedResult?.hash)
						if (completedResult !== undefined) onTransactionPresented(createLiquidationWarningPresentation(completedResult, message))
					},
					onWriteError: message => {
						if (isLiquidationSnapshotCurrent(submittedLiquidation)) {
							liquidationModalOpen.value = true
							securityPoolLiquidationError.value = message
						}
						securityPoolOverviewFeedback.value = createErrorActionFeedback('queueLiquidation', 'Liquidation failed', message)
					},
					refreshState: async () => {
						await refreshWalletStateOnly(refreshState)
					},
				},
				async walletAddress => {
					const targetVault = parseAddressInput(submittedLiquidation.targetVault, 'Target vault')
					const amount = parseRepAmountInput(submittedLiquidation.amount, 'Liquidation amount')
					const writeClient = dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted })
					const requiredEthValue = await dependencies.loadOracleManagerQueueOperationEthValue(writeClient, managerAddress)
					const walletEthBalance = requiredEthValue === 0n ? undefined : await dependencies.createConnectedReadClient().getBalance({ address: walletAddress })
					if (walletEthBalance !== undefined && walletEthBalance < requiredEthValue) throw new Error(`Need ${formatCurrencyBalance(requiredEthValue - walletEthBalance)} more ETH in this wallet to queue this liquidation.`)
					if (requiredEthValue > 0n) {
						const fundingRequirement = await dependencies.loadCoordinatorInitialReportFundingRequirement(writeClient, managerAddress, walletAddress)
						if (fundingRequirement.currentRepBalance < fundingRequirement.exactToken1Report) {
							throw new Error(`Need ${formatCurrencyBalance(fundingRequirement.exactToken1Report - fundingRequirement.currentRepBalance)} more REP in this wallet to fund the initial report.`)
						}
						const managerDetails = await dependencies.loadOracleManagerDetails(managerAddress)
						const requiredEthWithWrap = addOpenOracleBountyBuffer(managerDetails.requestPriceEthCost) + fundingRequirement.wethShortfall
						if (walletEthBalance !== undefined && walletEthBalance < requiredEthWithWrap) {
							throw new Error(`Need ${formatCurrencyBalance(requiredEthWithWrap - walletEthBalance)} more ETH in this wallet to fund the initial report and queue this liquidation.`)
						}
					}
					const timeoutMinutes = parseBigIntInput(submittedLiquidation.timeoutMinutes, 'Liquidation timeout')
					if (timeoutMinutes < MIN_STAGED_OPERATION_TIMEOUT_MINUTES) throw new Error('Liquidation timeout must be at least 1 minute')
					if (timeoutMinutes > MAX_STAGED_OPERATION_TIMEOUT_MINUTES) throw new Error('Liquidation timeout must be 5 minutes or less')
					const validForSeconds = getStagedOperationTimeoutSeconds(timeoutMinutes)
					if (validForSeconds === undefined) throw new Error('Liquidation timeout must be at least 1 minute')
					return await dependencies.queueSecurityPoolLiquidation(writeClient, managerAddress, targetVault, amount, validForSeconds)
				},
				'Failed to queue liquidation',
				async result => {
					const nextResult: SecurityPoolOverviewActionResult = {
						action: 'queueLiquidation',
						hash: result.hash,
						...(result.queuedOperation === undefined ? {} : { queuedOperation: result.queuedOperation }),
						securityPoolAddress,
						...(result.stagedExecution === undefined ? {} : { stagedExecution: result.stagedExecution }),
					}
					completedResult = nextResult
					securityPoolLiquidationError.value = undefined
					securityPoolOverviewResult.value = nextResult
					securityPoolOverviewFeedback.value = getLiquidationFeedbackFromResult(nextResult)
					if (nextResult.stagedExecution?.success === false) {
						onTransactionPresented(createLiquidationFailurePresentation(nextResult, getLiquidationExecutionFailureDetail(nextResult.stagedExecution.errorMessage) ?? 'The liquidation execution failed.'))
					} else {
						onTransactionPresented(createLiquidationSuccessPresentation(nextResult))
					}
					await loadSecurityPools(securityPoolAddress)
				},
			)
		} finally {
			securityPoolOverviewActiveAction.value = undefined
		}
	}

	return {
		liquidationAmount: liquidationAmount.value,
		liquidationMaxAmount: liquidationMaxAmount.value,
		liquidationManagerAddress: liquidationManagerAddress.value,
		liquidationModalOpen: liquidationModalOpen.value,
		liquidationTargetVault: liquidationTargetVault.value,
		liquidationTimeoutMinutes: liquidationTimeoutMinutes.value,
		checkedSecurityPoolAddress: checkedSecurityPoolAddress.value,
		hasLoadedSecurityPools: hasLoadedSecurityPools.value,
		hasLoadedSecurityPoolPage: hasLoadedSecurityPoolPage.value,
		liquidationSecurityPoolAddress: liquidationSecurityPoolAddress.value,
		loadingSecurityPoolPage: securityPoolPageLoad.isLoading.value,
		loadingSecurityPools: securityPoolsLoad.isLoading.value,
		closeLiquidationModal,
		loadBrowseSecurityPoolPage,
		openLiquidationModal,
		queueLiquidation,
		securityPoolOverviewActiveAction: securityPoolOverviewActiveAction.value,
		securityPoolOverviewError: securityPoolOverviewError.value,
		securityPoolLiquidationError: securityPoolLiquidationError.value,
		securityPoolOverviewFeedback: securityPoolOverviewFeedback.value,
		securityPoolOverviewResult: securityPoolOverviewResult.value,
		securityPoolBrowseCount: securityPoolBrowseCount.value,
		securityPoolPage: securityPoolPage.value,
		securityPools: securityPools.value,
		setLiquidationAmount: (value: string) => {
			liquidationAmount.value = value
		},
		setLiquidationTimeoutMinutes: (value: string) => {
			liquidationTimeoutMinutes.value = value
		},
		setLiquidationTargetVault: (value: string) => {
			liquidationTargetVault.value = value
		},
		loadSecurityPools,
	}
}

export function useSecurityPoolsOverview(parameters: UseSecurityPoolsOverviewParameters): ReturnType<typeof useSecurityPoolsOverviewWithDependencies<SecurityPoolsOverviewProductionWriteClient>>
export function useSecurityPoolsOverview<TWriteClient>(parameters: UseSecurityPoolsOverviewParameters, dependencies: UseSecurityPoolsOverviewDependencies<TWriteClient>): ReturnType<typeof useSecurityPoolsOverviewWithDependencies<TWriteClient>>
export function useSecurityPoolsOverview<TWriteClient>(parameters: UseSecurityPoolsOverviewParameters, dependencies?: UseSecurityPoolsOverviewDependencies<TWriteClient>) {
	if (dependencies === undefined) return useSecurityPoolsOverviewWithDependencies(parameters, defaultUseSecurityPoolsOverviewDependencies)
	return useSecurityPoolsOverviewWithDependencies(parameters, dependencies)
}
