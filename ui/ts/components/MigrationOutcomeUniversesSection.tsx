import { CurrencyValue } from './CurrencyValue.js'
import { OutcomeSelectionList } from './OutcomeSelectionList.js'
import { WorkflowSubsection } from './WorkflowSubsection.js'
import type { ZoltarChildUniverseSummary } from '../types/contracts.js'
import { UI_STRING_ADD_ANOTHER_UNIVERSE, UI_STRING_ALREADY_MIGRATED, UI_STRING_NO_OUTCOME_UNIVERSES_AVAILABLE, UI_STRING_OUTCOME_UNIVERSES, UI_STRING_REP, UI_STRING_YOUR_BALANCE } from '../lib/uiStrings.js'

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

export function getMigrationOutcomeSplitLimit(childUniverses: ZoltarChildUniverseSummary[], childUniverseRepBalances: Record<string, bigint | undefined>, migrationBalance: bigint | undefined, selectedOutcomeIndexSet: Set<string>) {
	if (migrationBalance === undefined) return undefined
	let splitLimit: bigint | undefined = undefined

	for (const child of childUniverses) {
		if (!selectedOutcomeIndexSet.has(child.outcomeIndex.toString())) continue
		const heldBalance = getMigrationOutcomeHeldBalance(child, childUniverseRepBalances)
		if (heldBalance === undefined) return undefined
		const remainingCapacity = migrationBalance > heldBalance ? migrationBalance - heldBalance : 0n
		splitLimit = splitLimit === undefined || remainingCapacity < splitLimit ? remainingCapacity : splitLimit
	}

	return splitLimit ?? 0n
}

export function MigrationOutcomeUniversesSection({ childUniverses, childUniverseRepBalances, disabled, isScalarFork, migrationBalance, onAddNextOutcome, onToggleOutcomeIndex, selectedOutcomeIndexSet }: MigrationOutcomeUniversesSectionProps) {
	const hasAddableOutcome = childUniverses.some(child => !selectedOutcomeIndexSet.has(child.outcomeIndex.toString()))

	return (
		<WorkflowSubsection
			badge={
				isScalarFork ? (
					<button className='quiet' type='button' onClick={onAddNextOutcome} disabled={disabled || !hasAddableOutcome}>
						{UI_STRING_ADD_ANOTHER_UNIVERSE}
					</button>
				) : undefined
			}
			className='migration-outcome-section'
			title={UI_STRING_OUTCOME_UNIVERSES}
		>
			{childUniverses.length === 0 ? (
				<p className='detail'>{UI_STRING_NO_OUTCOME_UNIVERSES_AVAILABLE}</p>
			) : (
				<OutcomeSelectionList
					items={childUniverses.map(child => {
						const selected = selectedOutcomeIndexSet.has(child.outcomeIndex.toString())
						const heldBalance = getMigrationOutcomeHeldBalance(child, childUniverseRepBalances)
						const isHeldBalanceLoading = child.exists && heldBalance === undefined
						return {
							details: (
								<>
									<span>
										{UI_STRING_YOUR_BALANCE}{' '}
										<strong>
											<CurrencyValue copyable={false} loading={isHeldBalanceLoading} value={heldBalance} suffix={UI_STRING_REP} />
										</strong>
									</span>
									<span>
										{UI_STRING_ALREADY_MIGRATED}{' '}
										<strong>
											<CurrencyValue copyable={false} loading={isHeldBalanceLoading} value={heldBalance} suffix={UI_STRING_REP} /> / <CurrencyValue copyable={false} loading={migrationBalance === undefined} value={migrationBalance} suffix={UI_STRING_REP} />
										</strong>
									</span>
								</>
							),
							disabled,
							key: child.universeId.toString(),
							label: child.outcomeLabel,
							onSelect: () => onToggleOutcomeIndex(child.outcomeIndex),
							selected,
						}
					})}
				/>
			)}
		</WorkflowSubsection>
	)
}
