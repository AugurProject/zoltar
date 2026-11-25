import { serializeStoredValue } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import type { ReadClient, ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'
import * as pageCopy from '../../../copy/reportingDeposits.js'
import { formatCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { usePageVisible } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import * as copy from '../../../copy/reporting.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { getImportedEscalationDepositClaimAmount } from '../lib/reportingDomain.js'
import { useEffect, useRef, useState } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { buildWriteActionConfig, runWriteAction } from '@zoltar/ui-core-shared/transactions/writeAction.js'
import { getWalletActiveAppChainGuardState } from '@zoltar/ui-core-shared/transactions/actionGuards.js'
import { isActiveAppChain } from '@zoltar/ui-core-shared/wallet/network.js'
import { createConnectedReadClient, createWalletWriteClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { buildForkCarriedEscalationProofs, loadForkCarriedEscalationDepositsFromParentSnapshot, withdrawForkedEscalationDeposits, type ParentClaimPreparation } from '../../../protocol/reportingCarryState.js'
import { loadReportingDetails } from '../../../protocol/reporting.js'
import { withStatoblastRequestTimeout } from '../../../protocol/requestTimeout.js'
import { useOldActionDataNotice } from '../../useStatoblastPageRefresh.js'
import type { ActiveReportingDetails, AuthenticatedForkClaim, ReportingDetails } from '../../../types/contracts.js'
import type { AccountState, WriteOperationsParameters } from '../../../types/app.js'

type Props = {
	actionDataReadAt?: number | undefined
	parameters: WriteOperationsParameters
	accountState: AccountState
	details: ReportingDetails | undefined
	onRefresh: () => Promise<unknown>
}

async function loadClaims(active: ActiveReportingDetails, wallet: Address, signal?: AbortSignal, preparation?: ParentClaimPreparation) {
	const parent = active.parentQuestionLedgerAddress
	if (parent === undefined || parent === zeroAddress || active.forkContinuation !== true) return []
	const client = withStatoblastRequestTimeout(createConnectedReadClient(), pageCopy.inheritedClaimTimeout, signal)
	let queued = Promise.resolve()
	const readContract: typeof client.readContract = parameters => {
		const read = queued.then(async () => {
			signal?.throwIfAborted()
			try {
				return await client.readContract(parameters)
			} finally {
				signal?.throwIfAborted()
			}
		})
		queued = read.then(
			() => undefined,
			() => undefined,
		)
		return read
	}
	const claims = await Promise.all(
		active.sides.map(async side => {
			const deposits = await loadForkCarriedEscalationDepositsFromParentSnapshot({ ...client, readContract }, active.escalationGameAddress, parent, side.key, wallet, preparation)
			return deposits.map(deposit => ({ side, deposit }))
		}),
	)
	return claims.flat()
}

function createClaimCheckpoint() {
	const checkpoints = new Map<string, Promise<unknown>>()
	return (client: Pick<ReadClient, 'readContract'>, report: (node: string) => void): Pick<ReadClient, 'readContract'> => {
		const useCheckpoint = <T,>(id: string, read: () => Promise<T>): Promise<T> => {
			const previous = checkpoints.get(id)
			if (previous !== undefined) return previous as Promise<T>
			const pending = read().catch(error => {
				checkpoints.delete(id)
				throw error
			})
			checkpoints.set(id, pending)
			return pending
		}
		return {
			readContract: async parameters => {
				// The frozen parent's root is checked independently before its contents are displayed.
				const key = serializeStoredValue([parameters.address, parameters.functionName, parameters.args])
				const value = await useCheckpoint(key, () => client.readContract(parameters))
				if (parameters.functionName === 'nodes') report(key)
				return value
			},
		}
	}
}

/** Inherited reporter claims are question claims, independent of underwriting ownership. */
export function InheritedReporterClaims({ actionDataReadAt, parameters, accountState, details, onRefresh }: Props) {
	const error = useSignal<string | undefined>(undefined)
	const pending = useSignal<string | undefined>(undefined)
	const selection = `${details?.questionLedgerAddress ?? ''}:${accountState.address ?? ''}:${accountState.chainId ?? ''}:${details?.universeId ?? ''}`
	const current = useRef(selection)
	current.current = selection
	useEffect(
		() => () => {
			current.current = ''
		},
		[],
	)
	const active = details?.status === 'active' ? details : undefined
	const [open, setOpen] = useState(false)
	const [loading, setLoading] = useState(false)
	const [retry, setRetry] = useState(0)
	const [progress, setProgress] = useState<ReadonlyMap<ReportingOutcomeKey, { done: bigint; total: bigint }>>(new Map())
	const checkpoint = useRef<{ selection: string; read: ReturnType<typeof createClaimCheckpoint> }>()
	const [loaded, setLoaded] = useState<{ selection: string; claims: Awaited<ReturnType<typeof loadClaims>> }>()
	const visible = usePageVisible()
	const oldActionData = useOldActionDataNotice(active?.settlementState === 'resolved' ? actionDataReadAt : undefined)
	const wallet = accountState.address
	const canLoad = active?.forkContinuation === true && wallet !== undefined
	useEffect(() => {
		if (!open || !visible || active === undefined || wallet === undefined || !canLoad) return
		const abort = new AbortController()
		let pendingRetry: ReturnType<typeof setTimeout> | undefined
		if (checkpoint.current?.selection !== selection) {
			checkpoint.current = { selection, read: createClaimCheckpoint() }
			setProgress(new Map())
		}
		const read = checkpoint.current.read
		const prepare = (attempt: number) => {
			const job = new AbortController()
			abort.signal.addEventListener('abort', () => job.abort(), { once: true })
			setLoading(true)
			error.value = undefined
			void loadClaims(active, wallet, job.signal, {
				read,
				onProgress: (outcome, done, total) => {
					if (!job.signal.aborted) setProgress(previous => new Map([...previous, [outcome, { done, total }]]))
				},
			}).then(
				claims => {
					if (abort.signal.aborted) return
					setLoaded({ selection, claims })
					setLoading(false)
				},
				failure => {
					job.abort()
					if (abort.signal.aborted) return
					const delay = [500, 2000, 5000][attempt]
					if (delay !== undefined) pendingRetry = setTimeout(() => prepare(attempt + 1), delay)
					else {
						error.value = failure instanceof Error ? failure.message : pageCopy.inheritedClaimFailure
						setLoading(false)
					}
				},
			)
		}
		prepare(0)
		return () => {
			abort.abort()
			clearTimeout(pendingRetry)
		}
	}, [open, visible, canLoad, active?.escalationGameAddress, active?.parentQuestionLedgerAddress, wallet, selection, retry])
	const claims = loaded?.selection === selection ? loaded.claims : (active?.sides.flatMap(side => side.importedUserDeposits.map(deposit => ({ side, deposit }))) ?? [])
	if (claims.length === 0 && !canLoad) return undefined
	const walletReason = getWalletActiveAppChainGuardState({ accountAddress: accountState.address, isOnActiveAppChain: isActiveAppChain(accountState.chainId) })?.reason
	const run = async (identities: readonly AuthenticatedForkClaim[]) => {
		const identity = identities[0]
		if (pending.value !== undefined || active === undefined || identity === undefined) return
		const pool = active.questionLedgerAddress
		const key = identities.length === 1 ? `${identity.outcome}:${identity.parentDepositIndex}` : 'all'
		pending.value = key
		error.value = undefined
		const assertSelection = () => {
			if (current.current !== selection) throw new Error(copy.inheritedClaimContextChanged)
		}
		try {
			await runWriteAction(
				buildWriteActionConfig({ ...parameters, onTransactionCanceled: parameters.onTransactionCanceled, onTransactionFailed: parameters.onTransactionFailed, onTransactionPrepared: parameters.onTransactionPrepared }, error, commonCopy.formatConnectWalletBefore(copy.claimWalletAction), {
					action: 'settleForkedEscalation',
					source: copy.recoverySource,
					submittedTitle: copy.settleInheritedClaim,
					universeId: active.universeId,
				}),
				async (account, context) => {
					assertSelection()
					const read = withStatoblastRequestTimeout(createConnectedReadClient(), pageCopy.inheritedClaimTimeout, context.reviewSignal)
					const latest = await loadReportingDetails(read, pool, account)
					context.assertActive()
					assertSelection()
					const latestClaims = latest.status === 'active' ? await loadClaims(latest, account, context.reviewSignal) : []
					if (latest.settlementState !== 'resolved') throw new Error(copy.questionFinalizationRequired)
					if (latest.questionOutcome !== identity.outcome) throw new Error(copy.claimWinningOutcomeRequired)
					const indexes = identities.map(item => {
						const deposit = latestClaims.find(candidate => candidate.side.key === item.outcome && candidate.deposit.parentDepositIndex === item.parentDepositIndex)?.deposit
						if (deposit?.claimIdentity === undefined || item.outcome !== identity.outcome || deposit.claimIdentity.snapshotRoot !== item.snapshotRoot || deposit.depositor.toLowerCase() !== account.toLowerCase()) throw new Error(copy.inheritedClaimDepositChanged)
						return item.parentDepositIndex
					})
					const client = createWalletWriteClient(account, { reviewSignal: context.reviewSignal, onTransactionPrepared: parameters.onTransactionPrepared, onTransactionSubmitted: parameters.onTransactionSubmitted })
					const proofs = await buildForkCarriedEscalationProofs(read, pool, identity.outcome, indexes)
					context.assertActive()
					assertSelection()
					return await withdrawForkedEscalationDeposits(client, pool, identity.outcome, proofs)
				},
				copy.inheritedClaimSubmissionFailed,
				async result => {
					parameters.onTransactionPresented({ hash: result.hash, title: copy.claimSettled, tone: 'success', showStatusDialog: false, universeId: active.universeId })
					if (current.current === selection) {
						setRetry(value => value + 1)
						await onRefresh()
					}
				},
			)
		} finally {
			pending.value = undefined
		}
	}
	const winners = active?.settlementState === 'resolved' ? claims.filter(({ side, deposit }) => side.key === active.questionOutcome && deposit.claimIdentity !== undefined) : []
	const pendingReason = pending.value === undefined ? undefined : copy.claimPending
	const batchReason = walletReason ?? (loading ? pageCopy.checkingInheritedClaims : pendingReason)
	const allClaims = winners.flatMap(({ deposit }) => (deposit.claimIdentity === undefined ? [] : [deposit.claimIdentity]))
	const totalPayout = winners.reduce((sum, { side, deposit }) => sum + (getImportedEscalationDepositClaimAmount(active, side.key, deposit) ?? 0n), 0n)
	const claimDataNotice = allClaims.length > 0 ? oldActionData : undefined

	return (
		<SectionBlock title={copy.inheritedClaims} description={claimDataNotice ?? copy.inheritedClaimsDescription}>
			{claimDataNotice !== undefined && <p className='detail'>{copy.inheritedClaimsDescription}</p>}
			{canLoad && !open && (
				<button type='button' onClick={() => setOpen(true)}>
					{pageCopy.prepareInheritedClaims}
				</button>
			)}
			{loading && (
				<p role='status'>
					{pageCopy.preparingInheritedClaims}{' '}
					{progress.size > 0 &&
						pageCopy.formatInheritedClaimProgress(
							[...progress.values()].reduce((sum, item) => sum + item.done, 0n),
							[...progress.values()].reduce((sum, item) => sum + item.total, 0n),
						)}
				</p>
			)}
			{open && !loading && loaded?.selection === selection && claims.length === 0 && <p>{pageCopy.emptyInheritedClaimsDetail}</p>}
			{open && !loading && error.value !== undefined && (
				<button type='button' onClick={() => setRetry(value => value + 1)}>
					{pageCopy.tryAgain}
				</button>
			)}
			<ErrorNotice message={error.value} />
			{allClaims.length > 1 && (
				<TransactionActionButton idleLabel={pageCopy.formatClaimRepDeposits(formatCurrencyBalance(totalPayout), allClaims.length)} pendingLabel={pageCopy.claimingDeposits} pending={pending.value === 'all'} availability={{ disabled: batchReason !== undefined, reason: batchReason }} onClick={() => void run(allClaims)} />
			)}

			{claims.map(({ side, deposit }) => {
				const identity = deposit.claimIdentity
				const baseReason = walletReason ?? (pending.value === undefined ? undefined : copy.claimPending) ?? (identity === undefined ? copy.claimAuthenticationRequired : undefined)
				const lost = active?.settlementState === 'resolved' && active.questionOutcome !== side.key
				const settleReason = baseReason ?? (active?.settlementState === 'resolved' ? undefined : copy.claimResolutionRequired)
				return (
					<div key={`${side.key}:${deposit.parentDepositIndex}`} className='workflow-subsection'>
						<p>
							{copy.inheritedClaimIdentity(side.label, deposit.parentDepositIndex.toString())} <CurrencyValue value={getImportedEscalationDepositClaimAmount(active, side.key, deposit)} suffix={copy.repUnit} />
						</p>
						{lost ? (
							<p className='detail'>{pageCopy.inheritedDepositLost}</p>
						) : (
							<div className='actions'>
								<TransactionActionButton
									idleLabel={copy.settleClaim}
									pendingLabel={copy.settlingClaim}
									pending={pending.value === `${side.key}:${deposit.parentDepositIndex}`}
									availability={{ disabled: settleReason !== undefined, reason: settleReason }}
									onClick={() => {
										if (identity !== undefined) void run([identity])
									}}
								/>
							</div>
						)}
					</div>
				)
			})}
		</SectionBlock>
	)
}
