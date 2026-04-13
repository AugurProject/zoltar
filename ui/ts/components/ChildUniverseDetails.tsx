import { TimestampValue } from './TimestampValue.js'
import { MetricField } from './MetricField.js'
import type { ZoltarChildUniverseSummary } from '../types/contracts.js'

type ChildUniverseDetailsProps = {
	child: ZoltarChildUniverseSummary
	showOutcomeIndex?: boolean
}

export function ChildUniverseDetails({ child, showOutcomeIndex = false }: ChildUniverseDetailsProps) {
	return (
		<div className='workflow-vault-grid'>
			<MetricField label='Outcome'>{child.outcomeLabel}</MetricField>
			{showOutcomeIndex ? <MetricField label='Outcome Index'>{child.outcomeIndex.toString()}</MetricField> : undefined}
			{child.exists ? <MetricField label='Reputation Token'>{child.reputationToken}</MetricField> : undefined}
			{child.forkTime !== 0n ? (
				<MetricField label='Fork Time'>
					<TimestampValue timestamp={child.forkTime} />
				</MetricField>
			) : undefined}
		</div>
	)
}
