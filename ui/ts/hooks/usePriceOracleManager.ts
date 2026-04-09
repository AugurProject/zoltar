import { useSignal } from '@preact/signals'
import type { Address, Hash } from 'viem'
import { loadOracleManagerDetails, requestPriceFromManager } from '../contracts.js'
import { createConnectedReadClient, createWalletWriteClient } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import type { OracleManagerDetails, PriceOracleActionResult } from '../types/contracts.js'

type UsePriceOracleManagerParameters = {
	accountAddress: Address | undefined
	onTransaction: (hash: Hash) => void
	onTransactionFinished: () => void
	onTransactionRequested: () => void
	onTransactionSubmitted: (hash: Hash) => void
}

export function usePriceOracleManager({ accountAddress, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted }: UsePriceOracleManagerParameters) {
	const loadingOracleManager = useSignal(false)
	const oracleManagerDetails = useSignal<OracleManagerDetails | undefined>(undefined)
	const oracleManagerError = useSignal<string | undefined>(undefined)
	const priceOracleResult = useSignal<PriceOracleActionResult | undefined>(undefined)
	const requestingPrice = useSignal(false)

	const loadOracleManager = async (managerAddress: Address) => {
		loadingOracleManager.value = true
		oracleManagerError.value = undefined
		try {
			oracleManagerDetails.value = await loadOracleManagerDetails(createConnectedReadClient(), managerAddress)
		} catch (error) {
			oracleManagerError.value = getErrorMessage(error, 'Failed to load price oracle details')
		} finally {
			loadingOracleManager.value = false
		}
	}

	const requestPrice = async (managerAddress: Address) => {
		if (accountAddress === undefined) {
			oracleManagerError.value = 'Connect a wallet before requesting a price'
			return
		}
		const ethCost = oracleManagerDetails.value?.requestPriceEthCost ?? 0n
		try {
			onTransactionRequested()
			oracleManagerError.value = undefined
			priceOracleResult.value = undefined
			const hash = await requestPriceFromManager(createWalletWriteClient(accountAddress, { onTransactionSubmitted }), managerAddress, ethCost)
			priceOracleResult.value = { action: 'requestPrice', hash }
			onTransaction(hash)
			await loadOracleManager(managerAddress)
		} catch (error) {
			oracleManagerError.value = getErrorMessage(error, 'Failed to request price')
		} finally {
			onTransactionFinished()
		}
	}

	return {
		loadingOracleManager: loadingOracleManager.value,
		loadOracleManager,
		oracleManagerDetails: oracleManagerDetails.value,
		oracleManagerError: oracleManagerError.value,
		priceOracleResult: priceOracleResult.value,
		requestingPrice: requestingPrice.value,
		requestPrice,
	}
}
