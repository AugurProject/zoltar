import { useSignal } from '@preact/signals'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { useLoadController } from '@zoltar/ui-core-shared/hooks/useLoadController.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { useRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import type { TokenApprovalState } from '@zoltar/ui-core-shared/transactions/tokenApproval.js'
import type { OpenOracleReportDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import { getOpenOracleAddress } from '../../../protocol/deploymentHelpers.js'
import { toBigIntReadResult, toReadError, type OpenOracleRawReadResult, type OpenOracleTokenAccessLoadResult, type OptionalReadResult, type RefreshOpenOracleTokenAccessOptions, type TokenAccessLoadResult } from '../lib/openOracleTokenAccess.js'

export function useOpenOracleTokenAccess({ accountAddress, isSelectedReportCurrent, readOptionalMulticall }: { accountAddress: Address | undefined; isSelectedReportCurrent: (reportIdInput: string) => boolean; readOptionalMulticall: (contracts: readonly unknown[]) => Promise<readonly OpenOracleRawReadResult[]> }) {
	const openOracleTokenAccessLoad = useLoadController()
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

	const setOpenOracleTokenAccessMode = (mode: 'idle' | 'initial' | 'background') => {
		openOracleTokenAccessLoadingInitial.value = mode === 'initial'
		openOracleTokenAccessRefreshing.value = mode === 'background'
	}

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
					const tokenAccessReadResults = await readOptionalMulticall([
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

	return {
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
	}
}
