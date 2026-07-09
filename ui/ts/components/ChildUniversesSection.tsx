import type { ComponentChildren } from 'preact'
import { Badge } from './Badge.js'
import { EntityCard } from './EntityCard.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { UniverseLink } from './UniverseLink.js'
import { WorkflowSubsection } from './WorkflowSubsection.js'
import { UI_STRINGS } from '../lib/uiStrings.js'
import type { ActionSafetyId } from '../lib/actionSafety/ids.js'
import type { ActionAvailability } from '../types/components.js'
import type { ZoltarChildUniverseSummary } from '../types/contracts.js'

type ChildUniverseAction = {
	availability?: ActionAvailability
	label: string
	onClick: () => void
	pending?: boolean
	pendingLabel?: string
	safetyId: ActionSafetyId
	showDisabledReason?: boolean
	tone?: 'primary' | 'secondary'
}

type ChildUniversesSectionProps = {
	action?: (child: ZoltarChildUniverseSummary) => ChildUniverseAction
	childUniverses: ZoltarChildUniverseSummary[]
	emptyMessage: string
	headerSubtitle?: ComponentChildren
	headerTitle: ComponentChildren
	renderBody: (child: ZoltarChildUniverseSummary) => ComponentChildren
	renderBadge?: (child: ZoltarChildUniverseSummary) => ComponentChildren
	renderTitle?: (child: ZoltarChildUniverseSummary) => ComponentChildren
}

export function ChildUniverseStatusBadge({ child }: { child: ZoltarChildUniverseSummary }) {
	return <Badge tone={child.exists ? 'ok' : 'pending'}>{child.exists ? UI_STRINGS.childUniversesSection.existsLabel : UI_STRINGS.childUniversesSection.notDeployedLabel}</Badge>
}

export function ChildUniversesSection({ action, childUniverses, emptyMessage, headerSubtitle, headerTitle, renderBody, renderBadge, renderTitle }: ChildUniversesSectionProps) {
	return (
		<WorkflowSubsection badge={headerSubtitle === undefined ? undefined : <span className='detail'>{headerSubtitle}</span>} className='child-universes-section' title={headerTitle}>
			{childUniverses.length === 0 ? (
				<p className='detail'>{emptyMessage}</p>
			) : (
				<div className='entity-card-list'>
					{childUniverses.map(child => {
						const childAction = action?.(child)
						return (
							<EntityCard
								key={child.universeId.toString()}
								className='compact'
								title={renderTitle === undefined ? <UniverseLink universeId={child.universeId} /> : renderTitle(child)}
								badge={renderBadge === undefined ? undefined : renderBadge(child)}
								actions={
									childAction === undefined ? undefined : (
										<TransactionActionButton
											safetyId={childAction.safetyId}
											idleLabel={childAction.label}
											pendingLabel={childAction.pendingLabel ?? UI_STRINGS.childUniversesSection.workingLabel}
											onClick={childAction.onClick}
											pending={childAction.pending === true}
											tone={childAction.tone ?? 'secondary'}
											availability={childAction.availability ?? { disabled: false, reason: undefined }}
											showDisabledReason={childAction.showDisabledReason ?? false}
										/>
									)
								}
							>
								{renderBody(child)}
							</EntityCard>
						)
					})}
				</div>
			)}
		</WorkflowSubsection>
	)
}
