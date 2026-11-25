import { useTradingCollateral } from './useTradingCollateral.js'
import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { loadZoltarUniverseSummary } from '@zoltar/ui-zoltar-shared/protocol/zoltar.js'
import { createCompleteSetInQuestionLedger, loadQuestionLedgerMintCapacity, loadShareMigrationTargets, loadTradingDetails as loadTradingDetailsForPool, migrateSharesFromUniverse, redeemCompleteSetInQuestionLedger, redeemSharesInQuestionLedger } from '../../../protocol/trading.js'
import { useLoadController } from '@zoltar/ui-core-shared/hooks/useLoadController.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { normalizeAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { createConnectedReadClient, createWalletWriteClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { parseAddressInput, parseBigIntListInput, parseReportingOutcomeInput, tryParseAddressInput } from '@zoltar/ui-core-shared/forms/inputs.js'
import { getDefaultTradingFormState } from '../lib/marketForm.js'
import { isActiveAppChain } from '@zoltar/ui-core-shared/wallet/network.js'
import { useRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import {
	estimateMintCheckpoint,
	getDefaultShareMigrationTargetOutcomeIndexes,
	getSelectedOutcomeShareBalance,
	getTradingMigrateSharesGuardMessage,
	getTradingMintGuardMessage,
	getTradingRedeemCompleteSetGuardMessage,
	getTradingRedeemSharesGuardMessage,
	isTradingSystemDeployed,
	parseCompleteSetAmountInput,
} from '../lib/trading.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '@zoltar/ui-core-shared/transactions/actionFeedback.js'
import type { ActionFeedback } from '@zoltar/ui-core-shared/transactions/actionFeedback.js'
import { createTradingSuccessPresentation, createTradingTransactionIntent, createTradingWarningPresentation } from '../../transactionPresentations.js'
import { buildWriteActionConfig, runWriteAction, type WriteActionContext } from '@zoltar/ui-core-shared/transactions/writeAction.js'
import { refreshWalletStateOnly } from '@zoltar/ui-core-shared/lib/refreshState.js'
import type { TradingFormState, WriteOperationsParameters } from '../../../types/app.js'
import type { DeploymentStatus, ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ShareMigrationTargetsState, TradingActionResult, TradingDetails } from '../../../types/contracts.js'
import { useBlockRefresh } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as tradingCopy from '../../../copy/trading.js'
import { withStatoblastRequestTimeout } from '../../../protocol/requestTimeout.js'

type UseTradingOperationsParameters = WriteOperationsParameters & {
	deploymentStatuses: DeploymentStatus[]
	enabled: boolean
	selectedQuestionLedgerAddress?: string
}

export type UseTradingOperationsDependencies = {
	createCompleteSetInQuestionLedger: (accountAddress: Address, callbacks: Parameters<typeof createWalletWriteClient>[1], questionLedgerAddress: Address, amount: bigint) => ReturnType<typeof createCompleteSetInQuestionLedger>
	getWalletEthBalance: (walletAddress: Address) => Promise<bigint>
	loadQuestionLedgerMintCapacity: (questionLedgerAddress: Address) => ReturnType<typeof loadQuestionLedgerMintCapacity>
	loadShareMigrationTargets: (source: Pick<TradingDetails, 'shareTokenAddress' | 'universeId'>, childUniverses: ZoltarUniverseSummary['childUniverses'], accountAddress: Address | undefined) => ReturnType<typeof loadShareMigrationTargets>
	loadTradingDetails: (questionLedgerAddress: Address, accountAddress: Address | undefined) => ReturnType<typeof loadTradingDetailsForPool>
	loadZoltarUniverseSummary: (universeId: bigint) => ReturnType<typeof loadZoltarUniverseSummary>
	migrateSharesFromUniverse: (accountAddress: Address, callbacks: Parameters<typeof createWalletWriteClient>[1], questionLedgerAddress: Address, outcome: Parameters<typeof migrateSharesFromUniverse>[2], targetOutcomeIndexes: bigint[], migratedAttoShares?: bigint) => ReturnType<typeof migrateSharesFromUniverse>
	redeemCompleteSetInQuestionLedger: (accountAddress: Address, callbacks: Parameters<typeof createWalletWriteClient>[1], questionLedgerAddress: Address, amount: bigint) => ReturnType<typeof redeemCompleteSetInQuestionLedger>
	redeemSharesInQuestionLedger: (accountAddress: Address, callbacks: Parameters<typeof createWalletWriteClient>[1], questionLedgerAddress: Address) => ReturnType<typeof redeemSharesInQuestionLedger>
}

const createTradingReadClient = () => withStatoblastRequestTimeout(createConnectedReadClient(), 'Shares refresh timed out.')

const defaultUseTradingOperationsDependencies: UseTradingOperationsDependencies = {
	createCompleteSetInQuestionLedger: async (accountAddress, callbacks, questionLedgerAddress, amount) => await createCompleteSetInQuestionLedger(createWalletWriteClient(accountAddress, callbacks), questionLedgerAddress, amount),
	getWalletEthBalance: async walletAddress => await createTradingReadClient().getBalance({ address: walletAddress }),
	loadQuestionLedgerMintCapacity: async questionLedgerAddress => await loadQuestionLedgerMintCapacity(createTradingReadClient(), questionLedgerAddress),
	loadShareMigrationTargets: async (source, childUniverses, accountAddress) => await loadShareMigrationTargets(createTradingReadClient(), source, childUniverses, accountAddress),
	loadTradingDetails: async (questionLedgerAddress, accountAddress) => await loadTradingDetailsForPool(createTradingReadClient(), questionLedgerAddress, accountAddress),
	loadZoltarUniverseSummary: async universeId => await loadZoltarUniverseSummary(createTradingReadClient(), universeId),
	migrateSharesFromUniverse: async (accountAddress, callbacks, questionLedgerAddress, outcome, targetOutcomeIndexes, migratedAttoShares) => await migrateSharesFromUniverse(createWalletWriteClient(accountAddress, callbacks), questionLedgerAddress, outcome, targetOutcomeIndexes, migratedAttoShares),
	redeemCompleteSetInQuestionLedger: async (accountAddress, callbacks, questionLedgerAddress, amount) => await redeemCompleteSetInQuestionLedger(createWalletWriteClient(accountAddress, callbacks), questionLedgerAddress, amount),
	redeemSharesInQuestionLedger: async (accountAddress, callbacks, questionLedgerAddress) => await redeemSharesInQuestionLedger(createWalletWriteClient(accountAddress, callbacks), questionLedgerAddress),
}

export function useTradingOperations(parameters: UseTradingOperationsParameters, dependencies: UseTradingOperationsDependencies = defaultUseTradingOperationsDependencies) {
	const { accountAddress, deploymentStatuses, enabled, onTransactionCanceled, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState, selectedQuestionLedgerAddress } = parameters
	const tradingDetailsLoad = useLoadController({ timeoutMilliseconds: false })
	const nextTradingDetailsLoad = useRequestGuard()
	const tradingDetails = useSignal<TradingDetails | undefined>(undefined)
	const loadedDetailsScope = useSignal<string>()

	const tradingForkUniverse = useSignal<ZoltarUniverseSummary | undefined>(undefined)
	const tradingError = useSignal<string | undefined>(undefined)
	const tradingForm = useSignal<TradingFormState>(getDefaultTradingFormState())
	const collateralFunding = useTradingCollateral({ ...parameters, pool: selectedQuestionLedgerAddress, amountInput: tradingForm.value.completeSetAmount })
	const tradingActiveAction = useSignal<TradingActionResult['action'] | undefined>(undefined)
	const tradingFeedback = useSignal<ActionFeedback<TradingActionResult['action']> | undefined>(undefined)
	const tradingResult = useSignal<TradingActionResult | undefined>(undefined)
	const targetOutcomeDefaults = useRef<{ fromLoadedTargets: boolean; inputs: string; scope: string; value: string } | undefined>(undefined)
	const tradingSystemDeployed = isTradingSystemDeployed(deploymentStatuses)
	const effectiveTradingPoolAddressInput = selectedQuestionLedgerAddress?.trim() === '' || selectedQuestionLedgerAddress === undefined ? tradingForm.value.questionLedgerAddress : selectedQuestionLedgerAddress
	const currentTradingSelectionKey = normalizeAddress(effectiveTradingPoolAddressInput) ?? ''
	const detailsScope = `${currentTradingSelectionKey}:${accountAddress ?? ''}`
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
	// A failed read only blocks migration; balances and redeem capacity stay usable.
	const loadShareMigrationTargetsState = async (details: TradingDetails, forkUniverse: ZoltarUniverseSummary, walletAddress: Address | undefined): Promise<ShareMigrationTargetsState> => {
		try {
			return await dependencies.loadShareMigrationTargets(details, forkUniverse.childUniverses, walletAddress)
		} catch (error) {
			return { unavailableReason: getErrorMessage(error, tradingCopy.shareMigrationTargetPoolsUnavailable) }
		}
	}
	// A forked universe's details carry its child universes' share-token state, which decides whether a migration would revert.
	const loadTradingState = async (questionLedgerAddress: Address, walletAddress: Address | undefined) => {
		const details = await dependencies.loadTradingDetails(questionLedgerAddress, walletAddress)
		const forkUniverse = await dependencies.loadZoltarUniverseSummary(details.universeId)
		if (forkUniverse?.hasForked !== true) return { details, forkUniverse }
		const shareMigrationTargets = await loadShareMigrationTargetsState(details, forkUniverse, walletAddress)
		return { details: { ...details, shareMigrationTargets }, forkUniverse }
	}
	// Retries an unavailable read on the next block or explicit refresh, without reloading the rest of the details.
	const shareMigrationTargetsRetryPending = useRef(false)
	useBlockRefresh(() => {
		const details = tradingDetails.value
		const forkUniverse = tradingForkUniverse.value
		if (details?.shareMigrationTargets === undefined || !('unavailableReason' in details.shareMigrationTargets) || forkUniverse?.hasForked !== true || shareMigrationTargetsRetryPending.current || tradingDetailsLoad.isLoading.value) return
		shareMigrationTargetsRetryPending.current = true
		void loadShareMigrationTargetsState(details, forkUniverse, accountAddress)
			.then(shareMigrationTargets => {
				if (tradingDetails.value === details) tradingDetails.value = { ...details, shareMigrationTargets }
			})
			.finally(() => {
				shareMigrationTargetsRetryPending.current = false
			})
	}, enabled)

	const refreshTradingDetails = async (questionLedgerAddressInput: string, walletAddress: Address | undefined, isCurrent?: () => boolean, onReadError?: (error: unknown) => void) => {
		if (!tradingSystemDeployed) {
			tradingDetails.value = undefined
			tradingForkUniverse.value = undefined
			tradingError.value = undefined
			return
		}

		const questionLedgerAddress = resolveTradingPoolAddressInput(questionLedgerAddressInput)
		if (questionLedgerAddress === undefined) {
			tradingDetails.value = undefined
			tradingForkUniverse.value = undefined
			return
		}

		const loadOptions = {
			onStart: () => {
				tradingError.value = undefined
			},
			load: async () => await loadTradingState(questionLedgerAddress, walletAddress),
			onSuccess: ({ details, forkUniverse }: { details: TradingDetails; forkUniverse: ZoltarUniverseSummary | undefined }) => {
				loadedDetailsScope.value = detailsScope
				tradingDetails.value = details
				tradingForkUniverse.value = forkUniverse
			},
			onError:
				onReadError ??
				((error: unknown) => {
					tradingError.value = getErrorMessage(error, 'Failed to load trading details.')
				}),
		}

		return await tradingDetailsLoad.run(isCurrent === undefined ? loadOptions : { ...loadOptions, isCurrent })
	}

	// A confirmed write consumes its amount; a value the user typed since submitting stays.
	const clearSubmittedAmount = (actionName: TradingActionResult['action'], submittedForm: TradingFormState) => {
		if (actionName === 'createCompleteSet' && tradingForm.value.completeSetAmount === submittedForm.completeSetAmount) tradingForm.value = { ...tradingForm.value, completeSetAmount: '' }
		if (actionName === 'redeemCompleteSet' && tradingForm.value.redeemAmount === submittedForm.redeemAmount) tradingForm.value = { ...tradingForm.value, redeemAmount: '' }
	}

	const runTradingAction = async (actionName: TradingActionResult['action'], action: (walletAddress: Address, questionLedgerAddress: Address, currentForm: TradingFormState, isCurrentSelection: () => boolean, context: WriteActionContext) => Promise<TradingActionResult | undefined>, errorFallback: string) => {
		const currentForm = tradingForm.value
		const actionSelectionKey = currentTradingSelectionKey
		const transactionContext = {
			questionLedgerAddress: actionSelectionKey === '' ? undefined : actionSelectionKey,
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
						commonCopy.formatConnectWalletBefore('trading'),
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
					refreshErrorFallback: 'Trading transaction succeeded, but refreshing trading details failed.',
					refreshState: async () => {
						await refreshWalletStateOnly(refreshState)
					},
				},
				async (walletAddress, activeWallet) => {
					const questionLedgerAddress = parseAddressInput(resolveEffectiveTradingPoolAddressInput(), commonCopy.questionLedgerAddress)
					const isOnActiveAppChain = isActiveAppChain(activeWallet.chainId)
					const { details: latestTradingDetails, forkUniverse: latestForkUniverse } = await loadTradingState(questionLedgerAddress, walletAddress)
					if (isActionSelectionCurrent()) {
						loadedDetailsScope.value = detailsScope
						tradingDetails.value = latestTradingDetails
						tradingForkUniverse.value = latestForkUniverse
					}
					if (actionName === 'createCompleteSet') {
						if ((parseCollateralAmount(currentForm.completeSetAmount) ?? 0n) <= 0n) throw new Error('Invalid mint amount.')
						const latestMintCapacity = await dependencies.loadQuestionLedgerMintCapacity(questionLedgerAddress)
						const walletBalanceAttoEth = await dependencies.getWalletEthBalance(walletAddress)
						const mintCheckpoint = estimateMintCheckpoint({
							centralSettlement: latestMintCapacity.centralSettlement,
							centralCheckpointTimestamp: latestMintCapacity.centralCheckpointTimestamp,
							linearFee: latestMintCapacity.linearFee,
							currentTimestamp: latestMintCapacity.currentTimestamp,
							feeEndTimestamp: latestMintCapacity.feeEndTimestamp,
							lastFeeCheckpointNativeTime: latestMintCapacity.lastFeeCheckpointNativeTime,
							settlementCollateralAttoEth: latestMintCapacity.settlementCollateralAttoEth,
						})
						const guardMessage = getTradingMintGuardMessage({
							accountAddress: walletAddress,
							collateral: collateralFunding.collateral,
							usesSharedBacking: latestMintCapacity.linearFee !== undefined,
							escalationGameActive: latestMintCapacity.escalationGameActive === true,
							settlementCollateralAttoEth: mintCheckpoint?.settlementCollateralAfterFeesAttoEth ?? latestMintCapacity.settlementCollateralAttoEth,
							ethBalanceAttoEth: walletBalanceAttoEth,
							mintingCapacityAttoEth: latestMintCapacity.mintingCapacityAttoEth,
							hasSelectedPool: true,
							isOnActiveAppChain,
							mintAmountInput: currentForm.completeSetAmount,
							shareTokenSupplyAttoShares: latestMintCapacity.shareTokenSupplyAttoShares,
							totalPoolHeldAttoRep: latestMintCapacity.totalPoolHeldAttoRep,
						})
						if (guardMessage !== undefined) throw new Error(guardMessage)
					}
					if (actionName === 'redeemCompleteSet') {
						if ((parseCollateralAmount(currentForm.redeemAmount) ?? 0n) <= 0n) throw new Error('Invalid redeem amount.')
						const latestMintCapacity = await dependencies.loadQuestionLedgerMintCapacity(questionLedgerAddress)
						const guardMessage = getTradingRedeemCompleteSetGuardMessage({
							accountAddress: walletAddress,
							settlementCollateralAttoEth: latestMintCapacity.settlementCollateralAttoEth,
							hasSelectedPool: true,
							isOnActiveAppChain,
							loadingTradingDetails: false,
							redeemAmountInput: currentForm.redeemAmount,
							shareDecimals: requireCollateralDecimals(),
							shareBalances: latestTradingDetails.shareBalances,
							shareTokenSupplyAttoShares: latestMintCapacity.shareTokenSupplyAttoShares,
						})
						if (guardMessage !== undefined) throw new Error(guardMessage)
					}
					if (actionName === 'migrateShares') {
						const guardMessage = getTradingMigrateSharesGuardMessage({
							accountAddress: walletAddress,
							hasSelectedPool: true,
							isOnActiveAppChain,
							loadingTradingDetails: false,
							loadingTradingForkUniverse: false,
							selectedShareOutcome: currentForm.selectedShareOutcome,
							shareBalances: latestTradingDetails.shareBalances,
							shareMigrationTargets: latestTradingDetails.shareMigrationTargets,
							targetOutcomeIndexesInput: currentForm.targetOutcomeIndexes,
							tradingForkUniverse: latestForkUniverse,
						})
						if (guardMessage !== undefined) throw new Error(guardMessage)
					}
					if (actionName === 'redeemShares') {
						const guardMessage = getTradingRedeemSharesGuardMessage({ accountAddress: walletAddress, hasSelectedPool: true, isOnActiveAppChain })
						if (guardMessage !== undefined) throw new Error(guardMessage)
					}
					if (!isActionSelectionCurrent()) return undefined
					activeWallet.assertActive()
					const result = await action(walletAddress, questionLedgerAddress, currentForm, isActionSelectionCurrent, activeWallet)
					return result
				},
				errorFallback,
				async (result, walletAddress) => {
					tradingResult.value = result
					clearSubmittedAmount(actionName, currentForm)
					tradingFeedback.value = createSuccessActionFeedback(actionName, getSuccessTitle(actionName), result.hash)
					onTransactionPresented(createTradingSuccessPresentation(result))
					if (!isActionSelectionCurrent()) return
					const isCurrent = nextTradingDetailsLoad()
					await refreshTradingDetails(result.questionLedgerAddress, walletAddress, () => isCurrent() && isActionSelectionCurrent())
				},
			)
		} finally {
			tradingActiveAction.value = undefined
		}
	}

	function requireCollateralDecimals() {
		const collateral = collateralFunding.collateral
		if (collateral === undefined) throw new Error('Collateral metadata is not loaded. Wait for funding details and try again.')
		return collateral.decimals
	}

	function parseCollateralAmount(input: string) {
		return parseCompleteSetAmountInput(input, requireCollateralDecimals())
	}

	const createCompleteSet = async () =>
		await runTradingAction(
			'createCompleteSet',
			async (walletAddress, questionLedgerAddress, currentForm, isCurrentSelection, context) => {
				if (!isCurrentSelection()) return undefined
				return await dependencies.createCompleteSetInQuestionLedger(walletAddress, { onTransactionPrepared, onTransactionSubmitted, reviewSignal: context.reviewSignal }, questionLedgerAddress, parseCollateralAmount(currentForm.completeSetAmount) ?? 0n)
			},
			'Failed to mint complete sets.',
		)

	const redeemCompleteSet = async () =>
		await runTradingAction(
			'redeemCompleteSet',
			async (walletAddress, questionLedgerAddress, currentForm, isCurrentSelection, context) => {
				if (!isCurrentSelection()) return undefined
				const redeemAmountAttoShares = parseCollateralAmount(currentForm.redeemAmount) ?? 0n
				return await dependencies.redeemCompleteSetInQuestionLedger(walletAddress, { onTransactionPrepared, onTransactionSubmitted, reviewSignal: context.reviewSignal }, questionLedgerAddress, redeemAmountAttoShares)
			},
			'Failed to redeem complete sets.',
		)

	const redeemShares = async () =>
		await runTradingAction(
			'redeemShares',
			async (walletAddress, questionLedgerAddress, _currentForm, isCurrentSelection, context) => {
				if (!isCurrentSelection()) return undefined
				return await dependencies.redeemSharesInQuestionLedger(walletAddress, { onTransactionPrepared, onTransactionSubmitted, reviewSignal: context.reviewSignal }, questionLedgerAddress)
			},
			'Failed to redeem shares.',
		)

	const migrateShares = async () =>
		await runTradingAction(
			'migrateShares',
			async (walletAddress, questionLedgerAddress, currentForm, isCurrentSelection, context) => {
				if (!isCurrentSelection()) return undefined
				const shareOutcome = parseReportingOutcomeInput(currentForm.selectedShareOutcome)
				return await dependencies.migrateSharesFromUniverse(
					walletAddress,
					{ onTransactionPrepared, onTransactionSubmitted, reviewSignal: context.reviewSignal },
					questionLedgerAddress,
					shareOutcome,
					parseBigIntListInput(currentForm.targetOutcomeIndexes, 'Target child universes'),
					getSelectedOutcomeShareBalance(tradingDetails.value?.shareBalances, shareOutcome),
				)
			},
			'Failed to migrate shares.',
		)

	useEffect(() => {
		nextTradingDetailsLoad()
		if (!enabled) return
		targetOutcomeDefaults.current = undefined
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
	}, [enabled, selectedQuestionLedgerAddress, tradingForm.value.questionLedgerAddress, tradingSystemDeployed])

	useEffect(() => {
		if (!enabled) return
		const isCurrent = nextTradingDetailsLoad()
		if (!tradingSystemDeployed) return
		const effectiveQuestionLedgerAddressInput = resolveEffectiveTradingPoolAddressInput()
		if (resolveTradingPoolAddressInput(effectiveQuestionLedgerAddressInput) === undefined) return
		void refreshTradingDetails(effectiveQuestionLedgerAddressInput, accountAddress, isCurrent)
	}, [accountAddress, enabled, selectedQuestionLedgerAddress, tradingForm.value.questionLedgerAddress, tradingSystemDeployed])

	const targetOutcomeDefaultsScope = (() => {
		const questionLedgerAddress = resolveTradingPoolAddressInput(resolveEffectiveTradingPoolAddressInput())
		if (!enabled || questionLedgerAddress === undefined || tradingForkUniverse.value === undefined) return undefined
		return `${questionLedgerAddress.toLowerCase()}:${tradingForkUniverse.value.universeId.toString()}:${tradingForkUniverse.value.forkTime.toString()}`
	})()
	const shareMigrationTargets = tradingDetails.value?.shareMigrationTargets
	const shareMigrationTargetsLoaded = shareMigrationTargets !== undefined && !('unavailableReason' in shareMigrationTargets)
	const selectedShareOutcome = tradingForm.value.selectedShareOutcome
	// Everything the default depends on within one scope: the selected outcome, the wallet's balance of it, and what each child already holds.
	const targetOutcomeDefaultsInputs = (() => {
		const selectedBalance = getSelectedOutcomeShareBalance(tradingDetails.value?.shareBalances, selectedShareOutcome)
		const targets =
			shareMigrationTargets === undefined || 'unavailableReason' in shareMigrationTargets
				? 'no-targets'
				: shareMigrationTargets.map(target => `${target.outcomeIndex.toString()}:${target.canonicalPool ?? 'no-pool'}:${getSelectedOutcomeShareBalance(target.migratedAttoShares, selectedShareOutcome)?.toString() ?? ''}`).join(',')
		return `${selectedShareOutcome}:${selectedBalance?.toString() ?? 'no-balance'}:${targets}`
	})()
	// A new scope always takes its default. Within a scope the default follows its inputs only while the selection is still the
	// last default (the user has not edited it), and a selection computed from loaded targets survives a later failed read.
	useEffect(() => {
		if (targetOutcomeDefaultsScope === undefined) return
		const previous = targetOutcomeDefaults.current
		if (previous !== undefined && previous.scope === targetOutcomeDefaultsScope) {
			if (previous.inputs === targetOutcomeDefaultsInputs) return
			if (!shareMigrationTargetsLoaded && previous.fromLoadedTargets) return
			if (tradingForm.value.targetOutcomeIndexes !== previous.value) return
		}
		const value = getDefaultShareMigrationTargetOutcomeIndexes({
			selectedShareOutcome: tradingForm.value.selectedShareOutcome,
			shareBalances: tradingDetails.value?.shareBalances,
			shareMigrationTargets: tradingDetails.value?.shareMigrationTargets,
			tradingForkUniverse: tradingForkUniverse.value,
		})
		if (tradingForm.value.targetOutcomeIndexes !== value) tradingForm.value = { ...tradingForm.value, targetOutcomeIndexes: value }
		targetOutcomeDefaults.current = { fromLoadedTargets: shareMigrationTargetsLoaded, inputs: targetOutcomeDefaultsInputs, scope: targetOutcomeDefaultsScope, value }
	}, [enabled, selectedQuestionLedgerAddress, targetOutcomeDefaultsInputs, targetOutcomeDefaultsScope, tradingForm.value.questionLedgerAddress])

	return {
		collateralFunding,
		createCompleteSet,
		loadingTradingForkUniverse: tradingDetailsLoad.isLoading.value,
		loadingTradingDetails: tradingDetailsLoad.isLoading.value,
		migrateShares,
		redeemCompleteSet,
		redeemShares,
		refreshShares: (onReadError: (error: unknown) => void) => refreshTradingDetails(resolveEffectiveTradingPoolAddressInput(), accountAddress, nextTradingDetailsLoad(), onReadError),
		setTradingForm: (updater: (current: TradingFormState) => TradingFormState) => {
			tradingForm.value = updater(tradingForm.value)
		},
		tradingDetails: loadedDetailsScope.value === detailsScope ? tradingDetails.value : undefined,
		tradingActiveAction: tradingActiveAction.value,
		tradingError: tradingError.value,
		tradingFeedback: tradingFeedback.value,
		tradingForm: tradingForm.value,
		tradingForkUniverse: tradingForkUniverse.value,
		tradingResult: tradingResult.value,
	}
}
