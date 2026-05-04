import { useSignal } from '@preact/signals'
import { useCallback, useEffect } from 'preact/hooks'
import { zeroAddress, type Address, type Hash } from 'viem'
import { ABIS } from '../abis.js'
import { Zoltar_Zoltar } from '../contractArtifact.js'
import { approveErc20, forkZoltarUniverse, getZoltarAddress, readOptionalMulticall } from '../contracts.js'
import { useLoadController } from './useLoadController.js'
import { createReadClientForNetwork, createWalletWriteClient } from '../lib/clients.js'
import { requireWallet } from '../lib/walletGuard.js'
import { formatRefreshErrorMessage, formatWriteErrorMessage, getErrorMessage } from '../lib/errors.js'
import { parseBigIntInput } from '../lib/marketForm.js'
import type { TokenApprovalState } from '../lib/tokenApproval.js'
import { useRequestGuard } from '../lib/requestGuard.js'
import { getGenesisReputationTokenAddress } from '../lib/universe.js'
import type { SupportedNetworkKey } from '../shared/networkConfig.js'
import type { ZoltarForkActionResult, ZoltarUniverseSummary } from '../types/contracts.js'

type UseZoltarForkParameters = {
	accountAddress: Address | undefined
	activeNetworkKey: SupportedNetworkKey
	activeUniverseId: bigint
	ensureZoltarUniverse: () => Promise<ZoltarUniverseSummary>
	onTransaction: (hash: Hash) => void
	onTransactionFinished: () => void
	onTransactionRequested: () => void
	onTransactionSubmitted: (hash: Hash) => void
	refreshState: () => Promise<void>
	refreshZoltarUniverse: () => Promise<void>
	zoltarUniverse: ZoltarUniverseSummary | undefined
}

type OptionalReadResult<TResult> = { result: TResult; status: 'success' } | { error: Error; result?: undefined; status: 'failure' }

function toReadError(error: unknown) {
	return error instanceof Error ? error : new Error('Unknown read error')
}

function formatQuestionId(questionId: bigint) {
	return `0x${questionId.toString(16)}`
}

export function useZoltarFork({ accountAddress, activeNetworkKey, activeUniverseId, ensureZoltarUniverse, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted, refreshState, refreshZoltarUniverse, zoltarUniverse }: UseZoltarForkParameters) {
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
	const zoltarMigrationPreparedRepBalance = useSignal<bigint | undefined>(undefined)
	const zoltarMigrationChildRepBalances = useSignal<Record<string, bigint | undefined>>({})
	const nextForkAccessLoad = useRequestGuard()

	const loadZoltarForkAccess = async () => {
		const reputationToken = zoltarUniverse?.reputationToken ?? (activeUniverseId === 0n ? getGenesisReputationTokenAddress(activeNetworkKey) : undefined)
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
		const readClient = createReadClientForNetwork(activeNetworkKey)
		const universeId = zoltarUniverse?.universeId ?? activeUniverseId
		const childUniverses = (zoltarUniverse?.childUniverses ?? []).filter(child => child.reputationToken !== zeroAddress)
		if (isCurrent()) {
			zoltarForkApproval.value = {
				...zoltarForkApproval.value,
				error: undefined,
				loading: true,
			}
		}

		await forkAccessLoad.track(async () => {
			const accessResults = (await readOptionalMulticall(readClient, [
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
					args: [accountAddress, getZoltarAddress(activeNetworkKey)],
				},
				{
					abi: Zoltar_Zoltar.abi,
					functionName: 'getMigrationRepBalance',
					address: getZoltarAddress(activeNetworkKey),
					args: [accountAddress, universeId],
				},
				...childUniverses.map(child => ({
					abi: ABIS.mainnet.erc20,
					functionName: 'balanceOf',
					address: child.reputationToken,
					args: [accountAddress],
				})),
			]).catch(error => {
				const failureResult = {
					error: toReadError(error),
					status: 'failure',
				} satisfies OptionalReadResult<bigint>
				return [failureResult, failureResult, failureResult, ...childUniverses.map(() => failureResult)]
			})) as OptionalReadResult<bigint>[]
			const [repBalanceResult, approvalResult, preparedRepBalanceResult, ...childBalanceResults] = accessResults
			if (!isCurrent()) return
			if (repBalanceResult?.status === 'success') {
				zoltarForkRepBalance.value = repBalanceResult.result
			}
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

	const runZoltarForkAction = async (actionName: 'approve' | 'fork', action: (walletAddress: Address, universe: ZoltarUniverseSummary, questionId: bigint) => Promise<ZoltarForkActionResult>, errorFallback: string, refreshAfter: boolean, options?: { requireQuestionIdInput?: boolean }) => {
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
		zoltarForkResult.value = undefined

		try {
			let result: ZoltarForkActionResult | undefined
			try {
				onTransactionRequested()
				const universe = await ensureZoltarUniverse()
				const questionId = options?.requireQuestionIdInput
					? parseBigIntInput(zoltarForkQuestionId.value, 'Fork question ID')
					: (() => {
							const questionIdString = universe.forkQuestionDetails?.questionId ?? ''
							if (questionIdString === '') throw new Error('Fork question ID is missing')
							return BigInt(questionIdString)
						})()
				result = await action(accountAddress, universe, questionId)
				zoltarForkResult.value = result
				onTransaction(result.hash)
			} catch (error) {
				zoltarForkError.value = formatWriteErrorMessage(error, errorFallback)
				return
			}

			try {
				if (refreshAfter) {
					await refreshState()
					await refreshZoltarUniverse()
				}
				await loadZoltarForkAccess()
			} catch (error) {
				zoltarForkError.value = formatRefreshErrorMessage(error, 'Zoltar fork transaction succeeded, but refreshing the UI failed')
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
					const approval = await approveErc20(createWalletWriteClient(walletAddress, activeNetworkKey, { onTransactionSubmitted }), universe.reputationToken, getZoltarAddress(activeNetworkKey), approvalAmount, 'approveForkRep')
					return {
						action: 'approveForkRep',
						hash: approval.hash,
						questionId: formatQuestionId(questionId),
						universeId: universe.universeId,
					} satisfies ZoltarForkActionResult
				},
				'Failed to approve REP for Zoltar fork',
				false,
				{ requireQuestionIdInput: false },
			),
		[runZoltarForkAction, onTransactionSubmitted],
	)

	const forkZoltar = async () =>
		await runZoltarForkAction(
			'fork',
			async (walletAddress, universe, questionId) => {
				if (universe.hasForked) throw new Error('Zoltar has already forked')
				return await forkZoltarUniverse(createWalletWriteClient(walletAddress, activeNetworkKey, { onTransactionSubmitted }), universe.universeId, questionId)
			},
			'Failed to fork Zoltar',
			true,
		)

	useEffect(() => {
		void loadZoltarForkAccess().catch(() => undefined)
	}, [accountAddress, activeUniverseId, zoltarUniverse?.reputationToken, zoltarUniverse?.childUniverses.map(child => child.universeId.toString()).join(',')])

	return {
		approveZoltarForkRep,
		forkZoltar,
		loadZoltarForkAccess,
		loadingZoltarForkAccess: forkAccessLoad.isLoading.value,
		zoltarForkActiveAction: zoltarForkActiveAction.value,
		zoltarForkApproval: zoltarForkApproval.value,
		zoltarForkError: zoltarForkError.value,
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
