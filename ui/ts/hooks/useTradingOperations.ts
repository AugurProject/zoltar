import { useSignal } from '@preact/signals'
import type { Address, Hash } from 'viem'
import { createCompleteSetInSecurityPool, redeemCompleteSetInSecurityPool } from '../contracts.js'
import { createWriteClient, getRequiredInjectedEthereum } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { parseAddressInput } from '../lib/inputs.js'
import { getDefaultTradingFormState, parseBigIntInput } from '../lib/marketForm.js'
import { setSignalValue, updateSignalValue } from '../lib/signals.js'
import type { TradingFormState } from '../types/app.js'
import type { TradingActionResult } from '../types/contracts.js'

type UseTradingOperationsParameters = {
	accountAddress: Address | undefined
	onTransaction: (hash: Hash) => void
	refreshState: () => Promise<void>
}

export function useTradingOperations({ accountAddress, onTransaction, refreshState }: UseTradingOperationsParameters) {
	const tradingError = useSignal<string | undefined>(undefined)
	const tradingForm = useSignal<TradingFormState>(getDefaultTradingFormState())
	const tradingResult = useSignal<TradingActionResult | undefined>(undefined)

	const runTradingAction = async (action: (walletAddress: Address, securityPoolAddress: Address) => Promise<TradingActionResult>, errorFallback: string) => {
		const ethereum = getRequiredInjectedEthereum()
		if (ethereum === undefined) {
			setSignalValue(tradingError, 'No injected wallet found')
			return
		}
		if (accountAddress === undefined) {
			setSignalValue(tradingError, 'Connect a wallet before trading')
			return
		}

		try {
			setSignalValue(tradingError, undefined)
			setSignalValue(tradingResult, undefined)
			const securityPoolAddress = parseAddressInput(tradingForm.value.securityPoolAddress, 'Security pool address')
			const result = await action(accountAddress, securityPoolAddress)
			setSignalValue(tradingResult, result)
			onTransaction(result.hash)
			await refreshState()
		} catch (error) {
			setSignalValue(tradingError, getErrorMessage(error, errorFallback))
		}
	}

	const createCompleteSet = async () => await runTradingAction(async (walletAddress, securityPoolAddress) => await createCompleteSetInSecurityPool(createWriteClient(getRequiredInjectedEthereum(), walletAddress), securityPoolAddress, parseBigIntInput(tradingForm.value.completeSetAmount, 'Complete set amount')), 'Failed to mint complete sets')

	const redeemCompleteSet = async () => await runTradingAction(async (walletAddress, securityPoolAddress) => await redeemCompleteSetInSecurityPool(createWriteClient(getRequiredInjectedEthereum(), walletAddress), securityPoolAddress, parseBigIntInput(tradingForm.value.redeemAmount, 'Redeem amount')), 'Failed to redeem complete sets')

	return {
		createCompleteSet,
		redeemCompleteSet,
		setTradingForm: (updater: (current: TradingFormState) => TradingFormState) => {
			updateSignalValue(tradingForm, updater)
		},
		tradingError: tradingError.value,
		tradingForm: tradingForm.value,
		tradingResult: tradingResult.value,
	}
}
