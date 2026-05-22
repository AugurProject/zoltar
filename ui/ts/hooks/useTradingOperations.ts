import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { Address } from 'viem'
import { createCompleteSetInSecurityPool, loadTradingDetails as loadTradingDetailsForPool, loadZoltarUniverseSummary, migrateSharesFromUniverse, redeemCompleteSetInSecurityPool, redeemSharesInSecurityPool } from '../contracts.js'
import { useLoadController } from './useLoadController.js'
import { createConnectedReadClient, createWalletWriteClient } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { parseAddressInput, parseBigIntListInput, parseReportingOutcomeInput } from '../lib/inputs.js'
import { getDefaultTradingFormState, parseTradingAmountInput } from '../lib/marketForm.js'
import { useRequestGuard } from '../lib/requestGuard.js'
import { getDefaultShareMigrationTargetOutcomeIndexes, isTradingSystemDeployed } from '../lib/trading.js'
import { buildWriteActionConfig, runWriteAction } from '../lib/writeAction.js'
import type { TradingFormState, WriteOperationsParameters } from '../types/app.js'
import type { DeploymentStatus, TradingActionResult, TradingDetails, ZoltarUniverseSummary } from '../types/contracts.js'

type UseTradingOperationsParameters = WriteOperationsParameters & {
	deploymentStatuses: DeploymentStatus[]
	enabled: boolean
}

export function useTradingOperations({ accountAddress, deploymentStatuses, enabled, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted, refreshState }: UseTradingOperationsParameters) {
	const tradingDetailsLoad = useLoadController()
	const nextTradingDetailsLoad = useRequestGuard()
	const tradingDetails = useSignal<TradingDetails | undefined>(undefined)
	const tradingForkUniverse = useSignal<ZoltarUniverseSummary | undefined>(undefined)
	const tradingError = useSignal<string | undefined>(undefined)
	const tradingForm = useSignal<TradingFormState>(getDefaultTradingFormState())
	const tradingActiveAction = useSignal<TradingActionResult['action'] | undefined>(undefined)
	const tradingResult = useSignal<TradingActionResult | undefined>(undefined)
	const targetOutcomeDefaultsKey = useRef<string | undefined>(undefined)
	const tradingSystemDeployed = isTradingSystemDeployed(deploymentStatuses)

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
		if (!tradingSystemDeployed) {
			tradingDetails.value = undefined
			tradingForkUniverse.value = undefined
			tradingError.value = undefined
			return
		}

		const securityPoolAddress = resolveTradingPoolAddressInput(securityPoolAddressInput)
		if (securityPoolAddress === undefined) {
			tradingDetails.value = undefined
			tradingForkUniverse.value = undefined
			return
		}

		const loadOptions = {
			onStart: () => {
				tradingError.value = undefined
			},
			load: async () => {
				const readClient = createConnectedReadClient()
				const details = await loadTradingDetailsForPool(readClient, securityPoolAddress, walletAddress)
				const forkUniverse = await loadZoltarUniverseSummary(readClient, details.universeId)
				return { details, forkUniverse }
			},
			onSuccess: ({ details, forkUniverse }: { details: TradingDetails; forkUniverse: ZoltarUniverseSummary | undefined }) => {
				tradingDetails.value = details
				tradingForkUniverse.value = forkUniverse
			},
			onError: (error: unknown) => {
				tradingDetails.value = undefined
				tradingForkUniverse.value = undefined
				tradingError.value = getErrorMessage(error, 'Failed to load trading details')
			},
		}

		await tradingDetailsLoad.run(isCurrent === undefined ? loadOptions : { ...loadOptions, isCurrent })
	}

	const runTradingAction = async (actionName: TradingActionResult['action'], action: (walletAddress: Address, securityPoolAddress: Address, currentForm: TradingFormState) => Promise<TradingActionResult>, errorFallback: string) => {
		const currentForm = tradingForm.value
		try {
			tradingActiveAction.value = actionName
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
					const isCurrent = nextTradingDetailsLoad()
					await refreshTradingDetails(currentForm.securityPoolAddress, walletAddress, isCurrent)
				},
			)
		} finally {
			tradingActiveAction.value = undefined
		}
	}

	const createCompleteSet = async () =>
		await runTradingAction(
			'createCompleteSet',
			async (walletAddress, securityPoolAddress, currentForm) => await createCompleteSetInSecurityPool(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), securityPoolAddress, parseTradingAmountInput(currentForm.completeSetAmount, 'Complete set amount')),
			'Failed to mint complete sets',
		)

	const redeemCompleteSet = async () =>
		await runTradingAction(
			'redeemCompleteSet',
			async (walletAddress, securityPoolAddress, currentForm) => await redeemCompleteSetInSecurityPool(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), securityPoolAddress, parseTradingAmountInput(currentForm.redeemAmount, 'Redeem amount')),
			'Failed to redeem complete sets',
		)

	const redeemShares = async () => await runTradingAction('redeemShares', async (walletAddress, securityPoolAddress) => await redeemSharesInSecurityPool(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), securityPoolAddress), 'Failed to redeem shares')

	const migrateShares = async () =>
		await runTradingAction(
			'migrateShares',
			async (walletAddress, securityPoolAddress, currentForm) =>
				await migrateSharesFromUniverse(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), securityPoolAddress, parseReportingOutcomeInput(currentForm.selectedShareOutcome), parseBigIntListInput(currentForm.targetOutcomeIndexes, 'Target child universes')),
			'Failed to migrate shares',
		)

	useEffect(() => {
		if (!enabled) return
		nextTradingDetailsLoad()
		targetOutcomeDefaultsKey.current = undefined
		if (tradingForm.value.targetOutcomeIndexes !== '') {
			tradingForm.value = {
				...tradingForm.value,
				targetOutcomeIndexes: '',
			}
		}
		if (resolveTradingPoolAddressInput(tradingForm.value.securityPoolAddress) === undefined) {
			tradingDetails.value = undefined
			tradingForkUniverse.value = undefined
			tradingError.value = undefined
			return
		}
		if (!tradingSystemDeployed) {
			tradingDetails.value = undefined
			tradingForkUniverse.value = undefined
			tradingError.value = undefined
		}
	}, [enabled, tradingForm.value.securityPoolAddress, tradingSystemDeployed])

	useEffect(() => {
		if (!enabled) return
		const isCurrent = nextTradingDetailsLoad()
		if (!tradingSystemDeployed) return
		if (resolveTradingPoolAddressInput(tradingForm.value.securityPoolAddress) === undefined) return
		void refreshTradingDetails(tradingForm.value.securityPoolAddress, accountAddress, isCurrent)
	}, [accountAddress, enabled, tradingForm.value.securityPoolAddress, tradingSystemDeployed])

	useEffect(() => {
		if (!enabled) return
		const securityPoolAddress = resolveTradingPoolAddressInput(tradingForm.value.securityPoolAddress)
		if (securityPoolAddress === undefined || tradingForkUniverse.value === undefined) return

		const defaultsKey = `${securityPoolAddress.toLowerCase()}:${tradingForkUniverse.value.universeId.toString()}:${tradingForkUniverse.value.forkTime.toString()}`
		if (targetOutcomeDefaultsKey.current === defaultsKey) return

		tradingForm.value = {
			...tradingForm.value,
			targetOutcomeIndexes: getDefaultShareMigrationTargetOutcomeIndexes(tradingForkUniverse.value),
		}
		targetOutcomeDefaultsKey.current = defaultsKey
	}, [enabled, tradingForm.value.securityPoolAddress, tradingForkUniverse.value?.forkTime, tradingForkUniverse.value?.universeId])

	return {
		createCompleteSet,
		loadingTradingForkUniverse: tradingDetailsLoad.isLoading.value,
		loadingTradingDetails: tradingDetailsLoad.isLoading.value,
		migrateShares,
		redeemCompleteSet,
		redeemShares,
		setTradingForm: (updater: (current: TradingFormState) => TradingFormState) => {
			tradingForm.value = updater(tradingForm.value)
		},
		tradingDetails: tradingDetails.value,
		tradingActiveAction: tradingActiveAction.value,
		tradingError: tradingError.value,
		tradingForm: tradingForm.value,
		tradingForkUniverse: tradingForkUniverse.value,
		tradingResult: tradingResult.value,
	}
}
