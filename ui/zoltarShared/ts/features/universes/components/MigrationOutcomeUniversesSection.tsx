import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as zoltarCopy from '../../../copy/zoltar.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import type { Address } from '@zoltar/shared/evm/ethereum'
import * as marketCopy from '../../../copy/market.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { WalletAssetControl } from '@zoltar/ui-core-shared/components/WalletAssetControl.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { UniverseLink } from './UniverseLink.js'
import { formatUniverseLabel } from '../lib/universe.js'
import { getChildDeploymentAvailabilityReason } from './ChildUniverseDeploymentSection.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import type { ZoltarChildUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'

type MigrationOutcomeUniversesSectionProps = {
	accountAddress: Address | undefined
	isOnActiveAppChain: boolean
	hasForked: boolean
	onDeployChildUniverse: (outcomeIndex: bigint) => void
	pendingOutcomeIndex: bigint | undefined
	childUniverses: ZoltarChildUniverseSummary[]
	disabled: boolean
	migrationBalance: bigint | undefined
	isScalarFork: boolean
	onAddNextOutcome: () => void
	onToggleOutcomeIndex: (outcomeIndex: bigint) => void
	childUniverseSplitAmounts: Record<string, bigint | undefined>
	childUniverseRepBalances: Record<string, bigint | undefined>
	selectedOutcomeIndexSet: Set<string>
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
	accountAddress,
	isOnActiveAppChain,
	hasForked,
	onDeployChildUniverse,
	pendingOutcomeIndex,
	childUniverses,
	childUniverseRepBalances,
	childUniverseSplitAmounts,
	disabled,
	isScalarFork,
	migrationBalance,
	onAddNextOutcome,
	onToggleOutcomeIndex,
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
				<div className='migration-outcome-list'>
					{childUniverses.map(child => {
						const selected = selectedOutcomeIndexSet.has(child.outcomeIndex.toString())
						const heldBalance = getMigrationOutcomeHeldBalance(child, childUniverseRepBalances)
						const deploymentReason = getChildDeploymentAvailabilityReason({ accountAddress, exists: child.exists, hasForked, isOnActiveAppChain })
						return (
							<div key={child.universeId.toString()}>
								<button aria-pressed={selected} className={`migration-outcome-row ${selected ? 'active' : ''}`} disabled={disabled} onClick={() => onToggleOutcomeIndex(child.outcomeIndex)} type='button'>
									<span className='migration-outcome-copy'>
										<span className='migration-outcome-label'>{child.outcomeLabel}</span>
										<span>
											<Badge tone={selected ? 'ok' : 'muted'}>{selected ? commonCopy.selected : commonCopy.select}</Badge> <Badge tone={child.exists ? 'ok' : 'muted'}>{child.exists ? commonCopy.deployed : commonCopy.notDeployed}</Badge>
										</span>
										<span className='migration-outcome-metrics'>
											<span>
												{zoltarCopy.walletBalanceLabel}{' '}
												<strong>
													<CurrencyValue copyable={false} loading={child.exists && heldBalance === undefined} value={heldBalance} suffix={commonCopy.rep} />
												</strong>
											</span>
											<span>
												{zoltarCopy.migratedBalanceLabel}{' '}
												<strong>
													<CurrencyValue copyable={false} loading={child.exists && childUniverseSplitAmounts[child.universeId.toString()] === undefined} value={child.exists ? childUniverseSplitAmounts[child.universeId.toString()] : 0n} suffix={commonCopy.rep} /> /{' '}
													<CurrencyValue copyable={false} loading={migrationBalance === undefined} value={migrationBalance} suffix={commonCopy.rep} />
												</strong>
											</span>
										</span>
									</span>
								</button>
								<details>
									<summary>{commonCopy.technicalDetails}</summary>
									<DataGrid dense>
										<MetricField label={commonCopy.universe}>{child.exists ? <UniverseLink universeId={child.universeId}>{formatUniverseLabel(child.universeId)}</UniverseLink> : formatUniverseLabel(child.universeId)}</MetricField>
										<MetricField label={marketCopy.parentUniverse}>
											<UniverseLink universeId={child.parentUniverseId} />
										</MetricField>
										{child.exists ? (
											<MetricField label={child.reputationTokenSymbol ?? commonCopy.reputationToken}>
												<WalletAssetControl accountAddress={accountAddress} address={child.reputationToken} isSupportedChain={isOnActiveAppChain} tokenLabel={`${child.outcomeLabel} ${child.reputationTokenSymbol ?? commonCopy.rep}`} />
											</MetricField>
										) : undefined}
									</DataGrid>
									{child.exists ? undefined : (
										<TransactionActionButton
											idleLabel={marketCopy.deployUniverse}
											pendingLabel={marketCopy.deployingUniverse}
											pending={pendingOutcomeIndex === child.outcomeIndex}
											onClick={() => onDeployChildUniverse(child.outcomeIndex)}
											availability={{ disabled: disabled || pendingOutcomeIndex !== undefined || deploymentReason !== undefined, reason: deploymentReason }}
											showDisabledReason
										/>
									)}
								</details>
							</div>
						)
					})}
				</div>
			)}
		</WorkflowSubsection>
	)
}
