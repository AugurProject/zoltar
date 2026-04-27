import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { useFormState } from './useFormState.js'
import { useLoadController } from './useLoadController.js'
import type { Address } from 'viem'
import { approveErc20, createOpenOracleReportInstance, disputeOracleReport, getOpenOracleAddress, loadErc20Allowance, loadOpenOracleReportDetails, settleOracleReport, submitInitialOracleReport } from '../contracts.js'
import { createConnectedReadClient, createWalletWriteClient } from '../lib/clients.js'
import { getErrorDetail, getErrorMessage } from '../lib/errors.js'
import { deriveOpenOracleInitialReportSubmissionDetails, formatOpenOraclePriceInput, loadOpenOracleInitialReportPriceResult } from '../lib/openOracle.js'
import { requireDefined } from '../lib/required.js'
import type { TokenApprovalState } from '../lib/tokenApproval.js'
import { buildWriteActionConfig, runWriteAction } from '../lib/writeAction.js'
import { useRequestGuard } from '../lib/requestGuard.js'
import { parseAddressInput, parseBytes32Input, parseReportIdInput } from '../lib/inputs.js'
import { getDefaultOpenOracleCreateFormState, getDefaultOpenOracleFormState, parseBigIntInput } from '../lib/marketForm.js'
import type { OpenOracleCreateFormState, OpenOracleFormState, WriteOperationsParameters } from '../types/app.js'
import type { OpenOracleActionResult, OpenOracleReportDetails } from '../types/contracts.js'

type UseOpenOracleOperationsParameters = WriteOperationsParameters

export function useOpenOracleOperations({ accountAddress, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted, refreshState }: UseOpenOracleOperationsParameters) {
	const loadingOpenOracleCreate = useSignal(false)
	const oracleReportLoad = useLoadController()
	const openOracleInitialReportStateLoad = useLoadController()
	const { state: openOracleCreateForm, setState: setOpenOracleCreateForm } = useFormState<OpenOracleCreateFormState>(getDefaultOpenOracleCreateFormState())
	const openOracleError = useSignal<string | undefined>(undefined)
	const openOracleActiveAction = useSignal<OpenOracleActionResult['action'] | undefined>(undefined)
	const { state: openOracleForm, setState: setOpenOracleForm } = useFormState<OpenOracleFormState>(getDefaultOpenOracleFormState())
	const openOracleResult = useSignal<OpenOracleActionResult | undefined>(undefined)
	const openOracleReportDetails = useSignal<OpenOracleReportDetails | undefined>(undefined)
	const loadedOpenOracleReportId = useSignal<bigint | undefined>(undefined)
	const openOracleInitialReportDefaultPrice = useSignal<string | undefined>(undefined)
	const openOracleInitialReportDefaultPriceError = useSignal<string | undefined>(undefined)
	const openOracleInitialReportDefaultPriceSource = useSignal<'Uniswap V4' | 'Uniswap V3 fallback' | undefined>(undefined)
	const openOracleInitialReportQuoteAttemptedSources = useSignal<('Uniswap V4' | 'Uniswap V3 fallback')[] | undefined>(undefined)
	const openOracleInitialReportQuoteFailureKind = useSignal<'unsupported-pair' | 'quote-failed' | undefined>(undefined)
	const openOracleInitialReportQuoteFailureReason = useSignal<string | undefined>(undefined)
	const openOracleInitialReportToken1Approval = useSignal<TokenApprovalState>({
		error: undefined,
		loading: false,
		value: undefined,
	})
	const openOracleInitialReportToken2Approval = useSignal<TokenApprovalState>({
		error: undefined,
		loading: false,
		value: undefined,
	})
	const nextOpenOracleInitialReportStateLoad = useRequestGuard()
	type OpenOracleInitialReportStateResult = {
		initialPriceResult: Awaited<ReturnType<typeof loadOpenOracleInitialReportPriceResult>>
		token1ApprovalResult: TokenApprovalState
		token2ApprovalResult: TokenApprovalState
	}

	const resetOpenOracleTokenApprovalState = (loading: boolean) => {
		openOracleInitialReportToken1Approval.value = {
			error: undefined,
			loading,
			value: undefined,
		}
		openOracleInitialReportToken2Approval.value = {
			error: undefined,
			loading,
			value: undefined,
		}
	}

	const refreshOpenOracleInitialReportState = async (details: OpenOracleReportDetails | undefined) => {
		const currentDetails = details
		const isCurrent = nextOpenOracleInitialReportStateLoad()
		if (currentDetails === undefined) {
			openOracleInitialReportDefaultPrice.value = undefined
			openOracleInitialReportDefaultPriceError.value = undefined
			openOracleInitialReportDefaultPriceSource.value = undefined
			openOracleInitialReportQuoteAttemptedSources.value = undefined
			openOracleInitialReportQuoteFailureKind.value = undefined
			openOracleInitialReportQuoteFailureReason.value = undefined
			resetOpenOracleTokenApprovalState(false)
			return
		}

		await openOracleInitialReportStateLoad.run({
			isCurrent,
			onStart: () => {
				openOracleInitialReportDefaultPrice.value = undefined
				openOracleInitialReportDefaultPriceError.value = undefined
				openOracleInitialReportDefaultPriceSource.value = undefined
				openOracleInitialReportQuoteAttemptedSources.value = undefined
				openOracleInitialReportQuoteFailureKind.value = undefined
				openOracleInitialReportQuoteFailureReason.value = undefined
				resetOpenOracleTokenApprovalState(accountAddress !== undefined)
			},
			load: async () => {
				const readClient = createConnectedReadClient()
				const loadAllowance = async (tokenAddress: Address) => {
					if (accountAddress === undefined) {
						return {
							error: undefined,
							loading: false,
							value: undefined,
						} satisfies TokenApprovalState
					}

					try {
						return {
							error: undefined,
							loading: false,
							value: await loadErc20Allowance(readClient, tokenAddress, accountAddress, getOpenOracleAddress()),
						} satisfies TokenApprovalState
					} catch (error) {
						const errorDetail = getErrorDetail(error)
						return {
							error: errorDetail === undefined ? 'Failed to load token approval' : `Failed to load token approval: ${errorDetail}`,
							loading: false,
							value: undefined,
						} satisfies TokenApprovalState
					}
				}

				const [initialPriceResult, token1ApprovalResult, token2ApprovalResult] = await Promise.all([loadOpenOracleInitialReportPriceResult(readClient, currentDetails.token1, currentDetails.token2, currentDetails.exactToken1Report), loadAllowance(currentDetails.token1), loadAllowance(currentDetails.token2)])

				return { initialPriceResult, token1ApprovalResult, token2ApprovalResult }
			},
			onSuccess: ({ initialPriceResult, token1ApprovalResult, token2ApprovalResult }: OpenOracleInitialReportStateResult) => {
				const initialPrice = initialPriceResult.status === 'success' ? initialPriceResult : undefined
				const priceFailure = initialPriceResult.status === 'failure' ? initialPriceResult : undefined

				openOracleInitialReportDefaultPrice.value = initialPrice === undefined ? undefined : formatOpenOraclePriceInput(initialPrice.price)
				openOracleInitialReportDefaultPriceError.value = priceFailure?.reason
				openOracleInitialReportDefaultPriceSource.value = initialPrice?.priceSource
				openOracleInitialReportQuoteAttemptedSources.value = priceFailure?.attemptedSources
				openOracleInitialReportQuoteFailureKind.value = priceFailure?.failureKind
				openOracleInitialReportQuoteFailureReason.value = priceFailure?.reason
				openOracleInitialReportToken1Approval.value = token1ApprovalResult
				openOracleInitialReportToken2Approval.value = token2ApprovalResult

				if (openOracleForm.value.price.trim() === '' || openOracleForm.value.reportId.trim() !== currentDetails.reportId.toString()) {
					openOracleForm.value = {
						...openOracleForm.value,
						amount1: currentDetails.exactToken1Report.toString(),
						amount2: initialPrice?.token2Amount?.toString() ?? openOracleForm.value.amount2,
						price: initialPrice === undefined ? '' : formatOpenOraclePriceInput(initialPrice.price),
					}
				}
			},
			onError: () => undefined,
		})
	}

	const loadOracleReport = async (reportIdInput?: string) => {
		await oracleReportLoad.run({
			onStart: () => {
				openOracleError.value = undefined
			},
			load: async () => {
				const reportIdValue = reportIdInput?.trim() ?? openOracleForm.value.reportId
				const reportId = parseReportIdInput(reportIdValue)
				if (reportIdInput !== undefined) {
					openOracleForm.value = {
						...openOracleForm.value,
						reportId: reportIdValue,
					}
				}
				const details = await loadOpenOracleReportDetails(createConnectedReadClient(), getOpenOracleAddress(), reportId)
				return { details, reportId }
			},
			onSuccess: ({ details, reportId }: { details: OpenOracleReportDetails; reportId: bigint }) => {
				openOracleReportDetails.value = details
				loadedOpenOracleReportId.value = reportId
				openOracleForm.value = {
					...openOracleForm.value,
					price: '',
					stateHash: details.stateHash,
				}
			},
			onError: (error: unknown) => {
				openOracleReportDetails.value = undefined
				loadedOpenOracleReportId.value = undefined
				openOracleInitialReportDefaultPrice.value = undefined
				openOracleInitialReportDefaultPriceError.value = undefined
				openOracleInitialReportDefaultPriceSource.value = undefined
				openOracleInitialReportQuoteAttemptedSources.value = undefined
				openOracleInitialReportQuoteFailureKind.value = undefined
				openOracleInitialReportQuoteFailureReason.value = undefined
				resetOpenOracleTokenApprovalState(false)
				openOracleError.value = getErrorMessage(error, 'Failed to load oracle report')
			},
		})
	}

	const ensureLoadedSelectedReport = async () => {
		const reportId = parseReportIdInput(openOracleForm.value.reportId)
		if (openOracleReportDetails.value !== undefined && loadedOpenOracleReportId.value === reportId) {
			return { reportId, details: openOracleReportDetails.value }
		}

		await loadOracleReport()
		const loadedReportDetails = requireDefined(openOracleReportDetails.value, 'Failed to load oracle report')

		return {
			reportId: loadedReportDetails.reportId,
			details: loadedReportDetails,
		}
	}

	const runOracleAction = async (actionName: OpenOracleActionResult['action'], action: (walletAddress: Address) => Promise<OpenOracleActionResult>, errorFallback: string) => {
		try {
			await runWriteAction(
				{
					...buildWriteActionConfig({ accountAddress, onTransaction, onTransactionFinished, onTransactionRequested, refreshState }, openOracleError, 'Connect a wallet before operating open oracle'),
					refreshErrorFallback: 'Oracle transaction succeeded, but refreshing the selected report failed',
				},
				async walletAddress => {
					openOracleActiveAction.value = actionName
					openOracleResult.value = undefined
					return await action(walletAddress)
				},
				errorFallback,
				async result => {
					openOracleResult.value = result
					if (result.action === 'createReportInstance') {
						openOracleCreateForm.value = getDefaultOpenOracleCreateFormState()
					}
					if (result.action !== 'createReportInstance' && openOracleForm.value.reportId.trim() !== '') {
						await ensureLoadedSelectedReport()
					}
					if (result.action === 'approveToken1' || result.action === 'approveToken2') {
						await refreshOpenOracleInitialReportState(openOracleReportDetails.value)
					}
				},
			)
		} finally {
			openOracleActiveAction.value = undefined
		}
	}

	const getInitialReportSubmission = (reportDetails: OpenOracleReportDetails) =>
		deriveOpenOracleInitialReportSubmissionDetails({
			approvedToken1Amount: openOracleInitialReportToken1Approval.value.value,
			approvedToken2Amount: openOracleInitialReportToken2Approval.value.value,
			defaultPrice: openOracleInitialReportDefaultPrice.value,
			defaultPriceError: openOracleInitialReportDefaultPriceError.value,
			defaultPriceSource: openOracleInitialReportDefaultPriceSource.value,
			priceInput: openOracleForm.value.price,
			quoteAttemptedSources: openOracleInitialReportQuoteAttemptedSources.value,
			quoteFailureReason: openOracleInitialReportQuoteFailureReason.value,
			reportDetails,
			token1AllowanceError: openOracleInitialReportToken1Approval.value.error,
			token2AllowanceError: openOracleInitialReportToken2Approval.value.error,
			token1Decimals: reportDetails.token1Decimals,
			token2Decimals: reportDetails.token2Decimals,
		})

	const approveToken1 = async (amount?: bigint) =>
		await runOracleAction(
			'approveToken1',
			async walletAddress => {
				const reportDetails = requireDefined(openOracleReportDetails.value, 'Load an oracle report first')
				const submission = getInitialReportSubmission(reportDetails)
				const approvalAmount = amount ?? submission.token1Approval.targetAmount ?? submission.amount1
				if (approvalAmount === undefined) {
					throw new Error('No token1 approval amount is required for the selected report')
				}
				return await approveErc20(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), reportDetails.token1, getOpenOracleAddress(), approvalAmount, 'approveToken1')
			},
			'Failed to approve token1',
		)

	const approveToken2 = async (amount?: bigint) =>
		await runOracleAction(
			'approveToken2',
			async walletAddress => {
				const reportDetails = requireDefined(openOracleReportDetails.value, 'Load an oracle report first')
				const submission = getInitialReportSubmission(reportDetails)
				const approvalAmount = amount ?? submission.token2Approval.targetAmount ?? submission.amount2
				if (approvalAmount === undefined) {
					throw new Error('No token2 approval amount is required for the selected report')
				}
				return await approveErc20(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), reportDetails.token2, getOpenOracleAddress(), approvalAmount, 'approveToken2')
			},
			'Failed to approve token2',
		)

	const createOpenOracleGame = async () => {
		loadingOpenOracleCreate.value = true
		try {
			await runOracleAction(
				'createReportInstance',
				async walletAddress =>
					await createOpenOracleReportInstance(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), {
						disputeDelay: Number(parseBigIntInput(openOracleCreateForm.value.disputeDelay, 'Dispute delay')),
						escalationHalt: parseBigIntInput(openOracleCreateForm.value.escalationHalt, 'Escalation halt'),
						exactToken1Report: parseBigIntInput(openOracleCreateForm.value.exactToken1Report, 'Exact token1 report'),
						ethValue: parseBigIntInput(openOracleCreateForm.value.ethValue, 'ETH value'),
						feePercentage: Number(parseBigIntInput(openOracleCreateForm.value.feePercentage, 'Fee percentage')),
						multiplier: Number(parseBigIntInput(openOracleCreateForm.value.multiplier, 'Multiplier')),
						protocolFee: Number(parseBigIntInput(openOracleCreateForm.value.protocolFee, 'Protocol fee')),
						settlementTime: Number(parseBigIntInput(openOracleCreateForm.value.settlementTime, 'Settlement time')),
						settlerReward: parseBigIntInput(openOracleCreateForm.value.settlerReward, 'Settler reward'),
						token1Address: parseAddressInput(openOracleCreateForm.value.token1Address, 'Token1 address'),
						token2Address: parseAddressInput(openOracleCreateForm.value.token2Address, 'Token2 address'),
					}),
				'Failed to create Open Oracle game',
			)
		} finally {
			loadingOpenOracleCreate.value = false
		}
	}

	const submitInitialReport = async () =>
		await runOracleAction(
			'submitInitialReport',
			async walletAddress => {
				const reportDetails = requireDefined(openOracleReportDetails.value, 'Load an oracle report first')
				const submission = getInitialReportSubmission(reportDetails)
				if (!submission.canSubmit || submission.amount1 === undefined || submission.amount2 === undefined) {
					throw new Error(submission.blockReason ?? 'Invalid price')
				}

				return await submitInitialOracleReport(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), getOpenOracleAddress(), reportDetails.reportId, submission.amount1, submission.amount2, parseBytes32Input(openOracleForm.value.stateHash, 'State hash'))
			},
			'Failed to submit initial report',
		)

	const settleReport = async () => await runOracleAction('settle', async walletAddress => await settleOracleReport(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), getOpenOracleAddress(), parseReportIdInput(openOracleForm.value.reportId)), 'Failed to settle report')

	const disputeReport = async () =>
		await runOracleAction(
			'dispute',
			async walletAddress => {
				const { details } = await ensureLoadedSelectedReport()
				const form = openOracleForm.value
				const tokenToSwap = form.disputeTokenToSwap === 'token1' ? details.token1 : details.token2
				return await disputeOracleReport(
					createWalletWriteClient(walletAddress, { onTransactionSubmitted }),
					getOpenOracleAddress(),
					details.reportId,
					tokenToSwap,
					parseBigIntInput(form.disputeNewAmount1, 'New token1 amount'),
					parseBigIntInput(form.disputeNewAmount2, 'New token2 amount'),
					details.currentAmount2,
					parseBytes32Input(form.stateHash, 'State hash'),
				)
			},
			'Failed to dispute report',
		)

	useEffect(() => {
		if (openOracleReportDetails.value === undefined) {
			void refreshOpenOracleInitialReportState(undefined)
			return
		}
		void refreshOpenOracleInitialReportState(openOracleReportDetails.value)
	}, [accountAddress, openOracleReportDetails.value?.reportId, openOracleReportDetails.value?.token1, openOracleReportDetails.value?.token2, openOracleReportDetails.value?.exactToken1Report])

	return {
		approveToken1,
		approveToken2,
		createOpenOracleGame,
		disputeReport,
		loadOracleReport,
		openOracleActiveAction: openOracleActiveAction.value,
		refreshPrice: () => void refreshOpenOracleInitialReportState(openOracleReportDetails.value),
		loadingOpenOracleCreate: loadingOpenOracleCreate.value,
		loadingOracleReport: oracleReportLoad.isLoading.value,
		openOracleCreateForm: openOracleCreateForm.value,
		openOracleError: openOracleError.value,
		openOracleForm: openOracleForm.value,
		openOracleInitialReportState: {
			defaultPrice: openOracleInitialReportDefaultPrice.value,
			defaultPriceError: openOracleInitialReportDefaultPriceError.value,
			defaultPriceSource: openOracleInitialReportDefaultPriceSource.value,
			loading: openOracleInitialReportStateLoad.isLoading.value,
			quoteAttemptedSources: openOracleInitialReportQuoteAttemptedSources.value,
			quoteFailureKind: openOracleInitialReportQuoteFailureKind.value,
			quoteFailureReason: openOracleInitialReportQuoteFailureReason.value,
			token1Approval: openOracleInitialReportToken1Approval.value,
			token1Decimals: openOracleReportDetails.value?.token1Decimals,
			token2Approval: openOracleInitialReportToken2Approval.value,
			token2Decimals: openOracleReportDetails.value?.token2Decimals,
		},
		openOracleReportDetails: openOracleReportDetails.value,
		openOracleResult: openOracleResult.value,
		resetOpenOracleCreateForm: () => {
			openOracleCreateForm.value = getDefaultOpenOracleCreateFormState()
		},
		setOpenOracleCreateForm,
		setOpenOracleForm,
		settleReport,
		submitInitialReport,
	}
}
