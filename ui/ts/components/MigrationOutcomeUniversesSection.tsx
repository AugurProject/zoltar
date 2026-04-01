import type { ZoltarChildUniverseSummary } from '../types/contracts.js'

type MigrationOutcomeUniversesSectionProps = {
	childUniverses: ZoltarChildUniverseSummary[]
	disabled: boolean
	isScalarFork: boolean
	onAddNextOutcome: () => void
	onToggleOutcomeIndex: (outcomeIndex: bigint) => void
	selectedOutcomeIndexSet: Set<string>
}

export function MigrationOutcomeUniversesSection({ childUniverses, disabled, isScalarFork, onAddNextOutcome, onToggleOutcomeIndex, selectedOutcomeIndexSet }: MigrationOutcomeUniversesSectionProps) {
	const hasAddableOutcome = childUniverses.some(child => !selectedOutcomeIndexSet.has(child.outcomeIndex.toString()))

	return (
		<div className="entity-card-subsection market-overview-subsection">
			<div className="entity-card-subsection-header">
				<h4>Outcome universes</h4>
				{isScalarFork ? (
					<button className="quiet" type="button" onClick={onAddNextOutcome} disabled={disabled || !hasAddableOutcome}>
						Add another universe
					</button>
				) : undefined}
			</div>
			{childUniverses.length === 0 ? (
				<p className="detail">No outcome universes available.</p>
			) : (
				<div className="migration-outcome-list">
					{childUniverses.map(child => {
						const selected = selectedOutcomeIndexSet.has(child.outcomeIndex.toString())
						return (
							<button key={child.universeId.toString()} aria-pressed={selected} className={`migration-outcome-row ${ selected ? 'active' : '' }`} disabled={disabled} onClick={() => onToggleOutcomeIndex(child.outcomeIndex)} type="button">
								<span className="migration-outcome-label">{child.outcomeLabel}</span>
							</button>
						)
					})}
				</div>
			)}
		</div>
	)
}
