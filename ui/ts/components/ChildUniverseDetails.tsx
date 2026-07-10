import { AddressValue } from './AddressValue.js'
import { DataGrid } from './DataGrid.js'
import { TimestampValue } from './TimestampValue.js'
import { MetricField } from './MetricField.js'
import type { ZoltarChildUniverseSummary } from '../types/contracts.js'
import { UI_STRING_FORK_TIME, UI_STRING_OUTCOME, UI_STRING_OUTCOME_INDEX, UI_STRING_REPUTATION_TOKEN } from '../lib/uiStrings.js'

type ChildUniverseDetailsProps = {
	child: ZoltarChildUniverseSummary
	showOutcomeIndex?: boolean
}

export function ChildUniverseDetails({ child, showOutcomeIndex = false }: ChildUniverseDetailsProps) {
	return (
		<DataGrid className='child-universe-details-grid'>
			<MetricField label={UI_STRING_OUTCOME}>{child.outcomeLabel}</MetricField>
			{showOutcomeIndex ? <MetricField label={UI_STRING_OUTCOME_INDEX}>{child.outcomeIndex.toString()}</MetricField> : undefined}
			{child.exists ? (
				<MetricField label={UI_STRING_REPUTATION_TOKEN}>
					<AddressValue address={child.reputationToken} />
				</MetricField>
			) : undefined}
			{child.forkTime !== 0n ? (
				<MetricField label={UI_STRING_FORK_TIME}>
					<TimestampValue timestamp={child.forkTime} />
				</MetricField>
			) : undefined}
		</DataGrid>
	)
}
