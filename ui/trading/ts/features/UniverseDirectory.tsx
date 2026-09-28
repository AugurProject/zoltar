import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { UniverseBrowser } from '@zoltar/ui-core-shared/components/UniverseBrowser.js'
import { UniverseLink } from '@zoltar/ui-core-shared/components/UniverseLink.js'
import { formatUniverseLabel } from '@zoltar/ui-core-shared/lib/universeLabels.js'
import type { DeploymentConfiguration } from '../protocol/config.js'
import * as appCopy from '../copy/app.js'
import { loadUniverseSummary, useUniverseSummary, type LoadUniverseSummary } from './useUniverseSummary.js'

type UniverseDirectoryProps = {
	configuration: DeploymentConfiguration
	/** Route-scoped wallet feedback rendered under the header, like every other live route. */
	connectionMessage?: string | undefined
	loadUniverse?: LoadUniverseSummary
	/** The universe the market, liquidity, and portfolio routes currently follow. */
	universeId: bigint
}

/**
 * The universe route: the shared universe browser for the selected universe, its lineage, and its child universes.
 * Selection goes through the shared `universe` query parameter, so every route follows the choice made here.
 */
export function UniverseDirectory({ configuration, connectionMessage, loadUniverse = loadUniverseSummary, universeId }: UniverseDirectoryProps) {
	const { retry, state } = useUniverseSummary(configuration, universeId, loadUniverse)
	const genesisAction =
		universeId === 0n ? undefined : (
			<UniverseLink className='button-link secondary-link' universeId={0n}>
				{commonCopy.goToGenesisUniverse}
			</UniverseLink>
		)
	return (
		<div className='route-view-flow'>
			<RouteHeader title={appCopy.universe} description={appCopy.universeRouteDescription} actions={genesisAction} />
			<ErrorNotice message={connectionMessage} />
			{state.kind === 'loading' || state.kind === 'idle' ? <StateHint announcement='polite' presentation={{ key: 'loading', badgeLabel: commonCopy.loading, badgeTone: 'loading', detail: commonCopy.loadingUniverseDetails, detailIsLoading: true }} /> : undefined}
			{state.kind === 'error' ? <RetryableNotice onRetry={retry} retryLabel={commonCopy.retry} presentation={{ key: 'load_failed', badgeLabel: commonCopy.error, badgeTone: 'blocked', detail: state.message }} /> : undefined}
			{state.kind === 'ready' && state.universe === undefined ? <StateHint presentation={{ key: 'not_found', badgeLabel: commonCopy.notFound, badgeTone: 'blocked', detail: appCopy.universeNotFound(formatUniverseLabel(universeId)) }} /> : undefined}
			{state.kind === 'ready' && state.universe !== undefined ? <UniverseBrowser activeUniverseId={universeId} universe={state.universe} /> : undefined}
		</div>
	)
}
