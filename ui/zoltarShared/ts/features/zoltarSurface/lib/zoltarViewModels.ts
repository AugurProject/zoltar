import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { LoadableValueState } from '@zoltar/ui-core-shared/lib/loadState.js'
import { formatUniverseLineageLabel } from '@zoltar/ui-core-shared/lib/universeLineage.js'
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ZoltarView } from '../../types.js'

/** Zoltar views in navigation order; `fork` and `migrate` are reached from actions, not tabs. */
export const ZOLTAR_VIEWS: readonly ZoltarView[] = ['overview', 'questions', 'create', 'universes', 'fork', 'migrate']
export const ZOLTAR_TAB_VIEWS = ['overview', 'questions', 'create', 'universes'] as const satisfies readonly ZoltarView[]

/** Which irreversible universe workflows apply: a universe forks once, and REP migrates only after that fork. */
export function getZoltarUniverseActions(universe: Pick<ZoltarUniverseSummary, 'hasForked'> | undefined) {
	return {
		canFork: universe !== undefined && !universe.hasForked,
		canMigrate: universe?.hasForked === true,
	}
}

export type ZoltarRouteGate = 'ready' | 'loading' | 'universe-unavailable' | 'universe-missing' | 'fork-unavailable' | 'migrate-unavailable'

/** True when the universe read failed: no summary, no read in flight, and an error to report. */
function isUniverseUnavailable(universeError: string | undefined, universeState: LoadableValueState) {
	return universeError !== undefined && universeState !== 'loading'
}

/**
 * Decides whether a Zoltar view can render its workflow. Questions are global protocol objects, so the question
 * views never depend on the selected universe; every other view needs it and explains why when it cannot render.
 */
export function resolveZoltarRouteGate({ universe, universeError, universeState, view }: { universe: Pick<ZoltarUniverseSummary, 'hasForked'> | undefined; universeError: string | undefined; universeState: LoadableValueState; view: ZoltarView }): ZoltarRouteGate {
	if (view === 'questions' || view === 'create') return 'ready'
	if (universeState === 'missing') return 'universe-missing'
	if (universe === undefined) return isUniverseUnavailable(universeError, universeState) ? 'universe-unavailable' : 'loading'
	const actions = getZoltarUniverseActions(universe)
	if (view === 'fork' && !actions.canFork) return 'fork-unavailable'
	if (view === 'migrate' && !actions.canMigrate) return 'migrate-unavailable'
	return 'ready'
}

export type ZoltarNextStep =
	| Readonly<{ kind: 'go-to-genesis' }>
	| Readonly<{ kind: 'retry-universe' }>
	| Readonly<{ kind: 'connect-wallet' }>
	| Readonly<{ kind: 'switch-network' }>
	| Readonly<{ kind: 'migrate-rep'; view: 'migrate' }>
	| Readonly<{ kind: 'open-child-universe'; view: 'universes' }>
	| Readonly<{ kind: 'browse-questions'; view: 'questions' }>

export type ZoltarOverviewInput = {
	account: {
		address: Address | undefined
		isOnActiveChain: boolean
		/** Unused REP already prepared for migration in this universe. */
		preparedMigrationRepAttoRep: bigint | undefined
		/** Wallet REP of the selected universe. */
		repBalanceAttoRep: bigint | undefined
	}
	activeUniverseId: bigint
	universe: ZoltarUniverseSummary | undefined
	/** The last universe read error, if the read failed. */
	universeError: string | undefined
	universeState: LoadableValueState
}

export type ZoltarOverviewModel = Readonly<{
	/** REP the wallet can still move into child universes; undefined until known. */
	migratableRepAttoRep: bigint | undefined
	/** One action chosen from the universe and wallet state; undefined only while the universe loads. */
	nextStep: ZoltarNextStep | undefined
	/** Whether the wallet must act: REP is stranded in a forked universe until it is migrated. */
	needsAttention: boolean
	forkTime: bigint | undefined
	repBalanceAttoRep: bigint | undefined
	status: 'loading' | 'unavailable' | 'missing' | 'operational' | 'forked'
	universeLabel: string
	wallet: 'disconnected' | 'wrong-network' | 'connected'
}>

function sumKnown(values: readonly (bigint | undefined)[]) {
	if (values.some(value => value === undefined)) return undefined
	return values.reduce<bigint>((total, value) => total + (value ?? 0n), 0n)
}

function getWalletStatus(account: ZoltarOverviewInput['account']): ZoltarOverviewModel['wallet'] {
	if (account.address === undefined) return 'disconnected'
	return account.isOnActiveChain ? 'connected' : 'wrong-network'
}

function getOverviewStatus(universe: ZoltarUniverseSummary | undefined, universeError: string | undefined, universeState: LoadableValueState): ZoltarOverviewModel['status'] {
	if (universeState === 'missing') return 'missing'
	if (universe === undefined) return isUniverseUnavailable(universeError, universeState) ? 'unavailable' : 'loading'
	return universe.hasForked ? 'forked' : 'operational'
}

function getNextStep(status: ZoltarOverviewModel['status'], wallet: ZoltarOverviewModel['wallet'], migratableRepAttoRep: bigint | undefined): ZoltarNextStep | undefined {
	if (status === 'missing') return { kind: 'go-to-genesis' }
	if (status === 'unavailable') return { kind: 'retry-universe' }
	if (status === 'loading') return undefined
	if (wallet === 'disconnected') return { kind: 'connect-wallet' }
	if (wallet === 'wrong-network') return { kind: 'switch-network' }
	// Only a known zero sends the user onward; an unknown balance goes to the Migrate route, which loads and retries it.
	if (status === 'forked') return migratableRepAttoRep === 0n ? { kind: 'open-child-universe', view: 'universes' } : { kind: 'migrate-rep', view: 'migrate' }
	return { kind: 'browse-questions', view: 'questions' }
}

/** The Overview route's status summary and single next step, derived from the selected universe and the wallet. */
export function deriveZoltarOverviewModel({ account, activeUniverseId, universe, universeError, universeState }: ZoltarOverviewInput): ZoltarOverviewModel {
	// A summary of another universe (left over while the selection changes) must not describe the active one.
	const loadedUniverse = universe?.universeId === activeUniverseId ? universe : undefined
	const status = getOverviewStatus(loadedUniverse, universeError, universeState)
	const wallet = getWalletStatus(account)
	const repBalanceAttoRep = wallet === 'connected' ? account.repBalanceAttoRep : undefined
	const migratableRepAttoRep = wallet === 'connected' && status === 'forked' ? sumKnown([account.repBalanceAttoRep, account.preparedMigrationRepAttoRep]) : undefined
	const forkTime = status === 'forked' && loadedUniverse !== undefined && loadedUniverse.forkTime > 0n ? loadedUniverse.forkTime : undefined
	return {
		forkTime,
		migratableRepAttoRep,
		needsAttention: migratableRepAttoRep !== undefined && migratableRepAttoRep > 0n,
		nextStep: getNextStep(status, wallet, migratableRepAttoRep),
		repBalanceAttoRep,
		status,
		universeLabel: formatUniverseLineageLabel(loadedUniverse?.lineage, activeUniverseId),
		wallet,
	}
}
