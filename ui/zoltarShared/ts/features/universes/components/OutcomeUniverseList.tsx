import type { ComponentChildren } from 'preact'
import { useId } from 'preact/hooks'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { OutcomeSelectionList } from '@zoltar/ui-core-shared/components/OutcomeSelectionList.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { formatOpenChildUniverse } from '../../../copy/zoltar.js'
import * as copy from '../../../copy/universeNavigation.js'

type Outcome = { exists: boolean; label: string; universeId: bigint; selected?: boolean; disabled?: boolean; details?: ComponentChildren; actions?: ComponentChildren; onSelect: () => void }

/** Outcome names and deployment status stay consistent while navigation and selection keep their own semantics. */
export function OutcomeUniverseList({ outcomes, selection = false, emptyMessage, className = '' }: { outcomes: readonly Outcome[]; selection?: boolean; emptyMessage?: ComponentChildren; className?: string }) {
	const statusId = useId()
	return (
		<OutcomeSelectionList
			className={className}
			emptyMessage={emptyMessage}
			items={outcomes.map(outcome => ({
				key: outcome.universeId.toString(),
				ariaLabel: selection ? outcome.label : formatOpenChildUniverse(outcome.label),
				describedById: `${statusId}-${outcome.universeId}`,
				label: (
					<>
						{selection ? (
							<span aria-hidden='true' className='migration-outcome-checkbox'>
								{outcome.selected ? '✓' : ''}
							</span>
						) : undefined}
						{outcome.label}
						{!selection && outcome.exists ? <span aria-hidden='true'>{copy.openOutcomeArrowTail}</span> : undefined}
					</>
				),
				details: (
					<>
						<span id={`${statusId}-${outcome.universeId}`}>
							<Badge tone={outcome.exists ? 'ok' : 'muted'}>{outcome.exists ? commonCopy.deployed : commonCopy.notDeployed}</Badge>
						</span>
						{outcome.details}
					</>
				),
				disabled: outcome.disabled ?? !outcome.exists,
				...(selection && outcome.selected !== undefined ? { selected: outcome.selected } : {}),
				actions: outcome.actions,
				onSelect: outcome.onSelect,
			}))}
		/>
	)
}
