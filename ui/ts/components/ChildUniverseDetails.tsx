import { formatTimestamp } from '../lib/formatters.js'
import type { ZoltarChildUniverseSummary } from '../types/contracts.js'

type ChildUniverseDetailsProps = {
	child: ZoltarChildUniverseSummary
	showOutcomeIndex?: boolean
}

export function ChildUniverseDetails({ child, showOutcomeIndex = false }: ChildUniverseDetailsProps) {
	return (
		<div className='workflow-vault-grid'>
			<div>
				<span className='metric-label'>Outcome</span>
				<strong>{child.outcomeLabel}</strong>
			</div>
			{showOutcomeIndex ? (
				<div>
					<span className='metric-label'>Outcome Index</span>
					<strong>{child.outcomeIndex.toString()}</strong>
				</div>
			) : undefined}
			{child.exists ? (
				<div>
					<span className='metric-label'>Reputation Token</span>
					<strong>{child.reputationToken}</strong>
				</div>
			) : undefined}
			{child.forkTime === 0n ? undefined : (
				<div>
					<span className='metric-label'>Fork Time</span>
					<strong>{formatTimestamp(child.forkTime)}</strong>
				</div>
			)}
		</div>
	)
}
