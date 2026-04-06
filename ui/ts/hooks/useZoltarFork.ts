import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { zeroAddress, type Address, type Hash } from 'viem'
import { approveErc20, forkZoltarUniverse, getDeploymentSteps, loadErc20Allowance, loadErc20Balance, loadRepTokensMigratedRepBalance } from '../contracts.js'
import { createReadClient, createWalletWriteClient, getRequiredInjectedEthereum } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { parseBigIntInput } from '../lib/marketForm.js'
import { GENESIS_REPUTATION_TOKEN_ADDRESS } from '../lib/universe.js'
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
	const zoltarStep = getDeploymentSteps().find(step => step.id === 'zoltar')
	if (zoltarStep === undefined) throw new Error('Zoltar deployment step not found')
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
		try {
			const readClient = createReadClient()
			const universeId = zoltarUniverse?.universeId ?? activeUniverseId
			const childUniverses = zoltarUniverse?.childUniverses ?? []
			const [allowance, balance, preparedRepBalance, childRepBalances] = await Promise.all([
				loadErc20Allowance(readClient, reputationToken, accountAddress, getZoltarAddress()),
				loadErc20Balance(readClient, reputationToken, accountAddress),
				loadRepTokensMigratedRepBalance(readClient, universeId, accountAddress),
				Promise.all(childUniverses.map(async child => [child.universeId.toString(), child.reputationToken === zeroAddress ? undefined : await loadErc20Balance(readClient, child.reputationToken, accountAddress)] as const)),
			])
			if (!isCurrent()) return
			zoltarForkAllowance.value = allowance
			zoltarForkRepBalance.value = balance
			zoltarMigrationPreparedRepBalance.value = preparedRepBalance
			const nextChildRepBalances: Record<string, bigint | undefined> = {}
			for (const [childUniverseId, childRepBalance] of childRepBalances) {
				nextChildRepBalances[childUniverseId] = childRepBalance
			}
			zoltarMigrationChildRepBalances.value = nextChildRepBalances
		} finally {
			if (isCurrent()) {
				loadingZoltarForkAccess.value = false
			}
		}
	}

	const runZoltarForkAction = async (actionName: 'approve' | 'fork', action: (walletAddress: Address, universe: ZoltarUniverseSummary, questionId: bigint) => Promise<ZoltarForkActionResult>, errorFallback: string, refreshAfter: boolean) => {
		try {
			getRequiredInjectedEthereum()
		} catch {
			zoltarForkError.value = 'No injected wallet found'
			return
		}
		if (accountAddress === undefined) {
			zoltarForkError.value = 'Connect a wallet before using Zoltar fork actions'
			return
		}

		zoltarForkPending.value = true
		zoltarForkActiveAction.value = actionName
		zoltarForkError.value = undefined
		zoltarForkResult.value = undefined

		try {
			onTransactionRequested()
			const questionId = parseBigIntInput(zoltarForkQuestionId.value, 'Fork question ID')
			const universe = await ensureZoltarUniverse()
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

	const approveZoltarForkRep = async () =>
		await runZoltarForkAction(
			'approve',
			async (walletAddress, universe, questionId) => {
				const approval = await approveErc20(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), universe.reputationToken, getZoltarAddress(), universe.forkThreshold, 'approveForkRep')
				return {
					action: 'approveForkRep',
					hash: approval.hash,
					questionId: formatQuestionId(questionId),
					universeId: universe.universeId,
				} satisfies ZoltarForkActionResult
			},
			'Failed to approve REP for Zoltar fork',
			false,
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
