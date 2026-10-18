import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { buildPortfolioPositionForkClaimRequest, type PortfolioAggregateSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact } from '../../../contractArtifact.js'
import { loadPortfolioForkClaimState } from '../../../protocol/securityPoolPortfolioFork.js'
import type { PortfolioActions } from '../components/PortfolioControls.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import * as copy from '../../../copy/portfolioFork.js'
import * as portfolioCopy from '../../../copy/portfolio.js'

export type PortfolioForkClaimParameters = {
	snapshot: PortfolioAggregateSnapshot
	allocation: PortfolioAggregateSnapshot['positions'][number] & { claimReason: string | undefined }
	actions: Pick<PortfolioActions, 'scope' | 'busy' | 'ownerReason' | 'runPortfolioAction'>
	onConfirmed: () => Promise<void>
}

export function usePortfolioForkClaim({ snapshot, allocation, actions, onConfirmed }: PortfolioForkClaimParameters) {
	const backend = getActiveBackend()
	const outcomeInput = useSignal('')
	const retry = useSignal(0)
	const parent = useSignal<{ key: string; backend: typeof backend; address: Address } | undefined>(undefined)
	const loaded = useSignal<{ key: string; backend: typeof backend; state?: Awaited<ReturnType<typeof loadPortfolioForkClaimState>>; error?: string } | undefined>(undefined)
	const interval = snapshot.intervals.find(item => item.active && item.startPosition <= allocation.positionId && (item.open || item.endPosition >= allocation.positionId))
	let outcomeIndex: bigint | undefined
	try {
		const parsed = BigInt(outcomeInput.value)
		if (outcomeInput.value.trim() !== '' && parsed >= 0n && parsed < 1n << 256n) outcomeIndex = parsed
	} catch (error) {
		if (!(error instanceof SyntaxError)) throw error
	}
	const parentKey = `${snapshot.portfolio}:${snapshot.originUniverseId}:${allocation.questionId}:${snapshot.blockHash}`
	const key = `${parentKey}:${snapshot.owner}:${allocation.positionId}:${interval?.intervalId}:${outcomeInput.value}`
	const current = loaded.value?.key === key && loaded.value.backend === backend ? loaded.value : undefined
	const selection = outcomeIndex === undefined || interval === undefined ? undefined : { portfolio: snapshot.portfolio, owner: snapshot.owner, questionId: allocation.questionId, originUniverseId: snapshot.originUniverseId, positionId: allocation.positionId, intervalId: interval.intervalId, outcomeIndex }
	useEffect(() => {
		outcomeInput.value = ''
	}, [backend, snapshot.portfolio, snapshot.owner, allocation.positionId])
	useEffect(() => {
		let active = true
		parent.value = undefined
		void backend
			.createReadClient()
			.readContract({ address: snapshot.portfolio, abi: portfolioArtifact.abi, functionName: 'getPool', args: [allocation.questionId, snapshot.originUniverseId], blockNumber: snapshot.blockNumber })
			.then(address => {
				if (active) parent.value = { key: parentKey, backend, address }
			})
			.catch(error => {
				if (active) loaded.value = { key, backend, error: getErrorMessage(error, portfolioCopy.snapshotFailed) }
			})
		return () => {
			active = false
		}
	}, [backend, parentKey])
	useEffect(() => {
		let active = true
		loaded.value = undefined
		if (selection !== undefined)
			void loadPortfolioForkClaimState(backend.createReadClient(), selection)
				.then(state => {
					if (active) loaded.value = { key, backend, state }
				})
				.catch(error => {
					if (active) loaded.value = { key, backend, error: getErrorMessage(error, portfolioCopy.snapshotFailed) }
				})
		return () => {
			active = false
		}
	}, [backend, key, retry.value])
	const reason = actions.ownerReason ?? allocation.claimReason ?? (interval === undefined ? portfolioCopy.intervalNotOnPage : undefined) ?? (outcomeIndex === undefined ? copy.chooseOutcome : undefined) ?? current?.error ?? (current?.state === undefined ? copy.loading : current.state.reason)
	return {
		outcomeInput: outcomeInput.value,
		setOutcome: (value: string) => {
			outcomeInput.value = value
		},
		parent: parent.value?.key === parentKey && parent.value.backend === backend ? parent.value.address : current?.state?.parent,
		loading: selection !== undefined && current === undefined,
		needsPreparation: current?.state === undefined || [copy.notForked, copy.childFeed, copy.childContracts, copy.childPool, copy.childHistory].includes(current.state.reason ?? ''),
		error: current?.error,
		selectedBranch: current?.state?.questionTitle === undefined || current.state.outcomeLabel === undefined ? undefined : copy.selectedBranch(current.state.questionTitle, current.state.outcomeLabel),
		reason,
		refresh: () => {
			retry.value += 1
		},
		claim: () =>
			actions.runPortfolioAction(
				`claimPortfolioPositionAndMigrate:${allocation.positionId}`,
				copy.claim,
				() => {
					if (reason !== undefined || selection === undefined || current?.state?.questionTitle === undefined || current.state.outcomeLabel === undefined) throw new Error(reason ?? copy.chooseOutcome)
					return {
						...buildPortfolioPositionForkClaimRequest(selection),
						reviewDescription: copy.review(selection.positionId, current.state.questionTitle, current.state.outcomeLabel),
						validateBeforeSubmit: async () => {
							const latest = await loadPortfolioForkClaimState(backend.createReadClient(), selection)
							if (latest.reason !== undefined) throw new Error(latest.reason)
						},
					}
				},
				undefined,
				async () => {
					await onConfirmed()
					retry.value += 1
				},
			),
	}
}
