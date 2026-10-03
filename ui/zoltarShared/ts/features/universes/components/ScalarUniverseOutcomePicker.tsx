import { describeUniverseReadError } from '../lib/universeReadError.js'
import { useEffect, useId, useState } from 'preact/hooks'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { ScalarQuestionDetails } from '@zoltar/zoltar-shared/questions/scalarOutcome'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { UniverseScalarPicker, resolveScalarUniverseSelection } from './UniverseScalarPicker.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { useBlockRefresh } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { createActiveEnvironmentGuard, getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { withReadTimeout } from '@zoltar/ui-core-shared/lib/promise.js'
import { navigateToUniverse } from '@zoltar/ui-core-shared/navigation/universeNavigation.js'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { loadScalarUniverseOutcome, type UniverseOutcome } from '../../../protocol/universeNavigation.js'
import { formatOpenOutcomeUniverse } from '../../../copy/zoltar.js'
import * as copy from '../../../copy/universeNavigation.js'

export type LoadScalarUniverseOutcome = (address: Address, universeId: bigint, outcomeIndex: bigint) => Promise<UniverseOutcome>
const loadConnectedOutcome: LoadScalarUniverseOutcome = (address, universeId, outcomeIndex) => loadScalarUniverseOutcome(createConnectedReadClient(), address, universeId, outcomeIndex)

type Props = { address: Address; universeId: bigint; question: ScalarQuestionDetails; loadOutcome?: LoadScalarUniverseOutcome | undefined }

export function ScalarUniverseOutcomePicker({ address, universeId, question, loadOutcome = loadConnectedOutcome }: Props) {
	const statusId = useId()
	const backend = getActiveBackend()
	const [tickInput, setTickInput] = useState('0')
	const [invalid, setInvalid] = useState(false)
	const [refresh, setRefresh] = useState(0)
	useBlockRefresh(() => setRefresh(count => count + 1))
	const { outcomeIndex, label } = resolveScalarUniverseSelection(question, tickInput, invalid)
	const [snapshot, setSnapshot] = useState<{ backend: typeof backend; loadOutcome: LoadScalarUniverseOutcome; outcomeIndex: bigint; outcome?: UniverseOutcome | undefined; error?: string }>()
	const current = snapshot?.backend === backend && snapshot.loadOutcome === loadOutcome && snapshot.outcomeIndex === outcomeIndex ? snapshot : undefined
	const outcome = current?.outcome
	const loading = outcomeIndex !== undefined && current === undefined
	useEffect(() => {
		if (outcomeIndex === undefined) return
		let active = true
		const guard = createActiveEnvironmentGuard()
		const readSelection = async () => {
			if (!active || !guard.isCurrent()) return
			try {
				const outcome = await withReadTimeout(loadOutcome(address, universeId, outcomeIndex))
				if (active && guard.isCurrent()) setSnapshot({ backend, loadOutcome, outcomeIndex, outcome })
			} catch (error) {
				if (active && guard.isCurrent())
					setSnapshot(previous => ({ backend, loadOutcome, outcomeIndex, outcome: previous?.backend === backend && previous.loadOutcome === loadOutcome && previous.outcomeIndex === outcomeIndex ? previous.outcome : undefined, error: describeUniverseReadError(error, copy.formatChildStatusReadFailure(label)) }))
			}
		}
		const timer = setTimeout(() => void readSelection(), 150)
		return () => {
			active = false
			clearTimeout(timer)
		}
	}, [address, backend, label, loadOutcome, outcomeIndex, refresh, universeId])
	return (
		<div className='form-grid'>
			<UniverseScalarPicker question={question} tickInput={tickInput} invalid={invalid} onTickChange={setTickInput} onInvalidChange={setInvalid} />
			{loading ? <StateHint announcement='polite' presentation={{ key: 'loading', badgeLabel: commonCopy.loading, badgeTone: 'loading', detail: copy.loadingChild, detailIsLoading: true }} /> : undefined}
			{outcomeIndex === undefined ? <UserMessage placement='field' tone='error' detail={copy.invalidScalarTick} /> : undefined}
			<RetryableNotice message={current?.error} retryLabel={copy.formatRetryChildOutcome(label)} onRetry={() => setRefresh(count => count + 1)} />
			<div className='actions'>
				{outcome === undefined ? undefined : (
					<span id={statusId}>
						<Badge tone={outcome.exists ? 'ok' : 'muted'}>{outcome.exists ? commonCopy.deployed : commonCopy.notDeployed}</Badge>
					</span>
				)}
				<button type='button' aria-describedby={outcome === undefined ? undefined : statusId} className='secondary' disabled={outcomeIndex === undefined || outcome?.exists !== true} onClick={() => outcome?.exists && navigateToUniverse(outcome.universeId)}>
					{formatOpenOutcomeUniverse(label)}
				</button>
			</div>
		</div>
	)
}
