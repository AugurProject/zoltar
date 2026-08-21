import { useSignal } from '@preact/signals'
import { useRef } from 'preact/hooks'
import type { Address, Hash } from '@zoltar/shared/ethereum'
import {
	loadAllSecurityPools,
	loadCoordinatorInitialReportFundingRequirement,
	loadLiquidationApproval as loadProtocolLiquidationApproval,
	loadOracleManagerDetails,
	loadOracleManagerQueueOperationEthValue,
	loadSecurityPoolPage,
	loadSecurityPoolVaultSummary as loadProtocolSecurityPoolVaultSummary,
	queueSecurityPoolLiquidation,
} from '../../../protocol/index.js'
import { useLoadController } from '@zoltar/ui-core-shared/hooks/useLoadController.js'
import { normalizeAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { createConnectedReadClient, createWalletWriteClient } from '@zoltar/ui-core-shared/lib/clients.js'
import { getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getErrorDetail, getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '@zoltar/ui-core-shared/lib/actionFeedback.js'
import type { ActionFeedback } from '@zoltar/ui-core-shared/lib/actionFeedback.js'
import { createLiquidationFailurePresentation, createLiquidationSuccessPresentation, createLiquidationTransactionIntent, createLiquidationWarningPresentation } from '../../transactionPresentations.js'
import { buildWriteActionConfig, runWriteAction } from '@zoltar/ui-core-shared/lib/writeAction.js'
import { refreshWalletStateOnly } from '@zoltar/ui-core-shared/lib/refreshState.js'
import { parseAddressInput, parseBytes32Input, tryParseAddressInput } from '@zoltar/ui-core-shared/lib/inputs.js'
import { parseBigIntInput } from '@zoltar/ui-core-shared/lib/integerInput.js'
import { parseEthAmountInput } from '@zoltar/ui-core-shared/lib/formInputs.js'
import { formatAdditionalCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { getLiquidationExecutionFailureDetail } from '../lib/liquidation.js'
import { useRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import { DEFAULT_STAGED_OPERATION_TIMEOUT_MINUTES, getStagedOperationTimeoutSeconds, MAX_STAGED_OPERATION_TIMEOUT_MINUTES, MIN_STAGED_OPERATION_TIMEOUT_MINUTES } from '../lib/securityVault.js'
import type { WriteOperationsParameters } from '../../../types/app.js'
import type { LiquidationApprovalDetails, LiquidationFundingPreview, ListedSecurityPool, SecurityPoolBrowsePage, SecurityPoolOverviewActionResult, SecurityPoolPage, SecurityPoolVaultSummary } from '@zoltar/ui-core-shared/types/contracts.js'

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
	loadLiquidationApproval: (managerAddress: Address, approvalId: Hash) => Promise<LiquidationApprovalDetails>
	loadSecurityPoolVaultSummary: (securityPoolAddress: Address, vaultAddress: Address) => Promise<SecurityPoolVaultSummary>
	loadOracleManagerDetails: (managerAddress: Address) => Promise<Awaited<ReturnType<typeof loadOracleManagerDetails>>>
	loadOracleManagerQueueOperationEthValue: (client: TWriteClient, managerAddress: Address) => Promise<bigint>
	loadSecurityPoolPage: (pageIndex: number, pageSize: number, accountAddress: Address | undefined) => Promise<SecurityPoolPage>
	queueSecurityPoolLiquidation: (client: TWriteClient, managerAddress: Address, targetVault: Address, amount: bigint, validForSeconds: bigint, requestedInitialAttoWeth?: bigint, receiverVault?: Address, approvalId?: Hash) => Promise<SecurityPoolLiquidationQueueResult>
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
	loadLiquidationApproval: async (managerAddress, approvalId) => await loadProtocolLiquidationApproval(createConnectedReadClient(), managerAddress, approvalId),
	loadSecurityPoolVaultSummary: async (securityPoolAddress, vaultAddress) => await loadProtocolSecurityPoolVaultSummary(createConnectedReadClient(), securityPoolAddress, vaultAddress),
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
	const liquidationDebtEthAmount = useSignal('0')
	const maximumLiquidationDebtAttoEth = useSignal<bigint | undefined>(undefined)
	const liquidationTargetVault = useSignal('')
	const liquidationReceiverVault = useSignal('')
	const liquidationApprovalId = useSignal(`0x${'00'.repeat(32)}`)
	const liquidationApprovalDetails = useSignal<LiquidationApprovalDetails | undefined>(undefined)
	const liquidationApprovalError = useSignal<string | undefined>(undefined)
	const liquidationApprovalLoadingKey = useSignal<string | undefined>(undefined)
	const liquidationReceiverVaultSummary = useSignal<SecurityPoolVaultSummary | undefined>(undefined)
	const liquidationReceiverVaultSummaryError = useSignal<string | undefined>(undefined)
	const liquidationReceiverVaultSummaryResolvedKey = useSignal<string | undefined>(undefined)
	const liquidationReceiverVaultSummaryLoadingKey = useSignal<string | undefined>(undefined)
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
	const liquidationApprovalLoad = useLoadController()
	const liquidationReceiverVaultSummaryLoad = useLoadController()
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
	const nextLiquidationApprovalLoad = useRequestGuard()
	const nextLiquidationReceiverVaultSummaryLoad = useRequestGuard()
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
		const queueOperationValueAttoEth = await dependencies.loadOracleManagerQueueOperationEthValue(writeClient, managerAddress)
		if (queueOperationValueAttoEth === 0n) {
			return {
				currentRepBalanceAttoRep: 0n,
				currentWethBalanceAttoEth: 0n,
				initialReportRepRequiredAttoRep: 0n,
				initialReportWethRequiredAttoEth: 0n,
				queueOperationValueAttoEth,
				totalWalletEthRequiredAttoEth: 0n,
				wethShortfallAttoEth: 0n,
			}
		}
		const fundingRequirement = await dependencies.loadCoordinatorInitialReportFundingRequirement(writeClient, managerAddress, walletAddress)
		return {
			currentRepBalanceAttoRep: fundingRequirement.currentRepBalanceAttoRep,
			currentWethBalanceAttoEth: fundingRequirement.currentWethBalanceAttoEth,
			initialReportRepRequiredAttoRep: fundingRequirement.initialReportAmount2,
			initialReportWethRequiredAttoEth: fundingRequirement.maximumInitialAttoWeth,
			queueOperationValueAttoEth,
			totalWalletEthRequiredAttoEth: queueOperationValueAttoEth + fundingRequirement.wethShortfallAttoEth,
			wethShortfallAttoEth: fundingRequirement.wethShortfallAttoEth,
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
			liquidationFundingPreviewError.value = 'Connect a wallet to review liquidation funding.'
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

	const getCurrentLiquidationApprovalRequestKey = () => {
		const managerAddress = liquidationManagerAddress.value
		if (managerAddress === undefined) return undefined
		const approvalId = liquidationApprovalId.value.trim()
		if (!/^0x[0-9a-fA-F]{64}$/.test(approvalId)) return undefined
		return `${latestEnvironmentRefreshKey.current}:${managerAddress.toLowerCase()}:${approvalId.toLowerCase()}`
	}

	const loadLiquidationApproval = async () => {
		const managerAddress = liquidationManagerAddress.value
		if (managerAddress === undefined) {
			liquidationApprovalError.value = 'Selected pool details are still loading.'
			return false
		}
		let approvalId: Hash
		try {
			approvalId = parseBytes32Input(liquidationApprovalId.value, 'Liquidation approval ID')
		} catch (error) {
			liquidationApprovalDetails.value = undefined
			liquidationApprovalError.value = getErrorMessage(error, 'Enter a valid liquidation approval ID')
			return false
		}
		const requestKey = `${latestEnvironmentRefreshKey.current}:${managerAddress.toLowerCase()}:${approvalId.toLowerCase()}`
		const isCurrent = nextLiquidationApprovalLoad()
		const result = await liquidationApprovalLoad.run({
			isCurrent,
			onStart: () => {
				liquidationApprovalDetails.value = undefined
				liquidationApprovalError.value = undefined
				liquidationApprovalLoadingKey.value = requestKey
			},
			load: async () => {
				await dependencies.waitForSecurityPoolReadBackend()
				return await dependencies.loadLiquidationApproval(managerAddress, approvalId)
			},
			onSuccess: approval => {
				if (getCurrentLiquidationApprovalRequestKey() !== requestKey) return
				liquidationApprovalDetails.value = approval
			},
			onError: error => {
				if (getCurrentLiquidationApprovalRequestKey() !== requestKey) return
				liquidationApprovalError.value = getErrorMessage(error, 'Failed to load liquidation approval')
			},
		})
		if (liquidationApprovalLoadingKey.value === requestKey) liquidationApprovalLoadingKey.value = undefined
		return result !== undefined && getCurrentLiquidationApprovalRequestKey() === requestKey
	}

	const getCurrentLiquidationReceiverVaultSummaryRequestKey = () => {
		const securityPoolAddress = liquidationSecurityPoolAddress.value
		if (securityPoolAddress === undefined) return undefined
		const receiverVault = tryParseAddressInput(liquidationReceiverVault.value)
		if (receiverVault === undefined) return undefined
		return `${latestEnvironmentRefreshKey.current}:${securityPoolAddress.toLowerCase()}:${receiverVault.toLowerCase()}`
	}

	const loadLiquidationReceiverVaultSummary = async () => {
		const securityPoolAddress = liquidationSecurityPoolAddress.value
		if (securityPoolAddress === undefined) {
			liquidationReceiverVaultSummaryError.value = 'Selected pool details are still loading.'
			return false
		}
		let receiverVault: Address
		try {
			receiverVault = parseAddressInput(liquidationReceiverVault.value, 'Receiver vault')
		} catch (error) {
			liquidationReceiverVaultSummary.value = undefined
			liquidationReceiverVaultSummaryError.value = getErrorMessage(error, 'Enter a valid receiver vault')
			return false
		}
		const requestKey = `${latestEnvironmentRefreshKey.current}:${securityPoolAddress.toLowerCase()}:${receiverVault.toLowerCase()}`
		const isCurrent = nextLiquidationReceiverVaultSummaryLoad()
		const result = await liquidationReceiverVaultSummaryLoad.run({
			isCurrent,
			onStart: () => {
				liquidationReceiverVaultSummary.value = undefined
				liquidationReceiverVaultSummaryError.value = undefined
				liquidationReceiverVaultSummaryResolvedKey.value = undefined
				liquidationReceiverVaultSummaryLoadingKey.value = requestKey
			},
			load: async () => {
				await dependencies.waitForSecurityPoolReadBackend()
				return await dependencies.loadSecurityPoolVaultSummary(securityPoolAddress, receiverVault)
			},
			onSuccess: summary => {
				if (getCurrentLiquidationReceiverVaultSummaryRequestKey() !== requestKey) return
				liquidationReceiverVaultSummary.value = summary
				liquidationReceiverVaultSummaryResolvedKey.value = requestKey
			},
			onError: error => {
				if (getCurrentLiquidationReceiverVaultSummaryRequestKey() !== requestKey) return
				liquidationReceiverVaultSummaryError.value = getErrorMessage(error, 'Failed to load receiver vault')
			},
		})
		if (liquidationReceiverVaultSummaryLoadingKey.value === requestKey) liquidationReceiverVaultSummaryLoadingKey.value = undefined
		return result !== undefined && getCurrentLiquidationReceiverVaultSummaryRequestKey() === requestKey
	}

	const openLiquidationModal = (managerAddress: Address, securityPoolAddress: Address, vaultAddress: Address, maxAmount: bigint | undefined) => {
		nextLiquidationFundingPreviewLoad()
		nextLiquidationApprovalLoad()
		nextLiquidationReceiverVaultSummaryLoad()
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
		maximumLiquidationDebtAttoEth.value = maxAmount
		liquidationSecurityPoolAddress.value = securityPoolAddress
		liquidationTargetVault.value = vaultAddress
		liquidationReceiverVault.value = accountAddress ?? ''
		liquidationApprovalId.value = `0x${'00'.repeat(32)}`
		liquidationApprovalDetails.value = undefined
		liquidationApprovalError.value = undefined
		liquidationApprovalLoadingKey.value = undefined
		liquidationReceiverVaultSummary.value = undefined
		liquidationReceiverVaultSummaryError.value = undefined
		liquidationReceiverVaultSummaryResolvedKey.value = undefined
		liquidationReceiverVaultSummaryLoadingKey.value = undefined
		liquidationTimeoutMinutes.value = DEFAULT_STAGED_OPERATION_TIMEOUT_MINUTES.toString()
		liquidationModalOpen.value = true
	}

	const closeLiquidationModal = () => {
		nextLiquidationFundingPreviewLoad()
		nextLiquidationApprovalLoad()
		nextLiquidationReceiverVaultSummaryLoad()
		securityPoolLiquidationError.value = undefined
		securityPoolOverviewFeedback.value = undefined
		securityPoolOverviewResult.value = undefined
		liquidationFundingPreview.value = undefined
		liquidationFundingPreviewError.value = undefined
		liquidationFundingPreviewErrorKey.value = undefined
		liquidationFundingPreviewLoadingKey.value = undefined
		liquidationFundingPreviewResolvedKey.value = undefined
		liquidationApprovalDetails.value = undefined
		liquidationApprovalError.value = undefined
		liquidationApprovalLoadingKey.value = undefined
		liquidationReceiverVaultSummary.value = undefined
		liquidationReceiverVaultSummaryError.value = undefined
		liquidationReceiverVaultSummaryResolvedKey.value = undefined
		liquidationReceiverVaultSummaryLoadingKey.value = undefined
		liquidationModalOpen.value = false
	}

	const getLiquidationSubmittedFeedback = (hash: Hash) => createSuccessActionFeedback('queueLiquidation', 'Liquidation submitted', hash, 'Waiting for refreshed pool state.')

	const getLiquidationFeedbackFromResult = (result: SecurityPoolOverviewActionResult) => {
		if (result.stagedExecution?.success === false) return createErrorActionFeedback('queueLiquidation', 'Liquidation failed', getLiquidationExecutionFailureDetail(result.stagedExecution.errorMessage) ?? 'The liquidation execution failed.')
		if (result.stagedExecution?.success === true) return createSuccessActionFeedback('queueLiquidation', 'Liquidation executed', result.hash, 'Execution completed immediately.')
		return getLiquidationSubmittedFeedback(result.hash)
	}

	const isLiquidationSnapshotCurrent = (snapshot: { approvalId: string; amount: string; managerAddress: Address; receiverVault: string; securityPoolAddress: Address; targetVault: string; timeoutMinutes: string }) =>
		liquidationApprovalId.value === snapshot.approvalId &&
		liquidationDebtEthAmount.value === snapshot.amount &&
		liquidationManagerAddress.value === snapshot.managerAddress &&
		liquidationSecurityPoolAddress.value === snapshot.securityPoolAddress &&
		liquidationReceiverVault.value === snapshot.receiverVault &&
		liquidationTargetVault.value === snapshot.targetVault &&
		liquidationTimeoutMinutes.value === snapshot.timeoutMinutes

	const queueLiquidation = async (managerAddress: Address, securityPoolAddress: Address) => {
		securityPoolLiquidationError.value = undefined
		securityPoolOverviewResult.value = undefined
		const submittedLiquidation = {
			approvalId: liquidationApprovalId.value,
			amount: liquidationDebtEthAmount.value,
			managerAddress,
			receiverVault: liquidationReceiverVault.value,
			securityPoolAddress,
			targetVault: liquidationTargetVault.value,
			timeoutMinutes: liquidationTimeoutMinutes.value,
		}
		const transactionContext = {
			amount: submittedLiquidation.amount,
			securityPoolAddress: submittedLiquidation.securityPoolAddress,
			targetVault: submittedLiquidation.targetVault,
			universeId: securityPools.value.find(pool => normalizeAddress(pool.securityPoolAddress) === normalizeAddress(submittedLiquidation.securityPoolAddress))?.universeId,
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
						createLiquidationTransactionIntent(transactionContext),
					),
					onRefreshError: (message, hash) => {
						if (completedResult?.stagedExecution?.success === false) return
						securityPoolOverviewFeedback.value =
							completedResult?.stagedExecution?.success === true ? createWarningActionFeedback('queueLiquidation', 'Liquidation executed', message, hash ?? completedResult.hash) : createWarningActionFeedback('queueLiquidation', 'Liquidation submitted', message, hash ?? completedResult?.hash)
						if (completedResult !== undefined) onTransactionPresented(createLiquidationWarningPresentation(completedResult, message, transactionContext))
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
					const receiverVault = parseAddressInput(submittedLiquidation.receiverVault, 'Receiver vault')
					const approvalId = parseBytes32Input(submittedLiquidation.approvalId, 'Liquidation approval ID')
					const amount = parseEthAmountInput(submittedLiquidation.amount, 'Liquidation debt')
					const fundingEnvironmentRefreshKey = latestEnvironmentRefreshKey.current
					const fundingPreviewKey = getLiquidationFundingPreviewRequestKey(managerAddress, walletAddress, fundingEnvironmentRefreshKey)
					const ensureFundingContextIsCurrent = () => {
						if (latestAccountAddress.current?.toLowerCase() !== walletAddress.toLowerCase() || latestEnvironmentRefreshKey.current !== fundingEnvironmentRefreshKey) {
							throw new Error('The wallet or network changed while loading liquidation funding. Review the refreshed funding requirements and try again.')
						}
					}
					const writeClient = dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted })
					const fundingPreview = await resolveLiquidationFundingPreview(managerAddress, walletAddress)
					ensureFundingContextIsCurrent()
					if (getCurrentLiquidationFundingPreviewRequestKey() === fundingPreviewKey) {
						liquidationFundingPreview.value = fundingPreview
						liquidationFundingPreviewResolvedKey.value = fundingPreviewKey
					}
					if (fundingPreview.currentRepBalanceAttoRep < fundingPreview.initialReportRepRequiredAttoRep) throw new Error(`Need ${formatAdditionalCurrencyBalance(fundingPreview.initialReportRepRequiredAttoRep - fundingPreview.currentRepBalanceAttoRep, 'REP')} in this wallet to fund the initial report.`)
					const walletBalanceAttoEth = fundingPreview.totalWalletEthRequiredAttoEth === 0n ? undefined : await dependencies.createConnectedReadClient().getBalance({ address: walletAddress })
					ensureFundingContextIsCurrent()
					if (walletBalanceAttoEth !== undefined && walletBalanceAttoEth < fundingPreview.totalWalletEthRequiredAttoEth)
						throw new Error(`Need ${formatAdditionalCurrencyBalance(fundingPreview.totalWalletEthRequiredAttoEth - walletBalanceAttoEth, 'ETH')} in this wallet to fund the initial report and queue this liquidation.`)
					const timeoutMinutes = parseBigIntInput(submittedLiquidation.timeoutMinutes, 'Liquidation timeout')
					if (timeoutMinutes < MIN_STAGED_OPERATION_TIMEOUT_MINUTES) throw new Error('Liquidation timeout must be at least 1 minute')
					if (timeoutMinutes > MAX_STAGED_OPERATION_TIMEOUT_MINUTES) throw new Error('Liquidation timeout must be 5 minutes or less')
					const validForSeconds = getStagedOperationTimeoutSeconds(timeoutMinutes)
					if (validForSeconds === undefined) throw new Error('Liquidation timeout must be at least 1 minute')
					ensureFundingContextIsCurrent()
					return await dependencies.queueSecurityPoolLiquidation(writeClient, managerAddress, targetVault, amount, validForSeconds, 0n, receiverVault, approvalId)
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
						onTransactionPresented(createLiquidationFailurePresentation(nextResult, getLiquidationExecutionFailureDetail(nextResult.stagedExecution.errorMessage) ?? 'The liquidation execution failed.', transactionContext))
					} else {
						onTransactionPresented(createLiquidationSuccessPresentation(nextResult, transactionContext))
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
	const currentLiquidationReceiverVaultSummaryRequestKey = getCurrentLiquidationReceiverVaultSummaryRequestKey()
	const hasResolvedCurrentLiquidationReceiverVaultSummary = currentLiquidationReceiverVaultSummaryRequestKey !== undefined && liquidationReceiverVaultSummaryResolvedKey.value === currentLiquidationReceiverVaultSummaryRequestKey
	const currentLiquidationApprovalRequestKey = getCurrentLiquidationApprovalRequestKey()
	const loadingCurrentLiquidationApproval = currentLiquidationApprovalRequestKey !== undefined && liquidationApprovalLoadingKey.value === currentLiquidationApprovalRequestKey && liquidationApprovalLoad.isLoading.value
	const loadingCurrentLiquidationReceiverVaultSummary = currentLiquidationReceiverVaultSummaryRequestKey !== undefined && liquidationReceiverVaultSummaryLoadingKey.value === currentLiquidationReceiverVaultSummaryRequestKey && liquidationReceiverVaultSummaryLoad.isLoading.value

	return {
		liquidationDebtEthAmount: liquidationDebtEthAmount.value,
		maximumLiquidationDebtAttoEth: maximumLiquidationDebtAttoEth.value,
		liquidationManagerAddress: liquidationManagerAddress.value,
		liquidationFundingPreview: currentLiquidationFundingPreview,
		liquidationFundingPreviewError: currentLiquidationFundingPreviewError,
		liquidationModalOpen: liquidationModalOpen.value,
		liquidationTargetVault: liquidationTargetVault.value,
		liquidationReceiverVault: liquidationReceiverVault.value,
		liquidationApprovalId: liquidationApprovalId.value,
		liquidationApprovalDetails: liquidationApprovalDetails.value,
		liquidationApprovalError: liquidationApprovalError.value,
		liquidationReceiverVaultSummary: hasResolvedCurrentLiquidationReceiverVaultSummary ? liquidationReceiverVaultSummary.value : undefined,
		liquidationReceiverVaultSummaryError: liquidationReceiverVaultSummaryError.value,
		liquidationReceiverVaultSummaryResolved: hasResolvedCurrentLiquidationReceiverVaultSummary,
		liquidationTimeoutMinutes: liquidationTimeoutMinutes.value,
		checkedSecurityPoolAddress: checkedSecurityPoolAddress.value,
		hasLoadedSecurityPools: securityPoolsLoadedEnvironmentRefreshKey.value === environmentRefreshKey,
		securityPoolsLoadedEnvironmentRefreshKey: securityPoolsLoadedEnvironmentRefreshKey.value,
		hasLoadedSecurityPoolPage: hasLoadedSecurityPoolPage.value,
		liquidationSecurityPoolAddress: liquidationSecurityPoolAddress.value,
		loadingSecurityPoolPage: securityPoolPageLoad.isLoading.value,
		loadingSecurityPools: securityPoolsLoad.isLoading.value,
		loadingLiquidationFundingPreview: loadingCurrentLiquidationFundingPreview,
		loadingLiquidationApproval: loadingCurrentLiquidationApproval,
		loadingLiquidationReceiverVaultSummary: loadingCurrentLiquidationReceiverVaultSummary,
		closeLiquidationModal,
		loadBrowseSecurityPoolPage,
		loadLiquidationFundingPreview,
		loadLiquidationApproval,
		loadLiquidationReceiverVaultSummary,
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
			liquidationDebtEthAmount.value = value
		},
		setLiquidationTimeoutMinutes: (value: string) => {
			liquidationTimeoutMinutes.value = value
		},
		setLiquidationTargetVault: (value: string) => {
			liquidationTargetVault.value = value
		},
		setLiquidationReceiverVault: (value: string) => {
			nextLiquidationReceiverVaultSummaryLoad()
			liquidationReceiverVault.value = value
			liquidationReceiverVaultSummary.value = undefined
			liquidationReceiverVaultSummaryError.value = undefined
			liquidationReceiverVaultSummaryResolvedKey.value = undefined
			liquidationReceiverVaultSummaryLoadingKey.value = undefined
		},
		setLiquidationApprovalId: (value: string) => {
			nextLiquidationApprovalLoad()
			liquidationApprovalId.value = value
			liquidationApprovalDetails.value = undefined
			liquidationApprovalError.value = undefined
			liquidationApprovalLoadingKey.value = undefined
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
