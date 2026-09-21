import { useEffect, useState } from 'preact/hooks'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as marketCopy from '@zoltar/ui-zoltar-shared/copy/market.js'
import * as universeCopy from '@zoltar/ui-zoltar-shared/copy/zoltar.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { EntityCard } from '@zoltar/ui-core-shared/components/EntityCard.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { formatUniverseLabel } from '@zoltar/ui-core-shared/lib/universeLabels.js'
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import type { BadgeTone } from '@zoltar/ui-core-shared/types/components.js'
import { UniverseDirectorySection } from '@zoltar/ui-zoltar-shared/features/universes/components/UniverseDirectorySection.js'
import { UniverseLink } from '@zoltar/ui-zoltar-shared/features/universes/components/UniverseLink.js'
import { loadZoltarUniverseSummary } from '@zoltar/ui-zoltar-shared/protocol/zoltar.js'
import type { DeploymentConfiguration } from '../protocol/config.js'
import { createTradingPublicClient, publicErrorMessage } from '../protocol/live.js'
import * as appCopy from '../copy/app.js'

export type LoadUniverseSummary = (configuration: DeploymentConfiguration, universeId: bigint) => Promise<ZoltarUniverseSummary | undefined>

const loadUniverseSummary: LoadUniverseSummary = async (configuration, universeId) => await loadZoltarUniverseSummary(createTradingPublicClient(configuration), universeId)

type UniverseDirectoryProps = {
	configuration: DeploymentConfiguration
	loadUniverse?: LoadUniverseSummary
	/** The universe the market, liquidity, and portfolio routes currently follow. */
	universeId: bigint
}

type UniverseLoadState = Readonly<{ kind: 'loading' } | { kind: 'ready'; universe: ZoltarUniverseSummary | undefined } | { kind: 'error'; message: string }>

/**
 * The universe route: where the selected universe comes from, what forked it, and which child universes can be opened.
 * Selection goes through the shared `universe` query parameter, so every route follows the choice made here.
 */
export function UniverseDirectory({ configuration, loadUniverse = loadUniverseSummary, universeId }: UniverseDirectoryProps) {
	const [state, setState] = useState<UniverseLoadState>({ kind: 'loading' })
	const [retryNonce, setRetryNonce] = useState(0)
	useEffect(() => {
		let active = true
		setState({ kind: 'loading' })
		void (async () => {
			try {
				const universe = await loadUniverse(configuration, universeId)
				if (active) setState({ kind: 'ready', universe })
			} catch (error) {
				if (active) setState({ kind: 'error', message: publicErrorMessage(error, appCopy.universeUnavailable) })
			}
		})()
		return () => {
			active = false
		}
	}, [configuration, loadUniverse, retryNonce, universeId])

	const genesisAction =
		universeId === 0n ? undefined : (
			<UniverseLink className='button-link secondary-link' universeId={0n}>
				{commonCopy.goToGenesisUniverse}
			</UniverseLink>
		)
	return (
		<div className='route-view-flow'>
			<RouteHeader title={appCopy.universe} description={appCopy.universeRouteDescription} actions={genesisAction} />
			{state.kind === 'loading' ? <StateHint announcement='polite' presentation={{ key: 'loading', badgeLabel: commonCopy.loading, badgeTone: 'loading', detail: appCopy.loadingUniverse, detailIsLoading: true }} /> : undefined}
			{state.kind === 'error' ? <RetryableNotice onRetry={() => setRetryNonce(current => current + 1)} retryLabel={commonCopy.retry} presentation={{ key: 'load_failed', badgeLabel: commonCopy.error, badgeTone: 'blocked', detail: state.message }} /> : undefined}
			{state.kind === 'ready' && state.universe === undefined ? <StateHint presentation={{ key: 'not_found', badgeLabel: commonCopy.notFound, badgeTone: 'blocked', detail: appCopy.universeNotFound(formatUniverseLabel(universeId)) }} /> : undefined}
			{state.kind === 'ready' && state.universe !== undefined ? (
				<UniverseDirectorySection zoltarUniverse={state.universe}>
					<SectionBlock title={appCopy.childUniverses} variant='plain'>
						{state.universe.childUniverses.length === 0 ? (
							<StateHint presentation={{ key: 'empty', badgeLabel: commonCopy.universe, badgeTone: 'muted', detail: appCopy.childUniversesEmpty }} />
						) : (
							<div className='entity-card-list decision-card-list'>
								{state.universe.childUniverses.map(childUniverse => {
									const isActive = childUniverse.universeId === universeId
									let badge: { label: string; tone: BadgeTone } = { label: commonCopy.notDeployed, tone: 'muted' }
									if (isActive) badge = { label: commonCopy.selected, tone: 'warning' }
									else if (childUniverse.exists) badge = { label: commonCopy.deployed, tone: 'ok' }
									return (
										<EntityCard
											key={childUniverse.universeId.toString()}
											headerActions={
												isActive || !childUniverse.exists ? undefined : (
													<UniverseLink className='button-link secondary-link' universeId={childUniverse.universeId}>
														{commonCopy.select}
													</UniverseLink>
												)
											}
											badge={<Badge tone={badge.tone}>{badge.label}</Badge>}
											title={childUniverse.outcomeLabel}
											variant='record'
										>
											<ReadOnlyDetailAccordion title={universeCopy.universeDetails}>
												<MetricField label={commonCopy.universe}>{formatUniverseLabel(childUniverse.universeId)}</MetricField>
												<MetricField label={marketCopy.parentUniverse}>
													<UniverseLink universeId={childUniverse.parentUniverseId} />
												</MetricField>
												{childUniverse.reputationTokenSymbol === undefined ? undefined : <MetricField label={commonCopy.reputationToken}>{childUniverse.reputationTokenSymbol}</MetricField>}
											</ReadOnlyDetailAccordion>
										</EntityCard>
									)
								})}
							</div>
						)}
					</SectionBlock>
				</UniverseDirectorySection>
			) : undefined}
		</div>
	)
}
