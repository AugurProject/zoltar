import { useSignal } from '@preact/signals'
import type { Address, Hash } from 'viem'
import { loadOracleManagerDetails, requestOraclePrice } from '../contracts.js'
import { useLoadController } from './useLoadController.js'
import { createConnectedReadClient, createWalletWriteClient } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { runWriteAction } from '../lib/writeAction.js'
import type { OpenOracleActionResult, OracleManagerDetails } from '../types/contracts.js'

type UsePriceOracleManagerParameters = {
	accountAddress: Address | undefined
	onTransaction: (hash: Hash) => void
	onTransactionFinished: () => void
	onTransactionRequested: () => void
	onTransactionSubmitted: (hash: Hash) => void
}

export function usePriceOracleManager({ accountAddress, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted }: UsePriceOracleManagerParameters) {
	const poolOracleManagerLoad = useLoadController()
	const poolOracleManagerDetails = useSignal<OracleManagerDetails | undefined>(undefined)
	const poolOracleManagerError = useSignal<string | undefined>(undefined)
	const poolPriceOracleResult = useSignal<OpenOracleActionResult | undefined>(undefined)

	const loadPoolOracleManager = async (managerAddress: Address) => {
		await poolOracleManagerLoad.run({
			onStart: () => {
				poolOracleManagerError.value = undefined
			},
			load: async () => await loadOracleManagerDetails(createConnectedReadClient(), managerAddress),
			onSuccess: details => {
				poolOracleManagerDetails.value = details
			},
			onError: error => {
				poolOracleManagerError.value = getErrorMessage(error, 'Failed to load price oracle details')
			},
		})
	}

	const requestPoolPrice = async (managerAddress: Address) => {
		poolPriceOracleResult.value = undefined
		await runWriteAction(
			{
				accountAddress,
				missingWalletMessage: 'Connect a wallet before requesting a price',
				onTransaction,
				onTransactionFinished,
				onTransactionRequested,
				refreshState: async () => {
					await loadPoolOracleManager(managerAddress)
				},
				setErrorMessage: message => {
					poolOracleManagerError.value = message
				},
			},
			async walletAddress => {
				const details = poolOracleManagerDetails.value ?? (await loadOracleManagerDetails(createConnectedReadClient(), managerAddress))
				return await requestOraclePrice(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), managerAddress, details.requestPriceEthCost)
			},
			'Failed to request price',
			result => {
				poolPriceOracleResult.value = result
			},
		)
	}

	return {
		loadingPoolOracleManager: poolOracleManagerLoad.isLoading.value,
		loadPoolOracleManager,
		poolOracleManagerDetails: poolOracleManagerDetails.value,
		poolOracleManagerError: poolOracleManagerError.value,
		poolPriceOracleResult: poolPriceOracleResult.value,
		requestPoolPrice,
	}
}
