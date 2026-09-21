import type { ComponentChildren } from 'preact'
import { Badge } from './Badge.js'
import type { BadgeTone } from '../types/components.js'

export type DeploymentStepRow = {
	/** The deploy control for the row; omitted once the contract is deployed. */
	action?: ComponentChildren
	address: string
	badge?: { label: string; tone: BadgeTone } | undefined
	/** One-line status such as a prerequisite or wallet requirement, referenced by the action's disabled reason. */
	detail?: string | undefined
	detailId?: string | undefined
	key: string
	label: string
}

/** The contract rows of a deployment route: status badge, contract name, address, status detail, and the deploy action. */
export function DeploymentStepList({ steps }: { steps: readonly DeploymentStepRow[] }) {
	return (
		<div className='contract-list'>
			{steps.map(step => (
				<div className='contract-row' key={step.key}>
					<div className='contract-copy'>
						<div className='contract-topline'>
							{step.badge === undefined ? undefined : <Badge tone={step.badge.tone}>{step.badge.label}</Badge>}
							<h3>{step.label}</h3>
						</div>
						<p className='address'>{step.address}</p>
						{step.detail === undefined ? undefined : (
							<p className='detail' id={step.detailId}>
								{step.detail}
							</p>
						)}
					</div>
					{step.action}
				</div>
			))}
		</div>
	)
}
