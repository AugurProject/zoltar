import { useSignal } from '@preact/signals'
import { useCallback, useEffect, useRef } from 'preact/hooks'
import { zeroAddress, type Address } from '@zoltar/shared/ethereum'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { Zoltar_Zoltar } from '@zoltar/ui-core-shared/contractArtifact.js'
import { readOptionalMulticall } from '../../../protocol/core.js'
import { approveErc20 } from '../../../protocol/tokenActions.js'
import { forkZoltarUniverse } from '../../../protocol/zoltarForks.js'
import { getZoltarAddress } from '../../../protocol/zoltarDeploymentHelpers.js'
import { useLoadController } from '@zoltar/ui-core-shared/hooks/useLoadController.js'
import { createConnectedReadClient, createWalletWriteClient } from '@zoltar/ui-core-shared/lib/clients.js'
import { requireWallet } from '@zoltar/ui-core-shared/lib/requireWalletConnection.js'
import { assertActiveWallet } from '@zoltar/ui-core-shared/lib/assertActiveWallet.js'
import { formatRefreshErrorMessage, formatWriteErrorMessage, getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '@zoltar/ui-core-shared/lib/actionFeedback.js'
import type { ActionFeedback } from '@zoltar/ui-core-shared/lib/actionFeedback.js'
import { createZoltarForkSuccessPresentation, createZoltarForkTransactionIntent, createZoltarForkWarningPresentation } from '../../zoltarTransactionPresentations.js'
import { parseBigIntInput } from '@zoltar/ui-core-shared/lib/integerInput.js'
import type { TokenApprovalState } from '@zoltar/ui-core-shared/lib/tokenApproval.js'
import { getGenesisReputationTokenAddress } from '../lib/universe.js'
import { useRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import { refreshWalletStateOnly } from '@zoltar/ui-core-shared/lib/refreshState.js'
import type { TransactionLifecycleParameters, WriteOperationContext } from '../../../types/app.js'
import type { CreateWriteClientCallbacks } from '@zoltar/ui-core-shared/lib/chainBackend.js'
import type { ZoltarForkActionResult, ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { createActiveEnvironmentGuard } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { TRANSACTION_ACTION_LOCK_REASON } from '@zoltar/ui-core-shared/lib/transactionTray.js'

type UseZoltarForkParameters = TransactionLifecycleParameters &
	WriteOperationContext & {
		activeUniverseId: bigint
		environmentRefreshKey: number
		ensureZoltarUniverse: () => Promise<ZoltarUniverseSummary>
		refreshZoltarUniverse: () => Promise<ZoltarUniverseSummary | undefined>
		shouldAutoLoadForkAccess: boolean
		zoltarUniverse: ZoltarUniverseSummary | undefined
	}

type OptionalReadResult<TResult> = { result: TResult; status: 'success' } | { error: Error; result?: undefined; status: 'failure' }
type ZoltarForkAccessChildUniverse = ZoltarUniverseSummary['childUniverses'][number]

export type UseZoltarForkDependencies = {
	approveForkRep: (accountAddress: Address, callbacks: CreateWriteClientCallbacks, reputationToken: Address, amount: bigint, questionId: bigint, universeId: bigint) => Promise<ZoltarForkActionResult>
	forkZoltarUniverse: (accountAddress: Address, callbacks: CreateWriteClientCallbacks, universeId: bigint, questionId: bigint) => Promise<ZoltarForkActionResult>
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
				functionName: 'getMigrationRepBalanceAttoRep',
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
			error: new Error('Unexpected non-bigint universe fork access value'),
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

function resolveForkQuestionId(submittedQuestionId: string, universe: ZoltarUniverseSummary) {
	if (!universe.hasForked) return resolveSubmittedForkQuestionId(submittedQuestionId)

	const universeQuestionId = universe.forkQuestionDetails?.questionId
	if (universeQuestionId === undefined || universeQuestionId === '') throw new Error('Fork question ID is missing')
	return BigInt(universeQuestionId)
}

export function useZoltarFork(
	{
		accountAddress,
		activeUniverseId,
		environmentRefreshKey,
		ensureZoltarUniverse,
		onTransactionFailed,
		onTransactionFinished,
		onTransactionPresented,
		onTransactionPrepared,
		onTransactionRequested,
		onTransactionSubmitted,
		refreshState,
		refreshZoltarUniverse,
		shouldAutoLoadForkAccess,
		zoltarUniverse,
	}: UseZoltarForkParameters,
	dependencies: UseZoltarForkDependencies = defaultUseZoltarForkDependencies,
) {
	const forkAccessLoad = useLoadController()
	const zoltarForkError = useSignal<string | undefined>(undefined)
	const zoltarForkPending = useSignal(false)
	const forkQuestionScopeKey = `${accountAddress ?? 'disconnected'}:${environmentRefreshKey}:${activeUniverseId.toString()}`
	const forkQuestionSelection = useSignal({ questionId: '', scopeKey: forkQuestionScopeKey })
	const zoltarForkQuestionId = forkQuestionSelection.value.scopeKey === forkQuestionScopeKey ? forkQuestionSelection.value.questionId : ''
	const zoltarForkResult = useSignal<ZoltarForkActionResult | undefined>(undefined)
	const zoltarForkApproval = useSignal<TokenApprovalState>({
		error: undefined,
		loading: false,
		value: undefined,
	})
	const zoltarForkRepBalanceAttoRep = useSignal<bigint | undefined>(undefined)
	const zoltarForkActiveAction = useSignal<'approve' | 'fork' | undefined>(undefined)
	const zoltarForkFeedback = useSignal<ActionFeedback<ZoltarForkActionResult['action']> | undefined>(undefined)
	const zoltarMigrationPreparedRepBalanceAttoRep = useSignal<bigint | undefined>(undefined)
	const zoltarMigrationChildRepBalancesAttoRep = useSignal<Record<string, bigint | undefined>>({})
	const nextForkAccessLoad = useRequestGuard()
	const forkAccessScopeKey = `${accountAddress ?? 'disconnected'}:${environmentRefreshKey}:${activeUniverseId.toString()}:${zoltarUniverse?.universeId.toString() ?? 'missing'}:${zoltarUniverse?.reputationToken ?? 'missing'}`
	const currentForkAccessScope = useRef({ generation: 0, key: forkAccessScopeKey })
	if (currentForkAccessScope.current.key !== forkAccessScopeKey) currentForkAccessScope.current = { generation: currentForkAccessScope.current.generation + 1, key: forkAccessScopeKey }
	const forkAccessScopeGeneration = currentForkAccessScope.current.generation
	const loadedForkAccessScopeGeneration = useRef<number | undefined>(undefined)
	const resolveActionResultName = (actionName: 'approve' | 'fork') => (actionName === 'approve' ? 'approveForkRep' : 'forkZoltar')
	const getPendingTitle = (actionName: 'approve' | 'fork') => (actionName === 'approve' ? 'Approving REP for fork' : 'Forking universe')
	const getSuccessTitle = (actionName: 'approve' | 'fork') => (actionName === 'approve' ? 'REP approved for fork' : 'Universe fork submitted')
	const getFailureTitle = (actionName: 'approve' | 'fork') => (actionName === 'approve' ? 'Fork REP approval failed' : 'Universe fork failed')

	const loadZoltarForkAccess = async (universe: ZoltarUniverseSummary | undefined = zoltarUniverse) => {
		const isCurrent = nextForkAccessLoad()
		const isCurrentScope = () => isCurrent() && currentForkAccessScope.current.generation === forkAccessScopeGeneration
		const reputationToken = universe?.reputationToken ?? (activeUniverseId === 0n ? getGenesisReputationTokenAddress() : undefined)
		if (accountAddress === undefined || reputationToken === undefined || reputationToken === zeroAddress) {
			loadedForkAccessScopeGeneration.current = forkAccessScopeGeneration
			zoltarForkApproval.value = {
				error: undefined,
				loading: false,
				value: undefined,
			}
			zoltarForkRepBalanceAttoRep.value = undefined
			zoltarMigrationPreparedRepBalanceAttoRep.value = undefined
			zoltarMigrationChildRepBalancesAttoRep.value = {}
			return
		}

		const universeId = universe?.universeId ?? activeUniverseId
		const childUniverses = (universe?.childUniverses ?? []).filter(child => child.reputationToken !== zeroAddress)
		if (isCurrentScope())
			zoltarForkApproval.value = {
				...zoltarForkApproval.value,
				error: undefined,
				loading: true,
			}
		if (isCurrentScope()) zoltarMigrationChildRepBalancesAttoRep.value = {}

		await forkAccessLoad.track(async () => {
			const accessResults = await dependencies.loadZoltarForkAccess(accountAddress, reputationToken, universeId, childUniverses).catch(error => {
				const failureResult = {
					error: toReadError(error),
					status: 'failure',
				} satisfies OptionalReadResult<bigint>
				return [failureResult, failureResult, failureResult, ...childUniverses.map(() => failureResult)]
			})
			const [repBalanceResult, approvalResult, preparedRepBalanceResult, ...childBalanceResults] = accessResults
			if (!isCurrentScope()) return
			loadedForkAccessScopeGeneration.current = forkAccessScopeGeneration
			if (repBalanceResult?.status === 'success') zoltarForkRepBalanceAttoRep.value = repBalanceResult.result
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
				zoltarMigrationPreparedRepBalanceAttoRep.value = preparedRepBalanceResult.result
			} else {
				zoltarMigrationPreparedRepBalanceAttoRep.value = undefined
			}
			const nextChildBalances: Record<string, bigint | undefined> = {}
			for (const [index, child] of childUniverses.entries()) {
				const childBalanceResult = childBalanceResults[index] as OptionalReadResult<bigint> | undefined
				if (childBalanceResult?.status !== 'success') continue
				nextChildBalances[child.universeId.toString()] = childBalanceResult.result
			}
			zoltarMigrationChildRepBalancesAttoRep.value = nextChildBalances
		})
	}

	const runZoltarForkAction = async (actionName: 'approve' | 'fork', action: (walletAddress: Address, universe: ZoltarUniverseSummary, questionId: bigint) => Promise<ZoltarForkActionResult>, errorFallback: string, refreshAfter: boolean) => {
		if (
			!requireWallet(
				accountAddress,
				message => {
					zoltarForkError.value = message
				},
				'using universe fork actions',
			)
		)
			return
		const environmentGuard = createActiveEnvironmentGuard()

		zoltarForkPending.value = true
		zoltarForkActiveAction.value = actionName
		zoltarForkError.value = undefined
		zoltarForkFeedback.value = createPendingActionFeedback(resolveActionResultName(actionName), getPendingTitle(actionName))
		zoltarForkResult.value = undefined
		const submittedQuestionId = zoltarForkQuestionId
		let ownsTransaction = false

		try {
			let result: ZoltarForkActionResult | undefined
			try {
				await assertActiveWallet(accountAddress)
				if (!environmentGuard.isCurrent()) return
				if (
					onTransactionRequested(
						createZoltarForkTransactionIntent(actionName, {
							questionId: submittedQuestionId,
							universeId: activeUniverseId,
						}),
					) === false
				) {
					zoltarForkFeedback.value = createErrorActionFeedback(resolveActionResultName(actionName), getFailureTitle(actionName), TRANSACTION_ACTION_LOCK_REASON)
					return
				}
				ownsTransaction = true
				const universe = await ensureZoltarUniverse()
				if (!environmentGuard.isCurrent()) return
				const questionId = resolveForkQuestionId(submittedQuestionId, universe)
				result = await action(accountAddress, universe, questionId)
				if (!environmentGuard.isCurrent()) return
				zoltarForkResult.value = result
				zoltarForkFeedback.value = createSuccessActionFeedback(result.action, getSuccessTitle(actionName), result.hash)
				onTransactionPresented(createZoltarForkSuccessPresentation(result))
			} catch (error) {
				if (!environmentGuard.isCurrent()) return
				const message = formatWriteErrorMessage(error, errorFallback)
				if (ownsTransaction) onTransactionFailed?.(message)
				zoltarForkFeedback.value = createErrorActionFeedback(resolveActionResultName(actionName), getFailureTitle(actionName), message)
				return
			}

			try {
				let refreshedUniverse: ZoltarUniverseSummary | undefined
				if (refreshAfter) {
					await refreshWalletStateOnly(refreshState)
					if (!environmentGuard.isCurrent()) return
					refreshedUniverse = await refreshZoltarUniverse()
					if (!environmentGuard.isCurrent()) return
				}
				await loadZoltarForkAccess(refreshedUniverse)
			} catch (error) {
				if (!environmentGuard.isCurrent()) return
				const message = formatRefreshErrorMessage(error, 'Universe fork transaction succeeded, but refreshing the UI failed')
				zoltarForkFeedback.value = createWarningActionFeedback(result.action, getSuccessTitle(actionName), message, result.hash)
				onTransactionPresented(createZoltarForkWarningPresentation(result, message))
			}
		} finally {
			if (environmentGuard.isCurrent()) {
				zoltarForkPending.value = false
				zoltarForkActiveAction.value = undefined
				if (ownsTransaction) onTransactionFinished()
			}
		}
	}

	useEffect(() => {
		zoltarForkError.value = undefined
		zoltarForkPending.value = false
		zoltarForkResult.value = undefined
		zoltarForkFeedback.value = undefined
		zoltarForkActiveAction.value = undefined
	}, [environmentRefreshKey])

	const approveZoltarForkRep = useCallback(
		async (amount?: bigint) =>
			await runZoltarForkAction(
				'approve',
				async (walletAddress, universe, questionId) => {
					const approvalAmount = amount ?? universe.forkThresholdAttoRep
					return await dependencies.approveForkRep(walletAddress, { onTransactionPrepared, onTransactionSubmitted }, universe.reputationToken, approvalAmount, questionId, universe.universeId)
				},
				'Failed to approve REP for the universe fork',
				false,
			),
		[runZoltarForkAction, onTransactionPrepared, onTransactionSubmitted, dependencies],
	)

	const forkZoltar = async () =>
		await runZoltarForkAction(
			'fork',
			async (walletAddress, universe, questionId) => {
				if (universe.hasForked) throw new Error('This universe has already forked')
				return await dependencies.forkZoltarUniverse(walletAddress, { onTransactionPrepared, onTransactionSubmitted }, universe.universeId, questionId)
			},
			'Failed to fork the universe',
			true,
		)

	useEffect(() => {
		if (!shouldAutoLoadForkAccess) return
		void loadZoltarForkAccess().catch(error => {
			zoltarForkError.value = getErrorMessage(error, 'Failed to load universe fork access')
			console.error('[zoltar-fork] failed to auto-load fork access', error)
		})
	}, [accountAddress, activeUniverseId, environmentRefreshKey, shouldAutoLoadForkAccess, zoltarUniverse?.reputationToken, zoltarUniverse?.childUniverses.map(child => `${child.universeId.toString()}:${child.exists ? 'deployed' : 'undeployed'}:${child.reputationToken}`).join(',')])

	const hasCurrentForkAccess = loadedForkAccessScopeGeneration.current === forkAccessScopeGeneration
	return {
		approveZoltarForkRep,
		forkZoltar,
		loadZoltarForkAccess,
		loadingZoltarForkAccess: forkAccessLoad.isLoading.value,
		zoltarForkActiveAction: zoltarForkActiveAction.value,
		zoltarForkApproval: hasCurrentForkAccess
			? zoltarForkApproval.value
			: {
					error: undefined,
					loading: false,
					value: undefined,
				},
		zoltarForkError: zoltarForkError.value,
		zoltarForkFeedback: zoltarForkFeedback.value,
		zoltarForkPending: zoltarForkPending.value,
		zoltarForkQuestionId,
		zoltarForkRepBalanceAttoRep: hasCurrentForkAccess ? zoltarForkRepBalanceAttoRep.value : undefined,
		zoltarForkResult: zoltarForkResult.value,
		zoltarMigrationChildRepBalancesAttoRep: hasCurrentForkAccess ? zoltarMigrationChildRepBalancesAttoRep.value : {},
		zoltarMigrationPreparedRepBalanceAttoRep: hasCurrentForkAccess ? zoltarMigrationPreparedRepBalanceAttoRep.value : undefined,
		setZoltarForkQuestionId: (questionId: string) => {
			forkQuestionSelection.value = { questionId, scopeKey: forkQuestionScopeKey }
		},
	}
}
