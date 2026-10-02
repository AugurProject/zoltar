import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { OutcomeSelectionList } from '@zoltar/ui-core-shared/components/OutcomeSelectionList.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { formatOpenOutcomeUniverse } from '../../../copy/zoltar.js'
import { useEffect, useId, useState } from 'preact/hooks'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { PaginationControls } from '@zoltar/ui-core-shared/components/PaginationControls.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { parseDecimalInput } from '@zoltar/ui-core-shared/forms/decimal.js'
import { createActiveEnvironmentGuard, getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { withReadTimeout } from '@zoltar/ui-core-shared/lib/promise.js'
import { navigateToUniverse } from '@zoltar/ui-core-shared/navigation/universeNavigation.js'
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { getScalarTickIndexForDisplayValue } from '@zoltar/zoltar-shared/questions/scalarOutcome'
import * as copy from '../../../copy/universeNavigation.js'
import { loadUniverseOutcomePage, UNIVERSE_OUTCOME_PAGE_SIZE, type UniverseOutcomePage } from '../../../protocol/universeNavigation.js'

export type LoadUniverseOutcomes = (address: Address, universeId: bigint, start: bigint) => Promise<UniverseOutcomePage>
const loadConnectedOutcomes: LoadUniverseOutcomes = (address, universeId, start) => loadUniverseOutcomePage(createConnectedReadClient(), address, universeId, start)

type Props = { universe: ZoltarUniverseSummary; loadPage?: LoadUniverseOutcomes }

/** Keying by universe prevents a selected outcome or page from leaking into the next generation. */
export function UniverseOutcomeNavigation({ universe, loadPage = loadConnectedOutcomes }: Props) {
	if (!universe.hasForked || universe.zoltarAddress === undefined) return undefined
	return <OutcomeSelector key={`${universe.zoltarAddress}:${universe.universeId}`} address={universe.zoltarAddress} universeId={universe.universeId} loadPage={loadPage} />
}

function OutcomeSelector({ address, universeId, loadPage }: { address: Address; universeId: bigint; loadPage: LoadUniverseOutcomes }) {
	const valueId = useId()
	const statusId = useId()
	const backend = getActiveBackend()
	const [start, setStart] = useState(0n)
	const [retry, setRetry] = useState(0)
	const [value, setValue] = useState('')
	const [valueError, setValueError] = useState<string>()
	const [snapshot, setSnapshot] = useState<{ backend: typeof backend; loadPage: LoadUniverseOutcomes; start: bigint; retry: number; page?: UniverseOutcomePage; error?: string }>()
	const current = snapshot?.backend === backend && snapshot.loadPage === loadPage && snapshot.start === start && snapshot.retry === retry ? snapshot : undefined
	const page = current?.page
	const loading = current === undefined
	useEffect(() => {
		let active = true
		const guard = createActiveEnvironmentGuard()
		void (async () => {
			try {
				const page = await withReadTimeout(loadPage(address, universeId, start))
				if (active && guard.isCurrent()) setSnapshot({ backend, loadPage, start, retry, page })
			} catch (error) {
				void error
				if (active && guard.isCurrent()) setSnapshot({ backend, loadPage, start, retry, error: copy.outcomesUnavailable })
			}
		})()
		return () => {
			active = false
		}
	}, [address, backend, loadPage, retry, start, universeId])
	return (
		<SectionBlock title={commonCopy.childUniverses} variant='plain'>
			<div className='form-grid'>
				{page?.title === undefined ? undefined : <p className='detail'>{page.title}</p>}
				{loading ? <StateHint announcement='polite' presentation={{ key: 'loading', badgeLabel: commonCopy.loading, badgeTone: 'loading', detail: copy.loadingOutcomes, detailIsLoading: true }} /> : undefined}
				<OutcomeSelectionList
					emptyMessage={page === undefined ? undefined : commonCopy.childUniversesEmpty}
					items={(page?.choices ?? []).map(candidate => ({
						ariaLabel: formatOpenOutcomeUniverse(candidate.label),
						describedById: `${statusId}-${candidate.universeId}`,
						key: candidate.universeId.toString(),
						label: (
							<>
								{candidate.label}
								{candidate.exists ? <span aria-hidden='true'>{copy.openOutcomeArrowTail}</span> : undefined}
							</>
						),
						details: (
							<span id={`${statusId}-${candidate.universeId}`}>
								<Badge tone={candidate.exists ? 'ok' : 'muted'}>{candidate.exists ? commonCopy.deployed : commonCopy.notDeployed}</Badge>
							</span>
						),
						disabled: !candidate.exists,
						onSelect: () => {
							if (candidate.exists) navigateToUniverse(candidate.universeId)
						},
					}))}
				/>

				<RetryableNotice message={current?.error} retryLabel={commonCopy.retry} onRetry={() => setRetry(count => count + 1)} />
				<PaginationControls
					loading={loading}
					hasPreviousPage={start > 0n}
					hasNextPage={page?.hasNextPage ?? false}
					onPreviousPage={() => setStart(current => (current >= UNIVERSE_OUTCOME_PAGE_SIZE ? current - UNIVERSE_OUTCOME_PAGE_SIZE : 0n))}
					onNextPage={() => setStart(current => current + UNIVERSE_OUTCOME_PAGE_SIZE)}
				/>
				{page?.scalarQuestion === undefined ? undefined : (
					<form
						onSubmit={event => {
							event.preventDefault()
							try {
								const question = page.scalarQuestion
								if (question === undefined) return
								const tick = getScalarTickIndexForDisplayValue(question, parseDecimalInput(value, copy.scalarValue, 18))
								if (tick === undefined) throw new Error(copy.invalidScalarValue)
								setValueError(undefined)
								setStart(((tick + 1n) / UNIVERSE_OUTCOME_PAGE_SIZE) * UNIVERSE_OUTCOME_PAGE_SIZE)
							} catch (error) {
								void error
								setValueError(copy.invalidScalarValue)
							}
						}}
					>
						<div className='field'>
							<label htmlFor={valueId}>{copy.scalarValue}</label>
							<FormInput
								id={valueId}
								value={value}
								onInput={event => setValue(event.currentTarget.value)}
								error={valueError}
								liveError
								action={
									<button type='submit' className='secondary'>
										{copy.findOutcome}
									</button>
								}
							/>
						</div>
					</form>
				)}
			</div>
		</SectionBlock>
	)
}
