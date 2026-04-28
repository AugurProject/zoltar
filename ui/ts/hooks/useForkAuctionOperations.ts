import { useSignal } from '@preact/signals'
import { useFormState } from './useFormState.js'
import { useLoadController } from './useLoadController.js'
import type { Address } from 'viem'
import {
	claimSecurityPoolAuctionProceeds,
	createChildUniverseFromSecurityPool,
	finalizeSecurityPoolTruthAuction,
	forkUniverseDirectly,
	forkZoltarWithOwnEscalation,
	initiateSecurityPoolFork,
	loadForkAuctionDetails,
	migrateEscalationDeposits,
	migrateRepToZoltarFromSecurityPool,
	migrateSecurityVault,
	refundTruthAuctionBid,
	startTruthAuctionForSecurityPool,
	submitTruthAuctionBid,
	withdrawTruthAuctionBids,
} from '../contracts.js'
import { createConnectedReadClient, createWalletWriteClient } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { getReportingOutcomeKey, parseAddressInput, parseBigIntListInput, parseReportingOutcomeInput, parseReportingOutcomeListInput, resolveOptionalAddressInput } from '../lib/inputs.js'
import { requireDefined } from '../lib/required.js'
import { buildWriteActionConfig, runWriteAction } from '../lib/writeAction.js'
import { getDefaultForkAuctionFormState, parseBigIntInput } from '../lib/marketForm.js'
import type { ForkAuctionFormState, WriteOperationsParameters } from '../types/app.js'
import type { ForkAuctionActionResult, ForkAuctionDetails, ReportingOutcomeKey } from '../types/contracts.js'

type UseForkAuctionOperationsParameters = WriteOperationsParameters

export function useForkAuctionOperations({ accountAddress, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted, refreshState }: UseForkAuctionOperationsParameters) {
	const forkAuctionDetails = useSignal<ForkAuctionDetails | undefined>(undefined)
	const forkAuctionError = useSignal<string | undefined>(undefined)
	const { state: forkAuctionForm, setState: setForkAuctionForm } = useFormState<ForkAuctionFormState>(getDefaultForkAuctionFormState())
	const forkAuctionResult = useSignal<ForkAuctionActionResult | undefined>(undefined)
	const forkAuctionLoad = useLoadController()

	const loadForkAuction = async () => {
		await forkAuctionLoad.run({
			onStart: () => {
				forkAuctionError.value = undefined
			},
			load: async () => {
				const securityPoolAddress = parseAddressInput(forkAuctionForm.value.securityPoolAddress, 'Security pool address')
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

	const runForkAuctionAction = async (action: (walletAddress: Address, details: ForkAuctionDetails) => Promise<ForkAuctionActionResult>, errorFallback: string) =>
		await runWriteAction(
			buildWriteActionConfig({ accountAddress, onTransaction, onTransactionFinished, onTransactionRequested, refreshState }, forkAuctionError, 'Connect a wallet before using fork or truth auction actions'),
			async walletAddress => {
				forkAuctionResult.value = undefined
				const details = forkAuctionDetails.value ?? (await loadForkAuctionDetails(createConnectedReadClient(), parseAddressInput(forkAuctionForm.value.securityPoolAddress, 'Security pool address')))
				return await action(walletAddress, details)
			},
			errorFallback,
			async result => {
				forkAuctionResult.value = result
				forkAuctionDetails.value = await loadForkAuctionDetails(createConnectedReadClient(), result.securityPoolAddress)
			},
		)

	const forkWithOwnEscalation = async () => await runForkAuctionAction(async (walletAddress, details) => await forkZoltarWithOwnEscalation(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId), 'Failed to fork with own escalation game')

	const initiateFork = async () => await runForkAuctionAction(async (walletAddress, details) => await initiateSecurityPoolFork(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId), 'Failed to initiate security pool fork')

	const createChildUniverse = async (outcome: ReportingOutcomeKey | bigint) =>
		await runForkAuctionAction(async (walletAddress, details) => await createChildUniverseFromSecurityPool(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId, getReportingOutcomeKey(outcome)), 'Failed to create child universe')

	const migrateRepToZoltar = async () =>
		await runForkAuctionAction(
			async (walletAddress, details) => await migrateRepToZoltarFromSecurityPool(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId, parseReportingOutcomeListInput(forkAuctionForm.value.repMigrationOutcomes, 'REP migration outcomes')),
			'Failed to migrate REP to Zoltar',
		)

	const migrateVault = async () =>
		await runForkAuctionAction(async (walletAddress, details) => await migrateSecurityVault(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId, parseReportingOutcomeInput(forkAuctionForm.value.selectedOutcome)), 'Failed to migrate vault')

	const migrateEscalation = async () =>
		await runForkAuctionAction(async (walletAddress, details) => {
			const vaultAddress = resolveOptionalAddressInput(forkAuctionForm.value.vaultAddress, walletAddress, 'Vault address')
			return await migrateEscalationDeposits(
				createWalletWriteClient(walletAddress, { onTransactionSubmitted }),
				details.securityPoolAddress,
				details.universeId,
				vaultAddress,
				parseReportingOutcomeInput(forkAuctionForm.value.selectedOutcome),
				parseBigIntListInput(forkAuctionForm.value.depositIndexes, 'Deposit indexes'),
			)
		}, 'Failed to migrate escalation deposits')

	const startTruthAuction = async () => await runForkAuctionAction(async (walletAddress, details) => await startTruthAuctionForSecurityPool(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId), 'Failed to start truth auction')

	const submitBid = async () =>
		await runForkAuctionAction(async (walletAddress, details) => {
			const truthAuctionAddress = requireDefined(details.truthAuctionAddress, 'Truth auction not available')
			return await submitTruthAuctionBid(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId, truthAuctionAddress, parseBigIntInput(forkAuctionForm.value.submitBidTick, 'Bid tick'), parseBigIntInput(forkAuctionForm.value.submitBidAmount, 'Bid amount'))
		}, 'Failed to submit truth auction bid')

	const refundLosingBids = async () =>
		await runForkAuctionAction(async (walletAddress, details) => {
			const truthAuctionAddress = requireDefined(details.truthAuctionAddress, 'Truth auction not available')
			return await refundTruthAuctionBid(
				createWalletWriteClient(walletAddress, { onTransactionSubmitted }),
				details.securityPoolAddress,
				details.universeId,
				truthAuctionAddress,
				parseBigIntInput(forkAuctionForm.value.refundTick, 'Refund tick'),
				parseBigIntInput(forkAuctionForm.value.refundBidIndex, 'Refund bid index'),
			)
		}, 'Failed to refund losing bids')

	const finalizeTruthAuction = async () => await runForkAuctionAction(async (walletAddress, details) => await finalizeSecurityPoolTruthAuction(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId), 'Failed to finalize truth auction')

	const claimAuctionProceeds = async () =>
		await runForkAuctionAction(async (walletAddress, details) => {
			const vaultAddress = resolveOptionalAddressInput(forkAuctionForm.value.vaultAddress, walletAddress, 'Vault address')
			return await claimSecurityPoolAuctionProceeds(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId, vaultAddress, parseBigIntInput(forkAuctionForm.value.claimBidTick, 'Bid tick'), parseBigIntInput(forkAuctionForm.value.claimBidIndex, 'Bid index'))
		}, 'Failed to claim auction proceeds')

	const forkUniverse = async () =>
		await runForkAuctionAction(
			async (walletAddress, details) =>
				await forkUniverseDirectly(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), parseBigIntInput(forkAuctionForm.value.directForkUniverseId, 'Fork universe ID'), parseBigIntInput(forkAuctionForm.value.directForkQuestionId, 'Fork question ID'), details.securityPoolAddress),
			'Failed to fork universe directly',
		)

	const withdrawBids = async () =>
		await runForkAuctionAction(async (walletAddress, details) => {
			const truthAuctionAddress = requireDefined(details.truthAuctionAddress, 'Truth auction not available')
			const withdrawFor = resolveOptionalAddressInput(forkAuctionForm.value.withdrawForAddress, walletAddress, 'Withdraw-for address')
			return await withdrawTruthAuctionBids(
				createWalletWriteClient(walletAddress, { onTransactionSubmitted }),
				details.securityPoolAddress,
				details.universeId,
				truthAuctionAddress,
				withdrawFor,
				parseBigIntInput(forkAuctionForm.value.withdrawTick, 'Withdraw tick'),
				parseBigIntInput(forkAuctionForm.value.withdrawBidIndex, 'Withdraw bid index'),
			)
		}, 'Failed to withdraw bids')

	return {
		claimAuctionProceeds,
		createChildUniverse,
		forkAuctionDetails: forkAuctionDetails.value,
		forkAuctionError: forkAuctionError.value,
		forkAuctionForm: forkAuctionForm.value,
		forkAuctionResult: forkAuctionResult.value,
		forkUniverse,
		forkWithOwnEscalation,
		initiateFork,
		loadForkAuction,
		loadingForkAuctionDetails: forkAuctionLoad.isLoading.value,
		migrateEscalation: migrateEscalation,
		migrateRepToZoltar,
		migrateVault,
		refundLosingBids,
		setForkAuctionForm,
		startTruthAuction,
		submitBid,
		withdrawBids,
		finalizeTruthAuction,
	}
}
