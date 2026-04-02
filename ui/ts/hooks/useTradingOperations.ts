import { useSignal } from '@preact/signals'
import type { Address, Hash } from 'viem'
import { createCompleteSetInSecurityPool, migrateSharesFromUniverse, redeemCompleteSetInSecurityPool, redeemSharesInSecurityPool } from '../contracts.js'
import { createWalletWriteClient } from '../lib/clients.js'
import { parseAddressInput, parseReportingOutcomeInput } from '../lib/inputs.js'
import { getDefaultTradingFormState, parseBigIntInput } from '../lib/marketForm.js'
import { runWriteAction } from '../lib/writeAction.js'
import type { TradingFormState } from '../types/app.js'
import type { TradingActionResult } from '../types/contracts.js'

type UseTradingOperationsParameters = {
	accountAddress: Address | undefined
	onTransaction: (hash: Hash) => void
	onTransactionFinished: () => void
	onTransactionRequested: () => void
	onTransactionSubmitted: (hash: Hash) => void
	refreshState: () => Promise<void>
}

export function useTradingOperations({ accountAddress, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted, refreshState }: UseTradingOperationsParameters) {
	const tradingError = useSignal<string | undefined>(undefined)
	const tradingForm = useSignal<TradingFormState>(getDefaultTradingFormState())
	const tradingResult = useSignal<TradingActionResult | undefined>(undefined)
	const runTradingAction = async (action: (walletAddress: Address, securityPoolAddress: Address) => Promise<TradingActionResult>, errorFallback: string) =>
		await runWriteAction(
			{
				accountAddress,
				missingWalletMessage: 'Connect a wallet before trading',
				onTransaction,
				onTransactionFinished,
				onTransactionRequested,
				refreshState,
				setErrorMessage: message => {
					tradingError.value = message
				},
			},
			async walletAddress => {
				const securityPoolAddress = parseAddressInput(tradingForm.value.securityPoolAddress, 'Security pool address')
				const result = await action(walletAddress, securityPoolAddress)
				return result
			},
			errorFallback,
			result => {
				tradingResult.value = result
			},
		)

	const createCompleteSet = async () =>
		await runTradingAction(async (walletAddress, securityPoolAddress) => await createCompleteSetInSecurityPool(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), securityPoolAddress, parseBigIntInput(tradingForm.value.completeSetAmount, 'Complete set amount')), 'Failed to mint complete sets')

	const redeemCompleteSet = async () =>
		await runTradingAction(async (walletAddress, securityPoolAddress) => await redeemCompleteSetInSecurityPool(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), securityPoolAddress, parseBigIntInput(tradingForm.value.redeemAmount, 'Redeem amount')), 'Failed to redeem complete sets')

	const redeemShares = async () => await runTradingAction(async (walletAddress, securityPoolAddress) => await redeemSharesInSecurityPool(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), securityPoolAddress), 'Failed to redeem shares')

	const migrateShares = async () =>
		await runTradingAction(
			async (walletAddress, securityPoolAddress) => await migrateSharesFromUniverse(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), securityPoolAddress, parseBigIntInput(tradingForm.value.fromUniverseId, 'From universe ID'), parseReportingOutcomeInput(tradingForm.value.selectedOutcome)),
			'Failed to migrate shares',
		)

	return {
		createCompleteSet,
		migrateShares,
		redeemCompleteSet,
		redeemShares,
		setTradingForm: (updater: (current: TradingFormState) => TradingFormState) => {
			tradingForm.value = updater(tradingForm.value)
		},
		tradingError: tradingError.value,
		tradingForm: tradingForm.value,
		tradingResult: tradingResult.value,
	}
}
