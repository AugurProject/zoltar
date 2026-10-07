import { describeUniverseReadError } from '../lib/universeReadError.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { OutcomeUniverseList } from './OutcomeUniverseList.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { useEffect, useState } from 'preact/hooks'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { PaginationControls } from '@zoltar/ui-core-shared/components/PaginationControls.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { createActiveEnvironmentGuard, getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { withReadTimeout } from '@zoltar/ui-core-shared/lib/promise.js'
import { navigateToUniverse } from '@zoltar/ui-core-shared/navigation/universeNavigation.js'
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import * as copy from '../../../copy/universeNavigation.js'
import { loadUniverseOutcomePage, UNIVERSE_OUTCOME_PAGE_SIZE, type UniverseOutcomePage } from '../../../protocol/universeNavigation.js'
import { useBlockRefresh } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'

export type LoadUniverseOutcomes = (address: Address, universeId: bigint, start: bigint) => Promise<UniverseOutcomePage>
const loadConnectedOutcomes: LoadUniverseOutcomes = (address, universeId, start) => loadUniverseOutcomePage(createConnectedReadClient(), address, universeId, start)

import { ScalarUniverseOutcomePicker, type LoadScalarUniverseOutcome } from './ScalarUniverseOutcomePicker.js'

type Props = { universe: ZoltarUniverseSummary; loadPage?: LoadUniverseOutcomes; loadOutcome?: LoadScalarUniverseOutcome }

/** Keying by universe prevents a selected outcome or page from leaking into the next generation. */
export function UniverseOutcomeNavigation({ universe, loadPage = loadConnectedOutcomes, loadOutcome }: Props) {
	if (!universe.hasForked || universe.zoltarAddress === undefined) return undefined
	return <OutcomeSelector key={`${universe.zoltarAddress}:${universe.universeId}`} address={universe.zoltarAddress} universeId={universe.universeId} loadPage={loadPage} loadOutcome={loadOutcome} />
}

function OutcomeSelector({ address, universeId, loadPage, loadOutcome }: { address: Address; universeId: bigint; loadPage: LoadUniverseOutcomes; loadOutcome: LoadScalarUniverseOutcome | undefined }) {
	const backend = getActiveBackend()
	const [start, setStart] = useState(0n)
	const [retry, setRetry] = useState(0)
	const [refresh, setRefresh] = useState(0)
	const [snapshot, setSnapshot] = useState<{ backend: typeof backend; loadPage: LoadUniverseOutcomes; start: bigint; retry: number; pageStart?: bigint | undefined; page?: UniverseOutcomePage | undefined; error?: string }>()
	const current = snapshot?.backend === backend && snapshot.loadPage === loadPage && snapshot.start === start && snapshot.retry === retry ? snapshot : undefined
	const retained = snapshot?.backend === backend && snapshot.loadPage === loadPage ? snapshot.page : undefined
	const page = current?.error !== undefined && current.pageStart !== start ? undefined : (current?.page ?? retained)
	const loading = current === undefined
	useBlockRefresh(() => setRefresh(count => count + 1), page?.scalarQuestion === undefined)
	useEffect(() => {
		let active = true
		const guard = createActiveEnvironmentGuard()
		void (async () => {
			try {
				const page = await withReadTimeout(loadPage(address, universeId, start))
				if (active && guard.isCurrent()) setSnapshot({ backend, loadPage, start, retry, pageStart: start, page })
			} catch (error) {
				if (active && guard.isCurrent())
					setSnapshot(previous => ({
						backend,
						loadPage,
						start,
						retry,
						pageStart: previous?.backend === backend && previous.loadPage === loadPage ? previous.pageStart : undefined,
						page: previous?.backend === backend && previous.loadPage === loadPage ? previous.page : undefined,
						error: describeUniverseReadError(error, copy.childUniversesLoadError),
					}))
			}
		})()
		return () => {
			active = false
		}
	}, [address, backend, loadPage, refresh, retry, start, universeId])
	return (
		<SectionBlock
			title={
				<span className='universe-outcome-heading'>
					{commonCopy.childUniverses}
					<span aria-hidden={!loading || page === undefined} className={loading && page !== undefined ? undefined : 'universe-outcome-status-idle'}>
						<Badge tone='loading'>{commonCopy.loading}</Badge>
					</span>
				</span>
			}
			variant='plain'
			busy={loading}
		>
			<div className='form-grid'>
				{page?.title === undefined || page.title === '' ? undefined : <p className='detail'>{copy.formatForkQuestion(page.title)}</p>}
				{loading && page === undefined ? <StateHint announcement='polite' presentation={{ key: 'loading', badgeLabel: commonCopy.loading, badgeTone: 'loading', detail: copy.loadingChildUniverses, detailIsLoading: true }} /> : undefined}
				{page?.scalarQuestion === undefined ? (
					<OutcomeUniverseList
						emptyMessage={page === undefined ? undefined : commonCopy.childUniversesEmpty}
						notDeployedDetail={copy.childNotDeployedDetail}
						outcomes={(page?.choices ?? []).map(candidate => ({
							...candidate,
							disabled: loading || !candidate.exists,
							onSelect: () => {
								if (candidate.exists) navigateToUniverse(candidate.universeId)
							},
						}))}
					/>
				) : (
					<ScalarUniverseOutcomePicker address={address} universeId={universeId} question={page.scalarQuestion} loadOutcome={loadOutcome} />
				)}

				<RetryableNotice message={current?.error} retryLabel={commonCopy.retry} onRetry={() => setRetry(count => count + 1)} />
				<PaginationControls
					summary={start === 0n && page?.hasNextPage !== true ? undefined : copy.formatOutcomePage(Number(start / UNIVERSE_OUTCOME_PAGE_SIZE) + 1)}
					loading={loading}
					hasPreviousPage={start > 0n}
					hasNextPage={current?.error === undefined && (page?.hasNextPage ?? false)}
					onPreviousPage={() => setStart(current => (current >= UNIVERSE_OUTCOME_PAGE_SIZE ? current - UNIVERSE_OUTCOME_PAGE_SIZE : 0n))}
					onNextPage={() => setStart(current => current + UNIVERSE_OUTCOME_PAGE_SIZE)}
				/>
			</div>
		</SectionBlock>
	)
}
