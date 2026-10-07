import { ForkTargetPicker, type ForkTargetOption } from '@zoltar/ui-zoltar-shared/features/universes/components/ForkTargetPicker.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import { createScalarForkTarget, migratedSharesOf, targetMigrationComplete, type ForkMigrationContext, type ForkTarget } from '../protocol/forks.js'
import type { ShareOutcome } from '../protocol/live.js'
import { formatOutcomeQuantity } from '../lib/shareValue.js'
import { getTradingRouteHrefInUniverse } from '../lib/routing.js'
import * as forkCopy from '../copy/forkMigration.js'

export type { ForkMigrationContext, ForkTarget } from '../protocol/forks.js'

const SHARE_OUTCOMES: readonly ShareOutcome[] = ['YES', 'NO', 'INVALID']

function sameTarget(left: ForkTarget, right: ForkTarget) {
	return left.outcomeIndex === right.outcomeIndex
}

function toggleTarget(selectedTargets: readonly ForkTarget[], target: ForkTarget) {
	return selectedTargets.some(selected => sameTarget(selected, target)) ? selectedTargets.filter(selected => !sameTarget(selected, target)) : [...selectedTargets, target]
}

/**
 * A child pool must already exist for a migration batch to land; the status names that, not the universe. A child
 * universe that already holds the selected share's whole balance says so and cannot be selected, because migrating there again moves nothing.
 */
function toTargetOption(target: ForkTarget, sourceOutcome: ShareOutcome, sourceBalance: bigint | undefined): ForkTargetOption {
	if (targetMigrationComplete(target, sourceOutcome, sourceBalance)) return { disabledReason: forkCopy.alreadyMigratedTargetReason, label: target.label, outcomeIndex: target.outcomeIndex, status: { label: forkCopy.migrated, tone: 'ok' } }
	return { label: target.label, outcomeIndex: target.outcomeIndex, status: target.canonicalPool === undefined ? { label: forkCopy.childPoolMissing, tone: 'warning' } : { label: forkCopy.childPoolReady, tone: 'ok' } }
}

export function ForkMigrationTargets({
	context,
	selectedTargets,
	sourceOutcome,
	sourceBalance,
	disabled,
	onChange,
}: {
	context: ForkMigrationContext
	selectedTargets: readonly ForkTarget[]
	/** The share being migrated and its wallet balance; child universes that already hold that balance are marked migrated. */
	sourceOutcome: ShareOutcome
	sourceBalance: bigint | undefined
	disabled: boolean
	onChange(targets: readonly ForkTarget[]): void
}) {
	const resolveTarget = (outcomeIndex: bigint) => selectedTargets.find(target => target.outcomeIndex === outcomeIndex) ?? context.availableTargets.find(target => target.outcomeIndex === outcomeIndex) ?? (context.kind === 'scalar' ? createScalarForkTarget(context, outcomeIndex) : undefined)
	const toggle = (outcomeIndex: bigint) => {
		const target = resolveTarget(outcomeIndex)
		if (target === undefined) throw new Error(`Unknown child universe outcome ${outcomeIndex.toString()}`)
		onChange(toggleTarget(selectedTargets, target))
	}
	const option = (target: ForkTarget) => toTargetOption(target, sourceOutcome, sourceBalance)
	return (
		<ForkTargetPicker
			disabled={disabled}
			onToggle={toggle}
			question={
				context.kind === 'categorical'
					? { kind: 'categorical', targets: context.availableTargets.map(option) }
					: {
							kind: 'scalar',
							deployedTargets: context.availableTargets.map(option),
							details: context,
							resolveTarget: outcomeIndex => option(createScalarForkTarget(context, outcomeIndex)),
						}
			}
			selectedOutcomeIndexes={selectedTargets.map(target => target.outcomeIndex)}
			summary={
				<div className='fork-question-summary'>
					<span>{context.kind === 'scalar' ? forkCopy.scalarForkQuestion : forkCopy.categoricalForkQuestion}</span>
					<strong>{context.title}</strong>
				</div>
			}
		/>
	)
}

/** What a child universe holds from this wallet's migrations, such as `0.005 Yes · 0.005 Invalid`. */
function formatMigratedShares(target: ForkTarget) {
	return SHARE_OUTCOMES.filter(outcome => migratedSharesOf(target, outcome) > 0n)
		.map(outcome => formatOutcomeQuantity(migratedSharesOf(target, outcome), outcome))
		.join(' · ')
}

/**
 * Where migrated shares went: each child universe that received some, with a link that opens its security pool's market
 * in that universe. Migration mints the shares there, so this is the way to find, trade, or redeem them.
 */
export function MigratedShareLinks({ context }: { context: ForkMigrationContext }) {
	const migratedTargets = context.availableTargets.filter(target => target.canonicalPool !== undefined && SHARE_OUTCOMES.some(outcome => migratedSharesOf(target, outcome) > 0n))
	if (migratedTargets.length === 0) return null
	return (
		<WorkflowSubsection className='fork-migrated-shares' title={forkCopy.migratedSharesTitle}>
			<UserMessage className='detail' detail={forkCopy.migratedSharesDetail} />
			<ul className='fork-migrated-list'>
				{migratedTargets.map(target => (
					<li key={target.outcomeIndex.toString()}>
						<span className='fork-migrated-list__universe'>{forkCopy.childUniverseName(target.label)}</span>
						<span className='fork-migrated-list__amount'>{formatMigratedShares(target)}</span>
						{target.canonicalPool === undefined ? undefined : <a href={getTradingRouteHrefInUniverse(`#/market/${target.canonicalPool}`, target.universeId)}>{forkCopy.openChildUniverseMarket(target.label)}</a>}
					</li>
				))}
			</ul>
		</WorkflowSubsection>
	)
}
