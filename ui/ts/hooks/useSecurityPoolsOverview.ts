import { useSignal } from '@preact/signals'
import type { Address, Hash } from 'viem'
import { loadAllSecurityPools, loadOracleManagerDetails, queueSecurityPoolLiquidation } from '../contracts.js'
import { useLoadController } from './useLoadController.js'
import { normalizeAddress } from '../lib/address.js'
import { createConnectedReadClient, createWalletWriteClient } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '../lib/actionFeedback.js'
import type { ActionFeedback } from '../lib/actionFeedback.js'
import { createLiquidationSuccessPresentation, createLiquidationTransactionIntent, createLiquidationWarningPresentation } from '../lib/transactionPresentations.js'
import { buildWriteActionConfig, runWriteAction } from '../lib/writeAction.js'
import { parseAddressInput } from '../lib/inputs.js'
import { parseRepAmountInput } from '../lib/marketForm.js'
import { getOracleRequestEthGuardMessage } from '../lib/oracleRequestEth.js'
import { useRequestGuard } from '../lib/requestGuard.js'
import type { WriteOperationsParameters } from '../types/app.js'
import type { ListedSecurityPool, SecurityPoolOverviewActionResult } from '../types/contracts.js'

type UseSecurityPoolsOverviewParameters = {
	accountAddress: Address | undefined
	onTransactionFailed?: WriteOperationsParameters['onTransactionFailed']
	onTransactionFinished: () => void
	onTransactionPresented: WriteOperationsParameters['onTransactionPresented']
	onTransactionRequested: WriteOperationsParameters['onTransactionRequested']
	onTransactionSubmitted: (hash: Hash) => void
	refreshState: () => Promise<void>
}

export function useSecurityPoolsOverview({ accountAddress, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionRequested, onTransactionSubmitted, refreshState }: UseSecurityPoolsOverviewParameters) {
	const liquidationAmount = useSignal('0')
	const liquidationMaxAmount = useSignal<bigint | undefined>(undefined)
	const liquidationTargetVault = useSignal('')
	const liquidationManagerAddress = useSignal<Address | undefined>(undefined)
	const liquidationSecurityPoolAddress = useSignal<Address | undefined>(undefined)
	const liquidationModalOpen = useSignal(false)
	const securityPoolsLoad = useLoadController()
	const hasLoadedSecurityPools = useSignal(false)
	const checkedSecurityPoolAddress = useSignal<string | undefined>(undefined)
	const securityPoolOverviewActiveAction = useSignal<SecurityPoolOverviewActionResult['action'] | undefined>(undefined)
	const securityPoolOverviewFeedback = useSignal<ActionFeedback<SecurityPoolOverviewActionResult['action']> | undefined>(undefined)
	const securityPoolOverviewError = useSignal<string | undefined>(undefined)
	const securityPoolOverviewResult = useSignal<SecurityPoolOverviewActionResult | undefined>(undefined)
	const securityPools = useSignal<ListedSecurityPool[]>([])
	const nextSecurityPoolsLoad = useRequestGuard()

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
				const loadOptions = nextCheckedAddress === undefined ? { vaultDetailMode: 'selected' as const } : { selectedSecurityPoolAddress: nextCheckedAddress, vaultDetailMode: 'selected' as const }
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

	const openLiquidationModal = (managerAddress: Address, securityPoolAddress: Address, vaultAddress: Address, maxAmount: bigint | undefined) => {
		securityPoolOverviewError.value = undefined
		securityPoolOverviewFeedback.value = undefined
		securityPoolOverviewResult.value = undefined
		liquidationManagerAddress.value = managerAddress
		liquidationMaxAmount.value = maxAmount
		liquidationSecurityPoolAddress.value = securityPoolAddress
		liquidationTargetVault.value = vaultAddress
		liquidationModalOpen.value = true
	}

	const closeLiquidationModal = () => {
		securityPoolOverviewError.value = undefined
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
		securityPoolOverviewResult.value = undefined
		let completedResult: SecurityPoolOverviewActionResult | undefined
		try {
			securityPoolOverviewActiveAction.value = 'queueLiquidation'
			securityPoolOverviewFeedback.value = createPendingActionFeedback('queueLiquidation', 'Submitting liquidation')
			await runWriteAction(
				{
					...buildWriteActionConfig({ accountAddress, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionRequested, refreshState }, securityPoolOverviewError, 'Connect a wallet before queueing liquidation', createLiquidationTransactionIntent()),
					onRefreshError: (message, hash) => {
						if (completedResult?.stagedExecution?.success === false) return
						securityPoolOverviewFeedback.value =
							completedResult?.stagedExecution?.success === true ? createWarningActionFeedback('queueLiquidation', 'Liquidation executed', message, hash ?? completedResult.hash) : createWarningActionFeedback('queueLiquidation', 'Liquidation submitted', message, hash ?? completedResult?.hash)
						if (completedResult !== undefined) onTransactionPresented(createLiquidationWarningPresentation(completedResult, message))
					},
					onWriteError: message => {
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
					const targetVault = parseAddressInput(liquidationTargetVault.value, 'Target vault')
					const amount = parseRepAmountInput(liquidationAmount.value, 'Liquidation amount')
					return await queueSecurityPoolLiquidation(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), managerAddress, targetVault, amount)
				},
				'Failed to queue liquidation',
				async result => {
					const nextResult: SecurityPoolOverviewActionResult = {
						action: 'queueLiquidation',
						hash: result.hash,
						securityPoolAddress,
						...(result.stagedExecution === undefined ? {} : { stagedExecution: result.stagedExecution }),
					}
					completedResult = nextResult
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
		checkedSecurityPoolAddress: checkedSecurityPoolAddress.value,
		hasLoadedSecurityPools: hasLoadedSecurityPools.value,
		liquidationSecurityPoolAddress: liquidationSecurityPoolAddress.value,
		loadingSecurityPools: securityPoolsLoad.isLoading.value,
		closeLiquidationModal,
		openLiquidationModal,
		queueLiquidation,
		securityPoolOverviewActiveAction: securityPoolOverviewActiveAction.value,
		securityPoolOverviewError: securityPoolOverviewError.value,
		securityPoolOverviewFeedback: securityPoolOverviewFeedback.value,
		securityPoolOverviewResult: securityPoolOverviewResult.value,
		securityPools: securityPools.value,
		setLiquidationAmount: (value: string) => {
			liquidationAmount.value = value
		},
		setLiquidationTargetVault: (value: string) => {
			liquidationTargetVault.value = value
		},
		loadSecurityPools,
	}
}
