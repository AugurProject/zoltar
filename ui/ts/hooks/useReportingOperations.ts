import { useSignal } from '@preact/signals'
import { useFormState } from './useFormState.js'
import { useLoadController } from './useLoadController.js'
import type { Address } from 'viem'
import { loadReportingDetails, reportOutcomeInSecurityPool, withdrawEscalationFromSecurityPool } from '../contracts.js'
import { createConnectedReadClient, createWalletWriteClient } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { buildWriteActionConfig, runWriteAction } from '../lib/writeAction.js'
import { parseAddressInput, resolveOptionalBigIntListInput } from '../lib/inputs.js'
import { getDefaultReportingFormState, parseBigIntInput } from '../lib/marketForm.js'
import { useRequestGuard } from '../lib/requestGuard.js'
import type { ReportingFormState, WriteOperationsParameters } from '../types/app.js'
import type { ReportingActionResult, ReportingDetails } from '../types/contracts.js'

type UseReportingOperationsParameters = WriteOperationsParameters

export function useReportingOperations({ accountAddress, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted, refreshState }: UseReportingOperationsParameters) {
	const reportingLoad = useLoadController()
	const reportingDetails = useSignal<ReportingDetails | undefined>(undefined)
	const reportingError = useSignal<string | undefined>(undefined)
	const { state: reportingForm, setState: setReportingForm } = useFormState<ReportingFormState>(getDefaultReportingFormState())
	const reportingActiveAction = useSignal<ReportingActionResult['action'] | undefined>(undefined)
	const reportingResult = useSignal<ReportingActionResult | undefined>(undefined)
	const nextReportingLoad = useRequestGuard()

	const loadReporting = async () => {
		const isCurrent = nextReportingLoad()
		await reportingLoad.run({
			isCurrent,
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

	const runReportingAction = async (actionName: ReportingActionResult['action'], action: (walletAddress: Address, securityPoolAddress: Address, currentForm: ReportingFormState) => Promise<ReportingActionResult>, errorFallback: string) => {
		const currentForm = reportingForm.value
		try {
			reportingActiveAction.value = actionName
			await runWriteAction(
				{
					...buildWriteActionConfig({ accountAddress, onTransaction, onTransactionFinished, onTransactionRequested, refreshState }, reportingError, 'Connect a wallet before reporting on a market'),
					refreshErrorFallback: 'Reporting transaction succeeded, but refreshing reporting details failed',
				},
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
		} finally {
			reportingActiveAction.value = undefined
		}
	}

	const reportOutcome = async () =>
		await runReportingAction(
			'reportOutcome',
			async (walletAddress, securityPoolAddress, currentForm) => await reportOutcomeInSecurityPool(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), securityPoolAddress, currentForm.selectedOutcome, parseBigIntInput(currentForm.reportAmount, 'Report amount')),
			'Failed to report on outcome',
		)

	const withdrawEscalation = async () =>
		await runReportingAction(
			'withdrawEscalation',
			async (walletAddress, securityPoolAddress, currentForm) => {
				const latestDetails = await loadReportingDetails(createConnectedReadClient(), securityPoolAddress, walletAddress)
				if (latestDetails.status !== 'active') {
					throw new Error('Escalation game has not started yet')
				}
				const selectedSide = latestDetails.sides.find(side => side.key === currentForm.selectedOutcome)
				const depositIndexes = resolveOptionalBigIntListInput(currentForm.withdrawDepositIndexes, selectedSide?.userDeposits.map(deposit => deposit.depositIndex) ?? [], 'Deposit indexes')

				if (depositIndexes.length === 0) {
					throw new Error('No deposits available to withdraw for the selected side')
				}

				return await withdrawEscalationFromSecurityPool(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), securityPoolAddress, currentForm.selectedOutcome, depositIndexes)
			},
			'Failed to withdraw escalation deposits',
		)

	return {
		loadingReportingDetails: reportingLoad.isLoading.value,
		loadReporting,
		onReportOutcome: reportOutcome,
		reportingActiveAction: reportingActiveAction.value,
		reportingDetails: reportingDetails.value,
		reportingError: reportingError.value,
		reportingForm: reportingForm.value,
		reportingResult: reportingResult.value,
		setReportingForm,
		withdrawEscalation,
	}
}
