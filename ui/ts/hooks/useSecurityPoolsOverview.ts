import { useState } from 'preact/hooks'
import type { Address, Hash } from 'viem'
import { loadAllSecurityPools, loadOracleManagerDetails, queueSecurityPoolLiquidation } from '../contracts.js'
import { getInjectedEthereum } from '../injectedEthereum.js'
import { createReadClient, createWriteClient } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { parseAddressInput } from '../lib/inputs.js'
import { parseBigIntInput } from '../lib/marketForm.js'
import type { ListedSecurityPool, SecurityPoolOverviewActionResult } from '../types/contracts.js'

type UseSecurityPoolsOverviewParameters = {
	accountAddress: Address | undefined
	onTransaction: (hash: Hash) => void
	refreshState: () => Promise<void>
}

export function useSecurityPoolsOverview({ accountAddress, onTransaction, refreshState }: UseSecurityPoolsOverviewParameters) {
	const [liquidationAmount, setLiquidationAmount] = useState('0')
	const [liquidationTargetVault, setLiquidationTargetVault] = useState('')
	const [loadingSecurityPools, setLoadingSecurityPools] = useState(false)
	const [securityPoolOverviewError, setSecurityPoolOverviewError] = useState<string | undefined>(undefined)
	const [securityPoolOverviewResult, setSecurityPoolOverviewResult] = useState<SecurityPoolOverviewActionResult | undefined>(undefined)
	const [securityPools, setSecurityPools] = useState<ListedSecurityPool[]>([])

	const loadSecurityPools = async () => {
		setLoadingSecurityPools(true)
		setSecurityPoolOverviewError(undefined)
		try {
			setSecurityPools(await loadAllSecurityPools(createReadClient()))
		} catch (error) {
			setSecurityPoolOverviewError(getErrorMessage(error, 'Failed to load security pools'))
		} finally {
			setLoadingSecurityPools(false)
		}
	}

	const queueLiquidation = async (managerAddress: Address, securityPoolAddress: Address) => {
		const ethereum = getInjectedEthereum()
		if (ethereum === undefined) {
			setSecurityPoolOverviewError('No injected wallet found')
			return
		}
		if (accountAddress === undefined) {
			setSecurityPoolOverviewError('Connect a wallet before queueing liquidation')
			return
		}

		try {
			setSecurityPoolOverviewError(undefined)
			setSecurityPoolOverviewResult(undefined)
			const targetVault = parseAddressInput(liquidationTargetVault, 'Target vault')
			const amount = parseBigIntInput(liquidationAmount, 'Liquidation amount')
			const oracleDetails = await loadOracleManagerDetails(createReadClient(), managerAddress)
			const hash = await queueSecurityPoolLiquidation(createWriteClient(ethereum, accountAddress), managerAddress, targetVault, amount, oracleDetails.requestPriceEthCost)
			setSecurityPoolOverviewResult({
				action: 'queueLiquidation',
				hash,
				securityPoolAddress,
			})
			onTransaction(hash)
			await refreshState()
		} catch (error) {
			setSecurityPoolOverviewError(getErrorMessage(error, 'Failed to queue liquidation'))
		}
	}

	return {
		liquidationAmount,
		liquidationTargetVault,
		loadingSecurityPools,
		queueLiquidation,
		securityPoolOverviewError,
		securityPoolOverviewResult,
		securityPools,
		setLiquidationAmount,
		setLiquidationTargetVault,
		loadSecurityPools,
	}
}
