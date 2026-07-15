import * as commonCopy from '../../../copy/common.js'
import { AddressValue } from '../../../components/AddressValue.js'
import { DataGrid } from '../../../components/DataGrid.js'
import { TimestampValue } from '../../../components/TimestampValue.js'
import { MetricField } from '../../../components/MetricField.js'
import type { ZoltarChildUniverseSummary } from '../../../types/contracts.js'

type ChildUniverseDetailsProps = {
	child: ZoltarChildUniverseSummary
	showOutcomeIndex?: boolean
}

export function ChildUniverseDetails({ child, showOutcomeIndex = false }: ChildUniverseDetailsProps) {
	return (
		<DataGrid className='child-universe-details-grid'>
			<MetricField label={commonCopy.outcome}>{child.outcomeLabel}</MetricField>
			{showOutcomeIndex ? <MetricField label={commonCopy.outcomeIndex}>{child.outcomeIndex.toString()}</MetricField> : undefined}
			{child.exists ? (
				<MetricField label={commonCopy.reputationToken}>
					<AddressValue address={child.reputationToken} />
				</MetricField>
			) : undefined}
			{child.forkTime !== 0n ? (
				<MetricField label={commonCopy.forkTime}>
					<TimestampValue timestamp={child.forkTime} />
				</MetricField>
			) : undefined}
		</DataGrid>
	)
}
