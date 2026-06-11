import { useSignal } from '@preact/signals'
import { useFormState } from './useFormState.js'
import { useLoadController } from './useLoadController.js'
import type { Address } from 'viem'
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
	withdrawForkedEscalationDepositsWithProofs,
} from '../contracts.js'
import { createConnectedReadClient, createWalletWriteClient } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { getTruthAuctionBidGuardMessage, getTruthAuctionTickAtPrice } from '../lib/forkAuction.js'
import { getReportingOutcomeKey, parseAddressInput, parseBigIntListInput, parseReportingOutcomeInput, parseReportingOutcomeListInput, resolveOptionalAddressInput } from '../lib/inputs.js'
import { sameAddress } from '../lib/address.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '../lib/actionFeedback.js'
import type { ActionFeedback } from '../lib/actionFeedback.js'
import { requireDefined } from '../lib/required.js'
import { createForkAuctionSuccessPresentation, createForkAuctionTransactionIntent, createForkAuctionWarningPresentation } from '../lib/transactionPresentations.js'
import { buildWriteActionConfig, runWriteAction } from '../lib/writeAction.js'
import { getDefaultForkAuctionFormState, parseBigIntInput, parseTruthAuctionAmountInput, parseTruthAuctionPriceInput } from '../lib/marketForm.js'
import type { ForkAuctionFormState, WriteOperationsParameters } from '../types/app.js'
import type { ForkAuctionActionResult, ForkAuctionDetails, ReportingOutcomeKey } from '../types/contracts.js'
import type { SettlementSelectedBid } from '../types/components.js'

type UseForkAuctionOperationsParameters = WriteOperationsParameters & {
	selectedSecurityPoolAddress?: string
}

export function useForkAuctionOperations({ accountAddress, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionRequested, onTransactionSubmitted, refreshState, selectedSecurityPoolAddress }: UseForkAuctionOperationsParameters) {
	const forkAuctionDetails = useSignal<ForkAuctionDetails | undefined>(undefined)
	const forkAuctionActiveAction = useSignal<ForkAuctionActionResult['action'] | undefined>(undefined)
	const forkAuctionFeedback = useSignal<ActionFeedback<ForkAuctionActionResult['action']> | undefined>(undefined)
	const forkAuctionError = useSignal<string | undefined>(undefined)
	const { state: forkAuctionForm, setState: setForkAuctionForm } = useFormState<ForkAuctionFormState>(getDefaultForkAuctionFormState())
	const forkAuctionResult = useSignal<ForkAuctionActionResult | undefined>(undefined)
	const forkAuctionLoad = useLoadController()
	const getPendingTitle = (actionName: ForkAuctionActionResult['action']) => {
		if (actionName === 'claimAuctionProceeds') return 'Settle Finalized Bid'
		return actionName.replace(/([A-Z])/g, ' $1').replace(/^./, value => value.toUpperCase())
	}
	const getSuccessTitle = (actionName: ForkAuctionActionResult['action']) => `${getPendingTitle(actionName)} submitted`
	const getFailureTitle = (actionName: ForkAuctionActionResult['action']) => `${getPendingTitle(actionName)} failed`
	const resolveForkAuctionSecurityPoolAddress = () => parseAddressInput(selectedSecurityPoolAddress?.trim() === '' || selectedSecurityPoolAddress === undefined ? forkAuctionForm.value.securityPoolAddress : selectedSecurityPoolAddress, 'Security pool address')

	const loadForkAuction = async (securityPoolAddressOverride?: Address) => {
		await forkAuctionLoad.run({
			onStart: () => {
				forkAuctionError.value = undefined
			},
			load: async () => {
				const securityPoolAddress = securityPoolAddressOverride ?? resolveForkAuctionSecurityPoolAddress()
				return await loadForkAuctionDetails(createConnectedReadClient(), securityPoolAddress)
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

	const runForkAuctionAction = async (actionName: ForkAuctionActionResult['action'], action: (walletAddress: Address, details: ForkAuctionDetails) => Promise<ForkAuctionActionResult>, errorFallback: string, securityPoolAddressOverride?: Address) => {
		try {
			forkAuctionActiveAction.value = actionName
			forkAuctionFeedback.value = createPendingActionFeedback(actionName, getPendingTitle(actionName))
			await runWriteAction(
				{
					...buildWriteActionConfig({ accountAddress, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionRequested, refreshState }, forkAuctionError, 'Connect a wallet before using fork or truth auction actions', createForkAuctionTransactionIntent(actionName)),
					onRefreshError: (message, hash) => {
						forkAuctionFeedback.value = createWarningActionFeedback(actionName, getSuccessTitle(actionName), message, hash)
						const result = forkAuctionResult.value
						if (result !== undefined) onTransactionPresented(createForkAuctionWarningPresentation(result, message))
					},
					onWriteError: message => {
						forkAuctionFeedback.value = createErrorActionFeedback(actionName, getFailureTitle(actionName), message)
					},
				},
				async walletAddress => {
					forkAuctionResult.value = undefined
					const resolvedSecurityPoolAddress = securityPoolAddressOverride ?? resolveForkAuctionSecurityPoolAddress()
					const canReuseLoadedDetails = securityPoolAddressOverride === undefined && forkAuctionDetails.value !== undefined && sameAddress(forkAuctionDetails.value.securityPoolAddress, resolvedSecurityPoolAddress)
					const details = canReuseLoadedDetails ? requireDefined(forkAuctionDetails.value, 'Fork auction details unavailable') : await loadForkAuctionDetails(createConnectedReadClient(), resolvedSecurityPoolAddress)
					return await action(walletAddress, details)
				},
				errorFallback,
				async result => {
					forkAuctionResult.value = result
					forkAuctionFeedback.value = createSuccessActionFeedback(actionName, getSuccessTitle(actionName), result.hash)
					onTransactionPresented(createForkAuctionSuccessPresentation(result))
					if (securityPoolAddressOverride === undefined || sameAddress(result.securityPoolAddress, resolveForkAuctionSecurityPoolAddress())) {
						forkAuctionDetails.value = await loadForkAuctionDetails(createConnectedReadClient(), result.securityPoolAddress)
					}
				},
			)
		} finally {
			forkAuctionActiveAction.value = undefined
		}
	}

	const forkWithOwnEscalation = async () =>
		await runForkAuctionAction('forkWithOwnEscalation', async (walletAddress, details) => await forkZoltarWithOwnEscalation(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId), 'Failed to fork with own escalation game')

	const initiateFork = async () => await runForkAuctionAction('initiateFork', async (walletAddress, details) => await initiateSecurityPoolFork(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId), 'Failed to initiate security pool fork')

	const createChildUniverse = async (outcome: ReportingOutcomeKey | bigint) =>
		await runForkAuctionAction('createChildUniverse', async (walletAddress, details) => await createChildUniverseFromSecurityPool(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId, getReportingOutcomeKey(outcome)), 'Failed to create child universe')

	const migrateRepToZoltar = async (outcomesOverride?: ReportingOutcomeKey[]) =>
		await runForkAuctionAction(
			'migrateRepToZoltar',
			async (walletAddress, details) => await migrateRepToZoltarFromSecurityPool(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId, outcomesOverride ?? parseReportingOutcomeListInput(forkAuctionForm.value.repMigrationOutcomes, 'REP migration outcomes')),
			'Failed to migrate REP to Zoltar',
		)

	const migrateVault = async () =>
		await runForkAuctionAction('migrateVault', async (walletAddress, details) => await migrateSecurityVault(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId, parseReportingOutcomeInput(forkAuctionForm.value.selectedOutcome)), 'Failed to migrate vault')

	const migrateEscalation = async ({ depositIndexes, outcome, vaultAddress }: { depositIndexes?: bigint[]; outcome?: ReportingOutcomeKey; vaultAddress?: Address } = {}) =>
		await runForkAuctionAction(
			'migrateEscalationDeposits',
			async (walletAddress, details) => {
				const resolvedVaultAddress = vaultAddress ?? resolveOptionalAddressInput(forkAuctionForm.value.vaultAddress, walletAddress, 'Vault address')
				return await migrateEscalationDeposits(
					createWalletWriteClient(walletAddress, { onTransactionSubmitted }),
					details.securityPoolAddress,
					details.universeId,
					resolvedVaultAddress,
					outcome ?? parseReportingOutcomeInput(forkAuctionForm.value.selectedOutcome),
					depositIndexes ?? parseBigIntListInput(forkAuctionForm.value.depositIndexes, 'Deposit indexes'),
				)
			},
			'Failed to migrate escalation deposits',
		)

	const migrateUnresolvedEscalation = async (selectedChildOutcome: ReportingOutcomeKey) =>
		await runForkAuctionAction(
			'migrateUnresolvedEscalation',
			async (walletAddress, details) => await migrateVaultWithUnresolvedEscalation(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId, selectedChildOutcome),
			'Failed to migrate unresolved escalation deposits',
		)

	const startTruthAuction = async (securityPoolAddressOverride?: Address) =>
		await runForkAuctionAction('startTruthAuction', async (walletAddress, details) => await startTruthAuctionForSecurityPool(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId), 'Failed to start truth auction', securityPoolAddressOverride)

	const submitBid = async (securityPoolAddressOverride?: Address) =>
		await runForkAuctionAction(
			'submitBid',
			async (walletAddress, details) => {
				const walletEthBalance = await createConnectedReadClient().getBalance({ address: walletAddress })
				const bidGuardMessage = getTruthAuctionBidGuardMessage({
					accountAddress: walletAddress,
					currentTimestamp: details.currentTime,
					isMainnet: true,
					submitBidAmountInput: forkAuctionForm.value.submitBidAmount,
					truthAuction: details.truthAuction,
					walletEthBalance,
				})
				if (bidGuardMessage !== undefined) throw new Error(bidGuardMessage)
				const truthAuctionAddress = requireDefined(details.truthAuctionAddress, 'Truth auction not available')
				const bidPrice = parseTruthAuctionPriceInput(forkAuctionForm.value.submitBidPrice, 'Bid price')
				const bidTick = getTruthAuctionTickAtPrice(bidPrice)
				if (bidTick === undefined) throw new Error('Enter a valid bid price.')
				return await submitTruthAuctionBid(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId, truthAuctionAddress, bidTick, parseTruthAuctionAmountInput(forkAuctionForm.value.submitBidAmount, 'Bid amount'))
			},
			'Failed to submit truth auction bid',
			securityPoolAddressOverride,
		)

	const refundLosingBids = async (securityPoolAddressOverride?: Address, selectedBids?: readonly SettlementSelectedBid[]) =>
		await runForkAuctionAction(
			'refundLosingBids',
			async (walletAddress, details) => {
				const truthAuctionAddress = requireDefined(details.truthAuctionAddress, 'Truth auction not available')
				const normalizedBids = selectedBids === undefined ? [{ tick: parseBigIntInput(forkAuctionForm.value.refundTick, 'Refund tick'), bidIndex: parseBigIntInput(forkAuctionForm.value.refundBidIndex, 'Refund bid index') }] : Array.from(selectedBids).filter(({ tick, bidIndex }) => tick >= 0n && bidIndex >= 0n)
				if (normalizedBids.length === 0) throw new Error('Pick one or more bids to refund first.')
				const selectedBid = normalizedBids[0]
				if (selectedBid === undefined) throw new Error('Pick one or more bids to refund first.')
				return await refundTruthAuctionBid(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId, truthAuctionAddress, selectedBid.tick, selectedBid.bidIndex, normalizedBids)
			},
			'Failed to refund losing bids',
			securityPoolAddressOverride,
		)

	const finalizeTruthAuction = async (securityPoolAddressOverride?: Address) =>
		await runForkAuctionAction('finalizeTruthAuction', async (walletAddress, details) => await finalizeSecurityPoolTruthAuction(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId), 'Failed to finalize truth auction', securityPoolAddressOverride)

	const claimAuctionProceeds = async (securityPoolAddressOverride?: Address, selectedClaimBids?: readonly SettlementSelectedBid[], selectedRefundBids?: readonly SettlementSelectedBid[]) =>
		await runForkAuctionAction(
			'claimAuctionProceeds',
			async (walletAddress, details) => {
				const bidderAddress = resolveOptionalAddressInput(forkAuctionForm.value.settlementAddress, walletAddress, 'Bidder address')
				const normalizedClaimBids =
					selectedClaimBids === undefined ? [{ tick: parseBigIntInput(forkAuctionForm.value.claimBidTick, 'Settlement bid tick'), bidIndex: parseBigIntInput(forkAuctionForm.value.claimBidIndex, 'Settlement bid index') }] : Array.from(selectedClaimBids).filter(({ tick, bidIndex }) => tick >= 0n && bidIndex >= 0n)
				const normalizedRefundBids = selectedRefundBids === undefined ? [] : Array.from(selectedRefundBids).filter(({ tick, bidIndex }) => tick >= 0n && bidIndex >= 0n)
				if (normalizedClaimBids.length === 0 && normalizedRefundBids.length === 0) throw new Error('Pick one or more bids to settle first.')
				const selectedBid = normalizedClaimBids[0] ?? normalizedRefundBids[0]
				if (selectedBid === undefined) throw new Error('Pick one or more bids to settle first.')
				return await settleTruthAuctionBids(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId, bidderAddress, normalizedClaimBids, normalizedRefundBids)
			},
			'Failed to settle finalized bid',
			securityPoolAddressOverride,
		)

	const settleForkedEscalation = async (outcome: ReportingOutcomeKey, parentDepositIndexes: bigint[]) =>
		await runForkAuctionAction(
			'settleForkedEscalation',
			async (walletAddress, details) => {
				try {
					const proofs = await buildForkCarriedEscalationProofs(createConnectedReadClient(), details.securityPoolAddress, outcome, parentDepositIndexes)
					return await withdrawForkedEscalationDepositsWithProofs(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, outcome, proofs)
				} catch {
					return await withdrawForkedEscalationDeposits(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, outcome, parentDepositIndexes)
				}
			},
			'Failed to settle fork-carried escalation deposits',
		)

	const forkUniverse = async () =>
		await runForkAuctionAction(
			'forkUniverse',
			async (walletAddress, details) =>
				await forkUniverseDirectly(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), parseBigIntInput(forkAuctionForm.value.directForkUniverseId, 'Fork universe ID'), parseBigIntInput(forkAuctionForm.value.directForkQuestionId, 'Fork question ID'), details.securityPoolAddress),
			'Failed to fork universe directly',
		)

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
