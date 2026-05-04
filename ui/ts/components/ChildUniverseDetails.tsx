import { AddressValue } from './AddressValue.js'
import { DataGrid } from './DataGrid.js'
import { TimestampValue } from './TimestampValue.js'
import { MetricField } from './MetricField.js'
import type { ZoltarChildUniverseSummary } from '../types/contracts.js'

type ChildUniverseDetailsProps = {
	child: ZoltarChildUniverseSummary
	showOutcomeIndex?: boolean
}

export function ChildUniverseDetails({ child, showOutcomeIndex = false }: ChildUniverseDetailsProps) {
	return (
		<DataGrid className='child-universe-details-grid'>
			<MetricField label='Outcome'>{child.outcomeLabel}</MetricField>
			{showOutcomeIndex ? <MetricField label='Outcome Index'>{child.outcomeIndex.toString()}</MetricField> : undefined}
			{child.exists ? (
				<MetricField label='Reputation Token'>
					<AddressValue address={child.reputationToken} />
				</MetricField>
			) : undefined}
			{child.forkTime !== 0n ? (
				<MetricField label='Fork Time'>
					<TimestampValue timestamp={child.forkTime} />
				</MetricField>
			) : undefined}
		</DataGrid>
	)
}
