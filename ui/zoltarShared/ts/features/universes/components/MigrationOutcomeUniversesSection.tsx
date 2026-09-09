import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as zoltarCopy from '../../../copy/zoltar.js'
import * as marketCopy from '../../../copy/market.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { OutcomeSelectionList } from '@zoltar/ui-core-shared/components/OutcomeSelectionList.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { UniverseLink } from './UniverseLink.js'
import { formatUniverseIdHex } from '../lib/universe.js'
import type { ZoltarChildUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'

type MigrationOutcomeUniversesSectionProps = {
	childUniverses: ZoltarChildUniverseSummary[]
	disabled: boolean
	migrationBalance: bigint | undefined
	isScalarFork: boolean
	onDeployChildUniverse: (outcomeIndex: bigint) => void
	onAddNextOutcome: () => void
	onToggleOutcomeIndex: (outcomeIndex: bigint) => void
	childUniverseRepBalances: Record<string, bigint | undefined>
	childUniverseSplitAmounts: Record<string, bigint | undefined>
	selectedOutcomeIndexSet: Set<string>
	pendingOutcomeIndex: bigint | undefined
	deploymentDisabledReason: (child: ZoltarChildUniverseSummary) => string | undefined
}

export function getMigrationOutcomeHeldBalance(child: ZoltarChildUniverseSummary, childUniverseRepBalances: Record<string, bigint | undefined>) {
	if (!child.exists) return 0n
	return childUniverseRepBalances[child.universeId.toString()]
}

export function getMigrationOutcomeSplitLimit(childUniverses: ZoltarChildUniverseSummary[], childUniverseSplitAmounts: Record<string, bigint | undefined>, migrationBalance: bigint | undefined, selectedOutcomeIndexSet: Set<string>) {
	if (migrationBalance === undefined) return undefined
	let splitLimit: bigint | undefined = undefined

	for (const child of childUniverses) {
		if (!selectedOutcomeIndexSet.has(child.outcomeIndex.toString())) continue
		const splitAmount = child.exists ? childUniverseSplitAmounts[child.universeId.toString()] : 0n
		if (splitAmount === undefined) return undefined
		const remainingCapacity = migrationBalance > splitAmount ? migrationBalance - splitAmount : 0n
		splitLimit = splitLimit === undefined || remainingCapacity < splitLimit ? remainingCapacity : splitLimit
	}

	return splitLimit ?? 0n
}

export function MigrationOutcomeUniversesSection({
	childUniverses,
	childUniverseRepBalances,
	childUniverseSplitAmounts,
	deploymentDisabledReason,
	disabled,
	isScalarFork,
	migrationBalance,
	onAddNextOutcome,
	onDeployChildUniverse,
	onToggleOutcomeIndex,
	pendingOutcomeIndex,
	selectedOutcomeIndexSet,
}: MigrationOutcomeUniversesSectionProps) {
	const hasAddableOutcome = childUniverses.some(child => !selectedOutcomeIndexSet.has(child.outcomeIndex.toString()))

	return (
		<WorkflowSubsection
			badge={
				isScalarFork ? (
					<button className='quiet' type='button' onClick={onAddNextOutcome} disabled={disabled || !hasAddableOutcome}>
						{zoltarCopy.addAnotherUniverse}
					</button>
				) : undefined
			}
			className='migration-outcome-section'
			title={zoltarCopy.outcomeUniverses}
		>
			{childUniverses.length === 0 ? (
				<p className='detail'>{zoltarCopy.outcomeUniversesEmpty}</p>
			) : (
				<OutcomeSelectionList
					items={childUniverses.map(child => {
						const selected = selectedOutcomeIndexSet.has(child.outcomeIndex.toString())
						const heldBalance = getMigrationOutcomeHeldBalance(child, childUniverseRepBalances)
						const isHeldBalanceLoading = child.exists && heldBalance === undefined
						return {
							actions: child.exists ? (
								<UniverseLink universeId={child.universeId}>
									<Badge tone='ok'>{commonCopy.deployed}</Badge>
								</UniverseLink>
							) : (
								<TransactionActionButton
									tone='secondary'
									idleLabel={marketCopy.deployUniverse}
									pendingLabel={marketCopy.deployingUniverse}
									pending={pendingOutcomeIndex === child.outcomeIndex}
									onClick={() => onDeployChildUniverse(child.outcomeIndex)}
									availability={{ disabled: pendingOutcomeIndex !== undefined || deploymentDisabledReason(child) !== undefined, reason: deploymentDisabledReason(child) }}
								/>
							),
							details: (
								<>
									<span className='migration-outcome-metric'>
										<span className='migration-outcome-metric-label'>{commonCopy.universe}</span>
										<strong>{formatUniverseIdHex(child.universeId)}</strong>
									</span>
									<span className='migration-outcome-metric'>
										<span className='migration-outcome-metric-label'>{commonCopy.reputationToken}</span>
										<strong>{child.reputationTokenName ?? child.reputationTokenSymbol ?? commonCopy.notDeployed}</strong>
									</span>
									<span className='migration-outcome-metric'>
										<span className='migration-outcome-metric-label'>{zoltarCopy.walletBalanceLabel}</span>
										<strong>
											<CurrencyValue copyable={false} loading={isHeldBalanceLoading} value={heldBalance} suffix={commonCopy.rep} />
										</strong>
									</span>
									<span className='migration-outcome-metric'>
										<span className='migration-outcome-metric-label'>{zoltarCopy.migratedBalanceLabel}</span>
										<strong>
											<CurrencyValue copyable={false} loading={child.exists && childUniverseSplitAmounts[child.universeId.toString()] === undefined} value={child.exists ? childUniverseSplitAmounts[child.universeId.toString()] : 0n} suffix={commonCopy.rep} /> /{' '}
											<CurrencyValue copyable={false} loading={migrationBalance === undefined} value={migrationBalance} suffix={commonCopy.rep} />
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
