import { CurrencyValue } from './CurrencyValue.js'
import type { ZoltarChildUniverseSummary } from '../types/contracts.js'

type MigrationOutcomeUniversesSectionProps = {
	childUniverses: ZoltarChildUniverseSummary[]
	disabled: boolean
	migrationBalance: bigint | undefined
	isScalarFork: boolean
	onAddNextOutcome: () => void
	onToggleOutcomeIndex: (outcomeIndex: bigint) => void
	childUniverseRepBalances: Record<string, bigint | undefined>
	selectedOutcomeIndexSet: Set<string>
}

export function getMigrationOutcomeHeldBalance(child: ZoltarChildUniverseSummary, childUniverseRepBalances: Record<string, bigint | undefined>) {
	if (!child.exists) return 0n
	return childUniverseRepBalances[child.universeId.toString()]
}

export function MigrationOutcomeUniversesSection({ childUniverses, childUniverseRepBalances, disabled, isScalarFork, migrationBalance, onAddNextOutcome, onToggleOutcomeIndex, selectedOutcomeIndexSet }: MigrationOutcomeUniversesSectionProps) {
	const hasAddableOutcome = childUniverses.some(child => !selectedOutcomeIndexSet.has(child.outcomeIndex.toString()))

	return (
		<div className='entity-card-subsection market-overview-subsection'>
			<div className='entity-card-subsection-header'>
				<h4>Outcome universes</h4>
				{isScalarFork ? (
					<button className='quiet' type='button' onClick={onAddNextOutcome} disabled={disabled || !hasAddableOutcome}>
						Add another universe
					</button>
				) : undefined}
			</div>
			{childUniverses.length === 0 ? (
				<p className='detail'>No outcome universes available.</p>
			) : (
				<div className='migration-outcome-list'>
					{childUniverses.map(child => {
						const selected = selectedOutcomeIndexSet.has(child.outcomeIndex.toString())
						const heldBalance = getMigrationOutcomeHeldBalance(child, childUniverseRepBalances)
						const remainingBalance = migrationBalance === undefined || heldBalance === undefined ? undefined : migrationBalance > heldBalance ? migrationBalance - heldBalance : 0n
						return (
							<button key={child.universeId.toString()} aria-pressed={selected} className={`migration-outcome-row ${selected ? 'active' : ''}`} disabled={disabled} onClick={() => onToggleOutcomeIndex(child.outcomeIndex)} type='button'>
								<span className='migration-outcome-copy'>
									<span className='migration-outcome-label'>{child.outcomeLabel}</span>
									<span className='migration-outcome-metrics'>
										<span>
											Held here:{' '}
											<strong>
												<CurrencyValue copyable={false} loading={(child.exists && heldBalance === undefined) || migrationBalance === undefined} value={heldBalance} suffix='REP' />
											</strong>
										</span>
										<span>
											Still migratable:{' '}
											<strong>
												<CurrencyValue copyable={false} loading={remainingBalance === undefined} value={remainingBalance} suffix='REP' />
											</strong>
										</span>
									</span>
								</span>
							</button>
						)
					})}
				</div>
			)}
		</div>
	)
}
