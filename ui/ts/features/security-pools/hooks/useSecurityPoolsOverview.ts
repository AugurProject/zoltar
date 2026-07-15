import { useSignal } from '@preact/signals'
import { useRef } from 'preact/hooks'
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
import { getLiquidationExecutionFailureDetail } from '../lib/liquidation.js'
import { useRequestGuard } from '../../../lib/requestGuard.js'
import { DEFAULT_STAGED_OPERATION_TIMEOUT_MINUTES, getStagedOperationTimeoutSeconds, MAX_STAGED_OPERATION_TIMEOUT_MINUTES, MIN_STAGED_OPERATION_TIMEOUT_MINUTES } from '../lib/securityVault.js'
import type { WriteOperationsParameters } from '../../../types/app.js'
import type { LiquidationFundingPreview, ListedSecurityPool, SecurityPoolBrowsePage, SecurityPoolOverviewActionResult, SecurityPoolPage } from '../../../types/contracts.js'

type UseSecurityPoolsOverviewParameters = {
	accountAddress: Address | undefined
	environmentRefreshKey: number
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

function getLiquidationFundingPreviewRequestKey(managerAddress: Address, walletAddress: Address, environmentRefreshKey: number) {
	return `${environmentRefreshKey}:${managerAddress.toLowerCase()}:${walletAddress.toLowerCase()}`
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
	{ accountAddress, environmentRefreshKey, onTransactionCanceled, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState }: UseSecurityPoolsOverviewParameters,
	dependencies: UseSecurityPoolsOverviewDependencies<TWriteClient>,
) {
	const latestAccountAddress = useRef(accountAddress)
	const latestEnvironmentRefreshKey = useRef(environmentRefreshKey)
	latestAccountAddress.current = accountAddress
	latestEnvironmentRefreshKey.current = environmentRefreshKey
	const liquidationAmount = useSignal('0')
	const liquidationMaxAmount = useSignal<bigint | undefined>(undefined)
	const liquidationTargetVault = useSignal('')
	const liquidationTimeoutMinutes = useSignal(DEFAULT_STAGED_OPERATION_TIMEOUT_MINUTES.toString())
	const liquidationManagerAddress = useSignal<Address | undefined>(undefined)
	const liquidationFundingPreview = useSignal<LiquidationFundingPreview | undefined>(undefined)
	const liquidationFundingPreviewError = useSignal<string | undefined>(undefined)
	const liquidationFundingPreviewErrorKey = useSignal<string | undefined>(undefined)
	const liquidationFundingPreviewLoadingKey = useSignal<string | undefined>(undefined)
	const liquidationFundingPreviewResolvedKey = useSignal<string | undefined>(undefined)
	const liquidationSecurityPoolAddress = useSignal<Address | undefined>(undefined)
	const liquidationModalOpen = useSignal(false)
	const securityPoolBrowseCount = useSignal<bigint | undefined>(undefined)
	const securityPoolPage = useSignal<SecurityPoolBrowsePage | undefined>(undefined)
	const securityPoolsLoad = useLoadController()
	const liquidationFundingPreviewLoad = useLoadController()
	const securityPoolPageLoad = useLoadController()
	const securityPoolsLoadedEnvironmentRefreshKey = useSignal<number | undefined>(undefined)
	const hasLoadedSecurityPoolPage = useSignal(false)
	const checkedSecurityPoolAddress = useSignal<string | undefined>(undefined)
	const securityPoolOverviewActiveAction = useSignal<SecurityPoolOverviewActionResult['action'] | undefined>(undefined)
	const securityPoolOverviewFeedback = useSignal<ActionFeedback<SecurityPoolOverviewActionResult['action']> | undefined>(undefined)
	const securityPoolOverviewError = useSignal<string | undefined>(undefined)
	const securityPoolsLoadError = useSignal<string | undefined>(undefined)
	const securityPoolsLoadErrorEnvironmentRefreshKey = useSignal<number | undefined>(undefined)
	const securityPoolLiquidationError = useSignal<string | undefined>(undefined)
	const securityPoolOverviewResult = useSignal<SecurityPoolOverviewActionResult | undefined>(undefined)
	const securityPools = useSignal<ListedSecurityPool[]>([])
	const nextSecurityPoolsLoad = useRequestGuard()
	const nextLiquidationFundingPreviewLoad = useRequestGuard()
	const nextSecurityPoolPageLoad = useRequestGuard()

	const loadSecurityPools = async (securityPoolAddress?: string) => {
		const requestedEnvironmentRefreshKey = environmentRefreshKey
		const normalizedCheckedAddress = normalizeAddress(securityPoolAddress)
		const isCurrent = nextSecurityPoolsLoad()
		const nextCheckedAddress = normalizedCheckedAddress ?? checkedSecurityPoolAddress.value
		const result = await securityPoolsLoad.run({
			isCurrent,
			onStart: () => {
				if (!isCurrent()) return
				securityPoolOverviewError.value = undefined
				securityPoolsLoadError.value = undefined
				securityPoolsLoadErrorEnvironmentRefreshKey.value = undefined
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
				securityPoolsLoadedEnvironmentRefreshKey.value = requestedEnvironmentRefreshKey
				checkedSecurityPoolAddress.value = nextCheckedAddress
				securityPools.value = pools
			},
			onError: error => {
				const message = getErrorMessage(error, 'Failed to load security pools')
				securityPoolOverviewError.value = message
				securityPoolsLoadError.value = message
				securityPoolsLoadErrorEnvironmentRefreshKey.value = requestedEnvironmentRefreshKey
			},
		})
		return result !== undefined
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

	const resolveLiquidationFundingPreview = async (managerAddress: Address, walletAddress: Address): Promise<LiquidationFundingPreview> => {
		const writeClient = dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted })
		const queueOperationEthValue = await dependencies.loadOracleManagerQueueOperationEthValue(writeClient, managerAddress)
		if (queueOperationEthValue === 0n) {
			return {
				currentRepBalance: 0n,
				currentWethBalance: 0n,
				initialReportRepRequired: 0n,
				initialReportWethRequired: 0n,
				queueOperationEthValue,
				totalWalletEthRequired: 0n,
				wethShortfall: 0n,
			}
		}
		const fundingRequirement = await dependencies.loadCoordinatorInitialReportFundingRequirement(writeClient, managerAddress, walletAddress)
		return {
			currentRepBalance: fundingRequirement.currentRepBalance,
			currentWethBalance: fundingRequirement.currentWethBalance,
			initialReportRepRequired: fundingRequirement.exactToken1Report,
			initialReportWethRequired: fundingRequirement.initialReportAmount2,
			queueOperationEthValue,
			totalWalletEthRequired: queueOperationEthValue + fundingRequirement.wethShortfall,
			wethShortfall: fundingRequirement.wethShortfall,
		}
	}

	const getCurrentLiquidationFundingPreviewRequestKey = () => {
		const managerAddress = liquidationManagerAddress.value
		const walletAddress = latestAccountAddress.current
		if (managerAddress === undefined || walletAddress === undefined) return undefined
		return getLiquidationFundingPreviewRequestKey(managerAddress, walletAddress, latestEnvironmentRefreshKey.current)
	}

	const loadLiquidationFundingPreview = async (managerAddress: Address) => {
		const walletAddress = latestAccountAddress.current
		if (walletAddress === undefined) {
			liquidationFundingPreview.value = undefined
			liquidationFundingPreviewResolvedKey.value = undefined
			liquidationFundingPreviewError.value = 'Connect a wallet before loading liquidation funding.'
			liquidationFundingPreviewErrorKey.value = undefined
			return false
		}
		const requestKey = getLiquidationFundingPreviewRequestKey(managerAddress, walletAddress, latestEnvironmentRefreshKey.current)
		const isCurrent = nextLiquidationFundingPreviewLoad()
		const result = await liquidationFundingPreviewLoad.run({
			isCurrent,
			onStart: () => {
				liquidationFundingPreview.value = undefined
				liquidationFundingPreviewResolvedKey.value = undefined
				liquidationFundingPreviewError.value = undefined
				liquidationFundingPreviewErrorKey.value = undefined
				liquidationFundingPreviewLoadingKey.value = requestKey
			},
			load: async () => await resolveLiquidationFundingPreview(managerAddress, walletAddress),
			onSuccess: preview => {
				if (getCurrentLiquidationFundingPreviewRequestKey() !== requestKey) return
				liquidationFundingPreview.value = preview
				liquidationFundingPreviewResolvedKey.value = requestKey
			},
			onError: error => {
				if (getCurrentLiquidationFundingPreviewRequestKey() !== requestKey) return
				liquidationFundingPreviewError.value = getErrorMessage(error, 'Failed to load liquidation funding')
				liquidationFundingPreviewErrorKey.value = requestKey
			},
		})
		if (liquidationFundingPreviewLoadingKey.value === requestKey) liquidationFundingPreviewLoadingKey.value = undefined
		return result !== undefined && getCurrentLiquidationFundingPreviewRequestKey() === requestKey
	}

	const openLiquidationModal = (managerAddress: Address, securityPoolAddress: Address, vaultAddress: Address, maxAmount: bigint | undefined) => {
		nextLiquidationFundingPreviewLoad()
		securityPoolOverviewError.value = undefined
		securityPoolLiquidationError.value = undefined
		securityPoolOverviewFeedback.value = undefined
		securityPoolOverviewResult.value = undefined
		liquidationFundingPreview.value = undefined
		liquidationFundingPreviewError.value = undefined
		liquidationFundingPreviewErrorKey.value = undefined
		liquidationFundingPreviewLoadingKey.value = undefined
		liquidationFundingPreviewResolvedKey.value = undefined
		liquidationManagerAddress.value = managerAddress
		liquidationMaxAmount.value = maxAmount
		liquidationSecurityPoolAddress.value = securityPoolAddress
		liquidationTargetVault.value = vaultAddress
		liquidationTimeoutMinutes.value = DEFAULT_STAGED_OPERATION_TIMEOUT_MINUTES.toString()
		liquidationModalOpen.value = true
	}

	const closeLiquidationModal = () => {
		nextLiquidationFundingPreviewLoad()
		securityPoolLiquidationError.value = undefined
		securityPoolOverviewFeedback.value = undefined
		securityPoolOverviewResult.value = undefined
		liquidationFundingPreview.value = undefined
		liquidationFundingPreviewError.value = undefined
		liquidationFundingPreviewErrorKey.value = undefined
		liquidationFundingPreviewLoadingKey.value = undefined
		liquidationFundingPreviewResolvedKey.value = undefined
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
					const fundingEnvironmentRefreshKey = latestEnvironmentRefreshKey.current
					const fundingPreviewKey = getLiquidationFundingPreviewRequestKey(managerAddress, walletAddress, fundingEnvironmentRefreshKey)
					const ensureFundingContextIsCurrent = () => {
						if (getCurrentLiquidationFundingPreviewRequestKey() !== fundingPreviewKey) throw new Error('The wallet or network changed while loading liquidation funding. Review the refreshed funding requirements and try again.')
					}
					const writeClient = dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted })
					const fundingPreview = await resolveLiquidationFundingPreview(managerAddress, walletAddress)
					ensureFundingContextIsCurrent()
					liquidationFundingPreview.value = fundingPreview
					liquidationFundingPreviewResolvedKey.value = fundingPreviewKey
					if (fundingPreview.currentRepBalance < fundingPreview.initialReportRepRequired) throw new Error(`Need ${formatCurrencyBalance(fundingPreview.initialReportRepRequired - fundingPreview.currentRepBalance)} more REP in this wallet to fund the initial report.`)
					const walletEthBalance = fundingPreview.totalWalletEthRequired === 0n ? undefined : await dependencies.createConnectedReadClient().getBalance({ address: walletAddress })
					ensureFundingContextIsCurrent()
					if (walletEthBalance !== undefined && walletEthBalance < fundingPreview.totalWalletEthRequired) throw new Error(`Need ${formatCurrencyBalance(fundingPreview.totalWalletEthRequired - walletEthBalance)} more ETH in this wallet to fund the initial report and queue this liquidation.`)
					const timeoutMinutes = parseBigIntInput(submittedLiquidation.timeoutMinutes, 'Liquidation timeout')
					if (timeoutMinutes < MIN_STAGED_OPERATION_TIMEOUT_MINUTES) throw new Error('Liquidation timeout must be at least 1 minute')
					if (timeoutMinutes > MAX_STAGED_OPERATION_TIMEOUT_MINUTES) throw new Error('Liquidation timeout must be 5 minutes or less')
					const validForSeconds = getStagedOperationTimeoutSeconds(timeoutMinutes)
					if (validForSeconds === undefined) throw new Error('Liquidation timeout must be at least 1 minute')
					ensureFundingContextIsCurrent()
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
	const currentLiquidationFundingPreviewRequestKey = getCurrentLiquidationFundingPreviewRequestKey()
	const currentLiquidationFundingPreview = currentLiquidationFundingPreviewRequestKey !== undefined && liquidationFundingPreviewResolvedKey.value === currentLiquidationFundingPreviewRequestKey ? liquidationFundingPreview.value : undefined
	const currentLiquidationFundingPreviewError = liquidationFundingPreviewErrorKey.value === currentLiquidationFundingPreviewRequestKey ? liquidationFundingPreviewError.value : undefined
	const loadingCurrentLiquidationFundingPreview = currentLiquidationFundingPreviewRequestKey !== undefined && liquidationFundingPreviewLoadingKey.value === currentLiquidationFundingPreviewRequestKey && liquidationFundingPreviewLoad.isLoading.value

	return {
		liquidationAmount: liquidationAmount.value,
		liquidationMaxAmount: liquidationMaxAmount.value,
		liquidationManagerAddress: liquidationManagerAddress.value,
		liquidationFundingPreview: currentLiquidationFundingPreview,
		liquidationFundingPreviewError: currentLiquidationFundingPreviewError,
		liquidationModalOpen: liquidationModalOpen.value,
		liquidationTargetVault: liquidationTargetVault.value,
		liquidationTimeoutMinutes: liquidationTimeoutMinutes.value,
		checkedSecurityPoolAddress: checkedSecurityPoolAddress.value,
		hasLoadedSecurityPools: securityPoolsLoadedEnvironmentRefreshKey.value === environmentRefreshKey,
		securityPoolsLoadedEnvironmentRefreshKey: securityPoolsLoadedEnvironmentRefreshKey.value,
		hasLoadedSecurityPoolPage: hasLoadedSecurityPoolPage.value,
		liquidationSecurityPoolAddress: liquidationSecurityPoolAddress.value,
		loadingSecurityPoolPage: securityPoolPageLoad.isLoading.value,
		loadingSecurityPools: securityPoolsLoad.isLoading.value,
		loadingLiquidationFundingPreview: loadingCurrentLiquidationFundingPreview,
		closeLiquidationModal,
		loadBrowseSecurityPoolPage,
		loadLiquidationFundingPreview,
		openLiquidationModal,
		queueLiquidation,
		securityPoolOverviewActiveAction: securityPoolOverviewActiveAction.value,
		securityPoolOverviewError: securityPoolOverviewError.value,
		securityPoolsLoadError: securityPoolsLoadError.value,
		securityPoolsLoadErrorEnvironmentRefreshKey: securityPoolsLoadErrorEnvironmentRefreshKey.value,
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
