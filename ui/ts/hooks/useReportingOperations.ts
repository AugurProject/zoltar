import { useSignal } from '@preact/signals'
import type { Address, Hash } from 'viem'
import { loadReportingDetails, reportOutcomeInSecurityPool, withdrawEscalationFromSecurityPool } from '../contracts.js'
import { createReadClient, createWalletWriteClient } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { runWriteAction } from '../lib/writeAction.js'
import { parseAddressInput, parseBigIntListInput } from '../lib/inputs.js'
import { getDefaultReportingFormState, parseBigIntInput } from '../lib/marketForm.js'
import type { ReportingFormState } from '../types/app.js'
import type { ReportingActionResult, ReportingDetails } from '../types/contracts.js'

type UseReportingOperationsParameters = {
	accountAddress: Address | undefined
	onTransaction: (hash: Hash) => void
	onTransactionFinished: () => void
	onTransactionRequested: () => void
	onTransactionSubmitted: (hash: Hash) => void
	refreshState: () => Promise<void>
}

export function useReportingOperations({ accountAddress, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted, refreshState }: UseReportingOperationsParameters) {
	const loadingReportingDetails = useSignal(false)
	const reportingDetails = useSignal<ReportingDetails | undefined>(undefined)
	const reportingError = useSignal<string | undefined>(undefined)
	const reportingForm = useSignal<ReportingFormState>(getDefaultReportingFormState())
	const reportingResult = useSignal<ReportingActionResult | undefined>(undefined)

	const loadReporting = async () => {
		loadingReportingDetails.value = true
		reportingError.value = undefined
		try {
			const securityPoolAddress = parseAddressInput(reportingForm.value.securityPoolAddress, 'Security pool address')
			const details = await loadReportingDetails(createReadClient(), securityPoolAddress, accountAddress)
			reportingDetails.value = details
		} catch (error) {
			reportingDetails.value = undefined
			reportingError.value = getErrorMessage(error, 'Failed to load reporting details')
		} finally {
			loadingReportingDetails.value = false
		}
	}

	const runReportingAction = async (action: (walletAddress: Address, securityPoolAddress: Address, currentForm: ReportingFormState) => Promise<ReportingActionResult>, errorFallback: string) => {
		const currentForm = reportingForm.value
		await runWriteAction(
			{
				accountAddress,
				missingWalletMessage: 'Connect a wallet before reporting on a market',
				onTransaction,
				onTransactionFinished,
				onTransactionRequested,
				refreshState,
				setErrorMessage: message => {
					reportingError.value = message
				},
			},
			async walletAddress => {
				reportingResult.value = undefined
				const securityPoolAddress = parseAddressInput(currentForm.securityPoolAddress, 'Security pool address')
				return await action(walletAddress, securityPoolAddress, currentForm)
			},
			errorFallback,
			async (result) => {
				reportingResult.value = result
				const securityPoolAddress = parseAddressInput(currentForm.securityPoolAddress, 'Security pool address')
				const details = await loadReportingDetails(createReadClient(), securityPoolAddress, accountAddress)
				reportingDetails.value = details
			},
		)
	}

	const reportOutcome = async () => await runReportingAction(async (walletAddress, securityPoolAddress, currentForm) => await reportOutcomeInSecurityPool(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), securityPoolAddress, currentForm.selectedOutcome, parseBigIntInput(currentForm.reportAmount, 'Report amount')), 'Failed to report on outcome')

	const withdrawEscalation = async () =>
		await runReportingAction(async (walletAddress, securityPoolAddress, currentForm) => {
			const latestDetails = await loadReportingDetails(createReadClient(), securityPoolAddress, walletAddress)
			const selectedSide = latestDetails.sides.find(side => side.key === currentForm.selectedOutcome)
			const depositIndexes = currentForm.withdrawDepositIndexes.trim() === '' ? (selectedSide?.userDeposits.map(deposit => deposit.depositIndex) ?? []) : parseBigIntListInput(currentForm.withdrawDepositIndexes, 'Deposit indexes')

			if (depositIndexes.length === 0) {
				throw new Error('No deposits available to withdraw for the selected side')
			}

			return await withdrawEscalationFromSecurityPool(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), securityPoolAddress, currentForm.selectedOutcome, depositIndexes)
		}, 'Failed to withdraw escalation deposits')

	return {
		loadingReportingDetails: loadingReportingDetails.value,
		loadReporting,
		onReportOutcome: reportOutcome,
		reportingDetails: reportingDetails.value,
		reportingError: reportingError.value,
		reportingForm: reportingForm.value,
		reportingResult: reportingResult.value,
		setReportingForm: (updater: (current: ReportingFormState) => ReportingFormState) => {
			reportingForm.value = updater(reportingForm.value)
		},
		withdrawEscalation,
	}
}
