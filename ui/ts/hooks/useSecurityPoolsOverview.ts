import { useSignal } from '@preact/signals'
import type { Address, Hash } from 'viem'
import { loadAllSecurityPools, loadOracleManagerDetails, loadSecurityPoolPage, queueSecurityPoolLiquidation } from '../contracts.js'
import { useLoadController } from './useLoadController.js'
import { normalizeAddress } from '../lib/address.js'
import { createConnectedReadClient, createWalletWriteClient } from '../lib/clients.js'
import { getActiveBackend } from '../lib/activeEnvironment.js'
import { getErrorDetail, getErrorMessage } from '../lib/errors.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '../lib/actionFeedback.js'
import type { ActionFeedback } from '../lib/actionFeedback.js'
import { createLiquidationSuccessPresentation, createLiquidationTransactionIntent, createLiquidationWarningPresentation } from '../lib/transactionPresentations.js'
import { buildWriteActionConfig, runWriteAction } from '../lib/writeAction.js'
import { parseAddressInput } from '../lib/inputs.js'
import { parseBigIntInput, parseRepAmountInput } from '../lib/marketForm.js'
import { getOracleRequestEthGuardMessage } from '../lib/oracleRequestEth.js'
import { useRequestGuard } from '../lib/requestGuard.js'
import { DEFAULT_STAGED_OPERATION_TIMEOUT_MINUTES, getStagedOperationTimeoutSeconds, MAX_STAGED_OPERATION_TIMEOUT_MINUTES, MIN_STAGED_OPERATION_TIMEOUT_MINUTES } from '../lib/securityVault.js'
import type { WriteOperationsParameters } from '../types/app.js'
import type { ListedSecurityPool, SecurityPoolOverviewActionResult, SecurityPoolPage } from '../types/contracts.js'

type UseSecurityPoolsOverviewParameters = {
	accountAddress: Address | undefined
	onTransactionCanceled?: WriteOperationsParameters['onTransactionCanceled']
	onTransactionFailed?: WriteOperationsParameters['onTransactionFailed']
	onTransactionFinished: () => void
	onTransactionPresented: WriteOperationsParameters['onTransactionPresented']
	onTransactionPrepared?: WriteOperationsParameters['onTransactionPrepared']
	onTransactionRequested: WriteOperationsParameters['onTransactionRequested']
	onTransactionSubmitted: (hash: Hash) => void
	refreshState: () => Promise<void>
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

export function useSecurityPoolsOverview({ accountAddress, onTransactionCanceled, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState }: UseSecurityPoolsOverviewParameters) {
	const liquidationAmount = useSignal('0')
	const liquidationMaxAmount = useSignal<bigint | undefined>(undefined)
	const liquidationTargetVault = useSignal('')
	const liquidationTimeoutMinutes = useSignal(DEFAULT_STAGED_OPERATION_TIMEOUT_MINUTES.toString())
	const liquidationManagerAddress = useSignal<Address | undefined>(undefined)
	const liquidationSecurityPoolAddress = useSignal<Address | undefined>(undefined)
	const liquidationModalOpen = useSignal(false)
	const securityPoolBrowseCount = useSignal<bigint | undefined>(undefined)
	const securityPoolPage = useSignal<SecurityPoolPage | undefined>(undefined)
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
				await waitForSecurityPoolReadBackend()
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
				return await loadAllSecurityPools(createConnectedReadClient(), loadOptions)
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

	const loadBrowseSecurityPoolPage = async (pageIndex: number, pageSize: number) => {
		const isCurrent = nextSecurityPoolPageLoad()
		await securityPoolPageLoad.run({
			isCurrent,
			onStart: () => {
				if (!isCurrent()) return
				securityPoolOverviewError.value = undefined
			},
			load: async () => {
				await waitForSecurityPoolReadBackend()
				const readClient = createConnectedReadClient()
				try {
					return await loadSecurityPoolPage(readClient, pageIndex, pageSize, accountAddress)
				} catch (error) {
					if (!shouldFallbackToAllSecurityPoolsPage(error)) throw error
					if (hasLoadedSecurityPools.value) return createSecurityPoolPageFromLoadedPools(securityPools.value, pageIndex, pageSize)
					const pools = await loadAllSecurityPools(readClient, {
						...(accountAddress === undefined ? {} : { accountAddress }),
						vaultDetailMode: 'selected',
					})
					return createSecurityPoolPageFromLoadedPools(pools, pageIndex, pageSize)
				}
			},
			onSuccess: page => {
				hasLoadedSecurityPoolPage.value = true
				securityPoolBrowseCount.value = page.poolCount
				securityPoolPage.value = page
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
		if (result.stagedExecution?.success === false) return createErrorActionFeedback('queueLiquidation', 'Liquidation failed', result.stagedExecution.errorMessage ?? 'The liquidation execution failed.')
		if (result.stagedExecution?.success === true) return createSuccessActionFeedback('queueLiquidation', 'Liquidation executed', result.hash, 'Execution completed immediately.')
		return getLiquidationSubmittedFeedback(result.hash)
	}

	const queueLiquidation = async (managerAddress: Address, securityPoolAddress: Address) => {
		securityPoolLiquidationError.value = undefined
		securityPoolOverviewResult.value = undefined
		const submittedLiquidationTargetVault = liquidationTargetVault.value
		const submittedLiquidationAmount = liquidationAmount.value
		const submittedLiquidationTimeoutMinutes = liquidationTimeoutMinutes.value
		const isCurrentLiquidationSubmission = () => liquidationManagerAddress.value === managerAddress && liquidationSecurityPoolAddress.value === securityPoolAddress && liquidationTargetVault.value === submittedLiquidationTargetVault
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
						if (isCurrentLiquidationSubmission()) {
							liquidationModalOpen.value = true
							securityPoolLiquidationError.value = message
						}
						securityPoolOverviewFeedback.value = createErrorActionFeedback('queueLiquidation', 'Liquidation failed', message)
					},
				},
				async walletAddress => {
					const managerDetails = await loadOracleManagerDetails(createConnectedReadClient(), managerAddress)
					const walletEthBalance = await createConnectedReadClient().getBalance({ address: walletAddress })
					const liquidationGuardMessage = getOracleRequestEthGuardMessage({
						actionLabel: 'queue this liquidation',
						requestPriceEthCost: managerDetails.requestPriceEthCost,
						walletEthBalance,
					})
					if (liquidationGuardMessage !== undefined) throw new Error(liquidationGuardMessage)
					const targetVault = parseAddressInput(submittedLiquidationTargetVault, 'Target vault')
					const amount = parseRepAmountInput(submittedLiquidationAmount, 'Liquidation amount')
					const timeoutMinutes = parseBigIntInput(submittedLiquidationTimeoutMinutes, 'Liquidation timeout')
					if (timeoutMinutes < MIN_STAGED_OPERATION_TIMEOUT_MINUTES) throw new Error('Liquidation timeout must be at least 1 minute')
					if (timeoutMinutes > MAX_STAGED_OPERATION_TIMEOUT_MINUTES) throw new Error('Liquidation timeout must be 5 minutes or less')
					const validForSeconds = getStagedOperationTimeoutSeconds(timeoutMinutes)
					if (validForSeconds === undefined) throw new Error('Liquidation timeout must be at least 1 minute')
					return await queueSecurityPoolLiquidation(createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), managerAddress, targetVault, amount, validForSeconds)
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
					onTransactionPresented(createLiquidationSuccessPresentation(nextResult))
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
