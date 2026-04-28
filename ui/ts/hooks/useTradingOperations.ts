import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import type { Address } from 'viem'
import { createCompleteSetInSecurityPool, loadTradingDetails as loadTradingDetailsForPool, migrateSharesFromUniverse, redeemCompleteSetInSecurityPool, redeemSharesInSecurityPool } from '../contracts.js'
import { useLoadController } from './useLoadController.js'
import { createConnectedReadClient, createWalletWriteClient } from '../lib/clients.js'
import { parseAddressInput, parseReportingOutcomeInput } from '../lib/inputs.js'
import { getDefaultTradingFormState, parseTradingAmountInput } from '../lib/marketForm.js'
import { useRequestGuard } from '../lib/requestGuard.js'
import { buildWriteActionConfig, runWriteAction } from '../lib/writeAction.js'
import type { TradingFormState, WriteOperationsParameters } from '../types/app.js'
import type { TradingActionResult, TradingDetails } from '../types/contracts.js'

type UseTradingOperationsParameters = WriteOperationsParameters

export function useTradingOperations({ accountAddress, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted, refreshState }: UseTradingOperationsParameters) {
	const tradingDetailsLoad = useLoadController()
	const nextTradingDetailsLoad = useRequestGuard()
	const tradingDetails = useSignal<TradingDetails | undefined>(undefined)
	const tradingError = useSignal<string | undefined>(undefined)
	const tradingForm = useSignal<TradingFormState>(getDefaultTradingFormState())
	const tradingResult = useSignal<TradingActionResult | undefined>(undefined)

	const resolveTradingPoolAddressInput = (value: string) => {
		const trimmed = value.trim()
		if (!trimmed.startsWith('0x') || trimmed.length !== 42) return undefined

		try {
			return parseAddressInput(trimmed, 'Security pool address')
		} catch {
			return undefined
		}
	}

	const refreshTradingDetails = async (securityPoolAddressInput: string, walletAddress: Address | undefined, isCurrent?: () => boolean) => {
		const securityPoolAddress = resolveTradingPoolAddressInput(securityPoolAddressInput)
		if (securityPoolAddress === undefined) {
			tradingDetails.value = undefined
			return
		}

		const loadOptions = {
			onStart: () => {
				tradingError.value = undefined
			},
			load: async () => await loadTradingDetailsForPool(createConnectedReadClient(), securityPoolAddress, walletAddress),
			onSuccess: (details: TradingDetails) => {
				tradingDetails.value = details
			},
			onError: () => {
				tradingDetails.value = undefined
				tradingError.value = 'Failed to load trading details.'
			},
		}

		await tradingDetailsLoad.run(isCurrent === undefined ? loadOptions : { ...loadOptions, isCurrent })
	}

	const runTradingAction = async (action: (walletAddress: Address, securityPoolAddress: Address, currentForm: TradingFormState) => Promise<TradingActionResult>, errorFallback: string) => {
		const currentForm = tradingForm.value
		await runWriteAction(
			{
				...buildWriteActionConfig({ accountAddress, onTransaction, onTransactionFinished, onTransactionRequested, refreshState }, tradingError, 'Connect a wallet before trading'),
				refreshErrorFallback: 'Trading transaction succeeded, but refreshing trading details failed',
			},
			async walletAddress => {
				const securityPoolAddress = parseAddressInput(currentForm.securityPoolAddress, 'Security pool address')
				const result = await action(walletAddress, securityPoolAddress, currentForm)
				return result
			},
			errorFallback,
			async (result, walletAddress) => {
				tradingResult.value = result
				await refreshTradingDetails(currentForm.securityPoolAddress, walletAddress)
			},
		)
	}

	const createCompleteSet = async () =>
		await runTradingAction(
			async (walletAddress, securityPoolAddress, currentForm) => await createCompleteSetInSecurityPool(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), securityPoolAddress, parseTradingAmountInput(currentForm.completeSetAmount, 'Complete set amount')),
			'Failed to mint complete sets',
		)

	const redeemCompleteSet = async () =>
		await runTradingAction(async (walletAddress, securityPoolAddress, currentForm) => await redeemCompleteSetInSecurityPool(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), securityPoolAddress, parseTradingAmountInput(currentForm.redeemAmount, 'Redeem amount')), 'Failed to redeem complete sets')

	const redeemShares = async () => await runTradingAction(async (walletAddress, securityPoolAddress) => await redeemSharesInSecurityPool(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), securityPoolAddress), 'Failed to redeem shares')

	const migrateShares = async () =>
		await runTradingAction(async (walletAddress, securityPoolAddress, currentForm) => await migrateSharesFromUniverse(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), securityPoolAddress, parseReportingOutcomeInput(currentForm.selectedOutcome)), 'Failed to migrate shares')

	useEffect(() => {
		const isCurrent = nextTradingDetailsLoad()
		if (resolveTradingPoolAddressInput(tradingForm.value.securityPoolAddress) === undefined) {
			tradingDetails.value = undefined
			tradingError.value = undefined
			return
		}
		void refreshTradingDetails(tradingForm.value.securityPoolAddress, accountAddress, isCurrent)
	}, [accountAddress, tradingForm.value.securityPoolAddress])

	return {
		createCompleteSet,
		loadingTradingDetails: tradingDetailsLoad.isLoading.value,
		migrateShares,
		redeemCompleteSet,
		redeemShares,
		setTradingForm: (updater: (current: TradingFormState) => TradingFormState) => {
			tradingForm.value = updater(tradingForm.value)
		},
		tradingDetails: tradingDetails.value,
		tradingError: tradingError.value,
		tradingForm: tradingForm.value,
		tradingResult: tradingResult.value,
	}
}
