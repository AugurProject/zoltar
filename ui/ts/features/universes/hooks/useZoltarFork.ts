import { useSignal } from '@preact/signals'
import { useCallback, useEffect } from 'preact/hooks'
import { zeroAddress, type Address, type Hash } from '@zoltar/shared/ethereum'
import { ABIS } from '../../../abis.js'
import { Zoltar_Zoltar } from '../../../contractArtifact.js'
import { approveErc20, forkZoltarUniverse, getZoltarAddress, readOptionalMulticall } from '../../../protocol/index.js'
import { useLoadController } from '../../../hooks/useLoadController.js'
import { createConnectedReadClient, createWalletWriteClient } from '../../../lib/clients.js'
import { requireWallet } from '../../../lib/requireWalletConnection.js'
import { assertActiveWallet } from '../../../lib/assertActiveWallet.js'
import { formatRefreshErrorMessage, formatWriteErrorMessage, getErrorMessage } from '../../../lib/errors.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '../../../lib/actionFeedback.js'
import type { ActionFeedback } from '../../../lib/actionFeedback.js'
import { createZoltarForkSuccessPresentation, createZoltarForkTransactionIntent, createZoltarForkWarningPresentation } from '../../transactionPresentations.js'
import { parseBigIntInput } from '../../markets/lib/marketForm.js'
import type { TokenApprovalState } from '../../../lib/tokenApproval.js'
import { getGenesisReputationTokenAddress } from '../lib/universe.js'
import { useRequestGuard } from '../../../lib/requestGuard.js'
import { refreshWalletStateOnly } from '../../../lib/refreshState.js'
import type { WriteOperationsParameters } from '../../../types/app.js'
import type { ZoltarForkActionResult, ZoltarUniverseSummary } from '../../../types/contracts.js'

type UseZoltarForkParameters = {
	accountAddress: Address | undefined
	activeUniverseId: bigint
	ensureZoltarUniverse: () => Promise<ZoltarUniverseSummary>
	onTransactionFailed?: WriteOperationsParameters['onTransactionFailed']
	onTransactionFinished: () => void
	onTransactionPresented: WriteOperationsParameters['onTransactionPresented']
	onTransactionPrepared?: WriteOperationsParameters['onTransactionPrepared']
	onTransactionRequested: WriteOperationsParameters['onTransactionRequested']
	onTransactionSubmitted: (hash: Hash) => void
	refreshState: WriteOperationsParameters['refreshState']
	refreshZoltarUniverse: () => Promise<void>
	shouldAutoLoadForkAccess: boolean
	zoltarUniverse: ZoltarUniverseSummary | undefined
}

type OptionalReadResult<TResult> = { result: TResult; status: 'success' } | { error: Error; result?: undefined; status: 'failure' }
type ZoltarForkAccessChildUniverse = ZoltarUniverseSummary['childUniverses'][number]

export type UseZoltarForkDependencies = {
	approveForkRep: (accountAddress: Address, callbacks: { onTransactionPrepared?: WriteOperationsParameters['onTransactionPrepared']; onTransactionSubmitted: (hash: Hash) => void }, reputationToken: Address, amount: bigint, questionId: bigint, universeId: bigint) => Promise<ZoltarForkActionResult>
	forkZoltarUniverse: (accountAddress: Address, callbacks: { onTransactionPrepared?: WriteOperationsParameters['onTransactionPrepared']; onTransactionSubmitted: (hash: Hash) => void }, universeId: bigint, questionId: bigint) => Promise<ZoltarForkActionResult>
	loadZoltarForkAccess: (accountAddress: Address, reputationToken: Address, universeId: bigint, childUniverses: ZoltarForkAccessChildUniverse[]) => Promise<readonly OptionalReadResult<bigint>[]>
}

const defaultUseZoltarForkDependencies: UseZoltarForkDependencies = {
	approveForkRep: async (accountAddress, callbacks, reputationToken, amount, questionId, universeId) => {
		const approval = await approveErc20(createWalletWriteClient(accountAddress, callbacks), reputationToken, getZoltarAddress(), amount, 'approveForkRep')
		return {
			action: 'approveForkRep',
			hash: approval.hash,
			questionId: formatQuestionId(questionId),
			universeId,
		}
	},
	forkZoltarUniverse: async (accountAddress, callbacks, universeId, questionId) => await forkZoltarUniverse(createWalletWriteClient(accountAddress, callbacks), universeId, questionId),
	loadZoltarForkAccess: async (accountAddress, reputationToken, universeId, childUniverses) => {
		const readClient = createConnectedReadClient()
		const results = await readOptionalMulticall(readClient, [
			{
				abi: ABIS.mainnet.erc20,
				functionName: 'balanceOf',
				address: reputationToken,
				args: [accountAddress],
			},
			{
				abi: ABIS.mainnet.erc20,
				functionName: 'allowance',
				address: reputationToken,
				args: [accountAddress, getZoltarAddress()],
			},
			{
				abi: Zoltar_Zoltar.abi,
				functionName: 'getMigrationRepBalance',
				address: getZoltarAddress(),
				args: [accountAddress, universeId],
			},
			...childUniverses.map(child => ({
				abi: ABIS.mainnet.erc20,
				functionName: 'balanceOf',
				address: child.reputationToken,
				args: [accountAddress],
			})),
		])
		return results.map(toBigIntReadResult)
	},
}

function toReadError(error: unknown) {
	return error instanceof Error ? error : new Error('Unknown read error')
}

function toBigIntReadResult(result: { error?: unknown; result?: unknown; status: 'failure' | 'success' }): OptionalReadResult<bigint> {
	if (result.status === 'success') {
		if (typeof result.result === 'bigint') {
			return {
				result: result.result,
				status: 'success',
			}
		}
		return {
			error: new Error('Unexpected non-bigint Zoltar fork access value'),
			status: 'failure',
		}
	}
	return {
		error: toReadError(result.error),
		status: 'failure',
	}
}

function formatQuestionId(questionId: bigint) {
	return `0x${questionId.toString(16)}`
}

function resolveSubmittedForkQuestionId(submittedQuestionId: string) {
	return parseBigIntInput(submittedQuestionId, 'Fork question ID')
}

function resolveUniverseForkQuestionId(universe: ZoltarUniverseSummary) {
	const questionIdString = universe.forkQuestionDetails?.questionId ?? ''
	if (questionIdString === '') throw new Error('Fork question ID is missing')
	return BigInt(questionIdString)
}

export function useZoltarFork(
	{ accountAddress, activeUniverseId, ensureZoltarUniverse, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState, refreshZoltarUniverse, shouldAutoLoadForkAccess, zoltarUniverse }: UseZoltarForkParameters,
	dependencies: UseZoltarForkDependencies = defaultUseZoltarForkDependencies,
) {
	const forkAccessLoad = useLoadController()
	const zoltarForkError = useSignal<string | undefined>(undefined)
	const zoltarForkPending = useSignal(false)
	const zoltarForkQuestionId = useSignal('')
	const zoltarForkResult = useSignal<ZoltarForkActionResult | undefined>(undefined)
	const zoltarForkApproval = useSignal<TokenApprovalState>({
		error: undefined,
		loading: false,
		value: undefined,
	})
	const zoltarForkRepBalance = useSignal<bigint | undefined>(undefined)
	const zoltarForkActiveAction = useSignal<'approve' | 'fork' | undefined>(undefined)
	const zoltarForkFeedback = useSignal<ActionFeedback<ZoltarForkActionResult['action']> | undefined>(undefined)
	const zoltarMigrationPreparedRepBalance = useSignal<bigint | undefined>(undefined)
	const zoltarMigrationChildRepBalances = useSignal<Record<string, bigint | undefined>>({})
	const nextForkAccessLoad = useRequestGuard()
	const resolveActionResultName = (actionName: 'approve' | 'fork') => (actionName === 'approve' ? 'approveForkRep' : 'forkZoltar')
	const getPendingTitle = (actionName: 'approve' | 'fork') => (actionName === 'approve' ? 'Approving REP for fork' : 'Forking Zoltar')
	const getSuccessTitle = (actionName: 'approve' | 'fork') => (actionName === 'approve' ? 'REP approved for fork' : 'Zoltar fork submitted')
	const getFailureTitle = (actionName: 'approve' | 'fork') => (actionName === 'approve' ? 'Fork REP approval failed' : 'Zoltar fork failed')

	const loadZoltarForkAccess = async () => {
		const reputationToken = zoltarUniverse?.reputationToken ?? (activeUniverseId === 0n ? getGenesisReputationTokenAddress() : undefined)
		if (accountAddress === undefined || reputationToken === undefined || reputationToken === zeroAddress) {
			zoltarForkApproval.value = {
				error: undefined,
				loading: false,
				value: undefined,
			}
			zoltarForkRepBalance.value = undefined
			zoltarMigrationPreparedRepBalance.value = undefined
			zoltarMigrationChildRepBalances.value = {}
			return
		}

		const isCurrent = nextForkAccessLoad()
		const universeId = zoltarUniverse?.universeId ?? activeUniverseId
		const childUniverses = (zoltarUniverse?.childUniverses ?? []).filter(child => child.reputationToken !== zeroAddress)
		if (isCurrent())
			zoltarForkApproval.value = {
				...zoltarForkApproval.value,
				error: undefined,
				loading: true,
			}

		await forkAccessLoad.track(async () => {
			const accessResults = await dependencies.loadZoltarForkAccess(accountAddress, reputationToken, universeId, childUniverses).catch(error => {
				const failureResult = {
					error: toReadError(error),
					status: 'failure',
				} satisfies OptionalReadResult<bigint>
				return [failureResult, failureResult, failureResult, ...childUniverses.map(() => failureResult)]
			})
			const [repBalanceResult, approvalResult, preparedRepBalanceResult, ...childBalanceResults] = accessResults
			if (!isCurrent()) return
			if (repBalanceResult?.status === 'success') zoltarForkRepBalance.value = repBalanceResult.result
			if (approvalResult?.status === 'success') {
				zoltarForkApproval.value = {
					error: undefined,
					loading: false,
					value: approvalResult.result,
				}
			} else {
				zoltarForkApproval.value = {
					error: getErrorMessage(approvalResult?.error, 'Failed to load token approval'),
					loading: false,
					value: undefined,
				}
			}
			if (preparedRepBalanceResult?.status === 'success') {
				zoltarMigrationPreparedRepBalance.value = preparedRepBalanceResult.result
			} else {
				zoltarMigrationPreparedRepBalance.value = undefined
			}
			const nextChildBalances = { ...zoltarMigrationChildRepBalances.value }
			for (const [index, child] of childUniverses.entries()) {
				const childBalanceResult = childBalanceResults[index] as OptionalReadResult<bigint> | undefined
				if (childBalanceResult?.status !== 'success') continue
				nextChildBalances[child.universeId.toString()] = childBalanceResult.result
			}
			zoltarMigrationChildRepBalances.value = nextChildBalances
		})
	}

	const runZoltarForkAction = async (actionName: 'approve' | 'fork', action: (walletAddress: Address, universe: ZoltarUniverseSummary, questionId: bigint) => Promise<ZoltarForkActionResult>, errorFallback: string, refreshAfter: boolean, questionIdSource: 'submitted' | 'universe') => {
		if (
			!requireWallet(
				accountAddress,
				message => {
					zoltarForkError.value = message
				},
				'using Zoltar fork actions',
			)
		)
			return

		zoltarForkPending.value = true
		zoltarForkActiveAction.value = actionName
		zoltarForkError.value = undefined
		zoltarForkFeedback.value = createPendingActionFeedback(resolveActionResultName(actionName), getPendingTitle(actionName))
		zoltarForkResult.value = undefined
		const submittedQuestionId = zoltarForkQuestionId.value

		try {
			let result: ZoltarForkActionResult | undefined
			try {
				await assertActiveWallet(accountAddress)
				onTransactionRequested(createZoltarForkTransactionIntent(actionName))
				const universe = await ensureZoltarUniverse()
				const questionId = questionIdSource === 'submitted' ? resolveSubmittedForkQuestionId(submittedQuestionId) : resolveUniverseForkQuestionId(universe)
				result = await action(accountAddress, universe, questionId)
				zoltarForkResult.value = result
				zoltarForkFeedback.value = createSuccessActionFeedback(result.action, getSuccessTitle(actionName), result.hash)
				onTransactionPresented(createZoltarForkSuccessPresentation(result))
			} catch (error) {
				const message = formatWriteErrorMessage(error, errorFallback)
				onTransactionFailed?.(message)
				zoltarForkFeedback.value = createErrorActionFeedback(resolveActionResultName(actionName), getFailureTitle(actionName), message)
				return
			}

			try {
				if (refreshAfter) {
					await refreshWalletStateOnly(refreshState)
					await refreshZoltarUniverse()
				}
				await loadZoltarForkAccess()
			} catch (error) {
				const message = formatRefreshErrorMessage(error, 'Zoltar fork transaction succeeded, but refreshing the UI failed')
				zoltarForkFeedback.value = createWarningActionFeedback(result.action, getSuccessTitle(actionName), message, result.hash)
				onTransactionPresented(createZoltarForkWarningPresentation(result, message))
			}
		} finally {
			zoltarForkPending.value = false
			zoltarForkActiveAction.value = undefined
			onTransactionFinished()
		}
	}

	const approveZoltarForkRep = useCallback(
		async (amount?: bigint) =>
			await runZoltarForkAction(
				'approve',
				async (walletAddress, universe, questionId) => {
					const approvalAmount = amount ?? universe.forkThreshold
					return await dependencies.approveForkRep(walletAddress, { onTransactionPrepared, onTransactionSubmitted }, universe.reputationToken, approvalAmount, questionId, universe.universeId)
				},
				'Failed to approve REP for Zoltar fork',
				false,
				'universe',
			),
		[runZoltarForkAction, onTransactionPrepared, onTransactionSubmitted, dependencies],
	)

	const forkZoltar = async () =>
		await runZoltarForkAction(
			'fork',
			async (walletAddress, universe, questionId) => {
				if (universe.hasForked) throw new Error('Zoltar has already forked')
				return await dependencies.forkZoltarUniverse(walletAddress, { onTransactionPrepared, onTransactionSubmitted }, universe.universeId, questionId)
			},
			'Failed to fork Zoltar',
			true,
			'submitted',
		)

	useEffect(() => {
		if (!shouldAutoLoadForkAccess) return
		void loadZoltarForkAccess().catch(error => {
			zoltarForkError.value = getErrorMessage(error, 'Failed to load Zoltar fork access')
			console.error('[zoltar-fork] failed to auto-load fork access', error)
		})
	}, [accountAddress, activeUniverseId, shouldAutoLoadForkAccess, zoltarUniverse?.reputationToken, zoltarUniverse?.childUniverses.map(child => child.universeId.toString()).join(',')])

	return {
		approveZoltarForkRep,
		forkZoltar,
		loadZoltarForkAccess,
		loadingZoltarForkAccess: forkAccessLoad.isLoading.value,
		zoltarForkActiveAction: zoltarForkActiveAction.value,
		zoltarForkApproval: zoltarForkApproval.value,
		zoltarForkError: zoltarForkError.value,
		zoltarForkFeedback: zoltarForkFeedback.value,
		zoltarForkPending: zoltarForkPending.value,
		zoltarForkQuestionId: zoltarForkQuestionId.value,
		zoltarForkRepBalance: zoltarForkRepBalance.value,
		zoltarForkResult: zoltarForkResult.value,
		zoltarMigrationChildRepBalances: zoltarMigrationChildRepBalances.value,
		zoltarMigrationPreparedRepBalance: zoltarMigrationPreparedRepBalance.value,
		setZoltarForkQuestionId: (questionId: string) => {
			zoltarForkQuestionId.value = questionId
		},
	}
}
