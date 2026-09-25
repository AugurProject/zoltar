import type { ComponentChildren } from 'preact'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as zoltarCopy from '../../../copy/zoltar.js'
import * as marketCopy from '../../../copy/market.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { OutcomeSelectionList } from '@zoltar/ui-core-shared/components/OutcomeSelectionList.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { UniverseLink } from './UniverseLink.js'
import type { MigrationWizardOutcome } from '../lib/migrationWizard.js'

type MigrationOutcomeUniversesSectionProps = {
	deploymentDisabledReason: (outcome: MigrationWizardOutcome) => string | undefined
	disabled: boolean
	loadingBalances: boolean
	migrationBalance: bigint | undefined
	onDeployChildUniverse: (outcomeIndex: bigint) => void
	onToggleOutcomeIndex: (outcomeIndex: bigint) => void
	outcomes: readonly MigrationWizardOutcome[]
	pendingOutcomeIndex: bigint | undefined
}

function OutcomeMetric({ label, children }: { label: string; children: ComponentChildren }) {
	return (
		<span className='migration-outcome-metric'>
			<span className='migration-outcome-metric-label'>{label}</span>
			<strong>{children}</strong>
		</span>
	)
}

/** The "choose outcomes" step: one checkbox card per outcome universe, named by its outcome. */
export function MigrationOutcomeUniversesSection({ deploymentDisabledReason, disabled, loadingBalances, migrationBalance, onDeployChildUniverse, onToggleOutcomeIndex, outcomes, pendingOutcomeIndex }: MigrationOutcomeUniversesSectionProps) {
	return (
		<OutcomeSelectionList
			className='migration-outcome-section'
			emptyMessage={zoltarCopy.outcomeUniversesEmpty}
			items={outcomes.map(outcome => {
				const deployReason = deploymentDisabledReason(outcome)
				return {
					actions: outcome.exists ? (
						<UniverseLink className='button-link secondary-link' universeId={outcome.universeId}>
							{zoltarCopy.formatOpenOutcomeUniverse(outcome.label)}
						</UniverseLink>
					) : (
						<TransactionActionButton
							tone='secondary'
							showDisabledReason={false}
							idleLabel={marketCopy.deployUniverse}
							pendingLabel={marketCopy.deployingUniverse}
							pending={pendingOutcomeIndex === outcome.outcomeIndex}
							onClick={() => onDeployChildUniverse(outcome.outcomeIndex)}
							availability={{ disabled: pendingOutcomeIndex !== undefined || deployReason !== undefined, reason: deployReason }}
						/>
					),
					details: (
						<>
							<OutcomeMetric label={zoltarCopy.outcomeUniverseStatus}>{outcome.exists ? zoltarCopy.outcomeUniverseCreated : zoltarCopy.outcomeUniverseCreatedOnMigration}</OutcomeMetric>
							<OutcomeMetric label={zoltarCopy.outcomeHeldRep}>
								<CurrencyValue copyable={false} loading={loadingBalances && outcome.heldAttoRep === undefined} value={outcome.heldAttoRep} suffix={commonCopy.rep} />
							</OutcomeMetric>
							<OutcomeMetric label={zoltarCopy.outcomeAlreadyMigrated}>
								{outcome.fullyMigrated ? (
									zoltarCopy.outcomeFullyMigrated
								) : (
									<>
										<CurrencyValue copyable={false} loading={loadingBalances && outcome.alreadyMigratedAttoRep === undefined} value={outcome.alreadyMigratedAttoRep} suffix={commonCopy.rep} />
										{migrationBalance === undefined || migrationBalance === 0n ? undefined : (
											<>
												{' / '}
												<CurrencyValue copyable={false} value={migrationBalance} suffix={commonCopy.rep} />
											</>
										)}
									</>
								)}
							</OutcomeMetric>
						</>
					),
					disabled,
					key: outcome.universeId.toString(),
					label: (
						<>
							<span aria-hidden='true' className='migration-outcome-checkbox'>
								{outcome.selected ? '✓' : ''}
							</span>
							{outcome.label}
						</>
					),
					onSelect: () => onToggleOutcomeIndex(outcome.outcomeIndex),
					selected: outcome.selected,
				}
			})}
		/>
	)
}
