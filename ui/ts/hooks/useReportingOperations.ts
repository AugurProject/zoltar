import { useSignal } from '@preact/signals'
import { useFormState } from './useFormState.js'
import type { Address } from 'viem'
import { loadReportingDetails, reportOutcomeInSecurityPool, withdrawEscalationFromSecurityPool } from '../contracts.js'
import { createConnectedReadClient, createWalletWriteClient } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { runLoadRequest } from '../lib/loadState.js'
import { buildWriteActionConfig, runWriteAction } from '../lib/writeAction.js'
import { parseAddressInput, resolveOptionalBigIntListInput } from '../lib/inputs.js'
import { getDefaultReportingFormState, parseBigIntInput } from '../lib/marketForm.js'
import type { ReportingFormState, WriteOperationsParameters } from '../types/app.js'
import type { ReportingActionResult, ReportingDetails } from '../types/contracts.js'

type UseReportingOperationsParameters = WriteOperationsParameters

export function useReportingOperations({ accountAddress, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted, refreshState }: UseReportingOperationsParameters) {
	const loadingReportingDetails = useSignal(false)
	const reportingDetails = useSignal<ReportingDetails | undefined>(undefined)
	const reportingError = useSignal<string | undefined>(undefined)
	const { state: reportingForm, setState: setReportingForm } = useFormState<ReportingFormState>(getDefaultReportingFormState())
	const reportingResult = useSignal<ReportingActionResult | undefined>(undefined)

	const loadReporting = async () => {
		await runLoadRequest({
			setLoading: value => {
				loadingReportingDetails.value = value
			},
			onStart: () => {
				reportingError.value = undefined
			},
			load: async () => {
				const securityPoolAddress = parseAddressInput(reportingForm.value.securityPoolAddress, 'Security pool address')
				return await loadReportingDetails(createConnectedReadClient(), securityPoolAddress, accountAddress)
			},
			onSuccess: details => {
				reportingDetails.value = details
			},
			onError: error => {
				reportingDetails.value = undefined
				reportingError.value = getErrorMessage(error, 'Failed to load reporting details')
			},
		})
	}

	const runReportingAction = async (action: (walletAddress: Address, securityPoolAddress: Address, currentForm: ReportingFormState) => Promise<ReportingActionResult>, errorFallback: string) => {
		const currentForm = reportingForm.value
		await runWriteAction(
			buildWriteActionConfig({ accountAddress, onTransaction, onTransactionFinished, onTransactionRequested, refreshState }, reportingError, 'Connect a wallet before reporting on a market'),
			async walletAddress => {
				reportingResult.value = undefined
				const securityPoolAddress = parseAddressInput(currentForm.securityPoolAddress, 'Security pool address')
				return await action(walletAddress, securityPoolAddress, currentForm)
			},
			errorFallback,
			async result => {
				reportingResult.value = result
				const securityPoolAddress = parseAddressInput(currentForm.securityPoolAddress, 'Security pool address')
				const details = await loadReportingDetails(createConnectedReadClient(), securityPoolAddress, accountAddress)
				reportingDetails.value = details
			},
		)
	}

	const reportOutcome = async () =>
		await runReportingAction(
			async (walletAddress, securityPoolAddress, currentForm) => await reportOutcomeInSecurityPool(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), securityPoolAddress, currentForm.selectedOutcome, parseBigIntInput(currentForm.reportAmount, 'Report amount')),
			'Failed to report on outcome',
		)

	const withdrawEscalation = async () =>
		await runReportingAction(async (walletAddress, securityPoolAddress, currentForm) => {
			const latestDetails = await loadReportingDetails(createConnectedReadClient(), securityPoolAddress, walletAddress)
			const selectedSide = latestDetails.sides.find(side => side.key === currentForm.selectedOutcome)
			const depositIndexes = resolveOptionalBigIntListInput(currentForm.withdrawDepositIndexes, selectedSide?.userDeposits.map(deposit => deposit.depositIndex) ?? [], 'Deposit indexes')

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
		setReportingForm,
		withdrawEscalation,
	}
}
