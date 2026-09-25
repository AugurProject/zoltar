import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { UniverseLink } from '@zoltar/ui-core-shared/components/UniverseLink.js'
import * as zoltarCopy from '../../../copy/zoltar.js'
import type { ZoltarView } from '../../types.js'
import { resolveZoltarRouteGate, type ZoltarRouteGate } from '../lib/zoltarViewModels.js'
import { ZoltarOverviewRoute } from './ZoltarOverviewRoute.js'
import { ZoltarCreateQuestionRoute, ZoltarQuestionsRoute } from './ZoltarQuestionRoutes.js'
import { ZoltarForkRoute, ZoltarMigrateRoute, ZoltarUniversesRoute } from './ZoltarUniverseRoutes.js'
import { useZoltarWorkspace } from './ZoltarWorkspace.js'

/** Explains why a universe-scoped view cannot render and offers the one action that recovers. */
function ZoltarRouteGateState({ gate, onRetryUniverse, onViewChange, universeError }: { gate: Exclude<ZoltarRouteGate, 'ready'>; onRetryUniverse: () => void; onViewChange: (view: ZoltarView) => void; universeError: string | undefined }) {
	switch (gate) {
		case 'universe-unavailable':
			return <RetryableNotice onRetry={onRetryUniverse} retryLabel={commonCopy.retry} presentation={{ key: 'load_failed', badgeLabel: commonCopy.error, badgeTone: 'blocked', detail: universeError ?? zoltarCopy.universeUnavailableDetail }} />
		case 'loading':
			return <StateHint presentation={{ key: 'loading', badgeLabel: commonCopy.loading, badgeTone: 'loading', detail: commonCopy.loadingUniverseDetails, detailIsLoading: true }} />
		case 'universe-missing':
			return (
				<EmptyState
					title={zoltarCopy.universeNotFoundTitle}
					detail={zoltarCopy.universeNotFoundDetail}
					actions={
						<UniverseLink className='button-link' universeId={0n}>
							{commonCopy.goToGenesisUniverse}
						</UniverseLink>
					}
				/>
			)
		case 'fork-unavailable':
			return (
				<EmptyState
					title={zoltarCopy.forkUnavailableTitle}
					detail={zoltarCopy.forkUnavailableDetail}
					actions={
						<button className='primary' type='button' onClick={() => onViewChange('migrate')}>
							{zoltarCopy.migrateRep}
						</button>
					}
				/>
			)
		case 'migrate-unavailable':
			return (
				<EmptyState
					title={zoltarCopy.migrateUnavailableTitle}
					detail={zoltarCopy.migrateUnavailableDetail}
					actions={
						<button className='primary' type='button' onClick={() => onViewChange('universes')}>
							{zoltarCopy.browseUniversesAction}
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
				<ZoltarRouteGateState gate={gate === 'ready' ? 'loading' : gate} onRetryUniverse={onRetryUniverse} onViewChange={onViewChange} universeError={universeError} />
			</>
		)
	}
	if (view === 'fork') return <ZoltarForkRoute universe={universe} />
	if (view === 'migrate') return <ZoltarMigrateRoute universe={universe} />
	return <ZoltarUniversesRoute universe={universe} />
}
