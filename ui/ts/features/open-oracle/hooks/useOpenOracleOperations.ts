import { useSignal } from '@preact/signals'
import { zeroAddress, type Abi, type Address, type Hash } from '@zoltar/shared/ethereum'
import { useEffect, useRef } from 'preact/hooks'
import { useFormState } from '../../../hooks/useFormState.js'
import { useLoadController } from '../../../hooks/useLoadController.js'
import { ABIS } from '../../../abis.js'
import { approveErc20, createOpenOracleReportInstance, disputeOracleReport, getOpenOracleAddress, isOpenOracleReportMissingError, loadOpenOracleReportDetails, loadOpenOracleWithdrawableBalances, readOptionalMulticall, settleOracleReport, withdrawOpenOracleBalance } from '../../../protocol/index.js'
import { assertNever } from '../../../lib/assert.js'
import { createConnectedReadClient, createWalletWriteClient } from '../../../lib/clients.js'
import { getErrorMessage } from '../../../lib/errors.js'
import {
	deriveOpenOracleDisputeSubmissionDetails,
	formatOpenOracleDisputeWriteErrorMessage,
	formatOpenOracleSettleWriteErrorMessage,
	getOpenOracleCreateGuardMessage,
	getOpenOracleCreateValidationMessage,
	getOpenOracleDisputeAvailability,
	getOpenOracleSelectedReportActionMode,
	getOpenOracleSettleAvailability,
	parseOpenOracleCreateFormSubmission,
} from '../lib/openOracle.js'
import { parseAddressInput, parseBytes32Input, parseReportIdInput } from '../../../lib/inputs.js'
import { getDefaultOpenOracleCreateFormState, getDefaultOpenOracleFormState, parseBigIntInput } from '../../markets/lib/marketForm.js'
import { requireDefined } from '../../../lib/required.js'
import type { TokenApprovalState } from '../../../lib/tokenApproval.js'
import { useRequestGuard } from '../../../lib/requestGuard.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '../../../lib/actionFeedback.js'
import type { ActionFeedback } from '../../../lib/actionFeedback.js'
import { createOpenOracleSuccessPresentation, createOpenOracleTransactionIntent, createOpenOracleWarningPresentation } from '../../transactionPresentations.js'
import { buildWriteActionConfig, runWriteAction } from '../../../lib/writeAction.js'
import { refreshWalletStateOnly } from '../../../lib/refreshState.js'
import type { OpenOracleCreateFormState, OpenOracleFormState, WriteOperationsParameters } from '../../../types/app.js'
import type { OpenOracleActionResult, OpenOracleReportDetails, OpenOracleWithdrawableBalances } from '../../../types/contracts.js'
import type { OpenOracleReportLookupState } from '../../types.js'

type UseOpenOracleOperationsParameters = WriteOperationsParameters & {
	enabled: boolean
}

type OpenOracleReadClient = {
	getBalance: (parameters: { address: Address }) => Promise<bigint>
	readContract: (parameters: { abi: Abi; address: Address; args: readonly unknown[]; functionName: string }) => Promise<unknown>
}

type OpenOracleProductionWriteClient = ReturnType<typeof createWalletWriteClient>
type OpenOracleRawReadResult = { error?: unknown; result?: unknown; status: 'failure' | 'success' }

export type UseOpenOracleOperationsDependencies<TWriteClient = OpenOracleProductionWriteClient> = {
	approveErc20: (client: TWriteClient, tokenAddress: Address, spenderAddress: Address, amount: bigint, action: 'approveToken1' | 'approveToken2') => Promise<OpenOracleActionResult>
	createConnectedReadClient: () => OpenOracleReadClient
	createOpenOracleReportInstance: (client: TWriteClient, parameters: ReturnType<typeof parseOpenOracleCreateFormSubmission>) => Promise<OpenOracleActionResult>
	createWalletWriteClient: (accountAddress: Address, callbacks?: Parameters<typeof createWalletWriteClient>[1]) => TWriteClient
	disputeOracleReport: (client: TWriteClient, openOracleAddress: Address, reportId: bigint, tokenToSwap: Address, newAmount1: bigint, newAmount2: bigint, currentAmount2: bigint, stateHash: Hash) => Promise<OpenOracleActionResult>
	loadOpenOracleReportDetails: (openOracleAddress: Address, reportId: bigint) => Promise<OpenOracleReportDetails>
	loadOpenOracleWithdrawableBalances: (openOracleAddress: Address, holder: Address, token1: Address, token2: Address) => Promise<OpenOracleWithdrawableBalances>
	readOptionalMulticall: (contracts: readonly unknown[]) => Promise<readonly OpenOracleRawReadResult[]>
	settleOracleReport: (client: TWriteClient, openOracleAddress: Address, reportId: bigint) => Promise<OpenOracleActionResult>
	withdrawOpenOracleBalance: (client: TWriteClient, openOracleAddress: Address, token: Address, recipient: Address) => Promise<OpenOracleActionResult>
}

const defaultUseOpenOracleOperationsDependencies: UseOpenOracleOperationsDependencies = {
	approveErc20: async (client, tokenAddress, spenderAddress, amount, action) => await approveErc20(client, tokenAddress, spenderAddress, amount, action),
	createConnectedReadClient: () => {
		const client = createConnectedReadClient()
		return {
			getBalance: async parameters => await client.getBalance(parameters),
			readContract: async parameters => await client.readContract(parameters),
		}
	},
	createOpenOracleReportInstance: async (client, parameters) => await createOpenOracleReportInstance(client, parameters),
	createWalletWriteClient,
	disputeOracleReport: async (client, openOracleAddress, reportId, tokenToSwap, newAmount1, newAmount2, currentAmount2, stateHash) => await disputeOracleReport(client, openOracleAddress, reportId, tokenToSwap, newAmount1, newAmount2, currentAmount2, stateHash),
	loadOpenOracleReportDetails: async (openOracleAddress, reportId) => await loadOpenOracleReportDetails(createConnectedReadClient(), openOracleAddress, reportId),
	loadOpenOracleWithdrawableBalances: async (openOracleAddress, holder, token1, token2) => await loadOpenOracleWithdrawableBalances(createConnectedReadClient(), openOracleAddress, holder, token1, token2),
	readOptionalMulticall: async contracts => await readOptionalMulticall(createConnectedReadClient(), contracts),
	settleOracleReport: async (client, openOracleAddress, reportId) => await settleOracleReport(client, openOracleAddress, reportId),
	withdrawOpenOracleBalance: async (client, openOracleAddress, token, recipient) => await withdrawOpenOracleBalance(client, openOracleAddress, token, recipient),
}

function requireTokenDecimals(value: unknown, label: string) {
	const decimals = Number(value)
	if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error(`Unexpected ${label} decimals response`)
	return decimals
}

type TokenAccessLoadResult = {
	amount: bigint | undefined
	error: string | undefined
}

type OpenOracleTokenAccessLoadResult = {
	token1ApprovalResult: TokenApprovalState
	token2ApprovalResult: TokenApprovalState
	token1BalanceResult: TokenAccessLoadResult
	token2BalanceResult: TokenAccessLoadResult
}

type LoadedOracleReportResult = {
	details: OpenOracleReportDetails
	reportId: bigint
}

type RefreshOpenOracleTokenAccessOptions = {
	preserveExisting?: boolean
}

type OptionalReadResult<TResult> = { result: TResult; status: 'success' } | { error: Error; result?: undefined; status: 'failure' }

function toReadError(error: unknown) {
	return error instanceof Error ? error : new Error('Unknown read error')
}

function toBigIntReadResult(result: OpenOracleRawReadResult): OptionalReadResult<bigint> {
	if (result.status === 'success') {
		if (typeof result.result !== 'bigint') {
			return {
				error: new Error('Unexpected non-bigint OpenOracle token access value'),
				status: 'failure',
			}
		}
		return {
			result: result.result,
			status: 'success',
		}
	}
	return {
		error: toReadError(result.error),
		status: 'failure',
	}
}

function useOpenOracleOperationsWithDependencies<TWriteClient>(
	{ accountAddress, enabled, onTransactionCanceled, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState }: UseOpenOracleOperationsParameters,
	dependencies: UseOpenOracleOperationsDependencies<TWriteClient>,
) {
	const loadingOpenOracleCreate = useSignal(false)
	const oracleReportLoad = useLoadController()
	const openOracleTokenAccessLoad = useLoadController()
	const openOracleWithdrawableBalanceLoad = useLoadController()
	const { state: openOracleCreateForm, setState: setOpenOracleCreateForm } = useFormState<OpenOracleCreateFormState>(getDefaultOpenOracleCreateFormState())
	const openOracleError = useSignal<string | undefined>(undefined)
	const openOracleActiveAction = useSignal<OpenOracleActionResult['action'] | undefined>(undefined)
	const openOracleActiveWithdrawalBalance = useSignal<keyof OpenOracleWithdrawableBalances | undefined>(undefined)
	const openOracleFeedback = useSignal<ActionFeedback<OpenOracleActionResult['action']> | undefined>(undefined)
	const { state: openOracleForm, setState: setOpenOracleFormState } = useFormState<OpenOracleFormState>(getDefaultOpenOracleFormState())
	const openOracleResult = useSignal<OpenOracleActionResult | undefined>(undefined)
	const openOracleReportDetails = useSignal<OpenOracleReportDetails | undefined>(undefined)
	const openOracleReportLookupState = useSignal<OpenOracleReportLookupState>('unknown')
	const openOracleWithdrawableBalances = useSignal<OpenOracleWithdrawableBalances | undefined>(undefined)
	const openOracleWithdrawableBalancesError = useSignal<string | undefined>(undefined)
	const loadedOpenOracleReportId = useSignal<bigint | undefined>(undefined)
	const openOracleToken1Approval = useSignal<TokenApprovalState>({
		error: undefined,
		loading: false,
		value: undefined,
	})
	const openOracleToken2Approval = useSignal<TokenApprovalState>({
		error: undefined,
		loading: false,
		value: undefined,
	})
	const openOracleToken1Balance = useSignal<bigint | undefined>(undefined)
	const openOracleToken1BalanceError = useSignal<string | undefined>(undefined)
	const openOracleToken2Balance = useSignal<bigint | undefined>(undefined)
	const openOracleToken2BalanceError = useSignal<string | undefined>(undefined)
	const openOracleTokenAccessLoadingInitial = useSignal(false)
	const openOracleTokenAccessRefreshing = useSignal(false)
	const nextOpenOracleTokenAccessLoad = useRequestGuard()
	const nextOpenOracleWithdrawableBalanceLoad = useRequestGuard()
	const nextOracleReportLoad = useRequestGuard()
	const currentSelectedReportIdInput = openOracleForm.value.reportId.trim()
	const currentSelectedReportIdRef = useRef(currentSelectedReportIdInput)
	currentSelectedReportIdRef.current = currentSelectedReportIdInput
	const getPendingTitle = (actionName: OpenOracleActionResult['action']) => {
		switch (actionName) {
			case 'approveToken1':
				return 'Approving base token'
			case 'approveToken2':
				return 'Approving quote token'
			case 'createReportInstance':
				return 'Creating standalone oracle report'
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
			case 'withdrawBalance':
				return 'Withdrawing Oracle balance'
			case 'wrapWeth':
				return 'Wrapping ETH to WETH'
			default:
				return assertNever(actionName)
		}
	}
	const getSuccessTitle = (actionName: OpenOracleActionResult['action']) => {
		switch (actionName) {
			case 'approveToken1':
				return 'Base token approved'
			case 'approveToken2':
				return 'Quote token approved'
			case 'createReportInstance':
				return 'Standalone oracle report created'
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
			case 'withdrawBalance':
				return 'Oracle balance withdrawn'
			case 'wrapWeth':
				return 'ETH wrapped to WETH'
			default:
				return assertNever(actionName)
		}
	}
	const getFailureTitle = (actionName: OpenOracleActionResult['action']) => {
		switch (actionName) {
			case 'approveToken1':
				return 'Base token approval failed'
			case 'approveToken2':
				return 'Quote token approval failed'
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
			case 'withdrawBalance':
				return 'Oracle balance withdrawal failed'
			case 'wrapWeth':
				return 'ETH wrap failed'
			default:
				return assertNever(actionName)
		}
	}

	const setOpenOracleTokenAccessMode = (mode: 'idle' | 'initial' | 'background') => {
		openOracleTokenAccessLoadingInitial.value = mode === 'initial'
		openOracleTokenAccessRefreshing.value = mode === 'background'
	}
	const isSelectedReportCurrent = (reportIdInput: string) => currentSelectedReportIdRef.current === reportIdInput.trim()

	const resetOpenOracleTokenApprovalState = (loading: boolean) => {
		openOracleToken1Approval.value = {
			error: undefined,
			loading,
			value: undefined,
		}
		openOracleToken2Approval.value = {
			error: undefined,
			loading,
			value: undefined,
		}
	}

	const resetOpenOracleTokenBalanceState = () => {
		openOracleToken1Balance.value = undefined
		openOracleToken1BalanceError.value = undefined
		openOracleToken2Balance.value = undefined
		openOracleToken2BalanceError.value = undefined
	}

	const resetOpenOracleTokenAccessState = (approvalLoading: boolean) => {
		resetOpenOracleTokenApprovalState(approvalLoading)
		resetOpenOracleTokenBalanceState()
		setOpenOracleTokenAccessMode('idle')
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

	const refreshOpenOracleWithdrawableBalances = async (details: OpenOracleReportDetails | undefined) => {
		const isCurrent = nextOpenOracleWithdrawableBalanceLoad()
		const holder = accountAddress
		if (details === undefined || holder === undefined) {
			openOracleWithdrawableBalances.value = undefined
			openOracleWithdrawableBalancesError.value = undefined
			return
		}
		const currentReportIdInput = details.reportId.toString()
		await openOracleWithdrawableBalanceLoad.run({
			isCurrent: () => isCurrent() && isSelectedReportCurrent(currentReportIdInput),
			onStart: () => {
				openOracleWithdrawableBalancesError.value = undefined
			},
			load: async () => await dependencies.loadOpenOracleWithdrawableBalances(getOpenOracleAddress(), holder, details.token1, details.token2),
			onSuccess: balances => {
				openOracleWithdrawableBalances.value = balances
			},
			onError: error => {
				openOracleWithdrawableBalancesError.value = getErrorMessage(error, 'Failed to load Open Oracle balances')
			},
		})
	}

	const applyLoadedOracleReport = (details: OpenOracleReportDetails) => {
		openOracleReportDetails.value = details
		loadedOpenOracleReportId.value = details.reportId
		openOracleForm.value = {
			...openOracleForm.value,
			reportId: details.reportId.toString(),
			stateHash: details.stateHash,
		}
	}

	const refreshOpenOracleTokenAccess = async (details: OpenOracleReportDetails | undefined, { preserveExisting = false }: RefreshOpenOracleTokenAccessOptions = {}) => {
		const currentDetails = details
		const isCurrent = nextOpenOracleTokenAccessLoad()
		if (currentDetails === undefined) {
			resetOpenOracleTokenAccessState(false)
			return
		}
		const currentReportIdInput = currentDetails.reportId.toString()
		const isCurrentSelectedReport = () => isSelectedReportCurrent(currentReportIdInput)

		try {
			await openOracleTokenAccessLoad.run({
				isCurrent: () => isCurrent() && isCurrentSelectedReport(),
				onStart: () => {
					setOpenOracleTokenAccessMode(preserveExisting ? 'background' : 'initial')
					if (!preserveExisting) {
						resetOpenOracleTokenAccessState(accountAddress !== undefined)
						setOpenOracleTokenAccessMode('initial')
					} else {
						openOracleToken1Approval.value = {
							...openOracleToken1Approval.value,
							loading: false,
						}
						openOracleToken2Approval.value = {
							...openOracleToken2Approval.value,
							loading: false,
						}
					}
				},
				load: async () => {
					if (accountAddress === undefined)
						return {
							token1ApprovalResult: { error: undefined, loading: false, value: undefined },
							token2ApprovalResult: { error: undefined, loading: false, value: undefined },
							token1BalanceResult: { amount: undefined, error: undefined },
							token2BalanceResult: { amount: undefined, error: undefined },
						} satisfies OpenOracleTokenAccessLoadResult
					const tokenAccessReadResults = await dependencies
						.readOptionalMulticall([
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
						])
						.catch(error => {
							const failureResult = {
								error: toReadError(error),
								status: 'failure',
							} satisfies OptionalReadResult<bigint>
							return [failureResult, failureResult, failureResult, failureResult]
						})
					const [token1ApprovalReadResult, token2ApprovalReadResult, token1BalanceReadResult, token2BalanceReadResult] = tokenAccessReadResults.map(toBigIntReadResult)
					if (token1ApprovalReadResult === undefined || token2ApprovalReadResult === undefined || token1BalanceReadResult === undefined || token2BalanceReadResult === undefined) throw new Error('Unexpected token access response')

					return {
						token1ApprovalResult: getTokenApprovalState(token1ApprovalReadResult),
						token2ApprovalResult: getTokenApprovalState(token2ApprovalReadResult),
						token1BalanceResult: getTokenBalanceState(token1BalanceReadResult),
						token2BalanceResult: getTokenBalanceState(token2BalanceReadResult),
					} satisfies OpenOracleTokenAccessLoadResult
				},
				onSuccess: ({ token1ApprovalResult, token2ApprovalResult, token1BalanceResult, token2BalanceResult }: OpenOracleTokenAccessLoadResult) => {
					openOracleToken1Approval.value = token1ApprovalResult
					openOracleToken2Approval.value = token2ApprovalResult
					openOracleToken1Balance.value = token1BalanceResult.amount
					openOracleToken1BalanceError.value = token1BalanceResult.error
					openOracleToken2Balance.value = token2BalanceResult.amount
					openOracleToken2BalanceError.value = token2BalanceResult.error
				},
				onError: () => undefined,
			})
		} finally {
			if (isCurrent() && isCurrentSelectedReport()) setOpenOracleTokenAccessMode('idle')
		}
	}

	const loadOracleReportById = async (reportId: bigint) => await dependencies.loadOpenOracleReportDetails(getOpenOracleAddress(), reportId)
	const setOpenOracleForm = (updater: (current: OpenOracleFormState) => OpenOracleFormState) => {
		setOpenOracleFormState(current => {
			const next = updater(current)
			const nextReportId = next.reportId.trim()
			if (nextReportId === current.reportId.trim()) return next

			currentSelectedReportIdRef.current = nextReportId
			openOracleReportLookupState.value = 'unknown'
			openOracleReportDetails.value = undefined
			loadedOpenOracleReportId.value = undefined
			openOracleError.value = undefined
			resetOpenOracleTokenAccessState(false)
			return { ...getDefaultOpenOracleFormState(), reportId: next.reportId }
		})
	}

	const loadOracleReport = async (reportIdInput?: string) => {
		const requestedReportIdInput = reportIdInput?.trim() ?? currentSelectedReportIdInput
		if (reportIdInput !== undefined) setOpenOracleForm(current => ({ ...current, reportId: requestedReportIdInput }))
		const isCurrentLoad = nextOracleReportLoad()
		await oracleReportLoad.run({
			onStart: () => {
				openOracleError.value = undefined
				openOracleReportLookupState.value = 'loading'
			},
			load: async () => {
				const reportIdValue = reportIdInput?.trim() ?? openOracleForm.value.reportId
				const reportId = parseReportIdInput(reportIdValue)
				const details = await loadOracleReportById(reportId)
				if (!isCurrentLoad() || !isSelectedReportCurrent(requestedReportIdInput)) throw new Error('Stale oracle report load')
				return { details, reportId } satisfies LoadedOracleReportResult
			},
			onSuccess: ({ details }: LoadedOracleReportResult) => {
				if (!isCurrentLoad() || !isSelectedReportCurrent(requestedReportIdInput)) return
				applyLoadedOracleReport(details)
				openOracleReportLookupState.value = 'ready'
			},
			onError: (error: unknown) => {
				if (!isCurrentLoad() || !isSelectedReportCurrent(requestedReportIdInput)) return
				openOracleReportDetails.value = undefined
				loadedOpenOracleReportId.value = undefined
				resetOpenOracleTokenAccessState(false)
				const reportMissing = isOpenOracleReportMissingError(error)
				openOracleReportLookupState.value = reportMissing ? 'missing' : 'load-failed'
				openOracleError.value = reportMissing ? undefined : getErrorMessage(error, 'Failed to load oracle report')
			},
		})
	}
	const ensureLoadedSelectedReport = async ({ forceReload = false, reportIdInput, requireCurrentSelection = false }: { forceReload?: boolean; reportIdInput?: string; requireCurrentSelection?: boolean } = {}) => {
		const selectedReportIdInput = reportIdInput?.trim() ?? currentSelectedReportIdInput
		const reportId = parseReportIdInput(selectedReportIdInput)
		if (!forceReload && openOracleReportDetails.value !== undefined && loadedOpenOracleReportId.value === reportId) return { reportId, details: openOracleReportDetails.value }

		const details = await loadOracleReportById(reportId)
		if (requireCurrentSelection && !isSelectedReportCurrent(selectedReportIdInput)) throw new Error('Selected report changed. Review the current report and try again.')
		applyLoadedOracleReport(details)

		return {
			details,
			reportId,
		}
	}

	const assertSelectedReportCurrent = (reportIdInput: string) => {
		if (!isSelectedReportCurrent(reportIdInput)) throw new Error('Selected report changed. Review the current report and try again.')
	}

	const requireLoadedCurrentSelectedReport = () => {
		const reportDetails = requireDefined(openOracleReportDetails.value, 'Load an oracle report first')
		assertSelectedReportCurrent(reportDetails.reportId.toString())
		return reportDetails
	}

	const getDisputeSubmission = (reportDetails: OpenOracleReportDetails, form: OpenOracleFormState = openOracleForm.value) =>
		deriveOpenOracleDisputeSubmissionDetails({
			accountAddress,
			approvedToken1Amount: openOracleToken1Approval.value.value,
			approvedToken2Amount: openOracleToken2Approval.value.value,
			disputeNewAmount1Input: form.disputeNewAmount1,
			disputeNewAmount2Input: form.disputeNewAmount2,
			disputeTokenToSwap: form.disputeTokenToSwap,
			reportDetails,
			token1AllowanceError: openOracleToken1Approval.value.error,
			token1Balance: openOracleToken1Balance.value,
			token1BalanceError: openOracleToken1BalanceError.value,
			token1Decimals: reportDetails.token1Decimals,
			token2AllowanceError: openOracleToken2Approval.value.error,
			token2Balance: openOracleToken2Balance.value,
			token2BalanceError: openOracleToken2BalanceError.value,
			token2Decimals: reportDetails.token2Decimals,
		})

	const runOracleAction = async (
		actionName: OpenOracleActionResult['action'],
		action: (walletAddress: Address) => Promise<OpenOracleActionResult>,
		errorFallback: string,
		options?: {
			formatErrorMessage?: (error: unknown, fallbackMessage: string) => string
			refreshTokenAccessOnSuccess?: boolean
		},
	) => {
		const actionReportIdInput = currentSelectedReportIdInput
		const reportDetailsSnapshot = openOracleReportDetails.value
		const transactionContext =
			actionName === 'createReportInstance'
				? { tokenPair: `${openOracleCreateForm.value.token1Address} / ${openOracleCreateForm.value.token2Address}` }
				: {
						openOracleAddress: reportDetailsSnapshot?.openOracleAddress,
						reportId: actionReportIdInput,
						tokenPair: reportDetailsSnapshot === undefined ? undefined : `${reportDetailsSnapshot.token1Symbol} / ${reportDetailsSnapshot.token2Symbol}`,
					}
		try {
			openOracleFeedback.value = createPendingActionFeedback(actionName, getPendingTitle(actionName))
			await runWriteAction(
				{
					...buildWriteActionConfig(
						{ accountAddress, onTransactionCanceled, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, refreshState },
						openOracleError,
						'Connect a wallet before operating Open Oracle',
						createOpenOracleTransactionIntent(actionName, transactionContext),
					),
					formatErrorMessage: options?.formatErrorMessage,
					onRefreshError: (message, hash) => {
						openOracleFeedback.value = createWarningActionFeedback(actionName, getSuccessTitle(actionName), message, hash)
						const result = openOracleResult.value
						if (result !== undefined) onTransactionPresented(createOpenOracleWarningPresentation(result, message, transactionContext))
					},
					onWriteError: message => {
						openOracleFeedback.value = createErrorActionFeedback(actionName, getFailureTitle(actionName), message)
					},
					refreshErrorFallback: 'Oracle transaction succeeded, but refreshing the selected report failed',
					refreshState: async () => {
						await refreshWalletStateOnly(refreshState)
					},
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
					onTransactionPresented(createOpenOracleSuccessPresentation(result, transactionContext))
					if (result.action === 'createReportInstance') openOracleCreateForm.value = getDefaultOpenOracleCreateFormState()
					if (result.action !== 'createReportInstance' && actionReportIdInput !== '' && isSelectedReportCurrent(actionReportIdInput)) {
						await ensureLoadedSelectedReport({ forceReload: true, reportIdInput: actionReportIdInput, requireCurrentSelection: true })
					}
					if ((result.action === 'settle' || result.action === 'withdrawBalance') && actionReportIdInput !== '' && isSelectedReportCurrent(actionReportIdInput)) {
						await refreshOpenOracleWithdrawableBalances(openOracleReportDetails.value)
					}
					if (options?.refreshTokenAccessOnSuccess === true && actionReportIdInput !== '' && isSelectedReportCurrent(actionReportIdInput)) {
						await refreshOpenOracleTokenAccess(openOracleReportDetails.value, { preserveExisting: true })
					}
				},
			)
		} finally {
			openOracleActiveAction.value = undefined
		}
	}

	const approveToken1 = async (amount?: bigint) =>
		await (() => {
			const submittedOpenOracleForm = openOracleForm.value
			return runOracleAction(
				'approveToken1',
				async walletAddress => {
					const reportDetails = requireLoadedCurrentSelectedReport()
					await refreshOpenOracleTokenAccess(reportDetails, { preserveExisting: true })
					assertSelectedReportCurrent(reportDetails.reportId.toString())
					if (getOpenOracleSelectedReportActionMode(reportDetails) !== 'dispute') throw new Error('Token approvals are only available while disputing a report')
					const disputeSubmission = getDisputeSubmission(reportDetails, submittedOpenOracleForm)
					const approvalAmount = amount ?? disputeSubmission.token1Approval.targetAmount ?? disputeSubmission.token1ContributionAmount
					if (approvalAmount === undefined) throw new Error('No base token approval amount is required for the selected report')
					return await dependencies.approveErc20(dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), reportDetails.token1, getOpenOracleAddress(), approvalAmount, 'approveToken1')
				},
				'Failed to approve base token',
				{ refreshTokenAccessOnSuccess: true },
			)
		})()

	const approveToken2 = async (amount?: bigint) =>
		await (() => {
			const submittedOpenOracleForm = openOracleForm.value
			return runOracleAction(
				'approveToken2',
				async walletAddress => {
					const reportDetails = requireLoadedCurrentSelectedReport()
					await refreshOpenOracleTokenAccess(reportDetails, { preserveExisting: true })
					assertSelectedReportCurrent(reportDetails.reportId.toString())
					if (getOpenOracleSelectedReportActionMode(reportDetails) !== 'dispute') throw new Error('Token approvals are only available while disputing a report')
					const disputeSubmission = getDisputeSubmission(reportDetails, submittedOpenOracleForm)
					const approvalAmount = amount ?? disputeSubmission.token2Approval.targetAmount ?? disputeSubmission.token2ContributionAmount
					if (approvalAmount === undefined) throw new Error('No quote token approval amount is required for the selected report')
					return await dependencies.approveErc20(dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), reportDetails.token2, getOpenOracleAddress(), approvalAmount, 'approveToken2')
				},
				'Failed to approve quote token',
				{ refreshTokenAccessOnSuccess: true },
			)
		})()

	const createOpenOracleGame = async () => {
		const submittedOpenOracleCreateForm = openOracleCreateForm.value
		loadingOpenOracleCreate.value = true
		try {
			await runOracleAction(
				'createReportInstance',
				async walletAddress => {
					const readClient = dependencies.createConnectedReadClient()
					const walletEthBalance = await readClient.getBalance({ address: walletAddress })
					const createGuardMessage = getOpenOracleCreateGuardMessage({
						ethValueInput: submittedOpenOracleCreateForm.ethValue,
						isMainnet: true,
						settlerRewardInput: submittedOpenOracleCreateForm.settlerReward,
						walletConnected: true,
						walletEthBalance,
					})
					if (createGuardMessage !== undefined) throw new Error(createGuardMessage)
					const createValidationMessage = getOpenOracleCreateValidationMessage({ form: submittedOpenOracleCreateForm })
					if (createValidationMessage !== undefined) throw new Error(createValidationMessage)
					const token1Address = parseAddressInput(submittedOpenOracleCreateForm.token1Address, 'Base token address')
					const token2Address = parseAddressInput(submittedOpenOracleCreateForm.token2Address, 'Quote token address')
					const [token1Decimals, token2Decimals] = await Promise.all([
						readClient.readContract({ abi: ABIS.mainnet.erc20, address: token1Address, args: [], functionName: 'decimals' }).then(value => requireTokenDecimals(value, 'Base token')),
						readClient.readContract({ abi: ABIS.mainnet.erc20, address: token2Address, args: [], functionName: 'decimals' }).then(value => requireTokenDecimals(value, 'Quote token')),
					])
					const preciseCreateValidationMessage = getOpenOracleCreateValidationMessage({ form: submittedOpenOracleCreateForm, token1Decimals, token2Decimals })
					if (preciseCreateValidationMessage !== undefined) throw new Error(preciseCreateValidationMessage)

					return await dependencies.createOpenOracleReportInstance(dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), parseOpenOracleCreateFormSubmission({ form: submittedOpenOracleCreateForm, token1Decimals, token2Decimals }))
				},
				'Failed to create standalone Open Oracle report',
			)
		} finally {
			loadingOpenOracleCreate.value = false
		}
	}

	const settleReport = async () =>
		await runOracleAction(
			'settle',
			async walletAddress => {
				const { details } = await ensureLoadedSelectedReport({ forceReload: true, requireCurrentSelection: true })
				const settleAvailability = getOpenOracleSettleAvailability(details)
				if (!settleAvailability.canAct) throw new Error(settleAvailability.message ?? 'This report is not ready to settle.')

				return await dependencies.settleOracleReport(dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), getOpenOracleAddress(), details.reportId)
			},
			'Failed to settle report',
			{ formatErrorMessage: formatOpenOracleSettleWriteErrorMessage },
		)

	const withdrawBalance = async (balance: keyof OpenOracleWithdrawableBalances) => {
		openOracleActiveWithdrawalBalance.value = balance
		try {
			await runOracleAction(
				'withdrawBalance',
				async walletAddress => {
					const details = requireLoadedCurrentSelectedReport()
					const balances = requireDefined(openOracleWithdrawableBalances.value, 'Load Open Oracle balances first')
					if (balances[balance] <= 0n) throw new Error('No withdrawable Open Oracle balance is available for this asset')
					let token = zeroAddress
					if (balance === 'token1') token = details.token1
					else if (balance === 'token2') token = details.token2
					return await dependencies.withdrawOpenOracleBalance(dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), getOpenOracleAddress(), token, walletAddress)
				},
				'Failed to withdraw Open Oracle balance',
			)
		} finally {
			openOracleActiveWithdrawalBalance.value = undefined
		}
	}

	const disputeReport = async () =>
		await (() => {
			const submittedOpenOracleForm = openOracleForm.value
			return runOracleAction(
				'dispute',
				async walletAddress => {
					const submittedReportIdInput = submittedOpenOracleForm.reportId.trim()
					const { details } = await ensureLoadedSelectedReport({ forceReload: true, reportIdInput: submittedReportIdInput, requireCurrentSelection: true })
					const disputeAvailability = getOpenOracleDisputeAvailability(details)
					if (!disputeAvailability.canAct) throw new Error(disputeAvailability.message ?? 'This report is not ready to dispute.')
					await refreshOpenOracleTokenAccess(details, { preserveExisting: true })
					assertSelectedReportCurrent(details.reportId.toString())
					const disputeSubmission = getDisputeSubmission(details, submittedOpenOracleForm)
					if (!disputeSubmission.canSubmit || disputeSubmission.expectedNewAmount1 === undefined) throw new Error(disputeSubmission.blockMessage?.message ?? 'Invalid dispute submission details.')
					const tokenToSwap = submittedOpenOracleForm.disputeTokenToSwap === 'token1' ? details.token1 : details.token2
					return await dependencies.disputeOracleReport(
						dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }),
						getOpenOracleAddress(),
						details.reportId,
						tokenToSwap,
						parseBigIntInput(submittedOpenOracleForm.disputeNewAmount1, 'New base token amount'),
						parseBigIntInput(submittedOpenOracleForm.disputeNewAmount2, 'New quote token amount'),
						details.currentAmount2,
						parseBytes32Input(submittedOpenOracleForm.stateHash, 'State hash'),
					)
				},
				'Failed to dispute report',
				{
					formatErrorMessage: formatOpenOracleDisputeWriteErrorMessage,
					refreshTokenAccessOnSuccess: true,
				},
			)
		})()

	useEffect(() => {
		if (!enabled) return
		if (openOracleReportDetails.value === undefined) {
			resetOpenOracleTokenAccessState(false)
			void refreshOpenOracleWithdrawableBalances(undefined)
			return
		}
		void refreshOpenOracleTokenAccess(openOracleReportDetails.value)
		void refreshOpenOracleWithdrawableBalances(openOracleReportDetails.value)
	}, [accountAddress, enabled, openOracleReportDetails.value?.reportId, openOracleReportDetails.value?.token1, openOracleReportDetails.value?.token2, openOracleReportDetails.value?.exactToken1Report, openOracleReportDetails.value?.isDistributed, openOracleReportDetails.value?.settlementTimestamp])

	const openOracleDisputeSubmission = openOracleReportDetails.value === undefined ? undefined : getDisputeSubmission(openOracleReportDetails.value)

	return {
		approveToken1,
		approveToken2,
		createOpenOracleGame,
		disputeReport,
		loadOracleReport,
		openOracleActiveAction: openOracleActiveAction.value,
		openOracleActiveWithdrawalBalance: openOracleActiveWithdrawalBalance.value,
		loadingOpenOracleCreate: loadingOpenOracleCreate.value,
		openOracleCreateForm: openOracleCreateForm.value,
		openOracleDisputeSubmission,
		openOracleError: openOracleError.value,
		openOracleFeedback: openOracleFeedback.value,
		openOracleForm: openOracleForm.value,
		openOracleTokenAccessState: {
			token1Approval: openOracleToken1Approval.value,
			token1Balance: openOracleToken1Balance.value,
			token1BalanceError: openOracleToken1BalanceError.value,
			token1Decimals: openOracleReportDetails.value?.token1Decimals,
			token2Approval: openOracleToken2Approval.value,
			token2Balance: openOracleToken2Balance.value,
			token2BalanceError: openOracleToken2BalanceError.value,
			token2Decimals: openOracleReportDetails.value?.token2Decimals,
			tokenAccessLoadingInitial: openOracleTokenAccessLoadingInitial.value && openOracleTokenAccessLoad.isLoading.value,
			tokenAccessRefreshing: openOracleTokenAccessRefreshing.value && openOracleTokenAccessLoad.isLoading.value,
		},
		openOracleReportLookupState: openOracleReportLookupState.value,
		openOracleReportDetails: openOracleReportDetails.value,
		openOracleResult: openOracleResult.value,
		openOracleWithdrawableBalances: openOracleWithdrawableBalances.value,
		openOracleWithdrawableBalancesError: openOracleWithdrawableBalancesError.value,
		openOracleWithdrawableBalancesLoading: openOracleWithdrawableBalanceLoad.isLoading.value,
		resetOpenOracleCreateForm: () => {
			openOracleCreateForm.value = getDefaultOpenOracleCreateFormState()
		},
		setOpenOracleCreateForm,
		setOpenOracleForm,
		settleReport,
		withdrawBalance,
	}
}

export function useOpenOracleOperations(parameters: UseOpenOracleOperationsParameters): ReturnType<typeof useOpenOracleOperationsWithDependencies<OpenOracleProductionWriteClient>>
export function useOpenOracleOperations<TWriteClient>(parameters: UseOpenOracleOperationsParameters, dependencies: UseOpenOracleOperationsDependencies<TWriteClient>): ReturnType<typeof useOpenOracleOperationsWithDependencies<TWriteClient>>
export function useOpenOracleOperations<TWriteClient>(parameters: UseOpenOracleOperationsParameters, dependencies?: UseOpenOracleOperationsDependencies<TWriteClient>) {
	if (dependencies === undefined) return useOpenOracleOperationsWithDependencies(parameters, defaultUseOpenOracleOperationsDependencies)
	return useOpenOracleOperationsWithDependencies(parameters, dependencies)
}
