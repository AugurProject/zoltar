import { CurrencyValue } from './CurrencyValue.js'
import { OutcomeSelectionList } from './OutcomeSelectionList.js'
import { WorkflowSubsection } from './WorkflowSubsection.js'
import type { ZoltarChildUniverseSummary } from '../types/contracts.js'
import { TSX_STRINGS } from '../lib/uiStrings.js'

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
						{TSX_STRINGS.componentsMigrationOutcomeUniversesSection.copy001}
					</button>
				) : undefined
			}
			className='migration-outcome-section'
			title={TSX_STRINGS.componentsMigrationOutcomeUniversesSection.copy002}
		>
			{childUniverses.length === 0 ? (
				<p className='detail'>{TSX_STRINGS.componentsMigrationOutcomeUniversesSection.copy003}</p>
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
										{TSX_STRINGS.componentsMigrationOutcomeUniversesSection.copy004}{' '}
										<strong>
											<CurrencyValue copyable={false} loading={isHeldBalanceLoading} value={heldBalance} suffix={TSX_STRINGS.componentsMigrationOutcomeUniversesSection.copy005} />
										</strong>
									</span>
									<span>
										{TSX_STRINGS.componentsMigrationOutcomeUniversesSection.copy006}{' '}
										<strong>
											<CurrencyValue copyable={false} loading={isHeldBalanceLoading} value={heldBalance} suffix={TSX_STRINGS.componentsMigrationOutcomeUniversesSection.copy007} /> /{' '}
											<CurrencyValue copyable={false} loading={migrationBalance === undefined} value={migrationBalance} suffix={TSX_STRINGS.componentsMigrationOutcomeUniversesSection.copy008} />
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
