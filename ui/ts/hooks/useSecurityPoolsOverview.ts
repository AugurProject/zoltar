import { useSignal } from '@preact/signals'
import type { Address, Hash } from 'viem'
import { loadAllSecurityPools, queueSecurityPoolLiquidation } from '../contracts.js'
import { useLoadController } from './useLoadController.js'
import { normalizeAddress } from '../lib/address.js'
import { createConnectedReadClient, createWalletWriteClient } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { buildWriteActionConfig, runWriteAction } from '../lib/writeAction.js'
import { parseAddressInput } from '../lib/inputs.js'
import { parseBigIntInput } from '../lib/marketForm.js'
import type { ListedSecurityPool, SecurityPoolOverviewActionResult } from '../types/contracts.js'

type UseSecurityPoolsOverviewParameters = {
	accountAddress: Address | undefined
	onTransaction: (hash: Hash) => void
	onTransactionFinished: () => void
	onTransactionRequested: () => void
	onTransactionSubmitted: (hash: Hash) => void
	refreshState: () => Promise<void>
}

export function useSecurityPoolsOverview({ accountAddress, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted, refreshState }: UseSecurityPoolsOverviewParameters) {
	const liquidationAmount = useSignal('0')
	const liquidationTargetVault = useSignal('')
	const liquidationManagerAddress = useSignal<Address | undefined>(undefined)
	const liquidationSecurityPoolAddress = useSignal<Address | undefined>(undefined)
	const liquidationModalOpen = useSignal(false)
	const securityPoolsLoad = useLoadController()
	const hasLoadedSecurityPools = useSignal(false)
	const checkedSecurityPoolAddress = useSignal<string | undefined>(undefined)
	const securityPoolOverviewError = useSignal<string | undefined>(undefined)
	const securityPoolOverviewResult = useSignal<SecurityPoolOverviewActionResult | undefined>(undefined)
	const securityPools = useSignal<ListedSecurityPool[]>([])

	const loadSecurityPools = async (securityPoolAddress?: string) => {
		const normalizedCheckedAddress = normalizeAddress(securityPoolAddress)
		await securityPoolsLoad.run({
			onStart: () => {
				securityPoolOverviewError.value = undefined
			},
			load: async () => await loadAllSecurityPools(createConnectedReadClient()),
			onSuccess: pools => {
				hasLoadedSecurityPools.value = true
				checkedSecurityPoolAddress.value = normalizedCheckedAddress
				securityPools.value = pools
			},
			onError: error => {
				securityPoolOverviewError.value = getErrorMessage(error, 'Failed to load security pools')
			},
		})
	}

	const openLiquidationModal = (managerAddress: Address, securityPoolAddress: Address, vaultAddress: Address) => {
		liquidationManagerAddress.value = managerAddress
		liquidationSecurityPoolAddress.value = securityPoolAddress
		liquidationTargetVault.value = vaultAddress
		liquidationModalOpen.value = true
	}

	const closeLiquidationModal = () => {
		liquidationModalOpen.value = false
	}

	const queueLiquidation = async (managerAddress: Address, securityPoolAddress: Address) => {
		securityPoolOverviewResult.value = undefined
		await runWriteAction(
			buildWriteActionConfig({ accountAddress, onTransaction, onTransactionFinished, onTransactionRequested, refreshState }, securityPoolOverviewError, 'Connect a wallet before queueing liquidation'),
			async walletAddress => {
				const targetVault = parseAddressInput(liquidationTargetVault.value, 'Target vault')
				const amount = parseBigIntInput(liquidationAmount.value, 'Liquidation amount')
				const hash = await queueSecurityPoolLiquidation(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), managerAddress, targetVault, amount)
				return { hash }
			},
			'Failed to queue liquidation',
			result => {
				securityPoolOverviewResult.value = {
					action: 'queueLiquidation',
					hash: result.hash,
					securityPoolAddress,
				}
			},
		)
	}

	return {
		liquidationAmount: liquidationAmount.value,
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
		securityPoolOverviewError: securityPoolOverviewError.value,
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
