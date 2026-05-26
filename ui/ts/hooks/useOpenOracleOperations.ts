import { useSignal } from '@preact/signals'
import type { Address } from 'viem'
import { useEffect } from 'preact/hooks'
import { useFormState } from './useFormState.js'
import { useLoadController } from './useLoadController.js'
import { ABIS } from '../abis.js'
import { approveErc20, createOpenOracleReportInstance, disputeOracleReport, getOpenOracleAddress, loadOpenOracleReportDetails, readOptionalMulticall, settleOracleReport, submitInitialOracleReport, wrapWeth } from '../contracts.js'
import { createConnectedReadClient, createWalletWriteClient } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import {
	deriveOpenOracleDisputeSubmissionDetails,
	deriveOpenOracleInitialReportSubmissionDetails,
	formatOpenOracleDisputeWriteErrorMessage,
	formatOpenOracleInitialReportWriteErrorMessage,
	formatOpenOraclePriceInput,
	formatOpenOracleSettleWriteErrorMessage,
	getOpenOracleCreateGuardMessage,
	getOpenOracleDisputeAvailability,
	getOpenOracleSelectedReportActionMode,
	getOpenOracleSettleAvailability,
	loadOpenOracleInitialReportPriceResult,
} from '../lib/openOracle.js'
import { parseAddressInput, parseBytes32Input, parseReportIdInput } from '../lib/inputs.js'
import { getDefaultOpenOracleCreateFormState, getDefaultOpenOracleFormState, parseBigIntInput } from '../lib/marketForm.js'
import { requireDefined } from '../lib/required.js'
import type { TokenApprovalState } from '../lib/tokenApproval.js'
import { useRequestGuard } from '../lib/requestGuard.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '../lib/actionFeedback.js'
import { buildWriteActionConfig, runWriteAction } from '../lib/writeAction.js'
import type { OpenOracleCreateFormState, OpenOracleFormState, WriteOperationsParameters } from '../types/app.js'
import type { ActionFeedback } from '../types/components.js'
import type { OpenOracleActionResult, OpenOracleReportDetails } from '../types/contracts.js'

type UseOpenOracleOperationsParameters = WriteOperationsParameters & {
	enabled: boolean
}

type TokenAccessLoadResult = {
	amount: bigint | undefined
	error: string | undefined
}

type OpenOracleInitialReportPriceLoadResult = Awaited<ReturnType<typeof loadOpenOracleInitialReportPriceResult>>

type OpenOracleInitialReportTokenAccessLoadResult = {
	ethBalanceResult: TokenAccessLoadResult
	token1ApprovalResult: TokenApprovalState
	token2ApprovalResult: TokenApprovalState
	token1BalanceResult: TokenAccessLoadResult
	token2BalanceResult: TokenAccessLoadResult
}

type LoadedOracleReportResult = {
	details: OpenOracleReportDetails
	reportId: bigint
}

type RefreshOpenOracleInitialReportOptions = {
	preserveExisting?: boolean
}

type OptionalReadResult<TResult> = { result: TResult; status: 'success' } | { error: Error; result?: undefined; status: 'failure' }

function toReadError(error: unknown) {
	return error instanceof Error ? error : new Error('Unknown read error')
}

export function useOpenOracleOperations({ accountAddress, enabled, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted, refreshState }: UseOpenOracleOperationsParameters) {
	const loadingOpenOracleCreate = useSignal(false)
	const oracleReportLoad = useLoadController()
	const openOracleInitialReportPriceLoad = useLoadController()
	const openOracleInitialReportTokenAccessLoad = useLoadController()
	const { state: openOracleCreateForm, setState: setOpenOracleCreateForm } = useFormState<OpenOracleCreateFormState>(getDefaultOpenOracleCreateFormState())
	const openOracleError = useSignal<string | undefined>(undefined)
	const openOracleActiveAction = useSignal<OpenOracleActionResult['action'] | undefined>(undefined)
	const openOracleFeedback = useSignal<ActionFeedback<OpenOracleActionResult['action']> | undefined>(undefined)
	const { state: openOracleForm, setState: setOpenOracleForm } = useFormState<OpenOracleFormState>(getDefaultOpenOracleFormState())
	const openOracleResult = useSignal<OpenOracleActionResult | undefined>(undefined)
	const openOracleReportDetails = useSignal<OpenOracleReportDetails | undefined>(undefined)
	const loadedOpenOracleReportId = useSignal<bigint | undefined>(undefined)
	const openOracleInitialReportDefaultPrice = useSignal<string | undefined>(undefined)
	const openOracleInitialReportDefaultPriceError = useSignal<string | undefined>(undefined)
	const openOracleInitialReportDefaultPriceSource = useSignal<'Uniswap V4' | 'Uniswap V3' | 'MOCK' | undefined>(undefined)
	const openOracleInitialReportDefaultPriceSourceUrl = useSignal<string | undefined>(undefined)
	const openOracleInitialReportQuoteAttemptedSources = useSignal<('Uniswap V4' | 'Uniswap V3' | 'MOCK')[] | undefined>(undefined)
	const openOracleInitialReportQuoteFailureKind = useSignal<'unsupported-pair' | 'quote-failed' | undefined>(undefined)
	const openOracleInitialReportQuoteFailureReason = useSignal<string | undefined>(undefined)
	const openOracleInitialReportEthBalance = useSignal<bigint | undefined>(undefined)
	const openOracleInitialReportEthBalanceError = useSignal<string | undefined>(undefined)
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
	const openOracleInitialReportToken1Balance = useSignal<bigint | undefined>(undefined)
	const openOracleInitialReportToken1BalanceError = useSignal<string | undefined>(undefined)
	const openOracleInitialReportToken2Balance = useSignal<bigint | undefined>(undefined)
	const openOracleInitialReportToken2BalanceError = useSignal<string | undefined>(undefined)
	const openOracleInitialReportTokenAccessLoadingInitial = useSignal(false)
	const openOracleInitialReportTokenAccessRefreshing = useSignal(false)
	const nextOpenOracleInitialReportPriceLoad = useRequestGuard()
	const nextOpenOracleInitialReportTokenAccessLoad = useRequestGuard()
	const nextOracleReportLoad = useRequestGuard()
	const getPendingTitle = (actionName: OpenOracleActionResult['action']) => {
		switch (actionName) {
			case 'approveToken1':
				return 'Approving token1'
			case 'approveToken2':
				return 'Approving token2'
			case 'createReportInstance':
				return 'Creating report instance'
			case 'dispute':
				return 'Submitting dispute'
			case 'executeStagedOperation':
				return 'Executing staged operation'
			case 'queueOperation':
				return 'Queueing operation'
			case 'requestPrice':
				return 'Requesting price'
			case 'settle':
				return 'Settling report'
			case 'submitInitialReport':
				return 'Submitting initial report'
			case 'wrapWeth':
				return 'Wrapping ETH to WETH'
		}
	}
	const getSuccessTitle = (actionName: OpenOracleActionResult['action']) => {
		switch (actionName) {
			case 'approveToken1':
				return 'Token1 approved'
			case 'approveToken2':
				return 'Token2 approved'
			case 'createReportInstance':
				return 'Report instance created'
			case 'dispute':
				return 'Dispute submitted'
			case 'executeStagedOperation':
				return 'Staged operation executed'
			case 'queueOperation':
				return 'Operation queued'
			case 'requestPrice':
				return 'Price requested'
			case 'settle':
				return 'Report settled'
			case 'submitInitialReport':
				return 'Initial report submitted'
			case 'wrapWeth':
				return 'ETH wrapped to WETH'
		}
	}
	const getFailureTitle = (actionName: OpenOracleActionResult['action']) => {
		switch (actionName) {
			case 'approveToken1':
				return 'Token1 approval failed'
			case 'approveToken2':
				return 'Token2 approval failed'
			case 'createReportInstance':
				return 'Report creation failed'
			case 'dispute':
				return 'Dispute failed'
			case 'executeStagedOperation':
				return 'Staged operation failed'
			case 'queueOperation':
				return 'Queue operation failed'
			case 'requestPrice':
				return 'Price request failed'
			case 'settle':
				return 'Settlement failed'
			case 'submitInitialReport':
				return 'Initial report failed'
			case 'wrapWeth':
				return 'ETH wrap failed'
		}
	}

	const setOpenOracleInitialReportTokenAccessMode = (mode: 'idle' | 'initial' | 'background') => {
		openOracleInitialReportTokenAccessLoadingInitial.value = mode === 'initial'
		openOracleInitialReportTokenAccessRefreshing.value = mode === 'background'
	}

	const resetOpenOracleInitialReportQuoteState = () => {
		openOracleInitialReportDefaultPrice.value = undefined
		openOracleInitialReportDefaultPriceError.value = undefined
		openOracleInitialReportDefaultPriceSource.value = undefined
		openOracleInitialReportDefaultPriceSourceUrl.value = undefined
		openOracleInitialReportQuoteAttemptedSources.value = undefined
		openOracleInitialReportQuoteFailureKind.value = undefined
		openOracleInitialReportQuoteFailureReason.value = undefined
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

	const resetOpenOracleInitialReportBalanceState = () => {
		openOracleInitialReportEthBalance.value = undefined
		openOracleInitialReportEthBalanceError.value = undefined
		openOracleInitialReportToken1Balance.value = undefined
		openOracleInitialReportToken1BalanceError.value = undefined
		openOracleInitialReportToken2Balance.value = undefined
		openOracleInitialReportToken2BalanceError.value = undefined
	}

	const resetOpenOracleInitialReportTokenAccessState = (approvalLoading: boolean) => {
		resetOpenOracleTokenApprovalState(approvalLoading)
		resetOpenOracleInitialReportBalanceState()
		setOpenOracleInitialReportTokenAccessMode('idle')
	}

	const resetOpenOracleInitialReportState = (approvalLoading: boolean) => {
		resetOpenOracleInitialReportQuoteState()
		resetOpenOracleInitialReportTokenAccessState(approvalLoading)
	}

	const getTokenApprovalState = (result: OptionalReadResult<bigint>): TokenApprovalState => {
		if (result.status === 'success')
			return {
				error: undefined,
				loading: false,
				value: result.result,
			}
		return {
			error: getErrorMessage(result.error, 'Failed to load token approval'),
			loading: false,
			value: undefined,
		}
	}

	const getTokenBalanceState = (result: OptionalReadResult<bigint>): TokenAccessLoadResult => {
		if (result.status === 'success')
			return {
				amount: result.result,
				error: undefined,
			}
		return {
			amount: undefined,
			error: getErrorMessage(result.error, 'Failed to load token balance'),
		}
	}

	const loadEthBalance = async (readClient = createConnectedReadClient()): Promise<TokenAccessLoadResult> => {
		if (accountAddress === undefined) return { amount: undefined, error: undefined }

		try {
			return {
				amount: await readClient.getBalance({ address: accountAddress }),
				error: undefined,
			}
		} catch (error) {
			return {
				amount: undefined,
				error: getErrorMessage(error, 'Failed to load wallet ETH balance'),
			}
		}
	}

	const applyLoadedOracleReport = (details: OpenOracleReportDetails, { resetPrice }: { resetPrice: boolean }) => {
		openOracleReportDetails.value = details
		loadedOpenOracleReportId.value = details.reportId
		openOracleForm.value = {
			...openOracleForm.value,
			reportId: details.reportId.toString(),
			stateHash: details.stateHash,
			...(resetPrice ? { price: '' } : {}),
		}
	}

	const refreshOpenOracleInitialReportQuote = async (details: OpenOracleReportDetails | undefined, { preserveExisting = false }: RefreshOpenOracleInitialReportOptions = {}) => {
		const currentDetails = details
		const isCurrent = nextOpenOracleInitialReportPriceLoad()
		if (currentDetails === undefined) {
			resetOpenOracleInitialReportQuoteState()
			return
		}

		await openOracleInitialReportPriceLoad.run({
			isCurrent,
			onStart: () => {
				if (!preserveExisting) resetOpenOracleInitialReportQuoteState()
			},
			load: async () => await loadOpenOracleInitialReportPriceResult(createConnectedReadClient(), currentDetails.token1, currentDetails.token2, currentDetails.exactToken1Report),
			onSuccess: (initialPriceResult: OpenOracleInitialReportPriceLoadResult) => {
				const initialPrice = initialPriceResult.status === 'success' ? initialPriceResult : undefined
				const priceFailure = initialPriceResult.status === 'failure' ? initialPriceResult : undefined

				openOracleInitialReportDefaultPrice.value = initialPrice === undefined ? undefined : formatOpenOraclePriceInput(initialPrice.price)
				openOracleInitialReportDefaultPriceError.value = priceFailure?.reason
				openOracleInitialReportDefaultPriceSource.value = initialPrice?.priceSource
				openOracleInitialReportDefaultPriceSourceUrl.value = initialPrice?.priceSourceUrl
				openOracleInitialReportQuoteAttemptedSources.value = priceFailure?.attemptedSources
				openOracleInitialReportQuoteFailureKind.value = priceFailure?.failureKind
				openOracleInitialReportQuoteFailureReason.value = priceFailure?.reason

				if (openOracleForm.value.price.trim() === '' || openOracleForm.value.reportId.trim() !== currentDetails.reportId.toString())
					openOracleForm.value = {
						...openOracleForm.value,
						amount1: currentDetails.exactToken1Report.toString(),
						amount2: initialPrice?.token2Amount?.toString() ?? openOracleForm.value.amount2,
						price: initialPrice === undefined ? '' : formatOpenOraclePriceInput(initialPrice.price),
					}
			},
			onError: () => undefined,
		})
	}

	const refreshOpenOracleInitialReportTokenAccess = async (details: OpenOracleReportDetails | undefined, { preserveExisting = false }: RefreshOpenOracleInitialReportOptions = {}) => {
		const currentDetails = details
		const isCurrent = nextOpenOracleInitialReportTokenAccessLoad()
		if (currentDetails === undefined) {
			resetOpenOracleInitialReportTokenAccessState(false)
			return
		}

		try {
			await openOracleInitialReportTokenAccessLoad.run({
				isCurrent,
				onStart: () => {
					setOpenOracleInitialReportTokenAccessMode(preserveExisting ? 'background' : 'initial')
					if (!preserveExisting) {
						resetOpenOracleInitialReportTokenAccessState(accountAddress !== undefined)
						setOpenOracleInitialReportTokenAccessMode('initial')
					} else {
						openOracleInitialReportToken1Approval.value = {
							...openOracleInitialReportToken1Approval.value,
							loading: false,
						}
						openOracleInitialReportToken2Approval.value = {
							...openOracleInitialReportToken2Approval.value,
							loading: false,
						}
					}
				},
				load: async () => {
					if (accountAddress === undefined)
						return {
							ethBalanceResult: { amount: undefined, error: undefined },
							token1ApprovalResult: { error: undefined, loading: false, value: undefined },
							token2ApprovalResult: { error: undefined, loading: false, value: undefined },
							token1BalanceResult: { amount: undefined, error: undefined },
							token2BalanceResult: { amount: undefined, error: undefined },
						} satisfies OpenOracleInitialReportTokenAccessLoadResult
					const readClient = createConnectedReadClient()
					const [ethBalanceResult, [token1ApprovalReadResult, token2ApprovalReadResult, token1BalanceReadResult, token2BalanceReadResult]] = await Promise.all([
						loadEthBalance(readClient),
						readOptionalMulticall(readClient, [
							{
								abi: ABIS.mainnet.erc20,
								functionName: 'allowance',
								address: currentDetails.token1,
								args: [accountAddress, getOpenOracleAddress()],
							},
							{
								abi: ABIS.mainnet.erc20,
								functionName: 'allowance',
								address: currentDetails.token2,
								args: [accountAddress, getOpenOracleAddress()],
							},
							{
								abi: ABIS.mainnet.erc20,
								functionName: 'balanceOf',
								address: currentDetails.token1,
								args: [accountAddress],
							},
							{
								abi: ABIS.mainnet.erc20,
								functionName: 'balanceOf',
								address: currentDetails.token2,
								args: [accountAddress],
							},
						]).catch(error => {
							const failureResult = {
								error: toReadError(error),
								status: 'failure',
							} satisfies OptionalReadResult<bigint>
							return [failureResult, failureResult, failureResult, failureResult]
						}),
					])
					if (token1ApprovalReadResult === undefined || token2ApprovalReadResult === undefined || token1BalanceReadResult === undefined || token2BalanceReadResult === undefined) throw new Error('Unexpected token access response')

					return {
						ethBalanceResult,
						token1ApprovalResult: getTokenApprovalState(token1ApprovalReadResult),
						token2ApprovalResult: getTokenApprovalState(token2ApprovalReadResult),
						token1BalanceResult: getTokenBalanceState(token1BalanceReadResult),
						token2BalanceResult: getTokenBalanceState(token2BalanceReadResult),
					} satisfies OpenOracleInitialReportTokenAccessLoadResult
				},
				onSuccess: ({ ethBalanceResult, token1ApprovalResult, token2ApprovalResult, token1BalanceResult, token2BalanceResult }: OpenOracleInitialReportTokenAccessLoadResult) => {
					openOracleInitialReportEthBalance.value = ethBalanceResult.amount
					openOracleInitialReportEthBalanceError.value = ethBalanceResult.error
					openOracleInitialReportToken1Approval.value = token1ApprovalResult
					openOracleInitialReportToken2Approval.value = token2ApprovalResult
					openOracleInitialReportToken1Balance.value = token1BalanceResult.amount
					openOracleInitialReportToken1BalanceError.value = token1BalanceResult.error
					openOracleInitialReportToken2Balance.value = token2BalanceResult.amount
					openOracleInitialReportToken2BalanceError.value = token2BalanceResult.error
				},
				onError: () => undefined,
			})
		} finally {
			if (isCurrent()) setOpenOracleInitialReportTokenAccessMode('idle')
		}
	}

	const loadOracleReportById = async (reportId: bigint) => await loadOpenOracleReportDetails(createConnectedReadClient(), getOpenOracleAddress(), reportId)

	const loadOracleReport = async (reportIdInput?: string) => {
		const isCurrent = nextOracleReportLoad()
		await oracleReportLoad.run({
			onStart: () => {
				openOracleError.value = undefined
			},
			load: async () => {
				const reportIdValue = reportIdInput?.trim() ?? openOracleForm.value.reportId
				const reportId = parseReportIdInput(reportIdValue)
				if (reportIdInput !== undefined)
					openOracleForm.value = {
						...openOracleForm.value,
						reportId: reportIdValue,
					}
				const details = await loadOracleReportById(reportId)
				if (!isCurrent()) throw new Error('Stale oracle report load')
				return { details, reportId } satisfies LoadedOracleReportResult
			},
			onSuccess: ({ details }: LoadedOracleReportResult) => {
				if (!isCurrent()) return
				applyLoadedOracleReport(details, { resetPrice: true })
			},
			onError: (error: unknown) => {
				if (!isCurrent()) return
				openOracleReportDetails.value = undefined
				loadedOpenOracleReportId.value = undefined
				resetOpenOracleInitialReportState(false)
				openOracleError.value = getErrorMessage(error, 'Failed to load oracle report')
			},
		})
	}

	const ensureLoadedSelectedReport = async ({ forceReload = false }: { forceReload?: boolean } = {}) => {
		const reportId = parseReportIdInput(openOracleForm.value.reportId)
		if (!forceReload && openOracleReportDetails.value !== undefined && loadedOpenOracleReportId.value === reportId) return { reportId, details: openOracleReportDetails.value }

		const details = await loadOracleReportById(reportId)
		applyLoadedOracleReport(details, { resetPrice: false })

		return {
			details,
			reportId,
		}
	}

	const getInitialReportSubmission = (reportDetails: OpenOracleReportDetails) =>
		deriveOpenOracleInitialReportSubmissionDetails({
			approvedToken1Amount: openOracleInitialReportToken1Approval.value.value,
			approvedToken2Amount: openOracleInitialReportToken2Approval.value.value,
			defaultPrice: openOracleInitialReportDefaultPrice.value,
			defaultPriceError: openOracleInitialReportDefaultPriceError.value,
			defaultPriceSource: openOracleInitialReportDefaultPriceSource.value,
			defaultPriceSourceUrl: openOracleInitialReportDefaultPriceSourceUrl.value,
			priceInput: openOracleForm.value.price,
			quoteAttemptedSources: openOracleInitialReportQuoteAttemptedSources.value,
			quoteFailureReason: openOracleInitialReportQuoteFailureReason.value,
			reportDetails,
			token1AllowanceError: openOracleInitialReportToken1Approval.value.error,
			token1Balance: openOracleInitialReportToken1Balance.value,
			token1BalanceError: openOracleInitialReportToken1BalanceError.value,
			token1Decimals: reportDetails.token1Decimals,
			token2AllowanceError: openOracleInitialReportToken2Approval.value.error,
			token2Balance: openOracleInitialReportToken2Balance.value,
			token2BalanceError: openOracleInitialReportToken2BalanceError.value,
			token2Decimals: reportDetails.token2Decimals,
			walletEthBalance: openOracleInitialReportEthBalance.value,
		})

	const getDisputeSubmission = (reportDetails: OpenOracleReportDetails) =>
		deriveOpenOracleDisputeSubmissionDetails({
			approvedToken1Amount: openOracleInitialReportToken1Approval.value.value,
			approvedToken2Amount: openOracleInitialReportToken2Approval.value.value,
			disputeNewAmount1Input: openOracleForm.value.disputeNewAmount1,
			disputeNewAmount2Input: openOracleForm.value.disputeNewAmount2,
			disputeTokenToSwap: openOracleForm.value.disputeTokenToSwap,
			reportDetails,
			token1AllowanceError: openOracleInitialReportToken1Approval.value.error,
			token1Balance: openOracleInitialReportToken1Balance.value,
			token1BalanceError: openOracleInitialReportToken1BalanceError.value,
			token1Decimals: reportDetails.token1Decimals,
			token2AllowanceError: openOracleInitialReportToken2Approval.value.error,
			token2Balance: openOracleInitialReportToken2Balance.value,
			token2BalanceError: openOracleInitialReportToken2BalanceError.value,
			token2Decimals: reportDetails.token2Decimals,
		})

	const runOracleAction = async (
		actionName: OpenOracleActionResult['action'],
		action: (walletAddress: Address) => Promise<OpenOracleActionResult>,
		errorFallback: string,
		options?: {
			formatErrorMessage?: (error: unknown, fallbackMessage: string) => string
			refreshInitialReportTokenAccessOnSuccess?: boolean
		},
	) => {
		try {
			openOracleFeedback.value = createPendingActionFeedback(actionName, getPendingTitle(actionName))
			await runWriteAction(
				{
					...buildWriteActionConfig({ accountAddress, onTransaction, onTransactionFinished, onTransactionRequested, refreshState }, openOracleError, 'Connect a wallet before operating open oracle'),
					formatErrorMessage: options?.formatErrorMessage,
					onRefreshError: (message, hash) => {
						openOracleFeedback.value = createWarningActionFeedback(actionName, getSuccessTitle(actionName), message, hash)
					},
					onWriteError: message => {
						openOracleFeedback.value = createErrorActionFeedback(actionName, getFailureTitle(actionName), message)
					},
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
					openOracleFeedback.value = createSuccessActionFeedback(actionName, getSuccessTitle(actionName), result.hash)
					if (result.action === 'createReportInstance') openOracleCreateForm.value = getDefaultOpenOracleCreateFormState()
					if (result.action !== 'createReportInstance' && openOracleForm.value.reportId.trim() !== '') await ensureLoadedSelectedReport({ forceReload: true })
					if (options?.refreshInitialReportTokenAccessOnSuccess === true) await refreshOpenOracleInitialReportTokenAccess(openOracleReportDetails.value, { preserveExisting: true })
				},
			)
		} finally {
			openOracleActiveAction.value = undefined
		}
	}

	const approveToken1 = async (amount?: bigint) =>
		await runOracleAction(
			'approveToken1',
			async walletAddress => {
				const reportDetails = requireDefined(openOracleReportDetails.value, 'Load an oracle report first')
				const selectedActionMode = getOpenOracleSelectedReportActionMode(reportDetails)
				const initialReportSubmission = selectedActionMode === 'initial-report' ? getInitialReportSubmission(reportDetails) : undefined
				const disputeSubmission = selectedActionMode === 'dispute' ? getDisputeSubmission(reportDetails) : undefined
				const approvalAmount = amount ?? initialReportSubmission?.token1Approval.targetAmount ?? initialReportSubmission?.amount1 ?? disputeSubmission?.token1Approval.targetAmount ?? disputeSubmission?.token1ContributionAmount
				if (approvalAmount === undefined) throw new Error('No token1 approval amount is required for the selected report')
				return await approveErc20(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), reportDetails.token1, getOpenOracleAddress(), approvalAmount, 'approveToken1')
			},
			'Failed to approve token1',
			{ refreshInitialReportTokenAccessOnSuccess: true },
		)

	const approveToken2 = async (amount?: bigint) =>
		await runOracleAction(
			'approveToken2',
			async walletAddress => {
				const reportDetails = requireDefined(openOracleReportDetails.value, 'Load an oracle report first')
				const selectedActionMode = getOpenOracleSelectedReportActionMode(reportDetails)
				const initialReportSubmission = selectedActionMode === 'initial-report' ? getInitialReportSubmission(reportDetails) : undefined
				const disputeSubmission = selectedActionMode === 'dispute' ? getDisputeSubmission(reportDetails) : undefined
				const approvalAmount = amount ?? initialReportSubmission?.token2Approval.targetAmount ?? initialReportSubmission?.amount2 ?? disputeSubmission?.token2Approval.targetAmount ?? disputeSubmission?.token2ContributionAmount
				if (approvalAmount === undefined) throw new Error('No token2 approval amount is required for the selected report')
				return await approveErc20(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), reportDetails.token2, getOpenOracleAddress(), approvalAmount, 'approveToken2')
			},
			'Failed to approve token2',
			{ refreshInitialReportTokenAccessOnSuccess: true },
		)

	const createOpenOracleGame = async () => {
		loadingOpenOracleCreate.value = true
		try {
			await runOracleAction(
				'createReportInstance',
				async walletAddress => {
					const walletEthBalance = await createConnectedReadClient().getBalance({ address: walletAddress })
					const createGuardMessage = getOpenOracleCreateGuardMessage({
						ethValueInput: openOracleCreateForm.value.ethValue,
						isMainnet: true,
						settlerRewardInput: openOracleCreateForm.value.settlerReward,
						walletConnected: true,
						walletEthBalance,
					})
					if (createGuardMessage !== undefined) throw new Error(createGuardMessage)

					return await createOpenOracleReportInstance(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), {
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
					})
				},
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
				const { details: reportDetails } = await ensureLoadedSelectedReport({ forceReload: true })
				if (getOpenOracleSelectedReportActionMode(reportDetails) !== 'initial-report') {
					const submission = getInitialReportSubmission(reportDetails)
					throw new Error(submission.blockMessage?.message ?? 'This report already has an initial report.')
				}

				await refreshOpenOracleInitialReportTokenAccess(reportDetails, { preserveExisting: true })
				const submission = getInitialReportSubmission(reportDetails)
				if (!submission.canSubmit || submission.amount1 === undefined || submission.amount2 === undefined) throw new Error(submission.blockMessage?.message ?? 'Invalid price')

				return await submitInitialOracleReport(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), getOpenOracleAddress(), reportDetails.reportId, submission.amount1, submission.amount2, parseBytes32Input(openOracleForm.value.stateHash, 'State hash'))
			},
			'Failed to submit initial report',
			{ formatErrorMessage: formatOpenOracleInitialReportWriteErrorMessage },
		)

	const wrapWethForInitialReport = async () =>
		await runOracleAction(
			'wrapWeth',
			async walletAddress => {
				const reportDetails = requireDefined(openOracleReportDetails.value, 'Load an oracle report first')
				await refreshOpenOracleInitialReportTokenAccess(reportDetails, { preserveExisting: true })
				const submission = getInitialReportSubmission(reportDetails)
				const wrapAmount = submission.requiredWethWrapAmount
				if (wrapAmount === undefined || wrapAmount <= 0n || !submission.canWrapRequiredWeth) throw new Error(submission.wrapRequiredWethMessage?.message ?? 'No WETH wrap is required for this report')

				return await wrapWeth(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), wrapAmount)
			},
			'Failed to wrap ETH to WETH',
			{ refreshInitialReportTokenAccessOnSuccess: true },
		)

	const settleReport = async () =>
		await runOracleAction(
			'settle',
			async walletAddress => {
				const { details } = await ensureLoadedSelectedReport({ forceReload: true })
				const settleAvailability = getOpenOracleSettleAvailability(details)
				if (!settleAvailability.canAct) throw new Error(settleAvailability.message ?? 'This report is not ready to settle yet.')

				return await settleOracleReport(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), getOpenOracleAddress(), details.reportId)
			},
			'Failed to settle report',
			{ formatErrorMessage: formatOpenOracleSettleWriteErrorMessage },
		)

	const disputeReport = async () =>
		await runOracleAction(
			'dispute',
			async walletAddress => {
				const { details } = await ensureLoadedSelectedReport({ forceReload: true })
				const disputeAvailability = getOpenOracleDisputeAvailability(details)
				if (!disputeAvailability.canAct) throw new Error(disputeAvailability.message ?? 'This report is not ready to dispute yet.')
				await refreshOpenOracleInitialReportTokenAccess(details, { preserveExisting: true })
				const disputeSubmission = getDisputeSubmission(details)
				if (!disputeSubmission.canSubmit || disputeSubmission.expectedNewAmount1 === undefined) throw new Error(disputeSubmission.blockMessage?.message ?? 'Invalid dispute submission details.')
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
			{ formatErrorMessage: formatOpenOracleDisputeWriteErrorMessage },
		)

	useEffect(() => {
		if (!enabled) return
		if (openOracleReportDetails.value === undefined) {
			resetOpenOracleInitialReportState(false)
			return
		}
		void refreshOpenOracleInitialReportQuote(openOracleReportDetails.value)
		void refreshOpenOracleInitialReportTokenAccess(openOracleReportDetails.value)
	}, [accountAddress, enabled, openOracleReportDetails.value?.reportId, openOracleReportDetails.value?.token1, openOracleReportDetails.value?.token2, openOracleReportDetails.value?.exactToken1Report])

	const openOracleInitialReportSubmission = openOracleReportDetails.value === undefined ? undefined : getInitialReportSubmission(openOracleReportDetails.value)
	const openOracleDisputeSubmission = openOracleReportDetails.value === undefined ? undefined : getDisputeSubmission(openOracleReportDetails.value)

	return {
		approveToken1,
		approveToken2,
		createOpenOracleGame,
		disputeReport,
		loadOracleReport,
		openOracleActiveAction: openOracleActiveAction.value,
		refreshPrice: () => void refreshOpenOracleInitialReportQuote(openOracleReportDetails.value),
		loadingOpenOracleCreate: loadingOpenOracleCreate.value,
		loadingOracleReport: oracleReportLoad.isLoading.value,
		openOracleCreateForm: openOracleCreateForm.value,
		openOracleDisputeSubmission,
		openOracleError: openOracleError.value,
		openOracleFeedback: openOracleFeedback.value,
		openOracleForm: openOracleForm.value,
		openOracleInitialReportState: {
			defaultPrice: openOracleInitialReportDefaultPrice.value,
			defaultPriceError: openOracleInitialReportDefaultPriceError.value,
			defaultPriceSource: openOracleInitialReportDefaultPriceSource.value,
			defaultPriceSourceUrl: openOracleInitialReportDefaultPriceSourceUrl.value,
			ethBalance: openOracleInitialReportEthBalance.value,
			ethBalanceError: openOracleInitialReportEthBalanceError.value,
			quoteLoading: openOracleInitialReportPriceLoad.isLoading.value,
			quoteAttemptedSources: openOracleInitialReportQuoteAttemptedSources.value,
			quoteFailureKind: openOracleInitialReportQuoteFailureKind.value,
			quoteFailureReason: openOracleInitialReportQuoteFailureReason.value,
			token1Approval: openOracleInitialReportToken1Approval.value,
			token1Balance: openOracleInitialReportToken1Balance.value,
			token1BalanceError: openOracleInitialReportToken1BalanceError.value,
			token1Decimals: openOracleReportDetails.value?.token1Decimals,
			token2Approval: openOracleInitialReportToken2Approval.value,
			token2Balance: openOracleInitialReportToken2Balance.value,
			token2BalanceError: openOracleInitialReportToken2BalanceError.value,
			token2Decimals: openOracleReportDetails.value?.token2Decimals,
			tokenAccessLoadingInitial: openOracleInitialReportTokenAccessLoadingInitial.value && openOracleInitialReportTokenAccessLoad.isLoading.value,
			tokenAccessRefreshing: openOracleInitialReportTokenAccessRefreshing.value && openOracleInitialReportTokenAccessLoad.isLoading.value,
		},
		openOracleInitialReportSubmission,
		openOracleReportDetails: openOracleReportDetails.value,
		openOracleResult: openOracleResult.value,
		resetOpenOracleCreateForm: () => {
			openOracleCreateForm.value = getDefaultOpenOracleCreateFormState()
		},
		setOpenOracleCreateForm,
		setOpenOracleForm,
		settleReport,
		submitInitialReport,
		wrapWethForInitialReport,
	}
}
