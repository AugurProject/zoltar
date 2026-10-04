import type { TransactionCancellationParameters, TransactionLifecycleParameters, WriteOperationContext } from '../../../types/app.js'
import { runReadOperation } from '@zoltar/ui-core-shared/lib/readOperation.js'
import { getLiquidationFundingPreviewRequestKey, resolveLiquidationFunding } from './liquidationFunding.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { useSignal } from '@preact/signals'
import { useRef } from 'preact/hooks'
import type { Address, Hash } from '@zoltar/core-shared/evm/ethereum'
import { useLoadController } from '@zoltar/ui-core-shared/hooks/useLoadController.js'
import { normalizeAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback, type ActionFeedback } from '@zoltar/ui-core-shared/transactions/actionFeedback.js'
import { createLiquidationFailurePresentation, createLiquidationSuccessPresentation, createLiquidationTransactionIntent, createLiquidationWarningPresentation } from '../../transactionPresentations.js'
import { buildWriteActionConfig, runWriteAction } from '@zoltar/ui-core-shared/transactions/writeAction.js'
import { refreshWalletStateOnly } from '@zoltar/ui-core-shared/lib/refreshState.js'
import { parseAddressInput, parseBytes32Input } from '@zoltar/ui-core-shared/forms/inputs.js'
import { parseBigIntInput } from '@zoltar/ui-core-shared/forms/integerInput.js'
import { parseEthAmountInput } from '@zoltar/ui-core-shared/forms/formInputs.js'
import { formatAdditionalCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { getLiquidationExecutionFailureDetail } from '../lib/liquidation.js'
import { useRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import { useLiquidationReceiverVault } from './useLiquidationReceiverVault.js'
import { appQueryCache, isSameQueryData } from '@zoltar/ui-core-shared/lib/dataRefresh.js'
import { useQueryState } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { DEFAULT_STAGED_OPERATION_TIMEOUT_MINUTES, getStagedOperationTimeoutSeconds, MAX_STAGED_OPERATION_TIMEOUT_MINUTES, MIN_STAGED_OPERATION_TIMEOUT_MINUTES } from '../lib/securityVault.js'
import type { LiquidationApprovalDetails, LiquidationFundingPreview, ListedSecurityPool, SecurityPoolOverviewActionResult } from '../../../types/contracts.js'
import { defaultUseSecurityPoolsOverviewDependencies, type SecurityPoolsOverviewProductionWriteClient, type UseSecurityPoolsOverviewDependencies } from './securityPoolsOverviewDependencies.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as liquidationCopy from '../../../copy/liquidation.js'

export type { UseSecurityPoolsOverviewDependencies } from './securityPoolsOverviewDependencies.js'

type UseSecurityPoolsOverviewParameters = TransactionLifecycleParameters & TransactionCancellationParameters & WriteOperationContext & { environmentRefreshKey: number }

/** The selected pool's lineage, refreshed in place on each new block. */
const securityPoolLineageQueries = appQueryCache.createStore<ListedSecurityPool[]>()

function useSecurityPoolsOverviewWithDependencies<TWriteClient>(
	{ accountAddress, environmentRefreshKey, onTransactionCanceled, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState }: UseSecurityPoolsOverviewParameters,
	dependencies: UseSecurityPoolsOverviewDependencies<TWriteClient>,
) {
	const latestAccountAddress = useRef(accountAddress)
	const latestEnvironmentRefreshKey = useRef(environmentRefreshKey)
	latestAccountAddress.current = accountAddress
	latestEnvironmentRefreshKey.current = environmentRefreshKey
	const liquidationDebtEthAmount = useSignal('0')
	const liquidationTargetVault = useSignal('')
	const liquidationApprovalId = useSignal(`0x${'00'.repeat(32)}`)
	const liquidationApprovalDetails = useSignal<LiquidationApprovalDetails | undefined>(undefined)
	const liquidationApprovalError = useSignal<string | undefined>(undefined)
	const liquidationApprovalLoadingKey = useSignal<string | undefined>(undefined)
	const liquidationTimeoutMinutes = useSignal(DEFAULT_STAGED_OPERATION_TIMEOUT_MINUTES.toString())
	const liquidationManagerAddress = useSignal<Address | undefined>(undefined)
	const liquidationFundingPrice = useSignal<bigint | undefined>(undefined)
	const liquidationFundingPreview = useSignal<LiquidationFundingPreview | undefined>(undefined)
	const liquidationFundingPreviewError = useSignal<string | undefined>(undefined)
	const liquidationFundingPreviewErrorKey = useSignal<string | undefined>(undefined)
	const liquidationFundingPreviewLoadingKey = useSignal<string | undefined>(undefined)
	const liquidationFundingPreviewResolvedKey = useSignal<string | undefined>(undefined)
	const liquidationSecurityPoolAddress = useSignal<Address | undefined>(undefined)
	const receiver = useLiquidationReceiverVault({
		accountAddress,
		latestEnvironmentRefreshKey,
		liquidationSecurityPoolAddress,
		loadSecurityPoolVaultSummary: dependencies.loadSecurityPoolVaultSummary,
		waitForSecurityPoolReadBackend: dependencies.waitForSecurityPoolReadBackend,
	})
	const liquidationModalOpen = useSignal(false)
	const securityPoolsLoad = useLoadController()
	const liquidationFundingPreviewLoad = useLoadController()
	const liquidationApprovalLoad = useLoadController()
	const securityPoolsLoadedEnvironmentRefreshKey = useSignal<number | undefined>(undefined)
	const checkedSecurityPoolAddress = useSignal<string | undefined>(undefined)
	const securityPoolOverviewActiveAction = useSignal<SecurityPoolOverviewActionResult['action'] | undefined>(undefined)
	const securityPoolOverviewFeedback = useSignal<ActionFeedback<SecurityPoolOverviewActionResult['action']> | undefined>(undefined)
	const securityPoolOverviewError = useSignal<string | undefined>(undefined)
	const securityPoolsLoadError = useSignal<string | undefined>(undefined)
	const securityPoolsLoadErrorEnvironmentRefreshKey = useSignal<number | undefined>(undefined)
	const securityPoolLiquidationError = useSignal<string | undefined>(undefined)
	const securityPoolOverviewResult = useSignal<SecurityPoolOverviewActionResult | undefined>(undefined)
	const securityPools = useSignal<ListedSecurityPool[]>([])
	const nextSecurityPoolsLoad = useRequestGuard()
	const activeLineageIsCurrent = useRef<() => boolean>(() => false)
	const nextLiquidationFundingPreviewLoad = useRequestGuard()
	const nextLiquidationApprovalLoad = useRequestGuard()

	const securityPoolsCommitVersion = useRef(0)
	const getLineageQueryKey = (address: string | undefined) => (address === undefined ? undefined : `${environmentRefreshKey}:${address}:${accountAddress?.toLowerCase() ?? 'no-account'}`)
	const lineageQuery = useQueryState(securityPoolLineageQueries, getLineageQueryKey(checkedSecurityPoolAddress.value))
	const loadSecurityPools = async (securityPoolAddress?: string) => {
		const requestedEnvironmentRefreshKey = environmentRefreshKey
		const normalizedCheckedAddress = normalizeAddress(securityPoolAddress)
		const isCurrent = nextSecurityPoolsLoad()
		activeLineageIsCurrent.current = isCurrent
		const nextCheckedAddress = normalizedCheckedAddress ?? checkedSecurityPoolAddress.value
		const result = await securityPoolsLoad.run({
			isCurrent,
			onStart: () => {
				if (!isCurrent()) return
				securityPoolOverviewError.value = undefined
				securityPoolsLoadError.value = undefined
				securityPoolsLoadErrorEnvironmentRefreshKey.value = undefined
			},
			waitUntilReady: dependencies.waitForSecurityPoolReadBackend,
			load: async operation => {
				if (nextCheckedAddress === undefined) return []
				return await dependencies.loadSecurityPoolLineage(parseAddressInput(nextCheckedAddress, 'Security pool'), accountAddress, operation)
			},
			onSuccess: pools => {
				securityPoolsCommitVersion.current += 1
				const queryKey = getLineageQueryKey(nextCheckedAddress)
				if (queryKey !== undefined) securityPoolLineageQueries.set(queryKey, pools)
				securityPoolsLoadedEnvironmentRefreshKey.value = requestedEnvironmentRefreshKey
				checkedSecurityPoolAddress.value = nextCheckedAddress
				securityPools.value = pools
			},
			onError: error => {
				const message = getErrorMessage(error, 'Failed to load security pools.')
				securityPoolOverviewError.value = message
				securityPoolsLoadError.value = message
				securityPoolsLoadErrorEnvironmentRefreshKey.value = requestedEnvironmentRefreshKey
			},
		})
		return result !== undefined
	}

	/** Applies the pool total from a completed vault read while the full lineage refresh is still loading. */
	const updatePoolCommitment = (address: string, totalUnderwritingLimitAttoEth: bigint) => {
		const matchingPool = securityPools.value.find(pool => pool.securityPoolAddress.toLowerCase() === address.toLowerCase())
		if (matchingPool === undefined || matchingPool.totalUnderwritingLimitAttoEth === totalUnderwritingLimitAttoEth) return
		securityPoolsCommitVersion.current += 1
		securityPools.value = securityPools.value.map(pool => (pool === matchingPool ? { ...pool, totalUnderwritingLimitAttoEth } : pool))
		const queryKey = getLineageQueryKey(checkedSecurityPoolAddress.value)
		if (queryKey !== undefined) securityPoolLineageQueries.set(queryKey, securityPools.value)
	}

	/** Re-reads the selected pool's lineage in place, keeping the loaded pools visible until the read lands. */
	const refreshSecurityPools = async () => {
		const address = checkedSecurityPoolAddress.value
		const queryKey = getLineageQueryKey(address)
		if (address === undefined || queryKey === undefined || securityPoolsLoad.isLoading.peek()) return
		const commitVersion = ++securityPoolsCommitVersion.current
		const isLineageCurrent = activeLineageIsCurrent.current
		const isCurrent = () => isLineageCurrent() && latestEnvironmentRefreshKey.current === environmentRefreshKey && latestAccountAddress.current === accountAddress && checkedSecurityPoolAddress.value === address
		try {
			const pools = await securityPoolLineageQueries.fetch(queryKey, async () => await runReadOperation(async operation => await dependencies.loadSecurityPoolLineage(parseAddressInput(address, 'Security pool'), accountAddress, operation), { isCurrent }))
			if (isCurrent() && securityPoolsCommitVersion.current === commitVersion && !securityPoolsLoad.isLoading.peek() && checkedSecurityPoolAddress.value === address && !isSameQueryData(pools, securityPools.value)) securityPools.value = pools
		} catch (error) {
			void error // A failed background read keeps the loaded pools; the next block retries.
		}
	}

	const getCurrentLiquidationFundingPreviewRequestKey = () => {
		const managerAddress = liquidationManagerAddress.value
		const walletAddress = latestAccountAddress.current
		if (managerAddress === undefined || walletAddress === undefined) return undefined
		return getLiquidationFundingPreviewRequestKey(managerAddress, walletAddress, latestEnvironmentRefreshKey.current, liquidationFundingPrice.value)
	}

	const loadLiquidationFundingPreview = async (managerAddress: Address, proposedRepPerEthPrice?: bigint) => {
		liquidationFundingPrice.value = proposedRepPerEthPrice
		const walletAddress = latestAccountAddress.current
		if (walletAddress === undefined) {
			liquidationFundingPreview.value = undefined
			liquidationFundingPreviewResolvedKey.value = undefined
			liquidationFundingPreviewError.value = 'Connect a wallet to review liquidation funding.'
			liquidationFundingPreviewErrorKey.value = undefined
			return false
		}
		const requestKey = getLiquidationFundingPreviewRequestKey(managerAddress, walletAddress, latestEnvironmentRefreshKey.current, liquidationFundingPrice.value)
		const isCurrent = nextLiquidationFundingPreviewLoad()
		const result = await liquidationFundingPreviewLoad.run({
			isCurrent,
			onStart: () => {
				liquidationFundingPreview.value = undefined
				liquidationFundingPreviewResolvedKey.value = undefined
				liquidationFundingPreviewError.value = undefined
				liquidationFundingPreviewErrorKey.value = undefined
				liquidationFundingPreviewLoadingKey.value = requestKey
			},
			load: async () => await resolveLiquidationFunding(dependencies, dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), managerAddress, walletAddress, proposedRepPerEthPrice),
			onSuccess: preview => {
				if (getCurrentLiquidationFundingPreviewRequestKey() !== requestKey) return
				liquidationFundingPreview.value = preview
				liquidationFundingPreviewResolvedKey.value = requestKey
			},
			onError: error => {
				if (getCurrentLiquidationFundingPreviewRequestKey() !== requestKey) return
				liquidationFundingPreviewError.value = getErrorMessage(error, 'Failed to load liquidation funding.')
				liquidationFundingPreviewErrorKey.value = requestKey
			},
		})
		if (liquidationFundingPreviewLoadingKey.value === requestKey) liquidationFundingPreviewLoadingKey.value = undefined
		return result !== undefined && getCurrentLiquidationFundingPreviewRequestKey() === requestKey
	}

	const getCurrentLiquidationApprovalRequestKey = () => {
		const managerAddress = liquidationManagerAddress.value
		if (managerAddress === undefined) return undefined
		const approvalId = liquidationApprovalId.value.trim()
		if (!/^0x[0-9a-fA-F]{64}$/.test(approvalId)) return undefined
		return `${latestEnvironmentRefreshKey.current}:${managerAddress.toLowerCase()}:${approvalId.toLowerCase()}`
	}

	const loadLiquidationApproval = async () => {
		const managerAddress = liquidationManagerAddress.value
		if (managerAddress === undefined) {
			liquidationApprovalError.value = liquidationCopy.selectedPoolDetailsLoading
			return false
		}
		let approvalId: Hash
		try {
			approvalId = parseBytes32Input(liquidationApprovalId.value, 'Liquidation approval ID')
		} catch (error) {
			liquidationApprovalDetails.value = undefined
			liquidationApprovalError.value = getErrorMessage(error, liquidationCopy.invalidDelegatedApprovalId)
			return false
		}
		const requestKey = `${latestEnvironmentRefreshKey.current}:${managerAddress.toLowerCase()}:${approvalId.toLowerCase()}`
		const isCurrent = nextLiquidationApprovalLoad()
		const result = await liquidationApprovalLoad.run({
			isCurrent,
			onStart: () => {
				liquidationApprovalDetails.value = undefined
				liquidationApprovalError.value = undefined
				liquidationApprovalLoadingKey.value = requestKey
			},
			waitUntilReady: dependencies.waitForSecurityPoolReadBackend,
			load: async () => {
				return await dependencies.loadLiquidationApproval(managerAddress, approvalId)
			},
			onSuccess: approval => {
				if (getCurrentLiquidationApprovalRequestKey() !== requestKey) return
				liquidationApprovalDetails.value = approval
			},
			onError: error => {
				if (getCurrentLiquidationApprovalRequestKey() !== requestKey) return
				liquidationApprovalError.value = getErrorMessage(error, 'Failed to load the liquidation approval.')
			},
		})
		if (liquidationApprovalLoadingKey.value === requestKey) liquidationApprovalLoadingKey.value = undefined
		return result !== undefined && getCurrentLiquidationApprovalRequestKey() === requestKey
	}

	const openLiquidationModal = (managerAddress: Address, securityPoolAddress: Address, vaultAddress: Address) => {
		nextLiquidationFundingPreviewLoad()
		liquidationFundingPrice.value = undefined
		nextLiquidationApprovalLoad()
		securityPoolOverviewError.value = undefined
		securityPoolLiquidationError.value = undefined
		securityPoolOverviewFeedback.value = undefined
		securityPoolOverviewResult.value = undefined
		liquidationFundingPreview.value = undefined
		liquidationFundingPreviewError.value = undefined
		liquidationFundingPreviewErrorKey.value = undefined
		liquidationFundingPreviewLoadingKey.value = undefined
		liquidationFundingPreviewResolvedKey.value = undefined
		liquidationManagerAddress.value = managerAddress
		liquidationSecurityPoolAddress.value = securityPoolAddress
		liquidationTargetVault.value = vaultAddress
		receiver.changeReceiverVault(accountAddress ?? '')
		liquidationApprovalId.value = `0x${'00'.repeat(32)}`
		liquidationApprovalDetails.value = undefined
		liquidationApprovalError.value = undefined
		liquidationApprovalLoadingKey.value = undefined
		liquidationTimeoutMinutes.value = DEFAULT_STAGED_OPERATION_TIMEOUT_MINUTES.toString()
		liquidationModalOpen.value = true
	}

	const closeLiquidationModal = () => {
		nextLiquidationFundingPreviewLoad()
		liquidationFundingPrice.value = undefined
		nextLiquidationApprovalLoad()
		receiver.resetSummary()
		securityPoolLiquidationError.value = undefined
		securityPoolOverviewFeedback.value = undefined
		securityPoolOverviewResult.value = undefined
		liquidationFundingPreview.value = undefined
		liquidationFundingPreviewError.value = undefined
		liquidationFundingPreviewErrorKey.value = undefined
		liquidationFundingPreviewLoadingKey.value = undefined
		liquidationFundingPreviewResolvedKey.value = undefined
		liquidationApprovalDetails.value = undefined
		liquidationApprovalError.value = undefined
		liquidationApprovalLoadingKey.value = undefined
		liquidationModalOpen.value = false
	}

	const getLiquidationSubmittedFeedback = (hash: Hash) => createSuccessActionFeedback('queueLiquidation', 'Liquidation submitted', hash, 'Waiting for refreshed pool state.')

	const getLiquidationFeedbackFromResult = (result: SecurityPoolOverviewActionResult) => {
		if (result.stagedExecution?.success === false) return createErrorActionFeedback('queueLiquidation', 'Liquidation failed', getLiquidationExecutionFailureDetail(result.stagedExecution.errorMessage) ?? 'The liquidation execution failed.')
		if (result.stagedExecution?.success === true) return createSuccessActionFeedback('queueLiquidation', 'Liquidation executed', result.hash, 'Execution completed immediately.')
		return getLiquidationSubmittedFeedback(result.hash)
	}

	const isLiquidationSnapshotCurrent = (snapshot: { approvalId: string; amount: string; managerAddress: Address; receiverVault: string; securityPoolAddress: Address; targetVault: string; timeoutMinutes: string }) =>
		liquidationApprovalId.value === snapshot.approvalId &&
		liquidationDebtEthAmount.value === snapshot.amount &&
		liquidationManagerAddress.value === snapshot.managerAddress &&
		liquidationSecurityPoolAddress.value === snapshot.securityPoolAddress &&
		receiver.receiverVault.value === snapshot.receiverVault &&
		liquidationTargetVault.value === snapshot.targetVault &&
		liquidationTimeoutMinutes.value === snapshot.timeoutMinutes

	const queueLiquidation = async (managerAddress: Address, securityPoolAddress: Address, proposedRepPerEthPrice?: bigint) => {
		securityPoolLiquidationError.value = undefined
		securityPoolOverviewResult.value = undefined
		const submittedLiquidation = {
			approvalId: liquidationApprovalId.value,
			amount: liquidationDebtEthAmount.value,
			managerAddress,
			receiverVault: receiver.receiverVault.value,
			securityPoolAddress,
			targetVault: liquidationTargetVault.value,
			timeoutMinutes: liquidationTimeoutMinutes.value,
		}
		const transactionContext = {
			amount: submittedLiquidation.amount,
			securityPoolAddress: submittedLiquidation.securityPoolAddress,
			targetVault: submittedLiquidation.targetVault,
			universeId: securityPools.value.find(pool => normalizeAddress(pool.securityPoolAddress) === normalizeAddress(submittedLiquidation.securityPoolAddress))?.universeId,
		}
		let completedResult: SecurityPoolOverviewActionResult | undefined
		try {
			securityPoolOverviewActiveAction.value = 'queueLiquidation'
			securityPoolOverviewFeedback.value = createPendingActionFeedback('queueLiquidation', 'Submitting liquidation')
			await runWriteAction(
				{
					...buildWriteActionConfig(
						{ accountAddress, onTransactionCanceled, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, refreshState },
						securityPoolOverviewError,
						commonCopy.formatConnectWalletBefore('queueing liquidation'),
						createLiquidationTransactionIntent(transactionContext),
					),
					onRefreshError: (message, hash) => {
						if (completedResult?.stagedExecution?.success === false) return
						securityPoolOverviewFeedback.value =
							completedResult?.stagedExecution?.success === true ? createWarningActionFeedback('queueLiquidation', 'Liquidation executed', message, hash ?? completedResult.hash) : createWarningActionFeedback('queueLiquidation', 'Liquidation submitted', message, hash ?? completedResult?.hash)
						if (completedResult !== undefined) onTransactionPresented(createLiquidationWarningPresentation(completedResult, message, transactionContext))
					},
					onWriteError: message => {
						// A dismissed dialog stays closed; the failure is reported through the transaction toast.
						if (liquidationModalOpen.value && isLiquidationSnapshotCurrent(submittedLiquidation)) securityPoolLiquidationError.value = message
						securityPoolOverviewFeedback.value = createErrorActionFeedback('queueLiquidation', 'Liquidation failed', message)
					},
					refreshState: async () => {
						await refreshWalletStateOnly(refreshState)
					},
				},
				async (walletAddress, context) => {
					if (proposedRepPerEthPrice !== undefined && (proposedRepPerEthPrice <= 0n || proposedRepPerEthPrice >= 2n ** 256n)) throw new Error(securityPoolCopy.manualInitialPriceError)
					const targetVault = parseAddressInput(submittedLiquidation.targetVault, 'Target vault')
					const receiverVault = parseAddressInput(submittedLiquidation.receiverVault, liquidationCopy.receiverVault)
					const approvalId = parseBytes32Input(submittedLiquidation.approvalId, 'Liquidation approval ID')
					const amount = parseEthAmountInput(submittedLiquidation.amount, liquidationCopy.requestedLiquidationDebt)
					const fundingEnvironmentRefreshKey = latestEnvironmentRefreshKey.current
					const fundingPreviewKey = getLiquidationFundingPreviewRequestKey(managerAddress, walletAddress, fundingEnvironmentRefreshKey, proposedRepPerEthPrice)
					const ensureFundingContextIsCurrent = () => {
						if (latestAccountAddress.current?.toLowerCase() !== walletAddress.toLowerCase() || latestEnvironmentRefreshKey.current !== fundingEnvironmentRefreshKey) {
							throw new Error('The wallet or network changed while loading liquidation funding. Review the refreshed funding requirements and try again.')
						}
					}
					const writeClient = dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted, reviewSignal: context.reviewSignal })
					const fundingPreview = await resolveLiquidationFunding(dependencies, writeClient, managerAddress, walletAddress, proposedRepPerEthPrice)
					ensureFundingContextIsCurrent()
					if (getCurrentLiquidationFundingPreviewRequestKey() === fundingPreviewKey) {
						liquidationFundingPreview.value = fundingPreview
						liquidationFundingPreviewResolvedKey.value = fundingPreviewKey
					}
					if (fundingPreview.currentRepBalanceAttoRep < fundingPreview.initialReportRepRequiredAttoRep) throw new Error(`Need ${formatAdditionalCurrencyBalance(fundingPreview.initialReportRepRequiredAttoRep - fundingPreview.currentRepBalanceAttoRep, 'REP')} in this wallet to fund the initial report.`)
					const walletBalanceAttoEth = fundingPreview.totalWalletEthRequiredAttoEth === 0n ? undefined : await dependencies.createConnectedReadClient().getBalance({ address: walletAddress })
					ensureFundingContextIsCurrent()
					if (walletBalanceAttoEth !== undefined && walletBalanceAttoEth < fundingPreview.totalWalletEthRequiredAttoEth)
						throw new Error(`Need ${formatAdditionalCurrencyBalance(fundingPreview.totalWalletEthRequiredAttoEth - walletBalanceAttoEth, 'ETH')} in this wallet to fund the initial report and queue this liquidation.`)
					const timeoutMinutes = parseBigIntInput(submittedLiquidation.timeoutMinutes, securityPoolCopy.executionWindow)
					if (timeoutMinutes < MIN_STAGED_OPERATION_TIMEOUT_MINUTES || timeoutMinutes > MAX_STAGED_OPERATION_TIMEOUT_MINUTES) throw new Error(securityPoolCopy.executionWindowRangeError)
					const validForSeconds = getStagedOperationTimeoutSeconds(timeoutMinutes)
					if (validForSeconds === undefined) throw new Error(securityPoolCopy.executionWindowRangeError)
					ensureFundingContextIsCurrent()
					return await dependencies.queueSecurityPoolLiquidation(writeClient, managerAddress, targetVault, amount, validForSeconds, 0n, receiverVault, approvalId, proposedRepPerEthPrice)
				},
				'Failed to queue the liquidation.',
				async result => {
					const nextResult: SecurityPoolOverviewActionResult = {
						action: 'queueLiquidation',
						hash: result.hash,
						...(result.queuedOperation === undefined ? {} : { queuedOperation: result.queuedOperation }),
						securityPoolAddress,
						...(result.stagedExecution === undefined ? {} : { stagedExecution: result.stagedExecution }),
					}
					completedResult = nextResult
					securityPoolLiquidationError.value = undefined
					securityPoolOverviewResult.value = nextResult
					securityPoolOverviewFeedback.value = getLiquidationFeedbackFromResult(nextResult)
					if (nextResult.stagedExecution?.success === false) {
						onTransactionPresented(createLiquidationFailurePresentation(nextResult, getLiquidationExecutionFailureDetail(nextResult.stagedExecution.errorMessage) ?? 'The liquidation execution failed.', transactionContext))
					} else {
						onTransactionPresented(createLiquidationSuccessPresentation(nextResult, transactionContext))
					}
					await loadSecurityPools(securityPoolAddress)
				},
			)
		} finally {
			securityPoolOverviewActiveAction.value = undefined
		}
	}
	const currentLiquidationFundingPreviewRequestKey = getCurrentLiquidationFundingPreviewRequestKey()
	const currentLiquidationFundingPreview = currentLiquidationFundingPreviewRequestKey !== undefined && liquidationFundingPreviewResolvedKey.value === currentLiquidationFundingPreviewRequestKey ? liquidationFundingPreview.value : undefined
	const currentLiquidationFundingPreviewError = liquidationFundingPreviewErrorKey.value === currentLiquidationFundingPreviewRequestKey ? liquidationFundingPreviewError.value : undefined
	const loadingCurrentLiquidationFundingPreview = currentLiquidationFundingPreviewRequestKey !== undefined && liquidationFundingPreviewLoadingKey.value === currentLiquidationFundingPreviewRequestKey && liquidationFundingPreviewLoad.isLoading.value
	const currentLiquidationApprovalRequestKey = getCurrentLiquidationApprovalRequestKey()
	const loadingCurrentLiquidationApproval = currentLiquidationApprovalRequestKey !== undefined && liquidationApprovalLoadingKey.value === currentLiquidationApprovalRequestKey && liquidationApprovalLoad.isLoading.value

	return {
		liquidationDebtEthAmount: liquidationDebtEthAmount.value,
		liquidationManagerAddress: liquidationManagerAddress.value,
		liquidationFundingPreview: currentLiquidationFundingPreview,
		liquidationFundingPreviewError: currentLiquidationFundingPreviewError,
		liquidationModalOpen: liquidationModalOpen.value,
		liquidationTargetVault: liquidationTargetVault.value,
		liquidationReceiverVault: receiver.receiverVault.value,
		liquidationApprovalId: liquidationApprovalId.value,
		liquidationApprovalDetails: liquidationApprovalDetails.value,
		liquidationApprovalError: liquidationApprovalError.value,
		liquidationReceiverVaultSummary: receiver.summary,
		liquidationReceiverVaultSummaryError: receiver.summaryError,
		liquidationReceiverVaultSummaryResolved: receiver.resolved,
		liquidationTimeoutMinutes: liquidationTimeoutMinutes.value,
		checkedSecurityPoolAddress: checkedSecurityPoolAddress.value,
		hasLoadedSecurityPools: securityPoolsLoadedEnvironmentRefreshKey.value === environmentRefreshKey,
		securityPoolsLoadedEnvironmentRefreshKey: securityPoolsLoadedEnvironmentRefreshKey.value,
		liquidationSecurityPoolAddress: liquidationSecurityPoolAddress.value,
		loadingSecurityPools: securityPoolsLoad.isLoading.value,
		loadingLiquidationFundingPreview: loadingCurrentLiquidationFundingPreview,
		loadingLiquidationApproval: loadingCurrentLiquidationApproval,
		loadingLiquidationReceiverVaultSummary: receiver.loading,
		closeLiquidationModal,
		loadLiquidationFundingPreview,
		loadLiquidationApproval,
		loadLiquidationReceiverVaultSummary: receiver.loadReceiverVaultSummary,
		openLiquidationModal,
		queueLiquidation,
		securityPoolOverviewActiveAction: securityPoolOverviewActiveAction.value,
		securityPoolOverviewError: securityPoolOverviewError.value,
		securityPoolsLoadError: securityPoolsLoadError.value,
		securityPoolsLoadErrorEnvironmentRefreshKey: securityPoolsLoadErrorEnvironmentRefreshKey.value,
		securityPoolLiquidationError: securityPoolLiquidationError.value,
		securityPoolOverviewFeedback: securityPoolOverviewFeedback.value,
		securityPoolOverviewResult: securityPoolOverviewResult.value,
		securityPools: securityPools.value,
		setLiquidationAmount: (value: string) => {
			liquidationDebtEthAmount.value = value
		},
		setLiquidationTimeoutMinutes: (value: string) => {
			liquidationTimeoutMinutes.value = value
		},
		setLiquidationTargetVault: (value: string) => {
			liquidationTargetVault.value = value
		},
		setLiquidationReceiverVault: receiver.changeReceiverVault,
		setLiquidationApprovalId: (value: string) => {
			nextLiquidationApprovalLoad()
			liquidationApprovalId.value = value
			liquidationApprovalDetails.value = undefined
			liquidationApprovalError.value = undefined
			liquidationApprovalLoadingKey.value = undefined
		},
		loadSecurityPools,
		refreshSecurityPools,
		updatePoolCommitment,
		securityPoolsFreshness: { refreshing: lineageQuery?.fetching === true, updatedAt: lineageQuery?.updatedAt },
	}
}

export function useSecurityPoolsOverview(parameters: UseSecurityPoolsOverviewParameters): ReturnType<typeof useSecurityPoolsOverviewWithDependencies<SecurityPoolsOverviewProductionWriteClient>>
export function useSecurityPoolsOverview<TWriteClient>(parameters: UseSecurityPoolsOverviewParameters, dependencies: UseSecurityPoolsOverviewDependencies<TWriteClient>): ReturnType<typeof useSecurityPoolsOverviewWithDependencies<TWriteClient>>
export function useSecurityPoolsOverview<TWriteClient>(parameters: UseSecurityPoolsOverviewParameters, dependencies?: UseSecurityPoolsOverviewDependencies<TWriteClient>) {
	if (dependencies === undefined) return useSecurityPoolsOverviewWithDependencies(parameters, defaultUseSecurityPoolsOverviewDependencies)
	return useSecurityPoolsOverviewWithDependencies(parameters, dependencies)
}
