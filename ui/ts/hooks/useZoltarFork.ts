import { useSignal } from '@preact/signals'
import { useCallback, useEffect } from 'preact/hooks'
import { zeroAddress, type Address, type Hash } from 'viem'
import { approveErc20, forkZoltarUniverse, getDeploymentSteps, loadErc20Allowance, loadErc20Balance, loadRepTokensMigratedRepBalance } from '../contracts.js'
import { createConnectedReadClient, createWalletWriteClient } from '../lib/clients.js'
import { requireWallet } from '../lib/walletGuard.js'
import { getErrorMessage } from '../lib/errors.js'
import { parseBigIntInput } from '../lib/marketForm.js'
import { GENESIS_REPUTATION_TOKEN_ADDRESS } from '../lib/universe.js'
import { requireDefined } from '../lib/required.js'
import { useRequestGuard } from '../lib/requestGuard.js'
import type { ZoltarForkActionResult, ZoltarUniverseSummary } from '../types/contracts.js'

type UseZoltarForkParameters = {
	accountAddress: Address | undefined
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

function formatQuestionId(questionId: bigint) {
	return `0x${questionId.toString(16)}`
}

function getZoltarAddress() {
	const zoltarStep = requireDefined(
		getDeploymentSteps().find(step => step.id === 'zoltar'),
		'Zoltar deployment step not found',
	)
	return zoltarStep.address
}

export function useZoltarFork({ accountAddress, activeUniverseId, ensureZoltarUniverse, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted, refreshState, refreshZoltarUniverse, zoltarUniverse }: UseZoltarForkParameters) {
	const loadingZoltarForkAccess = useSignal(false)
	const zoltarForkError = useSignal<string | undefined>(undefined)
	const zoltarForkPending = useSignal(false)
	const zoltarForkQuestionId = useSignal('')
	const zoltarForkResult = useSignal<ZoltarForkActionResult | undefined>(undefined)
	const zoltarForkAllowance = useSignal<bigint | undefined>(undefined)
	const zoltarForkRepBalance = useSignal<bigint | undefined>(undefined)
	const zoltarForkActiveAction = useSignal<'approve' | 'fork' | undefined>(undefined)
	const zoltarMigrationPreparedRepBalance = useSignal<bigint | undefined>(undefined)
	const zoltarMigrationChildRepBalances = useSignal<Record<string, bigint | undefined>>({})
	const nextForkAccessLoad = useRequestGuard()

	const loadZoltarForkAccess = async () => {
		const reputationToken = zoltarUniverse?.reputationToken ?? (activeUniverseId === 0n ? GENESIS_REPUTATION_TOKEN_ADDRESS : undefined)
		if (accountAddress === undefined || reputationToken === undefined || reputationToken === zeroAddress) {
			zoltarForkAllowance.value = undefined
			zoltarForkRepBalance.value = undefined
			zoltarMigrationPreparedRepBalance.value = undefined
			zoltarMigrationChildRepBalances.value = {}
			return
		}

		const isCurrent = nextForkAccessLoad()
		loadingZoltarForkAccess.value = true
		const readClient = createConnectedReadClient()
		const universeId = zoltarUniverse?.universeId ?? activeUniverseId
		const childUniverses = zoltarUniverse?.childUniverses ?? []

		let pending = 0
		const done = () => {
			pending -= 1
			if (pending === 0 && isCurrent()) loadingZoltarForkAccess.value = false
		}

		pending++
		loadErc20Balance(readClient, reputationToken, accountAddress)
			.then(balance => {
				if (isCurrent()) zoltarForkRepBalance.value = balance
			})
			.catch(() => undefined)
			.finally(done)

		pending++
		loadErc20Allowance(readClient, reputationToken, accountAddress, getZoltarAddress())
			.then(allowance => {
				if (isCurrent()) zoltarForkAllowance.value = allowance
			})
			.catch(() => {
				if (isCurrent()) zoltarForkAllowance.value = undefined
			})
			.finally(done)

		pending++
		loadRepTokensMigratedRepBalance(readClient, universeId, accountAddress)
			.then(preparedRepBalance => {
				if (isCurrent()) zoltarMigrationPreparedRepBalance.value = preparedRepBalance
			})
			.catch(() => {
				if (isCurrent()) zoltarMigrationPreparedRepBalance.value = undefined
			})
			.finally(done)

		for (const child of childUniverses) {
			if (child.reputationToken === zeroAddress) continue
			const childId = child.universeId.toString()
			pending++
			loadErc20Balance(readClient, child.reputationToken, accountAddress)
				.then(balance => {
					if (!isCurrent()) return
					zoltarMigrationChildRepBalances.value = { ...zoltarMigrationChildRepBalances.value, [childId]: balance }
				})
				.catch(() => undefined)
				.finally(done)
		}

		if (pending === 0) loadingZoltarForkAccess.value = false
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
			onTransactionRequested()
			const universe = await ensureZoltarUniverse()
			const questionId = options?.requireQuestionIdInput
				? parseBigIntInput(zoltarForkQuestionId.value, 'Fork question ID')
				: (() => {
						const questionIdString = universe.forkQuestionDetails?.questionId ?? ''
						if (questionIdString === '') throw new Error('Fork question ID is missing')
						return BigInt(questionIdString)
					})()
			const result = await action(accountAddress, universe, questionId)
			zoltarForkResult.value = result
			onTransaction(result.hash)
			if (refreshAfter) {
				await refreshState()
				await refreshZoltarUniverse()
			}
			await loadZoltarForkAccess()
		} catch (error) {
			zoltarForkError.value = getErrorMessage(error, errorFallback)
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
					const approval = await approveErc20(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), universe.reputationToken, getZoltarAddress(), approvalAmount, 'approveForkRep')
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
				return await forkZoltarUniverse(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), universe.universeId, questionId)
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
		loadingZoltarForkAccess: loadingZoltarForkAccess.value,
		zoltarForkActiveAction: zoltarForkActiveAction.value,
		zoltarForkAllowance: zoltarForkAllowance.value,
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
