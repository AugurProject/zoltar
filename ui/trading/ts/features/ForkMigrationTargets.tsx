import { ForkTargetPicker, type ForkTargetOption } from '@zoltar/ui-zoltar-shared/features/universes/components/ForkTargetPicker.js'
import { createScalarForkTarget, type ForkMigrationContext, type ForkTarget } from '../protocol/forks.js'
import * as forkCopy from '../copy/forkMigration.js'

export type { ForkMigrationContext, ForkTarget } from '../protocol/forks.js'

function sameTarget(left: ForkTarget, right: ForkTarget) {
	return left.outcomeIndex === right.outcomeIndex
}

function toggleTarget(selectedTargets: readonly ForkTarget[], target: ForkTarget) {
	return selectedTargets.some(selected => sameTarget(selected, target)) ? selectedTargets.filter(selected => !sameTarget(selected, target)) : [...selectedTargets, target]
}

/** A child pool must already exist for a migration batch to land; the status names that, not the universe. */
function toTargetOption(target: ForkTarget): ForkTargetOption {
	return { label: target.label, outcomeIndex: target.outcomeIndex, status: target.canonicalPool === undefined ? { label: forkCopy.childPoolMissing, tone: 'warning' } : { label: forkCopy.childPoolReady, tone: 'ok' } }
}

export function ForkMigrationTargets({ context, selectedTargets, disabled, onChange }: { context: ForkMigrationContext; selectedTargets: readonly ForkTarget[]; disabled: boolean; onChange(targets: readonly ForkTarget[]): void }) {
	const resolveTarget = (outcomeIndex: bigint) => selectedTargets.find(target => target.outcomeIndex === outcomeIndex) ?? context.availableTargets.find(target => target.outcomeIndex === outcomeIndex) ?? (context.kind === 'scalar' ? createScalarForkTarget(context, outcomeIndex) : undefined)
	const toggle = (outcomeIndex: bigint) => {
		const target = resolveTarget(outcomeIndex)
		if (target === undefined) throw new Error(`Unknown fork target outcome ${outcomeIndex.toString()}`)
		onChange(toggleTarget(selectedTargets, target))
	}
	return (
		<ForkTargetPicker
			disabled={disabled}
			onToggle={toggle}
			question={
				context.kind === 'categorical'
					? { kind: 'categorical', targets: context.availableTargets.map(toTargetOption) }
					: {
							kind: 'scalar',
							deployedTargets: context.availableTargets.map(toTargetOption),
							details: context,
							resolveTarget: outcomeIndex => toTargetOption(createScalarForkTarget(context, outcomeIndex)),
						}
			}
			selectedOutcomeIndexes={selectedTargets.map(target => target.outcomeIndex)}
			summary={
				<div className='fork-question-summary'>
					<span>{context.kind === 'scalar' ? forkCopy.scalarForkQuestion : forkCopy.categoricalForkQuestion}</span>
					<strong>{context.title}</strong>
				</div>
			}
			title={forkCopy.targetChildUniverses}
		/>
	)
}
