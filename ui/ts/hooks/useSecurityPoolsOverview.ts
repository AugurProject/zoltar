import { useSignal } from '@preact/signals'
import type { Address, Hash } from 'viem'
import { loadAllSecurityPools, loadOracleManagerDetails, queueSecurityPoolLiquidation } from '../contracts.js'
import { getInjectedEthereum } from '../injectedEthereum.js'
import { createReadClient, createWriteClient } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { parseAddressInput } from '../lib/inputs.js'
import { parseBigIntInput } from '../lib/marketForm.js'
import { setSignalValue } from '../lib/signals.js'
import type { ListedSecurityPool, SecurityPoolOverviewActionResult } from '../types/contracts.js'

type UseSecurityPoolsOverviewParameters = {
	accountAddress: Address | undefined
	onTransaction: (hash: Hash) => void
	refreshState: () => Promise<void>
}

export function useSecurityPoolsOverview({ accountAddress, onTransaction, refreshState }: UseSecurityPoolsOverviewParameters) {
	const liquidationAmount = useSignal('0')
	const liquidationTargetVault = useSignal('')
	const loadingSecurityPools = useSignal(false)
	const securityPoolOverviewError = useSignal<string | undefined>(undefined)
	const securityPoolOverviewResult = useSignal<SecurityPoolOverviewActionResult | undefined>(undefined)
	const securityPools = useSignal<ListedSecurityPool[]>([])

	const loadSecurityPools = async () => {
		setSignalValue(loadingSecurityPools, true)
		setSignalValue(securityPoolOverviewError, undefined)
		try {
			setSignalValue(securityPools, await loadAllSecurityPools(createReadClient()))
		} catch (error) {
			setSignalValue(securityPoolOverviewError, getErrorMessage(error, 'Failed to load security pools'))
		} finally {
			setSignalValue(loadingSecurityPools, false)
		}
	}

	const queueLiquidation = async (managerAddress: Address, securityPoolAddress: Address) => {
		const ethereum = getInjectedEthereum()
		if (ethereum === undefined) {
			setSignalValue(securityPoolOverviewError, 'No injected wallet found')
			return
		}
		if (accountAddress === undefined) {
			setSignalValue(securityPoolOverviewError, 'Connect a wallet before queueing liquidation')
			return
		}

		try {
			setSignalValue(securityPoolOverviewError, undefined)
			setSignalValue(securityPoolOverviewResult, undefined)
			const targetVault = parseAddressInput(liquidationTargetVault.value, 'Target vault')
			const amount = parseBigIntInput(liquidationAmount.value, 'Liquidation amount')
			const oracleDetails = await loadOracleManagerDetails(createReadClient(), managerAddress)
			const hash = await queueSecurityPoolLiquidation(createWriteClient(ethereum, accountAddress), managerAddress, targetVault, amount, oracleDetails.requestPriceEthCost)
			setSignalValue(securityPoolOverviewResult, {
				action: 'queueLiquidation',
				hash,
				securityPoolAddress,
			})
			onTransaction(hash)
			await refreshState()
		} catch (error) {
			setSignalValue(securityPoolOverviewError, getErrorMessage(error, 'Failed to queue liquidation'))
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
			setSignalValue(liquidationAmount, value)
		},
		setLiquidationTargetVault: (value: string) => {
			setSignalValue(liquidationTargetVault, value)
		},
		loadSecurityPools,
	}
}
