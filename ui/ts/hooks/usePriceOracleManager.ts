import { useSignal } from '@preact/signals'
import type { Address, Hash } from 'viem'
import { loadOracleManagerDetails, requestOraclePrice } from '../contracts.js'
import { createConnectedReadClient, createWalletWriteClient } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import type { OpenOracleActionResult, OracleManagerDetails } from '../types/contracts.js'

type UsePriceOracleManagerParameters = {
	accountAddress: Address | undefined
	onTransaction: (hash: Hash) => void
	onTransactionFinished: () => void
	onTransactionRequested: () => void
	onTransactionSubmitted: (hash: Hash) => void
}

export function usePriceOracleManager({ accountAddress, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted }: UsePriceOracleManagerParameters) {
	const loadingPoolOracleManager = useSignal(false)
	const poolOracleManagerDetails = useSignal<OracleManagerDetails | undefined>(undefined)
	const poolOracleManagerError = useSignal<string | undefined>(undefined)
	const poolPriceOracleResult = useSignal<OpenOracleActionResult | undefined>(undefined)

	const loadPoolOracleManager = async (managerAddress: Address) => {
		loadingPoolOracleManager.value = true
		poolOracleManagerError.value = undefined
		try {
			poolOracleManagerDetails.value = await loadOracleManagerDetails(createConnectedReadClient(), managerAddress)
		} catch (error) {
			poolOracleManagerError.value = getErrorMessage(error, 'Failed to load price oracle details')
		} finally {
			loadingPoolOracleManager.value = false
		}
	}

	const requestPoolPrice = async (managerAddress: Address) => {
		if (accountAddress === undefined) {
			poolOracleManagerError.value = 'Connect a wallet before requesting a price'
			return
		}
		const ethCost = poolOracleManagerDetails.value?.requestPriceEthCost ?? 0n
		try {
			onTransactionRequested()
			poolOracleManagerError.value = undefined
			poolPriceOracleResult.value = undefined
			const result = await requestOraclePrice(createWalletWriteClient(accountAddress, { onTransactionSubmitted }), managerAddress, ethCost)
			poolPriceOracleResult.value = result
			onTransaction(result.hash)
			await loadPoolOracleManager(managerAddress)
		} catch (error) {
			poolOracleManagerError.value = getErrorMessage(error, 'Failed to request price')
		} finally {
			onTransactionFinished()
		}
	}

	return {
		loadingPoolOracleManager: loadingPoolOracleManager.value,
		loadPoolOracleManager,
		poolOracleManagerDetails: poolOracleManagerDetails.value,
		poolOracleManagerError: poolOracleManagerError.value,
		poolPriceOracleResult: poolPriceOracleResult.value,
		requestPoolPrice,
	}
}
