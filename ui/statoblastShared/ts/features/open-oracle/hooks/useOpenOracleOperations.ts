import { useSignal } from '@preact/signals'
import { zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { useEffect, useRef } from 'preact/hooks'
import { useFormState } from '@zoltar/ui-core-shared/hooks/useFormState.js'
import { getOpenOracleAddress } from '../../../protocol/deploymentHelpers.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import {
	deriveOpenOracleDisputeSubmissionDetails,
	formatOpenOracleDisputeWriteErrorMessage,
	formatOpenOracleSettleWriteErrorMessage,
	getOpenOracleCreateGuardMessage,
	getOpenOracleCreateValidationMessage,
	getOpenOracleSelectedReportActionMode,
	getOpenOracleSettleAvailability,
	parseOpenOracleCreateFormSubmission,
} from '../lib/openOracle.js'
import type { OpenOracleCreateContractFieldErrors } from '../lib/openOracle.js'
import { parseAddressInput } from '@zoltar/ui-core-shared/forms/inputs.js'
import { getDefaultOpenOracleCreateFormState } from '../lib/formDefaults.js'
import { requireDefined } from '@zoltar/ui-core-shared/forms/required.js'
import { useRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback, type ActionFeedback } from '@zoltar/ui-core-shared/transactions/actionFeedback.js'
import { createOpenOracleSuccessPresentation, createOpenOracleTransactionIntent, createOpenOracleWarningPresentation, getOpenOracleFailureTitle, getOpenOraclePendingTitle, getOpenOracleSuccessTitle } from '../../reportingTransactionPresentations.js'
import { buildWriteActionConfig, runWriteAction } from '@zoltar/ui-core-shared/transactions/writeAction.js'
import { refreshWalletStateOnly } from '@zoltar/ui-core-shared/lib/refreshState.js'
import type { OpenOracleCreateFormState, OpenOracleFormState } from '@zoltar/ui-zoltar-shared/types/app.js'
import type { OpenOracleActionResult, OpenOracleReportDetails, OpenOracleWithdrawableBalances } from '@zoltar/ui-core-shared/types/contracts.js'
import * as openOracleCopy from '../../../copy/openOracle.js'
import { getRefreshedOpenOracleApprovalAmount, readCreateTokenDecimals } from '../lib/openOracleTokenAccess.js'
import { defaultUseOpenOracleOperationsDependencies, type OpenOracleProductionWriteClient, type UseOpenOracleOperationsDependencies, type UseOpenOracleOperationsParameters } from './openOracleOperationDependencies.js'
import { useOpenOracleSelectedReport } from './useOpenOracleSelectedReport.js'
import { useOpenOracleTokenAccess } from './useOpenOracleTokenAccess.js'

export type { UseOpenOracleOperationsDependencies } from './openOracleOperationDependencies.js'

function useOpenOracleOperationsWithDependencies<TWriteClient>(
	{ accountAddress, enabled, onReportSettled, onTransactionCanceled, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState }: UseOpenOracleOperationsParameters,
	dependencies: UseOpenOracleOperationsDependencies<TWriteClient>,
) {
	const loadingOpenOracleCreate = useSignal(false)
	const { state: openOracleCreateForm, setState: setOpenOracleCreateFormState } = useFormState<OpenOracleCreateFormState>(getDefaultOpenOracleCreateFormState())
	const openOracleCreateFieldErrors = useSignal<OpenOracleCreateContractFieldErrors>({})
	const openOracleError = useSignal<string | undefined>(undefined)
	const openOracleActiveAction = useSignal<OpenOracleActionResult['action'] | undefined>(undefined)
	type OpenOracleWithdrawableBalanceKey = 'ethAttoEth' | 'token1' | 'token2'
	const openOracleActiveWithdrawalBalance = useSignal<OpenOracleWithdrawableBalanceKey | undefined>(undefined)
	const openOracleFeedback = useSignal<ActionFeedback<OpenOracleActionResult['action']> | undefined>(undefined)
	const openOracleResult = useSignal<OpenOracleActionResult | undefined>(undefined)
	const openOracleWithdrawalBalanceChecking = useSignal(false)
	const openOracleWithdrawalReviewMessage = useSignal<{ balance: keyof OpenOracleWithdrawableBalances; message: string } | undefined>(undefined)
	const nextOpenOracleWithdrawalAttempt = useRequestGuard()
	const currentSelectedReportIdRef = useRef('')
	const isSelectedReportCurrent = (reportIdInput: string) => currentSelectedReportIdRef.current === reportIdInput.trim()
	const {
		openOracleToken1Approval,
		openOracleToken1Balance,
		openOracleToken1BalanceError,
		openOracleToken2Approval,
		openOracleToken2Balance,
		openOracleToken2BalanceError,
		openOracleTokenAccessLoad,
		openOracleTokenAccessLoadingInitial,
		openOracleTokenAccessRefreshing,
		refreshOpenOracleTokenAccess,
		resetOpenOracleTokenAccessState,
	} = useOpenOracleTokenAccess({
		accountAddress,
		isSelectedReportCurrent,
		readOptionalMulticall: dependencies.readOptionalMulticall,
	})
	const {
		assertSelectedReportCurrent,
		currentSelectedReportIdInput,
		ensureLoadedSelectedReport,
		loadOracleReport,
		openOracleForm,
		openOracleReportDetails,
		openOracleReportLookupState,
		openOracleWithdrawableBalanceLoad,
		openOracleWithdrawableBalances,
		openOracleWithdrawableBalancesError,
		refreshOpenOracleWithdrawableBalances,
		requireLoadedCurrentSelectedReport,
		setOpenOracleForm,
	} = useOpenOracleSelectedReport({
		accountAddress,
		currentSelectedReportIdRef,
		loadOpenOracleReportDetails: dependencies.loadOpenOracleReportDetails,
		loadOpenOracleWithdrawableBalances: dependencies.loadOpenOracleWithdrawableBalances,
		openOracleError,
		resetOpenOracleTokenAccessState,
	})
	const setOpenOracleCreateForm = (updater: (current: OpenOracleCreateFormState) => OpenOracleCreateFormState) => {
		setOpenOracleCreateFormState(current => {
			const next = updater(current)
			const currentErrors = openOracleCreateFieldErrors.value
			openOracleCreateFieldErrors.value = {
				...(next.token1Address === current.token1Address && currentErrors.token1Address !== undefined ? { token1Address: currentErrors.token1Address } : {}),
				...(next.token2Address === current.token2Address && currentErrors.token2Address !== undefined ? { token2Address: currentErrors.token2Address } : {}),
			}
			return next
		})
	}
	const accountAddressRef = useRef(accountAddress)
	accountAddressRef.current = accountAddress
	const enabledRef = useRef(enabled)
	enabledRef.current = enabled

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
		if (openOracleActiveAction.value !== undefined || openOracleWithdrawalBalanceChecking.value) return
		openOracleActiveAction.value = actionName
		openOracleResult.value = undefined
		const actionReportIdInput = currentSelectedReportIdInput
		const reportDetailsSnapshot = openOracleReportDetails.value
		const withdrawalTokenSymbol = (() => {
			if (actionName !== 'withdrawBalance' || reportDetailsSnapshot === undefined) return undefined
			if (openOracleActiveWithdrawalBalance.value === 'ethAttoEth') return 'ETH'
			if (openOracleActiveWithdrawalBalance.value === 'token1') return reportDetailsSnapshot.token1Symbol
			if (openOracleActiveWithdrawalBalance.value === 'token2') return reportDetailsSnapshot.token2Symbol
			return undefined
		})()
		const transactionContext =
			actionName === 'createReportInstance'
				? { tokenPair: `${openOracleCreateForm.value.token1Address} / ${openOracleCreateForm.value.token2Address}` }
				: {
						openOracleAddress: reportDetailsSnapshot?.openOracleAddress,
						reportId: actionReportIdInput,
						token1Symbol: reportDetailsSnapshot?.token1Symbol,
						token2Symbol: reportDetailsSnapshot?.token2Symbol,
						tokenPair: reportDetailsSnapshot === undefined ? undefined : `${reportDetailsSnapshot.token1Symbol} / ${reportDetailsSnapshot.token2Symbol}`,
						withdrawalTokenSymbol,
					}
		try {
			openOracleFeedback.value = createPendingActionFeedback(actionName, getOpenOraclePendingTitle(actionName))
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
						openOracleFeedback.value = createWarningActionFeedback(actionName, getOpenOracleSuccessTitle(actionName), message, hash)
						const result = openOracleResult.value
						if (result !== undefined) onTransactionPresented(createOpenOracleWarningPresentation(result, message, transactionContext))
					},
					onWriteError: message => {
						openOracleFeedback.value = createErrorActionFeedback(actionName, getOpenOracleFailureTitle(actionName), message)
					},
					refreshErrorFallback: 'Oracle transaction succeeded, but refreshing the selected report failed',
					refreshState: async () => {
						await refreshWalletStateOnly(refreshState)
					},
				},
				async walletAddress => {
					return await action(walletAddress)
				},
				errorFallback,
				async result => {
					openOracleResult.value = result
					openOracleFeedback.value = createSuccessActionFeedback(actionName, getOpenOracleSuccessTitle(actionName), result.hash)
					onTransactionPresented(createOpenOracleSuccessPresentation(result, transactionContext))
					if (result.action === 'createReportInstance') {
						openOracleCreateForm.value = getDefaultOpenOracleCreateFormState()
						openOracleCreateFieldErrors.value = {}
					}
					if (result.action === 'settle') await onReportSettled?.()
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
					const cachedReportDetails = requireLoadedCurrentSelectedReport()
					const cachedDisputeSubmission = getDisputeSubmission(cachedReportDetails, submittedOpenOracleForm)
					const { details: reportDetails } = await ensureLoadedSelectedReport({
						forceReload: true,
						reportIdInput: submittedOpenOracleForm.reportId,
						requireCurrentSelection: true,
					})
					if (getOpenOracleSelectedReportActionMode(reportDetails) !== 'dispute') throw new Error('Token approvals are only available while disputing a report')
					const refreshedDisputeSubmission = getDisputeSubmission(reportDetails, submittedOpenOracleForm)
					if (refreshedDisputeSubmission.inputBlockMessage !== undefined) throw new Error(refreshedDisputeSubmission.inputBlockMessage.message)
					if (amount !== undefined && refreshedDisputeSubmission.token1ContributionAmount !== cachedDisputeSubmission.token1ContributionAmount) {
						throw new Error('The required base token approval changed. Review the refreshed report and try again.')
					}
					await refreshOpenOracleTokenAccess(reportDetails, { preserveExisting: true })
					assertSelectedReportCurrent(reportDetails.reportId.toString())
					const disputeSubmission = getDisputeSubmission(reportDetails, submittedOpenOracleForm)
					if (disputeSubmission.inputBlockMessage !== undefined) throw new Error(disputeSubmission.inputBlockMessage.message)
					const approvalAmount = getRefreshedOpenOracleApprovalAmount({
						approvalError: openOracleToken1Approval.value.error,
						explicitAmount: amount,
						requirement: disputeSubmission.token1Approval,
						tokenLabel: 'base token',
					})
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
					const cachedReportDetails = requireLoadedCurrentSelectedReport()
					const cachedDisputeSubmission = getDisputeSubmission(cachedReportDetails, submittedOpenOracleForm)
					const { details: reportDetails } = await ensureLoadedSelectedReport({
						forceReload: true,
						reportIdInput: submittedOpenOracleForm.reportId,
						requireCurrentSelection: true,
					})
					if (getOpenOracleSelectedReportActionMode(reportDetails) !== 'dispute') throw new Error('Token approvals are only available while disputing a report')
					const refreshedDisputeSubmission = getDisputeSubmission(reportDetails, submittedOpenOracleForm)
					if (refreshedDisputeSubmission.inputBlockMessage !== undefined) throw new Error(refreshedDisputeSubmission.inputBlockMessage.message)
					if (amount !== undefined && refreshedDisputeSubmission.token2ContributionAmount !== cachedDisputeSubmission.token2ContributionAmount) {
						throw new Error('The required quote token approval changed. Review the refreshed report and try again.')
					}
					await refreshOpenOracleTokenAccess(reportDetails, { preserveExisting: true })
					assertSelectedReportCurrent(reportDetails.reportId.toString())
					const disputeSubmission = getDisputeSubmission(reportDetails, submittedOpenOracleForm)
					if (disputeSubmission.inputBlockMessage !== undefined) throw new Error(disputeSubmission.inputBlockMessage.message)
					const approvalAmount = getRefreshedOpenOracleApprovalAmount({
						approvalError: openOracleToken2Approval.value.error,
						explicitAmount: amount,
						requirement: disputeSubmission.token2Approval,
						tokenLabel: 'quote token',
					})
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
			openOracleCreateFieldErrors.value = {}
			openOracleFeedback.value = undefined
			openOracleError.value = undefined
			const initialValidationMessage = getOpenOracleCreateValidationMessage({ form: submittedOpenOracleCreateForm })
			if (initialValidationMessage !== undefined) {
				openOracleError.value = initialValidationMessage
				return
			}
			const token1Address = parseAddressInput(submittedOpenOracleCreateForm.token1Address, 'Base token address')
			const token2Address = parseAddressInput(submittedOpenOracleCreateForm.token2Address, 'Quote token address')
			const readClient = dependencies.createConnectedReadClient()
			const [token1DecimalsResult, token2DecimalsResult] = await Promise.all([readCreateTokenDecimals(readClient, token1Address, 'Base'), readCreateTokenDecimals(readClient, token2Address, 'Quote')])
			const currentOpenOracleCreateForm = openOracleCreateForm.value
			const token1AddressIsCurrent = currentOpenOracleCreateForm.token1Address === submittedOpenOracleCreateForm.token1Address
			const token2AddressIsCurrent = currentOpenOracleCreateForm.token2Address === submittedOpenOracleCreateForm.token2Address
			const contractFieldErrors: OpenOracleCreateContractFieldErrors = {
				...(token1AddressIsCurrent && token1DecimalsResult.status === 'failure' ? { token1Address: token1DecimalsResult.message } : {}),
				...(token2AddressIsCurrent && token2DecimalsResult.status === 'failure' ? { token2Address: token2DecimalsResult.message } : {}),
			}
			if (!token1AddressIsCurrent || !token2AddressIsCurrent || token1DecimalsResult.status === 'failure' || token2DecimalsResult.status === 'failure') {
				openOracleCreateFieldErrors.value = contractFieldErrors
				return
			}
			const token1Decimals = token1DecimalsResult.decimals
			const token2Decimals = token2DecimalsResult.decimals
			await runOracleAction(
				'createReportInstance',
				async walletAddress => {
					const walletBalanceAttoEth = await readClient.getBalance({ address: walletAddress })
					const createGuardMessage = getOpenOracleCreateGuardMessage({
						ethValueInput: submittedOpenOracleCreateForm.ethValue,
						isOnActiveAppChain: true,
						settlerRewardInput: submittedOpenOracleCreateForm.settlerRewardEthAmount,
						walletConnected: true,
						walletBalanceAttoEth,
					})
					if (createGuardMessage !== undefined) throw new Error(createGuardMessage)
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

	const cancelWithdrawalBalanceCheck = () => {
		if (!openOracleWithdrawalBalanceChecking.value) return
		nextOpenOracleWithdrawalAttempt()
		openOracleWithdrawalBalanceChecking.value = false
		openOracleActiveWithdrawalBalance.value = undefined
	}

	const withdrawBalance = async (balance: keyof OpenOracleWithdrawableBalances, reviewedAmount: bigint) => {
		if (openOracleWithdrawalBalanceChecking.value || openOracleActiveAction.value !== undefined) return
		const isCurrentWithdrawalAttempt = nextOpenOracleWithdrawalAttempt()
		const attemptAccountAddress = accountAddress
		const attemptEnabled = enabled
		const attemptReportIdInput = currentSelectedReportIdRef.current
		const attemptReportDetails = openOracleReportDetails.value
		const attemptOpenOracleAddress = getOpenOracleAddress()
		const isWithdrawalContextCurrent = () => {
			if (!attemptEnabled || !enabledRef.current || accountAddressRef.current !== attemptAccountAddress || currentSelectedReportIdRef.current !== attemptReportIdInput) return false
			const currentReportDetails = openOracleReportDetails.value
			if (attemptReportDetails === undefined || currentReportDetails === undefined) return attemptReportDetails === currentReportDetails
			return currentReportDetails.openOracleAddress === attemptReportDetails.openOracleAddress && currentReportDetails.reportId === attemptReportDetails.reportId && currentReportDetails.token1 === attemptReportDetails.token1 && currentReportDetails.token2 === attemptReportDetails.token2
		}
		openOracleActiveWithdrawalBalance.value = balance
		openOracleWithdrawalBalanceChecking.value = true
		let currentAmount: bigint
		let token = zeroAddress
		let preflightCanSubmit = false
		try {
			const holder = requireDefined(accountAddress, 'Connect a wallet before withdrawing an Open Oracle balance')
			const details = requireLoadedCurrentSelectedReport()
			const currentReportIdInput = details.reportId.toString()
			const balances = await dependencies.loadOpenOracleWithdrawableBalances(attemptOpenOracleAddress, holder, details.token1, details.token2)
			if (!isCurrentWithdrawalAttempt() || !isWithdrawalContextCurrent()) return
			assertSelectedReportCurrent(currentReportIdInput)
			openOracleWithdrawableBalances.value = balances
			currentAmount = balances[balance]
			let tokenSymbol = 'ETH'
			if (balance === 'token1') {
				token = details.token1
				tokenSymbol = details.token1Symbol
			} else if (balance === 'token2') {
				token = details.token2
				tokenSymbol = details.token2Symbol
			}
			if (currentAmount !== reviewedAmount) {
				openOracleWithdrawalReviewMessage.value = { balance, message: openOracleCopy.formatWithdrawalBalanceChanged(tokenSymbol) }
				return
			}
			if (currentAmount <= 0n) {
				openOracleWithdrawalReviewMessage.value = { balance, message: openOracleCopy.noWithdrawableBalanceForAsset }
				return
			}
			preflightCanSubmit = true
		} catch (error) {
			if (!isCurrentWithdrawalAttempt() || !isWithdrawalContextCurrent()) return
			openOracleWithdrawalReviewMessage.value = { balance, message: getErrorMessage(error, openOracleCopy.withdrawalBalanceRefreshFailed) }
			return
		} finally {
			if (isCurrentWithdrawalAttempt()) {
				openOracleWithdrawalBalanceChecking.value = false
				if (!preflightCanSubmit) openOracleActiveWithdrawalBalance.value = undefined
			}
		}

		if (!isCurrentWithdrawalAttempt() || !isWithdrawalContextCurrent()) {
			if (isCurrentWithdrawalAttempt()) openOracleActiveWithdrawalBalance.value = undefined
			return
		}
		openOracleWithdrawalReviewMessage.value = undefined
		try {
			await runOracleAction(
				'withdrawBalance',
				async walletAddress => await dependencies.withdrawOpenOracleBalance(dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), attemptOpenOracleAddress, token, currentAmount, walletAddress),
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
					const disputeInputPreflight = getDisputeSubmission(details, submittedOpenOracleForm)
					if (disputeInputPreflight.inputBlockMessage !== undefined) throw new Error(disputeInputPreflight.inputBlockMessage.message)
					await refreshOpenOracleTokenAccess(details, { preserveExisting: true })
					assertSelectedReportCurrent(details.reportId.toString())
					const disputeSubmission = getDisputeSubmission(details, submittedOpenOracleForm)
					if (!disputeSubmission.canSubmit || disputeSubmission.newAmount1 === undefined || disputeSubmission.newAmount2 === undefined) throw new Error(disputeSubmission.blockMessage?.message ?? 'Invalid dispute submission details.')
					const tokenToSwap = submittedOpenOracleForm.disputeTokenToSwap === 'token1' ? details.token1 : details.token2
					return await dependencies.disputeOracleReport(dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), getOpenOracleAddress(), details.reportId, tokenToSwap, disputeSubmission.newAmount1, disputeSubmission.newAmount2, details.currentAmount2, details.stateHash)
				},
				'Failed to dispute report',
				{
					formatErrorMessage: formatOpenOracleDisputeWriteErrorMessage,
					refreshTokenAccessOnSuccess: true,
				},
			)
		})()

	useEffect(() => {
		cancelWithdrawalBalanceCheck()
		openOracleWithdrawalReviewMessage.value = undefined
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
	const openOracleSectionState = {
		loadingOpenOracleCreate: loadingOpenOracleCreate.value,
		openOracleActiveAction: openOracleActiveAction.value,
		openOracleActiveWithdrawalBalance: openOracleActiveWithdrawalBalance.value,
		openOracleCreateFieldErrors: openOracleCreateFieldErrors.value,
		openOracleCreateForm: openOracleCreateForm.value,
		openOracleDisputeSubmission,
		openOracleError: openOracleError.value,
		openOracleReportDetails: openOracleReportDetails.value,
		openOracleReportLookupState: openOracleReportLookupState.value,
		openOracleResult: openOracleResult.value,
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
		openOracleWithdrawableBalances: openOracleWithdrawableBalances.value,
		openOracleWithdrawableBalancesError: openOracleWithdrawableBalancesError.value,
		openOracleWithdrawableBalancesLoading: openOracleWithdrawableBalanceLoad.isLoading.value,
		openOracleWithdrawalBalanceChecking: openOracleWithdrawalBalanceChecking.value,
		openOracleWithdrawalReviewMessage: openOracleWithdrawalReviewMessage.value,
	}

	return {
		approveToken1,
		approveToken2,
		cancelWithdrawalBalanceCheck,
		createOpenOracleGame,
		disputeReport,
		loadOracleReport,
		...openOracleSectionState,
		openOracleFeedback: openOracleFeedback.value,
		openOracleForm: openOracleForm.value,
		openOracleSectionState,
		resetOpenOracleCreateForm: () => {
			openOracleCreateForm.value = getDefaultOpenOracleCreateFormState()
			openOracleCreateFieldErrors.value = {}
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
