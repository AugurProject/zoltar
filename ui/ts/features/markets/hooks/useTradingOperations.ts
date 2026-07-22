import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { Address } from '@zoltar/shared/ethereum'
import { createCompleteSetInSecurityPool, loadSecurityPoolMintCapacity, loadTradingDetails as loadTradingDetailsForPool, loadZoltarUniverseSummary, migrateSharesFromUniverse, redeemCompleteSetInSecurityPool, redeemSharesInSecurityPool } from '../../../protocol/index.js'
import { useLoadController } from '../../../hooks/useLoadController.js'
import { assertNever } from '../../../lib/assert.js'
import { normalizeAddress } from '../../../lib/address.js'
import { createConnectedReadClient, createWalletWriteClient } from '../../../lib/clients.js'
import { getErrorMessage } from '../../../lib/errors.js'
import { parseAddressInput, parseBigIntListInput, parseReportingOutcomeInput, tryParseAddressInput } from '../../../lib/inputs.js'
import { getDefaultTradingFormState, parseTradingAmountInput } from '../lib/marketForm.js'
import { isMainnetChain } from '../../../lib/network.js'
import { useRequestGuard } from '../../../lib/requestGuard.js'
import { convertCollateralAmountToShareAmount, getDefaultShareMigrationTargetOutcomeIndexes, getTradingMigrateSharesGuardMessage, getTradingMintGuardMessage, getTradingRedeemCompleteSetGuardMessage, getTradingRedeemSharesGuardMessage, isTradingSystemDeployed } from '../lib/trading.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '../../../lib/actionFeedback.js'
import type { ActionFeedback } from '../../../lib/actionFeedback.js'
import { createTradingSuccessPresentation, createTradingTransactionIntent, createTradingWarningPresentation } from '../../transactionPresentations.js'
import { buildWriteActionConfig, runWriteAction } from '../../../lib/writeAction.js'
import { refreshWalletStateOnly } from '../../../lib/refreshState.js'
import type { TradingFormState, WriteOperationsParameters } from '../../../types/app.js'
import type { DeploymentStatus, TradingActionResult, TradingDetails, ZoltarUniverseSummary } from '../../../types/contracts.js'

type UseTradingOperationsParameters = WriteOperationsParameters & {
	deploymentStatuses: DeploymentStatus[]
	enabled: boolean
	selectedSecurityPoolAddress?: string
}

export type UseTradingOperationsDependencies = {
	createCompleteSetInSecurityPool: (accountAddress: Address, callbacks: Parameters<typeof createWalletWriteClient>[1], securityPoolAddress: Address, amount: bigint) => ReturnType<typeof createCompleteSetInSecurityPool>
	getWalletEthBalance: (walletAddress: Address) => Promise<bigint>
	loadSecurityPoolMintCapacity: (securityPoolAddress: Address) => ReturnType<typeof loadSecurityPoolMintCapacity>
	loadTradingDetails: (securityPoolAddress: Address, accountAddress: Address | undefined) => ReturnType<typeof loadTradingDetailsForPool>
	loadZoltarUniverseSummary: (universeId: bigint) => ReturnType<typeof loadZoltarUniverseSummary>
	migrateSharesFromUniverse: (accountAddress: Address, callbacks: Parameters<typeof createWalletWriteClient>[1], securityPoolAddress: Address, outcome: Parameters<typeof migrateSharesFromUniverse>[2], targetOutcomeIndexes: bigint[]) => ReturnType<typeof migrateSharesFromUniverse>
	redeemCompleteSetInSecurityPool: (accountAddress: Address, callbacks: Parameters<typeof createWalletWriteClient>[1], securityPoolAddress: Address, amount: bigint) => ReturnType<typeof redeemCompleteSetInSecurityPool>
	redeemSharesInSecurityPool: (accountAddress: Address, callbacks: Parameters<typeof createWalletWriteClient>[1], securityPoolAddress: Address) => ReturnType<typeof redeemSharesInSecurityPool>
}

const defaultUseTradingOperationsDependencies: UseTradingOperationsDependencies = {
	createCompleteSetInSecurityPool: async (accountAddress, callbacks, securityPoolAddress, amount) => await createCompleteSetInSecurityPool(createWalletWriteClient(accountAddress, callbacks), securityPoolAddress, amount),
	getWalletEthBalance: async walletAddress => await createConnectedReadClient().getBalance({ address: walletAddress }),
	loadSecurityPoolMintCapacity: async securityPoolAddress => await loadSecurityPoolMintCapacity(createConnectedReadClient(), securityPoolAddress),
	loadTradingDetails: async (securityPoolAddress, accountAddress) => await loadTradingDetailsForPool(createConnectedReadClient(), securityPoolAddress, accountAddress),
	loadZoltarUniverseSummary: async universeId => await loadZoltarUniverseSummary(createConnectedReadClient(), universeId),
	migrateSharesFromUniverse: async (accountAddress, callbacks, securityPoolAddress, outcome, targetOutcomeIndexes) => await migrateSharesFromUniverse(createWalletWriteClient(accountAddress, callbacks), securityPoolAddress, outcome, targetOutcomeIndexes),
	redeemCompleteSetInSecurityPool: async (accountAddress, callbacks, securityPoolAddress, amount) => await redeemCompleteSetInSecurityPool(createWalletWriteClient(accountAddress, callbacks), securityPoolAddress, amount),
	redeemSharesInSecurityPool: async (accountAddress, callbacks, securityPoolAddress) => await redeemSharesInSecurityPool(createWalletWriteClient(accountAddress, callbacks), securityPoolAddress),
}

export function useTradingOperations(
	{ accountAddress, deploymentStatuses, enabled, onTransactionCanceled, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState, selectedSecurityPoolAddress }: UseTradingOperationsParameters,
	dependencies: UseTradingOperationsDependencies = defaultUseTradingOperationsDependencies,
) {
	const tradingDetailsLoad = useLoadController()
	const nextTradingDetailsLoad = useRequestGuard()
	const tradingDetails = useSignal<TradingDetails | undefined>(undefined)
	const tradingForkUniverse = useSignal<ZoltarUniverseSummary | undefined>(undefined)
	const tradingError = useSignal<string | undefined>(undefined)
	const tradingForm = useSignal<TradingFormState>(getDefaultTradingFormState())
	const tradingActiveAction = useSignal<TradingActionResult['action'] | undefined>(undefined)
	const tradingFeedback = useSignal<ActionFeedback<TradingActionResult['action']> | undefined>(undefined)
	const tradingResult = useSignal<TradingActionResult | undefined>(undefined)
	const targetOutcomeDefaultsKey = useRef<string | undefined>(undefined)
	const tradingSystemDeployed = isTradingSystemDeployed(deploymentStatuses)
	const effectiveTradingPoolAddressInput = selectedSecurityPoolAddress?.trim() === '' || selectedSecurityPoolAddress === undefined ? tradingForm.value.securityPoolAddress : selectedSecurityPoolAddress
	const currentTradingSelectionKey = normalizeAddress(effectiveTradingPoolAddressInput) ?? ''
	const currentTradingSelectionKeyRef = useRef(currentTradingSelectionKey)
	currentTradingSelectionKeyRef.current = currentTradingSelectionKey
	const getPendingTitle = (actionName: TradingActionResult['action']) => {
		switch (actionName) {
			case 'createCompleteSet':
				return 'Minting complete sets'
			case 'redeemCompleteSet':
				return 'Redeeming complete sets'
			case 'migrateShares':
				return 'Migrating shares'
			case 'redeemShares':
				return 'Redeeming shares'
			default:
				return assertNever(actionName)
		}
	}
	const getSuccessTitle = (actionName: TradingActionResult['action']) => {
		switch (actionName) {
			case 'createCompleteSet':
				return 'Complete sets minted'
			case 'redeemCompleteSet':
				return 'Complete sets redeemed'
			case 'migrateShares':
				return 'Shares migrated'
			case 'redeemShares':
				return 'Shares redeemed'
			default:
				return assertNever(actionName)
		}
	}
	const getFailureTitle = (actionName: TradingActionResult['action']) => {
		switch (actionName) {
			case 'createCompleteSet':
				return 'Mint failed'
			case 'redeemCompleteSet':
				return 'Complete-set redemption failed'
			case 'migrateShares':
				return 'Share migration failed'
			case 'redeemShares':
				return 'Share redemption failed'
			default:
				return assertNever(actionName)
		}
	}

	const resolveTradingPoolAddressInput = (value: string) => {
		const trimmed = value.trim()
		if (!trimmed.startsWith('0x') || trimmed.length !== 42) return undefined
		return tryParseAddressInput(trimmed)
	}
	const resolveEffectiveTradingPoolAddressInput = () => effectiveTradingPoolAddressInput
	const isTradingSelectionCurrent = (selectionKey: string) => currentTradingSelectionKeyRef.current === selectionKey

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
				const details = await dependencies.loadTradingDetails(securityPoolAddress, walletAddress)
				const forkUniverse = await dependencies.loadZoltarUniverseSummary(details.universeId)
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

	const runTradingAction = async (actionName: TradingActionResult['action'], action: (walletAddress: Address, securityPoolAddress: Address, currentForm: TradingFormState, isCurrentSelection: () => boolean) => Promise<TradingActionResult | undefined>, errorFallback: string) => {
		const currentForm = tradingForm.value
		const actionSelectionKey = currentTradingSelectionKey
		const transactionContext = {
			securityPoolAddress: actionSelectionKey === '' ? undefined : actionSelectionKey,
			shareOutcome: actionName === 'migrateShares' ? currentForm.selectedShareOutcome : undefined,
			universeId: tradingDetails.value?.universeId,
		}
		const isActionSelectionCurrent = () => isTradingSelectionCurrent(actionSelectionKey)
		try {
			tradingActiveAction.value = actionName
			tradingFeedback.value = createPendingActionFeedback(actionName, getPendingTitle(actionName))
			await runWriteAction(
				{
					...buildWriteActionConfig(
						{ accountAddress, onTransactionCanceled, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, refreshState },
						tradingError,
						'Connect a wallet before trading',
						createTradingTransactionIntent(actionName, transactionContext),
					),
					onRefreshError: (message, hash) => {
						tradingFeedback.value = createWarningActionFeedback(actionName, getSuccessTitle(actionName), message, hash)
						const result = tradingResult.value
						if (result !== undefined) onTransactionPresented(createTradingWarningPresentation(result, message))
					},
					onWriteCanceled: () => {
						tradingFeedback.value = undefined
					},
					onWriteError: message => {
						tradingFeedback.value = createErrorActionFeedback(actionName, getFailureTitle(actionName), message)
					},
					refreshErrorFallback: 'Trading transaction succeeded, but refreshing trading details failed',
					refreshState: async () => {
						await refreshWalletStateOnly(refreshState)
					},
				},
				async (walletAddress, activeWallet) => {
					const securityPoolAddress = parseAddressInput(resolveEffectiveTradingPoolAddressInput(), 'Security pool address')
					const isMainnet = isMainnetChain(activeWallet.chainId)
					const latestTradingDetails = await dependencies.loadTradingDetails(securityPoolAddress, walletAddress)
					const latestForkUniverse = await dependencies.loadZoltarUniverseSummary(latestTradingDetails.universeId)
					if (isActionSelectionCurrent()) {
						tradingDetails.value = latestTradingDetails
						tradingForkUniverse.value = latestForkUniverse
					}
					if (actionName === 'createCompleteSet') {
						const latestMintCapacity = await dependencies.loadSecurityPoolMintCapacity(securityPoolAddress)
						const walletEthBalance = await dependencies.getWalletEthBalance(walletAddress)
						const guardMessage = getTradingMintGuardMessage({
							accountAddress: walletAddress,
							completeSetCollateralAmount: latestMintCapacity.completeSetCollateralAmount,
							ethBalance: walletEthBalance,
							hasSelectedPool: true,
							isMainnet,
							mintAmountInput: currentForm.completeSetAmount,
							shareTokenSupply: latestMintCapacity.shareTokenSupply,
							totalRepDeposit: latestMintCapacity.totalRepDeposit,
							totalSecurityBondAllowance: latestMintCapacity.totalSecurityBondAllowance,
						})
						if (guardMessage !== undefined) throw new Error(guardMessage)
					}
					if (actionName === 'redeemCompleteSet') {
						const latestMintCapacity = await dependencies.loadSecurityPoolMintCapacity(securityPoolAddress)
						const guardMessage = getTradingRedeemCompleteSetGuardMessage({
							accountAddress: walletAddress,
							completeSetCollateralAmount: latestMintCapacity.completeSetCollateralAmount,
							hasSelectedPool: true,
							isMainnet,
							loadingTradingDetails: false,
							redeemAmountInput: currentForm.redeemAmount,
							shareBalances: latestTradingDetails.shareBalances,
							shareTokenSupply: latestMintCapacity.shareTokenSupply,
						})
						if (guardMessage !== undefined) throw new Error(guardMessage)
					}
					if (actionName === 'migrateShares') {
						const guardMessage = getTradingMigrateSharesGuardMessage({
							accountAddress: walletAddress,
							hasSelectedPool: true,
							isMainnet,
							loadingTradingDetails: false,
							loadingTradingForkUniverse: false,
							selectedShareOutcome: currentForm.selectedShareOutcome,
							shareBalances: latestTradingDetails.shareBalances,
							targetOutcomeIndexesInput: currentForm.targetOutcomeIndexes,
							tradingForkUniverse: latestForkUniverse,
						})
						if (guardMessage !== undefined) throw new Error(guardMessage)
					}
					if (actionName === 'redeemShares') {
						const guardMessage = getTradingRedeemSharesGuardMessage({ accountAddress: walletAddress, hasSelectedPool: true, isMainnet })
						if (guardMessage !== undefined) throw new Error(guardMessage)
					}
					if (!isActionSelectionCurrent()) return undefined
					const result = await action(walletAddress, securityPoolAddress, currentForm, isActionSelectionCurrent)
					return result
				},
				errorFallback,
				async (result, walletAddress) => {
					tradingResult.value = result
					tradingFeedback.value = createSuccessActionFeedback(actionName, getSuccessTitle(actionName), result.hash)
					onTransactionPresented(createTradingSuccessPresentation(result))
					if (!isActionSelectionCurrent()) return
					const isCurrent = nextTradingDetailsLoad()
					await refreshTradingDetails(result.securityPoolAddress, walletAddress, () => isCurrent() && isActionSelectionCurrent())
				},
			)
		} finally {
			tradingActiveAction.value = undefined
		}
	}

	const createCompleteSet = async () =>
		await runTradingAction(
			'createCompleteSet',
			async (walletAddress, securityPoolAddress, currentForm, isCurrentSelection) => {
				if (!isCurrentSelection()) return undefined
				return await dependencies.createCompleteSetInSecurityPool(walletAddress, { onTransactionPrepared, onTransactionSubmitted }, securityPoolAddress, parseTradingAmountInput(currentForm.completeSetAmount, 'Complete set amount'))
			},
			'Failed to mint complete sets',
		)

	const redeemCompleteSet = async () =>
		await runTradingAction(
			'redeemCompleteSet',
			async (walletAddress, securityPoolAddress, currentForm, isCurrentSelection) => {
				const latestMintCapacity = await dependencies.loadSecurityPoolMintCapacity(securityPoolAddress)
				if (!isCurrentSelection()) return undefined
				const redeemCollateralAmount = parseTradingAmountInput(currentForm.redeemAmount, 'Redeem amount')
				const redeemShareAmount = convertCollateralAmountToShareAmount(redeemCollateralAmount, latestMintCapacity.completeSetCollateralAmount, latestMintCapacity.shareTokenSupply)
				if (redeemShareAmount === undefined) throw new Error('Redeeming is unavailable because this pool has complete-set shares but no collateral.')
				return await dependencies.redeemCompleteSetInSecurityPool(walletAddress, { onTransactionPrepared, onTransactionSubmitted }, securityPoolAddress, redeemShareAmount)
			},
			'Failed to redeem complete sets',
		)

	const redeemShares = async () =>
		await runTradingAction(
			'redeemShares',
			async (walletAddress, securityPoolAddress, _currentForm, isCurrentSelection) => {
				if (!isCurrentSelection()) return undefined
				return await dependencies.redeemSharesInSecurityPool(walletAddress, { onTransactionPrepared, onTransactionSubmitted }, securityPoolAddress)
			},
			'Failed to redeem shares',
		)

	const migrateShares = async () =>
		await runTradingAction(
			'migrateShares',
			async (walletAddress, securityPoolAddress, currentForm, isCurrentSelection) => {
				if (!isCurrentSelection()) return undefined
				return await dependencies.migrateSharesFromUniverse(walletAddress, { onTransactionPrepared, onTransactionSubmitted }, securityPoolAddress, parseReportingOutcomeInput(currentForm.selectedShareOutcome), parseBigIntListInput(currentForm.targetOutcomeIndexes, 'Target child universes'))
			},
			'Failed to migrate shares',
		)

	useEffect(() => {
		if (!enabled) return
		nextTradingDetailsLoad()
		targetOutcomeDefaultsKey.current = undefined
		if (tradingForm.value.targetOutcomeIndexes !== '')
			tradingForm.value = {
				...tradingForm.value,
				targetOutcomeIndexes: '',
			}
		if (resolveTradingPoolAddressInput(resolveEffectiveTradingPoolAddressInput()) === undefined) {
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
	}, [enabled, selectedSecurityPoolAddress, tradingForm.value.securityPoolAddress, tradingSystemDeployed])

	useEffect(() => {
		if (!enabled) return
		const isCurrent = nextTradingDetailsLoad()
		if (!tradingSystemDeployed) return
		const effectiveSecurityPoolAddressInput = resolveEffectiveTradingPoolAddressInput()
		if (resolveTradingPoolAddressInput(effectiveSecurityPoolAddressInput) === undefined) return
		void refreshTradingDetails(effectiveSecurityPoolAddressInput, accountAddress, isCurrent)
	}, [accountAddress, enabled, selectedSecurityPoolAddress, tradingForm.value.securityPoolAddress, tradingSystemDeployed])

	useEffect(() => {
		if (!enabled) return
		const securityPoolAddress = resolveTradingPoolAddressInput(resolveEffectiveTradingPoolAddressInput())
		if (securityPoolAddress === undefined || tradingForkUniverse.value === undefined) return

		const defaultsKey = `${securityPoolAddress.toLowerCase()}:${tradingForkUniverse.value.universeId.toString()}:${tradingForkUniverse.value.forkTime.toString()}`
		if (targetOutcomeDefaultsKey.current === defaultsKey) return

		tradingForm.value = {
			...tradingForm.value,
			targetOutcomeIndexes: getDefaultShareMigrationTargetOutcomeIndexes(tradingForkUniverse.value),
		}
		targetOutcomeDefaultsKey.current = defaultsKey
	}, [enabled, selectedSecurityPoolAddress, tradingForm.value.securityPoolAddress, tradingForkUniverse.value?.forkTime, tradingForkUniverse.value?.universeId])

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
		tradingFeedback: tradingFeedback.value,
		tradingForm: tradingForm.value,
		tradingForkUniverse: tradingForkUniverse.value,
		tradingResult: tradingResult.value,
	}
}
