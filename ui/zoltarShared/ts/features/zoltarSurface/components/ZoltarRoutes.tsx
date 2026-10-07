import * as universeCopy from '@zoltar/ui-core-shared/copy/universes.js'
import * as userMessagesCopy from '@zoltar/ui-core-shared/copy/userMessages.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { SkeletonList } from '@zoltar/ui-core-shared/components/Skeleton.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { UniverseLink } from '@zoltar/ui-core-shared/components/UniverseLink.js'
import * as zoltarCopy from '../../../copy/zoltar.js'
import type { ZoltarView } from '../../types.js'
import { resolveZoltarRouteGate, type ZoltarRouteGate } from '../lib/zoltarViewModels.js'
import { ZoltarOverviewRoute } from './ZoltarOverviewRoute.js'
import { ZoltarCreateQuestionRoute, ZoltarQuestionsRoute } from './ZoltarQuestionRoutes.js'
import { ZoltarForkRoute, ZoltarMigrateRoute, ZoltarUniversesRoute } from './ZoltarUniverseRoutes.js'
import { useZoltarWorkspace } from './ZoltarWorkspace.js'

/** Explains why a universe-scoped view cannot render and offers the one action that recovers. */
function ZoltarRouteGateState({ forkTime, gate, onRetryUniverse, onViewChange }: { forkTime: bigint | undefined; gate: Exclude<ZoltarRouteGate, 'ready'>; onRetryUniverse: () => void; onViewChange: (view: ZoltarView) => void }) {
	switch (gate) {
		case 'universe-unavailable':
			return <RetryableNotice onRetry={onRetryUniverse} retryLabel={commonCopy.retry} presentation={{ key: 'load_failed', badgeLabel: commonCopy.error, badgeTone: 'blocked', detail: zoltarCopy.universeUnavailableDetail }} />
		case 'loading':
			return <SkeletonList label={commonCopy.loadingUniverseDetails} rows={2} />
		case 'universe-missing':
			return (
				<EmptyState
					title={universeCopy.universeNotFoundTitle}
					detail={userMessagesCopy.missingUniverseDetail}
					actions={
						<UniverseLink className='button-link' universeId={0n}>
							{commonCopy.goToGenesisUniverse}
						</UniverseLink>
					}
				/>
			)
		// The fork already happened, possibly from this page: report it as done and lead to the one next step.
		case 'fork-unavailable':
			return (
				<EmptyState
					title={zoltarCopy.forkUnavailableTitle}
					detail={
						forkTime === undefined ? (
							zoltarCopy.forkUnavailableDetail
						) : (
							<>
								{zoltarCopy.forkCompletedOn} <TimestampValue timestamp={forkTime} />. {zoltarCopy.forkUnavailableDetail}
							</>
						)
					}
					actions={
						<button className='primary' type='button' onClick={() => onViewChange('migrate')}>
							{zoltarCopy.migrateRep}
						</button>
					}
				/>
			)
		default:
			return assertNever(gate)
	}
}

/** Renders the container for one Zoltar view; universe-scoped views first pass the route gate. */
export function ZoltarRoutes({ view }: { view: ZoltarView }) {
	const { onRetryUniverse, onViewChange, operations, universeError, universeState } = useZoltarWorkspace()
	if (view === 'overview') return <ZoltarOverviewRoute />
	if (view === 'questions') return <ZoltarQuestionsRoute />
	if (view === 'create') return <ZoltarCreateQuestionRoute />
	const universe = operations.zoltarUniverse
	const gate = resolveZoltarRouteGate({ universe, universeError, universeState, view })
	if (gate !== 'ready' || universe === undefined) {
		const titles = { fork: zoltarCopy.forkZoltar, migrate: zoltarCopy.migrateRep, universes: zoltarCopy.universesTitle }
		return (
			<>
				<RouteHeader title={titles[view]} />
				<ZoltarRouteGateState forkTime={universe?.hasForked === true ? universe.forkTime : undefined} gate={gate === 'ready' ? 'loading' : gate} onRetryUniverse={onRetryUniverse} onViewChange={onViewChange} />
			</>
		)
	}
	if (view === 'fork') return <ZoltarForkRoute universe={universe} />
	if (view === 'migrate') return <ZoltarMigrateRoute universe={universe} />
	return <ZoltarUniversesRoute universe={universe} />
}
