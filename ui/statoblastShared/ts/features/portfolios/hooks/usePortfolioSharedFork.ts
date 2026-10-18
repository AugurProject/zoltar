import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import {
	buildPortfolioSharedForkChoiceRequest,
	buildPortfolioSharedForkRevokeRequest,
	buildPortfolioSharedForkProcessRequest,
	buildPortfolioSharedForkRecoveryRequest,
	buildPortfolioContextPositionClaimRequest,
	loadPortfolioSharedForkSnapshot,
	type PortfolioAggregateSnapshot,
	type PortfolioSharedForkSnapshot,
} from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { formatTimestamp } from '@zoltar/ui-core-shared/lib/formatters.js'
import { portfolioReadClient, type PortfolioTransaction } from '../../../protocol/securityPoolPortfolio.js'
import { loadSharedForkOutcome, loadSharedForkPreparation } from '../../../protocol/securityPoolSharedFork.js'
import type { PortfolioActions } from '../components/PortfolioControls.js'
import * as copy from '../../../copy/portfolioSharedFork.js'
import * as forkCopy from '../../../copy/portfolioFork.js'

export type PortfolioSharedForkParameters = { snapshot: PortfolioAggregateSnapshot; actions: Pick<PortfolioActions, 'scope' | 'busy' | 'ownerReason' | 'runPortfolioAction'>; onConfirmed: () => Promise<void> }

function index(value: string) {
	try {
		if (value.trim() === '') return undefined
		const parsed = BigInt(value)
		return parsed >= 0n && parsed < 1n << 256n ? parsed : undefined
	} catch (error) {
		if (!(error instanceof SyntaxError)) throw error
		return undefined
	}
}

function choiceReason(snapshot: PortfolioSharedForkSnapshot) {
	if (snapshot.opensAt === 0n) return copy.notForked
	if (snapshot.timestamp < snapshot.opensAt) return copy.notOpen
	if (snapshot.timestamp > snapshot.closesAt) return copy.closed
	return undefined
}

function activeIntervals(snapshot: PortfolioSharedForkSnapshot) {
	return snapshot.intervals.filter(interval => interval.active && interval.startPosition <= (interval.open ? snapshot.positionCount : interval.endPosition))
}

export function usePortfolioSharedFork({ snapshot: portfolio, actions, onConfirmed }: PortfolioSharedForkParameters) {
	const backend = getActiveBackend()
	const contextInput = useSignal('0')
	const outcomeInput = useSignal('')
	const positionInput = useSignal('')
	const page = useSignal(0n)
	const refreshCount = useSignal(0)
	const contextId = index(contextInput.value)
	const outcomeIndex = index(outcomeInput.value)
	const positionId = index(positionInput.value)
	const key = `${portfolio.portfolio}:${portfolio.owner}:${portfolio.blockHash}:${contextInput.value}:${page.value}:${outcomeInput.value}:${positionInput.value}:${refreshCount.value}`
	type Loaded = {
		key: string
		backend: typeof backend
		snapshot?: PortfolioSharedForkSnapshot
		outcome?: Awaited<ReturnType<typeof loadSharedForkOutcome>> | undefined
		position?: Awaited<ReturnType<typeof loadSharedForkPreparation>> | undefined
		recoveryPreparation?: Awaited<ReturnType<typeof loadSharedForkPreparation>> | undefined
		branchLabels?: { contextId: bigint; label: string }[]
		incomingLabel?: string | undefined
		error?: string
	}
	const loaded = useSignal<Loaded | undefined>(undefined)
	const current = loaded.value?.key === key && loaded.value.backend === backend ? loaded.value : undefined
	const state = current?.snapshot
	const read = async (selectedContext = contextId, selectedOutcome = outcomeIndex) => {
		if (selectedContext === undefined) throw new Error(copy.invalidContext)
		return loadPortfolioSharedForkSnapshot({ client: portfolioReadClient(backend.createReadClient()), portfolio: portfolio.portfolio, owner: portfolio.owner, contextId: selectedContext, intervalStart: page.value * 64n, ...(selectedOutcome === undefined ? {} : { outcomeIndex: selectedOutcome }) })
	}
	const load = async () => {
		const snapshot = await read()
		const client = backend.createReadClient()
		const [outcome, position, incomingOutcome, branchLabels] = await Promise.all([
			outcomeIndex === undefined || snapshot.opensAt === 0n ? Promise.resolve(undefined) : loadSharedForkOutcome(client, snapshot, outcomeIndex),
			positionId === undefined || positionId === 0n ? Promise.resolve(undefined) : loadSharedForkPreparation(client, snapshot, positionId, outcomeIndex),
			snapshot.contextId === 0n ? Promise.resolve(undefined) : loadSharedForkOutcome(client, snapshot, snapshot.incomingOutcomeIndex, snapshot.parentUniverseId),
			Promise.all(
				snapshot.branches.map(async branch => {
					const outcome = await loadSharedForkOutcome(client, snapshot, branch.outcomeIndex)
					return { contextId: branch.contextId, label: outcome.outcomeLabel ?? String(branch.outcomeIndex) }
				}),
			),
		])
		let recoveryPreparation: Loaded['recoveryPreparation']
		if (position !== undefined && snapshot.contextId > 0n && position.custody === zeroAddress && !position.recoveryComplete) {
			const parent = await loadPortfolioSharedForkSnapshot({ client: portfolioReadClient(client), portfolio: portfolio.portfolio, owner: portfolio.owner, contextId: snapshot.parentContextId, outcomeIndex: snapshot.incomingOutcomeIndex })
			recoveryPreparation = await loadSharedForkPreparation(client, parent, position.positionId, snapshot.incomingOutcomeIndex)
			if (parent.timestamp <= parent.closesAt) recoveryPreparation = { ...recoveryPreparation, reason: copy.processingWait }
			else if (parent.contextId > 0n && recoveryPreparation.custody === zeroAddress) recoveryPreparation = { ...recoveryPreparation, reason: copy.ancestorRequired }
		}
		return { snapshot, outcome, position, recoveryPreparation, branchLabels, incomingLabel: incomingOutcome?.outcomeLabel === undefined ? undefined : forkCopy.selectedBranch(incomingOutcome.questionTitle, incomingOutcome.outcomeLabel) }
	}
	useEffect(() => {
		contextInput.value = '0'
		outcomeInput.value = ''
		positionInput.value = ''
		page.value = 0n
	}, [backend, portfolio.portfolio, portfolio.owner])
	useEffect(() => {
		let active = true
		loaded.value = undefined
		if (contextId !== undefined)
			void load()
				.then(result => {
					if (active) loaded.value = { key, backend, ...result }
				})
				.catch(error => {
					if (active) loaded.value = { key, backend, error: getErrorMessage(error, copy.loadFailed) }
				})
		return () => {
			active = false
		}
	}, [backend, key])
	const loading = contextId !== undefined && current === undefined
	const baseReason = actions.ownerReason ?? (contextId === undefined ? copy.invalidContext : undefined) ?? current?.error ?? (state === undefined ? copy.loading : undefined)
	const intervals = state === undefined ? [] : activeIntervals(state)
	const selected = intervals.filter(interval => interval.selected)
	const windowReason = state === undefined ? copy.loading : choiceReason(state)
	const branchReason = outcomeIndex === undefined || current?.outcome?.outcomeLabel === undefined ? forkCopy.chooseOutcome : undefined
	const openChildReason = (contextId === undefined ? copy.invalidContext : undefined) ?? current?.error ?? (state === undefined ? copy.loading : undefined) ?? branchReason ?? (state?.childContextId === 0n ? copy.childUnavailable : undefined)
	const chooseReason = baseReason ?? windowReason ?? (intervals.length === 0 ? copy.noIntervals : undefined) ?? branchReason
	const revokeReason = baseReason ?? windowReason ?? (selected.length === 0 ? copy.noChoices : undefined)
	const position = current?.position
	const positionReason = (positionId === undefined || positionId === 0n ? copy.invalidPosition : undefined) ?? (position === undefined ? copy.loading : undefined)
	const processReason =
		baseReason ??
		branchReason ??
		positionReason ??
		(state !== undefined && (state.opensAt === 0n || state.timestamp <= state.closesAt) ? copy.processingWait : undefined) ??
		(position?.branchProcessed ? copy.alreadyProcessed : undefined) ??
		(position?.branchWeight === 0n ? copy.noBranchWeight : undefined) ??
		(state !== undefined && state.contextId > 0n && position?.custody === zeroAddress ? copy.ancestorRequired : undefined) ??
		position?.reason
	const emptyProceedsReason = position?.recoveryComplete ? copy.allocationRecoveryComplete : copy.noProceeds
	const collectReason =
		baseReason ??
		(state?.contextId === 0n ? copy.rootRecovery : undefined) ??
		(positionInput.value.trim() !== '' ? (positionReason ?? current?.recoveryPreparation?.reason) : undefined) ??
		((position === undefined || position.recoveryComplete) && state?.recoverableRepAttoRep === 0n && state.recoverableFeesAttoEth === 0n ? emptyProceedsReason : undefined)
	const interval = intervals.find(entry => positionId !== undefined && entry.startPosition <= positionId && (entry.open || entry.endPosition >= positionId))
	const individualReason =
		baseReason ??
		positionReason ??
		(interval === undefined ? copy.missingInterval : undefined) ??
		(interval?.selected ? copy.selectedFallback : undefined) ??
		(position?.recoveryComplete ? copy.positionRecovered : undefined) ??
		(position?.custody === zeroAddress ? copy.ancestorRequired : undefined) ??
		(position?.remainingShares === 0n ? copy.positionRecovered : undefined) ??
		(position?.systemState !== undefined && position.systemState !== 0 && position.systemState !== 1 ? copy.nativeLocked : undefined)
	const requestParameters = (snapshot: PortfolioSharedForkSnapshot) => ({ owner: snapshot.owner, controller: snapshot.controller, contextId: snapshot.contextId })
	const run = (action: string, label: string, reason: string | undefined, build: (snapshot: PortfolioSharedForkSnapshot) => PortfolioTransaction) =>
		actions.runPortfolioAction(
			action,
			label,
			() => {
				if (reason !== undefined || state === undefined) throw new Error(reason ?? copy.loading)
				return build(state)
			},
			undefined,
			async () => {
				await onConfirmed()
				refreshCount.value += 1
			},
		)
	const assertIntervals = (latest: PortfolioSharedForkSnapshot, intervalIds: bigint[]) => {
		if (intervalIds.some(id => !activeIntervals(latest).some(interval => interval.intervalId === id))) throw new Error(copy.historyChanged)
	}
	return {
		state,
		loading,
		incomingLabel: current?.incomingLabel,
		branches: current?.branchLabels ?? [],
		rootContext: contextId === 0n,
		error: current?.error,
		contextInput: contextInput.value,
		outcomeInput: outcomeInput.value,
		positionInput: positionInput.value,
		setContext: (value: string) => {
			contextInput.value = value
			outcomeInput.value = ''
			positionInput.value = ''
			page.value = 0n
		},
		setOutcome: (value: string) => {
			outcomeInput.value = value
		},
		setPosition: (value: string) => {
			positionInput.value = value
		},
		intervals,
		selectedCount: selected.length,
		chooseReason,
		revokeReason,
		processReason,
		collectReason,
		individualReason,
		openChildReason,
		individualForkReason: individualReason ?? branchReason ?? position?.individualForkReason ?? position?.reason,
		position,
		preparation: current?.recoveryPreparation ?? position,
		selectedBranch: current?.outcome?.outcomeLabel === undefined ? undefined : forkCopy.selectedBranch(current.outcome.questionTitle, current.outcome.outcomeLabel),
		refresh: () => {
			refreshCount.value += 1
		},
		previousPage: () => {
			if (page.value > 0n) page.value -= 1n
		},
		nextPage: () => {
			if (state !== undefined && (page.value + 1n) * 64n < state.intervalCount) page.value += 1n
		},
		openContext: (id: bigint) => {
			contextInput.value = String(id)
			outcomeInput.value = ''
			positionInput.value = ''
			page.value = 0n
		},
		openChild: () => {
			if (state !== undefined && state.childContextId > 0n) {
				contextInput.value = String(state.childContextId)
				outcomeInput.value = ''
				positionInput.value = ''
				page.value = 0n
			}
		},
		choose: () =>
			run('chooseSharedFork', copy.choice, chooseReason, snapshot => {
				if (outcomeIndex === undefined || current?.outcome?.outcomeLabel === undefined) throw new Error(forkCopy.chooseOutcome)
				const chosenOutcome = outcomeIndex
				const intervalIds = intervals.map(interval => interval.intervalId)
				return {
					...buildPortfolioSharedForkChoiceRequest({ ...requestParameters(snapshot), intervalIds, outcomeIndex: chosenOutcome }),
					reviewDescription: copy.chooseReview(intervalIds.length, current.outcome.questionTitle, current.outcome.outcomeLabel, formatTimestamp(snapshot.closesAt)),
					validateBeforeSubmit: async () => {
						const latest = await read(snapshot.contextId, chosenOutcome)
						assertIntervals(latest, intervalIds)
						const unavailable = choiceReason(latest)
						if (unavailable !== undefined) throw new Error(unavailable)
					},
				}
			}),
		revoke: () =>
			run('revokeSharedFork', copy.revoke, revokeReason, snapshot => {
				const intervalIds = selected.map(interval => interval.intervalId)
				return {
					...buildPortfolioSharedForkRevokeRequest({ ...requestParameters(snapshot), intervalIds }),
					reviewDescription: copy.revokeReview(intervalIds.length),
					validateBeforeSubmit: async () => {
						const latest = await read(snapshot.contextId)
						assertIntervals(latest, intervalIds)
						const unavailable = choiceReason(latest)
						if (unavailable !== undefined) throw new Error(unavailable)
						if (intervalIds.some(id => !latest.intervals.some(interval => interval.intervalId === id && interval.selected))) throw new Error(copy.historyChanged)
					},
				}
			}),
		process: () =>
			run('processSharedFork', copy.process, processReason, snapshot => {
				if (outcomeIndex === undefined || positionId === undefined || current?.outcome?.outcomeLabel === undefined) throw new Error(copy.historyChanged)
				const chosenOutcome = outcomeIndex
				const chosenPosition = positionId
				return {
					...buildPortfolioSharedForkProcessRequest({ ...requestParameters(snapshot), positionId: chosenPosition, outcomeIndex: chosenOutcome }),
					reviewDescription: copy.processReview(chosenPosition, current.outcome.questionTitle, current.outcome.outcomeLabel),
					validateBeforeSubmit: async () => {
						const latest = await read(snapshot.contextId, chosenOutcome)
						if (latest.opensAt === 0n || latest.timestamp <= latest.closesAt) throw new Error(copy.processingWait)
						const checked = await loadSharedForkPreparation(backend.createReadClient(), latest, chosenPosition, chosenOutcome)
						if (checked.reason !== undefined) throw new Error(checked.reason)
						if (checked.branchProcessed || checked.branchWeight === 0n) throw new Error(copy.historyChanged)
					},
				}
			}),
		collect: () =>
			run('collectSharedFork', copy.recover, collectReason, snapshot => {
				const intervalIds = intervals.map(interval => interval.intervalId)
				const chosenPosition = position?.positionId
				return {
					...buildPortfolioSharedForkRecoveryRequest({ ...requestParameters(snapshot), intervalIds, positionIds: chosenPosition === undefined ? [] : [chosenPosition] }),
					reviewDescription: copy.recoverReview(current?.incomingLabel ?? snapshot.repToken, intervalIds.length, chosenPosition),
					validateBeforeSubmit: async () => {
						const latest = await read(snapshot.contextId)
						assertIntervals(latest, intervalIds)
						if (chosenPosition === undefined && latest.recoverableRepAttoRep === 0n && latest.recoverableFeesAttoEth === 0n) throw new Error(copy.noProceeds)
					},
				}
			}),
		individual: (migrate: boolean) =>
			run(migrate ? 'claimContextPositionAndMigrate' : 'claimContextPosition', migrate ? copy.individualFork : copy.individual, migrate ? (individualReason ?? branchReason ?? position?.individualForkReason ?? position?.reason) : individualReason, snapshot => {
				if (positionId === undefined || interval === undefined || (migrate && outcomeIndex === undefined)) throw new Error(copy.historyChanged)
				const chosenPosition = positionId
				const chosenInterval = interval.intervalId
				const chosenOutcome = migrate ? outcomeIndex : undefined
				return {
					...buildPortfolioContextPositionClaimRequest({ ...requestParameters(snapshot), positionId: chosenPosition, intervalId: chosenInterval, ...(chosenOutcome === undefined ? {} : { outcomeIndex: chosenOutcome }) }),
					reviewDescription: copy.individualReview(current?.incomingLabel ?? snapshot.repToken, chosenPosition) + (migrate && current?.outcome?.outcomeLabel !== undefined ? ` ${forkCopy.selectedBranch(current.outcome.questionTitle, current.outcome.outcomeLabel)}` : ''),
					validateBeforeSubmit: async () => {
						const latest = await read(snapshot.contextId, chosenOutcome)
						assertIntervals(latest, [chosenInterval])
						if (latest.intervals.some(interval => interval.intervalId === chosenInterval && interval.selected)) throw new Error(copy.selectedFallback)
						const checked = await loadSharedForkPreparation(backend.createReadClient(), latest, chosenPosition, chosenOutcome)
						if (checked.recoveryComplete || checked.remainingShares === 0n) throw new Error(copy.positionRecovered)
						if (migrate && checked.individualForkReason !== undefined) throw new Error(checked.individualForkReason)
						if (migrate && checked.reason !== undefined) throw new Error(checked.reason)
					},
				}
			}),
	}
}
