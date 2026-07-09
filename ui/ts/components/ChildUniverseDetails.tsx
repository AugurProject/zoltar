import { AddressValue } from './AddressValue.js'
import { DataGrid } from './DataGrid.js'
import { TimestampValue } from './TimestampValue.js'
import { MetricField } from './MetricField.js'
import type { ZoltarChildUniverseSummary } from '../types/contracts.js'
import { TSX_STRINGS } from '../lib/uiStrings.js'

type ChildUniverseDetailsProps = {
	child: ZoltarChildUniverseSummary
	showOutcomeIndex?: boolean
}

export function ChildUniverseDetails({ child, showOutcomeIndex = false }: ChildUniverseDetailsProps) {
	return (
		<DataGrid className='child-universe-details-grid'>
			<MetricField label={TSX_STRINGS.componentsChildUniverseDetails.copy001}>{child.outcomeLabel}</MetricField>
			{showOutcomeIndex ? <MetricField label={TSX_STRINGS.componentsChildUniverseDetails.copy002}>{child.outcomeIndex.toString()}</MetricField> : undefined}
			{child.exists ? (
				<MetricField label={TSX_STRINGS.componentsChildUniverseDetails.copy003}>
					<AddressValue address={child.reputationToken} />
				</MetricField>
			) : undefined}
			{child.forkTime !== 0n ? (
				<MetricField label={TSX_STRINGS.componentsChildUniverseDetails.copy004}>
					<TimestampValue timestamp={child.forkTime} />
				</MetricField>
			) : undefined}
		</DataGrid>
	)
}
