import type { ComponentChildren } from 'preact'
import { EntityCard } from './EntityCard.js'
import { UniverseLink } from './UniverseLink.js'
import type { ZoltarChildUniverseSummary } from '../types/contracts.js'

type ChildUniverseAction = {
	className?: string
	disabled: boolean
	label: string
	onClick: () => void
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

export function ChildUniversesSection({ action, childUniverses, emptyMessage, headerSubtitle, headerTitle, renderBody, renderBadge, renderTitle }: ChildUniversesSectionProps) {
	return (
		<div className="entity-card-subsection market-overview-subsection">
			<div className="entity-card-subsection-header">
				<h4>{headerTitle}</h4>
				{headerSubtitle === undefined ? undefined : <span className="detail">{headerSubtitle}</span>}
			</div>
			{childUniverses.length === 0 ? (
				<p className="detail">{emptyMessage}</p>
			) : (
				<div className="entity-card-list">
					{childUniverses.map(child => {
						const childAction = action?.(child)
						return (
							<EntityCard
								key={child.universeId.toString()}
								className="compact"
								title={renderTitle === undefined ? <UniverseLink universeId={child.universeId} /> : renderTitle(child)}
								badge={renderBadge === undefined ? undefined : renderBadge(child)}
								actions={
									childAction === undefined ? undefined : (
										<button className={childAction.className ?? 'secondary'} onClick={childAction.onClick} disabled={childAction.disabled}>
											{childAction.label}
										</button>
									)
								}
							>
								{renderBody(child)}
							</EntityCard>
						)
					})}
				</div>
			)}
		</div>
	)
}
