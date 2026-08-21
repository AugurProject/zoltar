import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import type { ComponentChildren } from 'preact'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { EntityCard } from '@zoltar/ui-core-shared/components/EntityCard.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import type { ActionAvailability } from '../../types.js'
import type { ZoltarChildUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'

type ChildUniverseAction = {
	availability?: ActionAvailability
	label: string
	onClick: () => void
	pending?: boolean
	pendingLabel?: string
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
	surface: 'card' | 'flat'
}

export function ChildUniverseStatusBadge({ child }: { child: ZoltarChildUniverseSummary }) {
	return <Badge tone={child.exists ? 'ok' : 'pending'}>{child.exists ? commonCopy.exists : commonCopy.notDeployed}</Badge>
}

export function ChildUniversesSection({ action, childUniverses, emptyMessage, headerSubtitle, headerTitle, renderBody, renderBadge, renderTitle, surface }: ChildUniversesSectionProps) {
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
								surface={surface}
								className='compact'
								title={renderTitle === undefined ? child.outcomeLabel : renderTitle(child)}
								badge={renderBadge === undefined ? undefined : renderBadge(child)}
								actions={
									childAction === undefined ? undefined : (
										<TransactionActionButton
											idleLabel={childAction.label}
											pendingLabel={childAction.pendingLabel ?? commonCopy.working}
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
