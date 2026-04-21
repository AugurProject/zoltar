import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { useFormState } from './useFormState.js'
import { useLoadController } from './useLoadController.js'
import type { Address } from 'viem'
import { approveErc20, createOpenOracleReportInstance, disputeOracleReport, getOpenOracleAddress, loadErc20Allowance, loadOpenOracleReportDetails, settleOracleReport, submitInitialOracleReport } from '../contracts.js'
import { createConnectedReadClient, createWalletWriteClient } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { deriveOpenOracleInitialReportSubmissionDetails, formatOpenOraclePriceInput, loadOpenOracleInitialReportPrice, OPEN_ORACLE_APPROVAL_AMOUNT } from '../lib/openOracle.js'
import { requireDefined } from '../lib/required.js'
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
	const { state: openOracleForm, setState: setOpenOracleForm } = useFormState<OpenOracleFormState>(getDefaultOpenOracleFormState())
	const openOracleResult = useSignal<OpenOracleActionResult | undefined>(undefined)
	const openOracleReportDetails = useSignal<OpenOracleReportDetails | undefined>(undefined)
	const loadedOpenOracleReportId = useSignal<bigint | undefined>(undefined)
	const openOracleInitialReportDefaultPrice = useSignal<string | undefined>(undefined)
	const openOracleInitialReportDefaultPriceSource = useSignal<'Uniswap V4' | 'Uniswap V3 fallback' | undefined>(undefined)
	const openOracleInitialReportToken1Allowance = useSignal<bigint | undefined>(undefined)
	const openOracleInitialReportToken2Allowance = useSignal<bigint | undefined>(undefined)
	const nextOpenOracleInitialReportStateLoad = useRequestGuard()

	const refreshOpenOracleInitialReportState = async (details: OpenOracleReportDetails | undefined) => {
		const currentDetails = details
		const isCurrent = nextOpenOracleInitialReportStateLoad()
		if (currentDetails === undefined) {
			openOracleInitialReportDefaultPrice.value = undefined
			openOracleInitialReportDefaultPriceSource.value = undefined
			openOracleInitialReportToken1Allowance.value = undefined
			openOracleInitialReportToken2Allowance.value = undefined
			return
		}

		await openOracleInitialReportStateLoad.run({
			isCurrent,
			onStart: () => {
				openOracleInitialReportToken1Allowance.value = undefined
				openOracleInitialReportToken2Allowance.value = undefined
			},
			load: async () => {
				const readClient = createConnectedReadClient()
				const [initialPrice, token1Allowance, token2Allowance] = await Promise.all([
					loadOpenOracleInitialReportPrice(readClient, currentDetails.token1, currentDetails.token2, currentDetails.exactToken1Report).catch(() => undefined),
					accountAddress === undefined ? Promise.resolve(undefined) : loadErc20Allowance(readClient, currentDetails.token1, accountAddress, getOpenOracleAddress()).catch(() => undefined),
					accountAddress === undefined ? Promise.resolve(undefined) : loadErc20Allowance(readClient, currentDetails.token2, accountAddress, getOpenOracleAddress()).catch(() => undefined),
				])

				return { initialPrice, token1Allowance, token2Allowance }
			},
			onSuccess: ({ initialPrice, token1Allowance, token2Allowance }) => {
				openOracleInitialReportDefaultPrice.value = initialPrice === undefined ? undefined : formatOpenOraclePriceInput(initialPrice.price)
				openOracleInitialReportDefaultPriceSource.value = initialPrice?.priceSource
				openOracleInitialReportToken1Allowance.value = token1Allowance
				openOracleInitialReportToken2Allowance.value = token2Allowance

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
			onSuccess: ({ details, reportId }) => {
				openOracleReportDetails.value = details
				loadedOpenOracleReportId.value = reportId
				openOracleForm.value = {
					...openOracleForm.value,
					price: '',
					stateHash: details.stateHash,
				}
			},
			onError: error => {
				openOracleReportDetails.value = undefined
				loadedOpenOracleReportId.value = undefined
				openOracleInitialReportDefaultPrice.value = undefined
				openOracleInitialReportDefaultPriceSource.value = undefined
				openOracleInitialReportToken1Allowance.value = undefined
				openOracleInitialReportToken2Allowance.value = undefined
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

	const runOracleAction = async (action: (walletAddress: Address) => Promise<OpenOracleActionResult>, errorFallback: string) =>
		await runWriteAction(
			buildWriteActionConfig({ accountAddress, onTransaction, onTransactionFinished, onTransactionRequested, refreshState }, openOracleError, 'Connect a wallet before operating open oracle'),
			async walletAddress => {
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

	const parseApproveAmount = (raw: string) => {
		const trimmed = raw.trim()
		if (trimmed === '') return OPEN_ORACLE_APPROVAL_AMOUNT
		try {
			return parseBigIntInput(trimmed, 'Approve amount')
		} catch {
			return OPEN_ORACLE_APPROVAL_AMOUNT
		}
	}

	const approveToken1 = async () =>
		await runOracleAction(async walletAddress => {
			const reportDetails = requireDefined(openOracleReportDetails.value, 'Load an oracle report first')
			return await approveErc20(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), reportDetails.token1, getOpenOracleAddress(), parseApproveAmount(openOracleForm.value.approveAmount1), 'approveToken1')
		}, 'Failed to approve token1')

	const approveToken2 = async () =>
		await runOracleAction(async walletAddress => {
			const reportDetails = requireDefined(openOracleReportDetails.value, 'Load an oracle report first')
			return await approveErc20(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), reportDetails.token2, getOpenOracleAddress(), parseApproveAmount(openOracleForm.value.approveAmount2), 'approveToken2')
		}, 'Failed to approve token2')

	const createOpenOracleGame = async () => {
		loadingOpenOracleCreate.value = true
		try {
			await runOracleAction(
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
		await runOracleAction(async walletAddress => {
			const reportDetails = requireDefined(openOracleReportDetails.value, 'Load an oracle report first')
			const submission = deriveOpenOracleInitialReportSubmissionDetails({
				approvedToken1Amount: openOracleInitialReportToken1Allowance.value,
				approvedToken2Amount: openOracleInitialReportToken2Allowance.value,
				defaultPrice: openOracleInitialReportDefaultPrice.value,
				defaultPriceSource: openOracleInitialReportDefaultPriceSource.value,
				priceInput: openOracleForm.value.price,
				reportDetails,
				token1Decimals: reportDetails.token1Decimals,
				token2Decimals: reportDetails.token2Decimals,
			})
			if (!submission.canSubmit || submission.amount1 === undefined || submission.amount2 === undefined) {
				throw new Error(submission.blockReason ?? 'Invalid price')
			}

			return await submitInitialOracleReport(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), getOpenOracleAddress(), reportDetails.reportId, submission.amount1, submission.amount2, parseBytes32Input(openOracleForm.value.stateHash, 'State hash'))
		}, 'Failed to submit initial report')

	const settleReport = async () => await runOracleAction(async walletAddress => await settleOracleReport(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), getOpenOracleAddress(), parseReportIdInput(openOracleForm.value.reportId)), 'Failed to settle report')

	const disputeReport = async () =>
		await runOracleAction(async walletAddress => {
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
		}, 'Failed to dispute report')

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
		refreshPrice: () => void refreshOpenOracleInitialReportState(openOracleReportDetails.value),
		loadingOpenOracleCreate: loadingOpenOracleCreate.value,
		loadingOracleReport: oracleReportLoad.isLoading.value,
		openOracleCreateForm: openOracleCreateForm.value,
		openOracleError: openOracleError.value,
		openOracleForm: openOracleForm.value,
		openOracleInitialReportState: {
			defaultPrice: openOracleInitialReportDefaultPrice.value,
			defaultPriceSource: openOracleInitialReportDefaultPriceSource.value,
			loading: openOracleInitialReportStateLoad.isLoading.value,
			token1Allowance: openOracleInitialReportToken1Allowance.value,
			token1Decimals: openOracleReportDetails.value?.token1Decimals,
			token2Allowance: openOracleInitialReportToken2Allowance.value,
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
