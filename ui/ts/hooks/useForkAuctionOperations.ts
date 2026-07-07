import { useSignal } from '@preact/signals'
import { useRef } from 'preact/hooks'
import { useFormState } from './useFormState.js'
import { useLoadController } from './useLoadController.js'
import type { Address } from '@zoltar/shared/ethereum'
import {
	createChildUniverseFromSecurityPool,
	buildForkCarriedEscalationProofs,
	finalizeSecurityPoolTruthAuction,
	forkUniverseDirectly,
	forkZoltarWithOwnEscalation,
	initiateSecurityPoolFork,
	loadForkAuctionDetails,
	migrateEscalationDeposits,
	migrateVaultWithUnresolvedEscalation,
	migrateRepToZoltarFromSecurityPool,
	migrateSecurityVault,
	refundTruthAuctionBid,
	settleTruthAuctionBids,
	startTruthAuctionForSecurityPool,
	submitTruthAuctionBid,
	withdrawForkedEscalationDeposits,
} from '../contracts.js'
import { createConnectedReadClient, createWalletWriteClient } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { getTruthAuctionBidGuardMessage, getTruthAuctionBidPriceValidationMessage, getTruthAuctionTickAtPrice } from '../lib/truthAuctionBook.js'
import { getReportingOutcomeKey, parseAddressInput, parseBigIntListInput, parseReportingOutcomeInput, parseReportingOutcomeListInput, resolveOptionalAddressInput } from '../lib/inputs.js'
import { normalizeAddress } from '../lib/address.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '../lib/actionFeedback.js'
import type { ActionFeedback } from '../lib/actionFeedback.js'
import { requireDefined } from '../lib/required.js'
import { createForkAuctionSuccessPresentation, createForkAuctionTransactionIntent, createForkAuctionWarningPresentation } from '../lib/transactionPresentations.js'
import { buildWriteActionConfig, runWriteAction } from '../lib/writeAction.js'
import { useRequestGuard } from '../lib/requestGuard.js'
import { getDefaultForkAuctionFormState, parseBigIntInput, parseTruthAuctionAmountInput, parseTruthAuctionPriceInput } from '../lib/marketForm.js'
import { refreshWalletStateOnly } from '../lib/refreshState.js'
import type { ForkAuctionFormState, WriteOperationsParameters } from '../types/app.js'
import type { ForkAuctionActionResult, ForkAuctionDetails, ReportingOutcomeKey, TruthAuctionSettlementMode } from '../types/contracts.js'
import type { SettlementSelectedBid } from '../types/components.js'

type UseForkAuctionOperationsParameters = WriteOperationsParameters & {
	selectedSecurityPoolAddress?: string
}

type ForkAuctionReadClient = {
	getBalance: (parameters: { address: Address }) => Promise<bigint>
}

type ForkAuctionProductionWriteClient = ReturnType<typeof createWalletWriteClient>

type ForkCarriedEscalationProofs = Awaited<ReturnType<typeof buildForkCarriedEscalationProofs>>

export type UseForkAuctionOperationsDependencies<TWriteClient = ForkAuctionProductionWriteClient> = {
	buildForkCarriedEscalationProofs: (securityPoolAddress: Address, outcome: ReportingOutcomeKey, parentDepositIndexes: readonly bigint[]) => Promise<ForkCarriedEscalationProofs>
	createChildUniverseFromSecurityPool: (client: TWriteClient, securityPoolAddress: Address, universeId: bigint, outcome: ReportingOutcomeKey) => Promise<ForkAuctionActionResult>
	createConnectedReadClient: () => ForkAuctionReadClient
	createWalletWriteClient: (walletAddress: Address, callbacks: Parameters<typeof createWalletWriteClient>[1]) => TWriteClient
	finalizeSecurityPoolTruthAuction: (client: TWriteClient, securityPoolAddress: Address, universeId: bigint) => Promise<ForkAuctionActionResult>
	forkUniverseDirectly: (client: TWriteClient, universeId: bigint, questionId: bigint, securityPoolAddress: Address) => Promise<ForkAuctionActionResult>
	forkZoltarWithOwnEscalation: (client: TWriteClient, securityPoolAddress: Address, universeId: bigint) => Promise<ForkAuctionActionResult>
	initiateSecurityPoolFork: (client: TWriteClient, securityPoolAddress: Address, universeId: bigint) => Promise<ForkAuctionActionResult>
	loadForkAuctionDetails: (securityPoolAddress: Address) => Promise<ForkAuctionDetails>
	migrateEscalationDeposits: (client: TWriteClient, securityPoolAddress: Address, universeId: bigint, vaultAddress: Address, outcome: ReportingOutcomeKey, depositIndexes: bigint[]) => Promise<ForkAuctionActionResult>
	migrateRepToZoltarFromSecurityPool: (client: TWriteClient, securityPoolAddress: Address, universeId: bigint, outcomes: ReportingOutcomeKey[]) => Promise<ForkAuctionActionResult>
	migrateSecurityVault: (client: TWriteClient, securityPoolAddress: Address, universeId: bigint, outcome: ReportingOutcomeKey) => Promise<ForkAuctionActionResult>
	migrateVaultWithUnresolvedEscalation: (client: TWriteClient, securityPoolAddress: Address, vaultAddress: Address, universeId: bigint, outcome: ReportingOutcomeKey) => Promise<ForkAuctionActionResult>
	refundTruthAuctionBid: (client: TWriteClient, securityPoolAddress: Address, universeId: bigint, truthAuctionAddress: Address, tick: bigint, bidIndex: bigint, selectedBids?: readonly SettlementSelectedBid[]) => Promise<ForkAuctionActionResult>
	settleTruthAuctionBids: (client: TWriteClient, securityPoolAddress: Address, universeId: bigint, vaultAddress: Address, claimTickIndices: readonly SettlementSelectedBid[], refundTickIndices: readonly SettlementSelectedBid[]) => Promise<ForkAuctionActionResult>
	startTruthAuctionForSecurityPool: (client: TWriteClient, securityPoolAddress: Address, universeId: bigint) => Promise<ForkAuctionActionResult>
	submitTruthAuctionBid: (client: TWriteClient, securityPoolAddress: Address, universeId: bigint, truthAuctionAddress: Address, tick: bigint, amount: bigint) => Promise<ForkAuctionActionResult>
	withdrawForkedEscalationDeposits: (client: TWriteClient, securityPoolAddress: Address, outcome: ReportingOutcomeKey, proofs: ForkCarriedEscalationProofs) => Promise<ForkAuctionActionResult>
}

const defaultUseForkAuctionOperationsDependencies: UseForkAuctionOperationsDependencies = {
	buildForkCarriedEscalationProofs: async (securityPoolAddress, outcome, parentDepositIndexes) => await buildForkCarriedEscalationProofs(createConnectedReadClient(), securityPoolAddress, outcome, parentDepositIndexes),
	createChildUniverseFromSecurityPool: async (client, securityPoolAddress, universeId, outcome) => await createChildUniverseFromSecurityPool(client, securityPoolAddress, universeId, outcome),
	createConnectedReadClient: () => createConnectedReadClient(),
	createWalletWriteClient: (walletAddress, callbacks) => createWalletWriteClient(walletAddress, callbacks),
	finalizeSecurityPoolTruthAuction: async (client, securityPoolAddress, universeId) => await finalizeSecurityPoolTruthAuction(client, securityPoolAddress, universeId),
	forkUniverseDirectly: async (client, universeId, questionId, securityPoolAddress) => await forkUniverseDirectly(client, universeId, questionId, securityPoolAddress),
	forkZoltarWithOwnEscalation: async (client, securityPoolAddress, universeId) => await forkZoltarWithOwnEscalation(client, securityPoolAddress, universeId),
	initiateSecurityPoolFork: async (client, securityPoolAddress, universeId) => await initiateSecurityPoolFork(client, securityPoolAddress, universeId),
	loadForkAuctionDetails: async securityPoolAddress => await loadForkAuctionDetails(createConnectedReadClient(), securityPoolAddress),
	migrateEscalationDeposits: async (client, securityPoolAddress, universeId, vaultAddress, outcome, depositIndexes) => await migrateEscalationDeposits(client, securityPoolAddress, universeId, vaultAddress, outcome, depositIndexes),
	migrateRepToZoltarFromSecurityPool: async (client, securityPoolAddress, universeId, outcomes) => await migrateRepToZoltarFromSecurityPool(client, securityPoolAddress, universeId, outcomes),
	migrateSecurityVault: async (client, securityPoolAddress, universeId, outcome) => await migrateSecurityVault(client, securityPoolAddress, universeId, outcome),
	migrateVaultWithUnresolvedEscalation: async (client, securityPoolAddress, vaultAddress, universeId, outcome) => await migrateVaultWithUnresolvedEscalation(client, securityPoolAddress, vaultAddress, universeId, outcome),
	refundTruthAuctionBid: async (client, securityPoolAddress, universeId, truthAuctionAddress, tick, bidIndex, selectedBids) => await refundTruthAuctionBid(client, securityPoolAddress, universeId, truthAuctionAddress, tick, bidIndex, selectedBids),
	settleTruthAuctionBids: async (client, securityPoolAddress, universeId, vaultAddress, claimTickIndices, refundTickIndices) => await settleTruthAuctionBids(client, securityPoolAddress, universeId, vaultAddress, claimTickIndices, refundTickIndices),
	startTruthAuctionForSecurityPool: async (client, securityPoolAddress, universeId) => await startTruthAuctionForSecurityPool(client, securityPoolAddress, universeId),
	submitTruthAuctionBid: async (client, securityPoolAddress, universeId, truthAuctionAddress, tick, amount) => await submitTruthAuctionBid(client, securityPoolAddress, universeId, truthAuctionAddress, tick, amount),
	withdrawForkedEscalationDeposits: async (client, securityPoolAddress, outcome, proofs) => await withdrawForkedEscalationDeposits(client, securityPoolAddress, outcome, proofs),
}

function filterSelectedSettlementBids(selectedBids: readonly SettlementSelectedBid[]) {
	return Array.from(selectedBids).filter(({ bidIndex }) => bidIndex >= 0n)
}

function useForkAuctionOperationsWithDependencies<TWriteClient>(
	{ accountAddress, onTransactionCanceled, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState, selectedSecurityPoolAddress }: UseForkAuctionOperationsParameters,
	dependencies: UseForkAuctionOperationsDependencies<TWriteClient>,
) {
	const forkAuctionDetails = useSignal<ForkAuctionDetails | undefined>(undefined)
	const forkAuctionActiveAction = useSignal<ForkAuctionActionResult['action'] | undefined>(undefined)
	const forkAuctionFeedback = useSignal<ActionFeedback<ForkAuctionActionResult['action']> | undefined>(undefined)
	const forkAuctionError = useSignal<string | undefined>(undefined)
	const { state: forkAuctionForm, setState: setForkAuctionForm } = useFormState<ForkAuctionFormState>(getDefaultForkAuctionFormState())
	const forkAuctionResult = useSignal<ForkAuctionActionResult | undefined>(undefined)
	const forkAuctionLoad = useLoadController()
	const nextForkAuctionLoad = useRequestGuard()
	const effectiveForkAuctionSecurityPoolAddressInput = selectedSecurityPoolAddress?.trim() === '' || selectedSecurityPoolAddress === undefined ? forkAuctionForm.value.securityPoolAddress : selectedSecurityPoolAddress
	const currentForkAuctionSelectionKey = normalizeAddress(effectiveForkAuctionSecurityPoolAddressInput) ?? ''
	const currentForkAuctionSelectionKeyRef = useRef(currentForkAuctionSelectionKey)
	currentForkAuctionSelectionKeyRef.current = currentForkAuctionSelectionKey
	const getPendingTitle = (actionName: ForkAuctionActionResult['action'], displayTitleOverride?: string) => {
		if (displayTitleOverride !== undefined) return displayTitleOverride
		if (actionName === 'claimAuctionProceeds') return 'Settle Finalized Bid'
		return actionName.replace(/([A-Z])/g, ' $1').replace(/^./, value => value.toUpperCase())
	}
	const getSuccessTitle = (actionName: ForkAuctionActionResult['action'], displayTitleOverride?: string) => `${getPendingTitle(actionName, displayTitleOverride)} submitted`
	const getFailureTitle = (actionName: ForkAuctionActionResult['action'], displayTitleOverride?: string) => `${getPendingTitle(actionName, displayTitleOverride)} failed`
	const isForkAuctionSelectionCurrent = (selectionKey: string) => currentForkAuctionSelectionKeyRef.current === selectionKey
	const resolveForkAuctionSecurityPoolAddress = () => parseAddressInput(effectiveForkAuctionSecurityPoolAddressInput, 'Security pool address')
	const getTruthAuctionSettlementMode = (claimBids: readonly SettlementSelectedBid[], refundBids: readonly SettlementSelectedBid[]): TruthAuctionSettlementMode => {
		if (claimBids.length === 0) return 'refund'
		if (refundBids.length === 0) return 'claim'
		return 'mixed'
	}

	const loadForkAuction = async (securityPoolAddressOverride?: Address) => {
		const selectionKey = currentForkAuctionSelectionKey
		const isCurrentLoad = nextForkAuctionLoad()
		await forkAuctionLoad.run({
			isCurrent: securityPoolAddressOverride === undefined ? () => isCurrentLoad() && isForkAuctionSelectionCurrent(selectionKey) : isCurrentLoad,
			onStart: () => {
				forkAuctionError.value = undefined
			},
			load: async () => {
				const securityPoolAddress = securityPoolAddressOverride ?? resolveForkAuctionSecurityPoolAddress()
				return await dependencies.loadForkAuctionDetails(securityPoolAddress)
			},
			onSuccess: details => {
				forkAuctionDetails.value = details
			},
			onError: error => {
				forkAuctionDetails.value = undefined
				forkAuctionError.value = getErrorMessage(error, 'Failed to load fork and auction details')
			},
		})
	}

	const runForkAuctionAction = async (
		actionName: ForkAuctionActionResult['action'],
		action: (walletAddress: Address, details: ForkAuctionDetails, isCurrentSelection: () => boolean) => Promise<ForkAuctionActionResult | undefined>,
		errorFallback: string,
		securityPoolAddressOverride?: Address,
		{ displayTitleOverride }: { displayTitleOverride?: string } = {},
	) => {
		const actionSelectionKey = currentForkAuctionSelectionKey
		const overrideSelectionKey = securityPoolAddressOverride === undefined ? undefined : (normalizeAddress(securityPoolAddressOverride) ?? '')
		const shouldRefreshCurrentSelection = securityPoolAddressOverride === undefined
		const isCurrentSelection = () => !shouldRefreshCurrentSelection || isForkAuctionSelectionCurrent(actionSelectionKey)
		const shouldApplyCurrentSelection = () => (securityPoolAddressOverride === undefined ? isForkAuctionSelectionCurrent(actionSelectionKey) : overrideSelectionKey !== undefined && isForkAuctionSelectionCurrent(overrideSelectionKey))
		try {
			forkAuctionActiveAction.value = actionName
			forkAuctionFeedback.value = createPendingActionFeedback(actionName, getPendingTitle(actionName, displayTitleOverride))
			await runWriteAction(
				{
					...buildWriteActionConfig(
						{ accountAddress, onTransactionCanceled, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, refreshState },
						forkAuctionError,
						'Connect a wallet before using fork or truth auction actions',
						createForkAuctionTransactionIntent(actionName, displayTitleOverride === undefined ? undefined : { submittedTitle: displayTitleOverride }),
					),
					onRefreshError: (message, hash) => {
						forkAuctionFeedback.value = createWarningActionFeedback(actionName, getSuccessTitle(actionName, displayTitleOverride), message, hash)
						const result = forkAuctionResult.value
						if (result !== undefined) onTransactionPresented(createForkAuctionWarningPresentation(result, message))
					},
					onWriteCanceled: () => {
						forkAuctionFeedback.value = undefined
					},
					onWriteError: message => {
						forkAuctionFeedback.value = createErrorActionFeedback(actionName, getFailureTitle(actionName, displayTitleOverride), message)
					},
					refreshState: async () => {
						await refreshWalletStateOnly(refreshState)
					},
				},
				async walletAddress => {
					forkAuctionResult.value = undefined
					const resolvedSecurityPoolAddress = securityPoolAddressOverride ?? resolveForkAuctionSecurityPoolAddress()
					const details = await dependencies.loadForkAuctionDetails(resolvedSecurityPoolAddress)
					if (shouldApplyCurrentSelection()) forkAuctionDetails.value = details
					if (!isCurrentSelection()) return undefined
					return await action(walletAddress, details, isCurrentSelection)
				},
				errorFallback,
				async result => {
					forkAuctionResult.value = result
					forkAuctionFeedback.value = createSuccessActionFeedback(actionName, getSuccessTitle(actionName, displayTitleOverride), result.hash)
					onTransactionPresented(createForkAuctionSuccessPresentation(result))
					if (!shouldApplyCurrentSelection()) return
					const details = await dependencies.loadForkAuctionDetails(result.securityPoolAddress)
					if (!shouldApplyCurrentSelection()) return
					forkAuctionDetails.value = details
				},
			)
		} finally {
			forkAuctionActiveAction.value = undefined
		}
	}

	const forkWithOwnEscalation = async () =>
		await runForkAuctionAction(
			'forkWithOwnEscalation',
			async (walletAddress, details, isCurrentSelection) => {
				if (!isCurrentSelection()) return undefined
				return await dependencies.forkZoltarWithOwnEscalation(dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), details.securityPoolAddress, details.universeId)
			},
			'Failed to fork with own escalation game',
		)

	const initiateFork = async () =>
		await runForkAuctionAction(
			'initiateFork',
			async (walletAddress, details, isCurrentSelection) => {
				if (!isCurrentSelection()) return undefined
				return await dependencies.initiateSecurityPoolFork(dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), details.securityPoolAddress, details.universeId)
			},
			'Failed to initiate security pool fork',
		)

	const createChildUniverse = async (outcome: ReportingOutcomeKey | bigint) =>
		await runForkAuctionAction(
			'createChildUniverse',
			async (walletAddress, details, isCurrentSelection) => {
				if (!isCurrentSelection()) return undefined
				return await dependencies.createChildUniverseFromSecurityPool(dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), details.securityPoolAddress, details.universeId, getReportingOutcomeKey(outcome))
			},
			'Failed to create child universe',
		)

	const migrateRepToZoltar = async (outcomesOverride?: ReportingOutcomeKey[]) =>
		await (() => {
			const submittedRepMigrationOutcomes = forkAuctionForm.value.repMigrationOutcomes
			return runForkAuctionAction(
				'migrateRepToZoltar',
				async (walletAddress, details, isCurrentSelection) => {
					if (!isCurrentSelection()) return undefined
					return await dependencies.migrateRepToZoltarFromSecurityPool(
						dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }),
						details.securityPoolAddress,
						details.universeId,
						outcomesOverride ?? parseReportingOutcomeListInput(submittedRepMigrationOutcomes, 'REP migration outcomes'),
					)
				},
				'Failed to migrate REP to Zoltar',
			)
		})()

	const migrateVault = async () =>
		await (() => {
			const submittedSelectedOutcome = forkAuctionForm.value.selectedOutcome
			return runForkAuctionAction(
				'migrateVault',
				async (walletAddress, details, isCurrentSelection) => {
					if (!isCurrentSelection()) return undefined
					return await dependencies.migrateSecurityVault(dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), details.securityPoolAddress, details.universeId, parseReportingOutcomeInput(submittedSelectedOutcome))
				},
				'Failed to migrate vault',
			)
		})()

	const migrateEscalation = async ({ depositIndexes, outcome, vaultAddress }: { depositIndexes?: bigint[]; outcome?: ReportingOutcomeKey; vaultAddress?: Address } = {}) =>
		await (() => {
			const submittedVaultAddress = forkAuctionForm.value.vaultAddress
			const submittedSelectedOutcome = forkAuctionForm.value.selectedOutcome
			const submittedDepositIndexes = forkAuctionForm.value.depositIndexes
			return runForkAuctionAction(
				'migrateEscalationDeposits',
				async (walletAddress, details, isCurrentSelection) => {
					const resolvedVaultAddress = vaultAddress ?? resolveOptionalAddressInput(submittedVaultAddress, walletAddress, 'Vault address')
					if (!isCurrentSelection()) return undefined
					return await dependencies.migrateEscalationDeposits(
						dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }),
						details.securityPoolAddress,
						details.universeId,
						resolvedVaultAddress,
						outcome ?? parseReportingOutcomeInput(submittedSelectedOutcome),
						depositIndexes ?? parseBigIntListInput(submittedDepositIndexes, 'Deposit indexes'),
					)
				},
				'Failed to migrate escalation deposits',
			)
		})()

	const migrateUnresolvedEscalation = async (selectedChildOutcome: ReportingOutcomeKey) =>
		await runForkAuctionAction(
			'migrateUnresolvedEscalation',
			async (walletAddress, details, isCurrentSelection) => {
				if (!isCurrentSelection()) return undefined
				return await dependencies.migrateVaultWithUnresolvedEscalation(dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), details.securityPoolAddress, walletAddress, details.universeId, selectedChildOutcome)
			},
			'Failed to migrate unresolved escalation deposits',
		)

	const startTruthAuction = async (securityPoolAddressOverride?: Address) =>
		await runForkAuctionAction(
			'startTruthAuction',
			async (walletAddress, details, isCurrentSelection) => {
				if (!isCurrentSelection()) return undefined
				return await dependencies.startTruthAuctionForSecurityPool(dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), details.securityPoolAddress, details.universeId)
			},
			'Failed to start truth auction',
			securityPoolAddressOverride,
		)

	const submitBid = async (securityPoolAddressOverride?: Address) =>
		await (() => {
			const submittedBidAmountInput = forkAuctionForm.value.submitBidAmount
			const submittedBidPriceInput = forkAuctionForm.value.submitBidPrice
			return runForkAuctionAction(
				'submitBid',
				async (walletAddress, details, isCurrentSelection) => {
					const walletEthBalance = await dependencies.createConnectedReadClient().getBalance({ address: walletAddress })
					const bidGuardMessage = getTruthAuctionBidGuardMessage({
						accountAddress: walletAddress,
						currentTimestamp: details.currentTime,
						isMainnet: true,
						submitBidAmountInput: submittedBidAmountInput,
						truthAuction: details.truthAuction,
						walletEthBalance,
					})
					if (bidGuardMessage !== undefined) throw new Error(bidGuardMessage)
					const bidPriceValidationMessage = getTruthAuctionBidPriceValidationMessage(submittedBidPriceInput)
					if (bidPriceValidationMessage !== undefined) throw new Error(bidPriceValidationMessage)
					const truthAuctionAddress = requireDefined(details.truthAuctionAddress, 'Truth auction not available')
					const bidPrice = parseTruthAuctionPriceInput(submittedBidPriceInput, 'Bid price')
					const bidTick = getTruthAuctionTickAtPrice(bidPrice)
					if (bidTick === undefined) throw new Error('Bid price is outside the supported auction range.')
					if (!isCurrentSelection()) return undefined
					return await dependencies.submitTruthAuctionBid(dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), details.securityPoolAddress, details.universeId, truthAuctionAddress, bidTick, parseTruthAuctionAmountInput(submittedBidAmountInput, 'Bid amount'))
				},
				'Failed to submit truth auction bid',
				securityPoolAddressOverride,
			)
		})()

	const refundLosingBids = async (securityPoolAddressOverride?: Address, selectedBids?: readonly SettlementSelectedBid[]) =>
		await (() => {
			const submittedRefundTick = forkAuctionForm.value.refundTick
			const submittedRefundBidIndex = forkAuctionForm.value.refundBidIndex
			return runForkAuctionAction(
				'refundLosingBids',
				async (walletAddress, details, isCurrentSelection) => {
					const truthAuctionAddress = requireDefined(details.truthAuctionAddress, 'Truth auction not available')
					const normalizedBids = selectedBids === undefined ? [{ tick: parseBigIntInput(submittedRefundTick, 'Refund tick'), bidIndex: parseBigIntInput(submittedRefundBidIndex, 'Refund bid index') }] : filterSelectedSettlementBids(selectedBids)
					if (normalizedBids.length === 0) throw new Error('Pick one or more bids to refund first.')
					const selectedBid = normalizedBids[0]
					if (selectedBid === undefined) throw new Error('Pick one or more bids to refund first.')
					if (!isCurrentSelection()) return undefined
					return await dependencies.refundTruthAuctionBid(dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), details.securityPoolAddress, details.universeId, truthAuctionAddress, selectedBid.tick, selectedBid.bidIndex, normalizedBids)
				},
				'Failed to refund losing bids',
				securityPoolAddressOverride,
			)
		})()

	const finalizeTruthAuction = async (securityPoolAddressOverride?: Address) =>
		await runForkAuctionAction(
			'finalizeTruthAuction',
			async (walletAddress, details, isCurrentSelection) => {
				if (!isCurrentSelection()) return undefined
				return await dependencies.finalizeSecurityPoolTruthAuction(dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), details.securityPoolAddress, details.universeId)
			},
			'Failed to finalize truth auction',
			securityPoolAddressOverride,
		)

	const claimAuctionProceeds = async (securityPoolAddressOverride?: Address, selectedClaimBids?: readonly SettlementSelectedBid[], selectedRefundBids?: readonly SettlementSelectedBid[]) => {
		const displayTitleOverride = selectedClaimBids !== undefined && selectedRefundBids !== undefined && selectedClaimBids.length === 0 && selectedRefundBids.length > 0 ? 'Settle Finalized Refunds' : undefined

		return await (() => {
			const submittedSettlementAddress = forkAuctionForm.value.settlementAddress
			const submittedClaimBidTick = forkAuctionForm.value.claimBidTick
			const submittedClaimBidIndex = forkAuctionForm.value.claimBidIndex
			return runForkAuctionAction(
				'claimAuctionProceeds',
				async (walletAddress, details, isCurrentSelection) => {
					const bidderAddress = resolveOptionalAddressInput(submittedSettlementAddress, walletAddress, 'Bidder address')
					const normalizedClaimBids = selectedClaimBids === undefined ? [{ tick: parseBigIntInput(submittedClaimBidTick, 'Settlement bid tick'), bidIndex: parseBigIntInput(submittedClaimBidIndex, 'Settlement bid index') }] : filterSelectedSettlementBids(selectedClaimBids)
					const normalizedRefundBids = selectedRefundBids === undefined ? [] : filterSelectedSettlementBids(selectedRefundBids)
					if (normalizedClaimBids.length === 0 && normalizedRefundBids.length === 0) throw new Error('Pick one or more bids to settle first.')
					const selectedBid = normalizedClaimBids[0] ?? normalizedRefundBids[0]
					if (selectedBid === undefined) throw new Error('Pick one or more bids to settle first.')
					if (!isCurrentSelection()) return undefined
					const result = await dependencies.settleTruthAuctionBids(dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), details.securityPoolAddress, details.universeId, bidderAddress, normalizedClaimBids, normalizedRefundBids)
					return {
						...result,
						settlementMode: getTruthAuctionSettlementMode(normalizedClaimBids, normalizedRefundBids),
					}
				},
				'Failed to settle finalized bid',
				securityPoolAddressOverride,
				displayTitleOverride === undefined ? {} : { displayTitleOverride },
			)
		})()
	}

	const settleForkedEscalation = async (outcome: ReportingOutcomeKey, parentDepositIndexes: bigint[]) =>
		await runForkAuctionAction(
			'settleForkedEscalation',
			async (walletAddress, details, isCurrentSelection) => {
				const proofs = await dependencies.buildForkCarriedEscalationProofs(details.securityPoolAddress, outcome, parentDepositIndexes)
				if (!isCurrentSelection()) return undefined
				return await dependencies.withdrawForkedEscalationDeposits(dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), details.securityPoolAddress, outcome, proofs)
			},
			'Failed to settle fork-carried escalation deposits',
		)

	const forkUniverse = async () =>
		await (() => {
			const submittedDirectForkUniverseId = forkAuctionForm.value.directForkUniverseId
			const submittedDirectForkQuestionId = forkAuctionForm.value.directForkQuestionId
			return runForkAuctionAction(
				'forkUniverse',
				async (walletAddress, details, isCurrentSelection) => {
					if (!isCurrentSelection()) return undefined
					return await dependencies.forkUniverseDirectly(
						dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }),
						parseBigIntInput(submittedDirectForkUniverseId, 'Fork universe ID'),
						parseBigIntInput(submittedDirectForkQuestionId, 'Fork question ID'),
						details.securityPoolAddress,
					)
				},
				'Failed to fork universe directly',
			)
		})()

	return {
		claimAuctionProceeds,
		createChildUniverse,
		forkAuctionActiveAction: forkAuctionActiveAction.value,
		forkAuctionDetails: forkAuctionDetails.value,
		forkAuctionError: forkAuctionError.value,
		forkAuctionFeedback: forkAuctionFeedback.value,
		forkAuctionForm: forkAuctionForm.value,
		forkAuctionResult: forkAuctionResult.value,
		forkUniverse,
		forkWithOwnEscalation,
		initiateFork,
		loadForkAuction,
		loadingForkAuctionDetails: forkAuctionLoad.isLoading.value,
		migrateEscalation: migrateEscalation,
		migrateUnresolvedEscalation,
		migrateRepToZoltar,
		migrateVault,
		refundLosingBids,
		setForkAuctionForm,
		settleForkedEscalation,
		startTruthAuction,
		submitBid,
		finalizeTruthAuction,
	}
}

export function useForkAuctionOperations(parameters: UseForkAuctionOperationsParameters): ReturnType<typeof useForkAuctionOperationsWithDependencies<ForkAuctionProductionWriteClient>>
export function useForkAuctionOperations<TWriteClient>(parameters: UseForkAuctionOperationsParameters, dependencies: UseForkAuctionOperationsDependencies<TWriteClient>): ReturnType<typeof useForkAuctionOperationsWithDependencies<TWriteClient>>
export function useForkAuctionOperations<TWriteClient>(parameters: UseForkAuctionOperationsParameters, dependencies?: UseForkAuctionOperationsDependencies<TWriteClient>) {
	if (dependencies === undefined) return useForkAuctionOperationsWithDependencies(parameters, defaultUseForkAuctionOperationsDependencies)
	return useForkAuctionOperationsWithDependencies(parameters, dependencies)
}
