import { useSignal } from '@preact/signals'
import type { Address, Hash } from 'viem'
import { loadAllSecurityPools, loadOracleManagerDetails, queueSecurityPoolLiquidation } from '../contracts.js'
import { getInjectedEthereum } from '../injectedEthereum.js'
import { createReadClient, createWalletWriteClient } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
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
	const loadingSecurityPools = useSignal(false)
	const securityPoolOverviewError = useSignal<string | undefined>(undefined)
	const securityPoolOverviewResult = useSignal<SecurityPoolOverviewActionResult | undefined>(undefined)
	const securityPools = useSignal<ListedSecurityPool[]>([])

	const loadSecurityPools = async () => {
		loadingSecurityPools.value = true
		securityPoolOverviewError.value = undefined
		try {
			securityPools.value = await loadAllSecurityPools(createReadClient())
		} catch (error) {
			securityPoolOverviewError.value = getErrorMessage(error, 'Failed to load security pools')
		} finally {
			loadingSecurityPools.value = false
		}
	}

	const queueLiquidation = async (managerAddress: Address, securityPoolAddress: Address) => {
		const ethereum = getInjectedEthereum()
		if (ethereum === undefined) {
			securityPoolOverviewError.value = 'No injected wallet found'
			return
		}
		if (accountAddress === undefined) {
			securityPoolOverviewError.value = 'Connect a wallet before queueing liquidation'
			return
		}

		try {
			onTransactionRequested()
			securityPoolOverviewError.value = undefined
			securityPoolOverviewResult.value = undefined
			const targetVault = parseAddressInput(liquidationTargetVault.value, 'Target vault')
			const amount = parseBigIntInput(liquidationAmount.value, 'Liquidation amount')
			const oracleDetails = await loadOracleManagerDetails(createReadClient(), managerAddress)
			const hash = await queueSecurityPoolLiquidation(createWalletWriteClient(accountAddress, { onTransactionSubmitted }), managerAddress, targetVault, amount, oracleDetails.requestPriceEthCost)
			securityPoolOverviewResult.value = {
				action: 'queueLiquidation',
				hash,
				securityPoolAddress,
			}
			onTransaction(hash)
		} catch (error) {
			securityPoolOverviewError.value = getErrorMessage(error, 'Failed to queue liquidation')
		} finally {
			onTransactionFinished()
		}

		try {
			await refreshState()
		} catch (error) {
			securityPoolOverviewError.value = getErrorMessage(error, 'Queued liquidation but failed to refresh state')
		}
	}

	return {
		liquidationAmount: liquidationAmount.value,
		liquidationTargetVault: liquidationTargetVault.value,
		loadingSecurityPools: loadingSecurityPools.value,
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
