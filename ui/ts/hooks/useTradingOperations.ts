import { useState } from 'preact/hooks'
import type { Address, Hash } from 'viem'
import { createCompleteSetInSecurityPool, redeemCompleteSetInSecurityPool } from '../contracts.js'
import { getInjectedEthereum } from '../injectedEthereum.js'
import { createWriteClient } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { parseAddressInput } from '../lib/inputs.js'
import { getDefaultTradingFormState, parseBigIntInput } from '../lib/marketForm.js'
import type { TradingFormState } from '../types/app.js'
import type { TradingActionResult } from '../types/contracts.js'

type UseTradingOperationsParameters = {
	accountAddress: Address | null
	onTransaction: (hash: Hash) => void
	refreshState: () => Promise<void>
}

export function useTradingOperations({ accountAddress, onTransaction, refreshState }: UseTradingOperationsParameters) {
	const [tradingError, setTradingError] = useState<string | null>(null)
	const [tradingForm, setTradingForm] = useState<TradingFormState>(() => getDefaultTradingFormState())
	const [tradingResult, setTradingResult] = useState<TradingActionResult | null>(null)

	const runTradingAction = async (action: (walletAddress: Address, securityPoolAddress: Address) => Promise<TradingActionResult>, errorFallback: string) => {
		const ethereum = getInjectedEthereum()
		if (ethereum === undefined) {
			setTradingError('No injected wallet found')
			return
		}
		if (accountAddress === null) {
			setTradingError('Connect a wallet before trading')
			return
		}

		try {
			setTradingError(null)
			setTradingResult(null)
			const securityPoolAddress = parseAddressInput(tradingForm.securityPoolAddress, 'Security pool address')
			const result = await action(accountAddress, securityPoolAddress)
			setTradingResult(result)
			onTransaction(result.hash)
			await refreshState()
		} catch (error) {
			setTradingError(getErrorMessage(error, errorFallback))
		}
	}

	const createCompleteSet = async () => await runTradingAction(async (walletAddress, securityPoolAddress) => await createCompleteSetInSecurityPool(createWriteClient(getInjectedEthereum() as NonNullable<ReturnType<typeof getInjectedEthereum>>, walletAddress), securityPoolAddress, parseBigIntInput(tradingForm.completeSetAmount, 'Complete set amount')), 'Failed to mint complete sets')

	const redeemCompleteSet = async () => await runTradingAction(async (walletAddress, securityPoolAddress) => await redeemCompleteSetInSecurityPool(createWriteClient(getInjectedEthereum() as NonNullable<ReturnType<typeof getInjectedEthereum>>, walletAddress), securityPoolAddress, parseBigIntInput(tradingForm.redeemAmount, 'Redeem amount')), 'Failed to redeem complete sets')

	return {
		createCompleteSet,
		redeemCompleteSet,
		setTradingForm,
		tradingError,
		tradingForm,
		tradingResult,
	}
}
