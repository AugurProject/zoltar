import { buildRouteHref, parseRouteHash } from '@zoltar/ui-core-shared/navigation/routing.js'
import { writeUniverseQueryParam } from '@zoltar/ui-core-shared/navigation/urlParams.js'
import { useEffect, useState } from 'preact/hooks'
import type { ScalarQuestionDetails } from '@zoltar/zoltar-shared/questions/scalarOutcome'
import { UniverseScalarPicker, resolveScalarUniverseSelection } from './UniverseScalarPicker.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { PaginationControls } from '@zoltar/ui-core-shared/components/PaginationControls.js'
import type { ComponentChildren } from 'preact'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as transactionCopy from '@zoltar/ui-core-shared/copy/transaction.js'
import * as zoltarCopy from '../../../copy/zoltar.js'
import * as marketCopy from '../../../copy/market.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { OutcomeUniverseList } from './OutcomeUniverseList.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { UniverseLink } from '@zoltar/ui-core-shared/components/UniverseLink.js'
import type { MigrationWizardOutcome } from '../lib/migrationWizard.js'

type MigrationOutcomeUniversesSectionProps = {
	deploymentDisabledReason: (outcome: Pick<MigrationWizardOutcome, 'exists'>) => string | undefined
	universeBrowserHref?: string | undefined
	scalarQuestion?: ScalarQuestionDetails | undefined
	selectedOutcomeIndexes?: readonly bigint[]
	onScalarOutcomesChange?: ((indexes: readonly bigint[]) => void) | undefined
	disabled: boolean
	loadingBalances: boolean
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
export function MigrationOutcomeUniversesSection({ universeBrowserHref, scalarQuestion, selectedOutcomeIndexes = [], onScalarOutcomesChange, deploymentDisabledReason, disabled, loadingBalances, onDeployChildUniverse, onToggleOutcomeIndex, outcomes, pendingOutcomeIndex }: MigrationOutcomeUniversesSectionProps) {
	const browser = universeBrowserHref === undefined ? undefined : parseRouteHash(universeBrowserHref)
	const [tickInput, setTickInput] = useState('0')
	const [invalid, setInvalid] = useState(false)
	const [page, setPage] = useState(0)
	const selection = scalarQuestion === undefined ? undefined : resolveScalarUniverseSelection(scalarQuestion, tickInput, invalid)
	const visibleOutcomes = selection === undefined ? outcomes.slice(page * 10, (page + 1) * 10) : outcomes.filter(outcome => outcome.outcomeIndex === selection.outcomeIndex)
	const selectionKey = selectedOutcomeIndexes.join(',')
	useEffect(() => {
		if (scalarQuestion === undefined || onScalarOutcomesChange === undefined) return
		const indexes = [...selectedOutcomeIndexes, ...(selection?.outcomeIndex === undefined ? [] : [selection.outcomeIndex])]
		const timer = setTimeout(() => onScalarOutcomesChange(indexes), 150)
		return () => clearTimeout(timer)
	}, [scalarQuestion, onScalarOutcomesChange, selection?.outcomeIndex, selectionKey])
	const selectedChild = visibleOutcomes[0]
	const resolvingSelection = onScalarOutcomesChange !== undefined && selection?.outcomeIndex !== undefined && selectedChild === undefined
	const deploymentReason = deploymentDisabledReason({ exists: false })
	return (
		<div className='form-grid'>
			{outcomes.some(outcome => outcome.selected) ? (
				<div className='field'>
					<span className='field-label'>{zoltarCopy.selectedOutcomes}</span>
					<div className='actions'>
						{outcomes
							.filter(outcome => outcome.selected)
							.map(outcome => (
								<button key={outcome.outcomeIndex.toString()} type='button' className='secondary' disabled={disabled} onClick={() => onToggleOutcomeIndex(outcome.outcomeIndex)} aria-label={zoltarCopy.formatRemoveOutcome(outcome.label)}>
									{outcome.label} <span aria-hidden='true'>{transactionCopy.closeSymbol}</span>
								</button>
							))}
					</div>
				</div>
			) : undefined}
			{scalarQuestion === undefined ? undefined : <UniverseScalarPicker question={scalarQuestion} tickInput={tickInput} invalid={invalid} onTickChange={setTickInput} onInvalidChange={setInvalid} disabled={disabled || pendingOutcomeIndex !== undefined} />}
			{selection?.outcomeIndex !== undefined && selectedChild === undefined ? (
				<div className='actions'>
					<Badge tone={resolvingSelection ? 'loading' : 'muted'}>{resolvingSelection ? commonCopy.loading : commonCopy.notDeployed}</Badge>
					<TransactionActionButton
						tone='secondary'
						idleLabel={zoltarCopy.formatDeployChildUniverse(selection.label)}
						pendingLabel={marketCopy.deployingUniverse}
						pending={pendingOutcomeIndex === selection.outcomeIndex}
						onClick={() => {
							if (selection.outcomeIndex !== undefined) onDeployChildUniverse(selection.outcomeIndex)
						}}
						availability={{ disabled: resolvingSelection || disabled || pendingOutcomeIndex !== undefined || deploymentReason !== undefined, reason: resolvingSelection ? commonCopy.loadingWithEllipsis : deploymentReason }}
					/>
				</div>
			) : undefined}
			<OutcomeUniverseList
				selection
				className='migration-outcome-section'
				emptyMessage={scalarQuestion === undefined ? zoltarCopy.migrationChildUniversesEmpty : undefined}
				outcomes={visibleOutcomes.map(outcome => {
					const deployReason = deploymentDisabledReason(outcome)
					return {
						actions: outcome.exists ? (
							<UniverseLink href={browser === undefined ? undefined : buildRouteHref(browser.routeHash, writeUniverseQueryParam(browser.search, outcome.universeId))} className='button-link secondary-link' universeId={outcome.universeId}>
								{zoltarCopy.formatOpenChildUniverse(outcome.label)}
							</UniverseLink>
						) : (
							<TransactionActionButton
								tone='secondary'
								showDisabledReason={false}
								idleLabel={zoltarCopy.formatDeployChildUniverse(outcome.label)}
								pendingLabel={marketCopy.deployingUniverse}
								pending={pendingOutcomeIndex === outcome.outcomeIndex}
								onClick={() => onDeployChildUniverse(outcome.outcomeIndex)}
								availability={{ disabled: pendingOutcomeIndex !== undefined || deployReason !== undefined, reason: deployReason }}
							/>
						),
						details: (
							<>
								<OutcomeMetric label={zoltarCopy.outcomeHeldRep}>
									<CurrencyValue copyable={false} loading={loadingBalances && outcome.heldAttoRep === undefined} value={outcome.heldAttoRep} suffix={commonCopy.rep} />
								</OutcomeMetric>
								<OutcomeMetric label={zoltarCopy.outcomeAlreadyMigrated}>
									<CurrencyValue copyable={false} loading={loadingBalances && outcome.alreadyMigratedAttoRep === undefined} value={outcome.alreadyMigratedAttoRep} suffix={commonCopy.rep} />
								</OutcomeMetric>
							</>
						),
						disabled,
						exists: outcome.exists,
						universeId: outcome.universeId,
						label: outcome.label,
						onSelect: () => onToggleOutcomeIndex(outcome.outcomeIndex),
						selected: outcome.selected,
					}
				})}
			/>
			{scalarQuestion === undefined ? <PaginationControls loading={false} hasPreviousPage={page > 0} hasNextPage={(page + 1) * 10 < outcomes.length} onPreviousPage={() => setPage(current => Math.max(0, current - 1))} onNextPage={() => setPage(current => current + 1)} /> : undefined}
		</div>
	)
}
