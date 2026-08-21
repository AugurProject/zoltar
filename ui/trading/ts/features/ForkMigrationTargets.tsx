import { formatScalarOutcomeLabel, getScalarOutcomeIndex } from '@zoltar/shared/scalarOutcome'
import { OutcomeSelectionList } from '@zoltar/ui-core-shared/components/OutcomeSelectionList.js'
import { ScalarOutcomePicker } from '@zoltar/ui-core-shared/components/ScalarOutcomePicker.js'
import { useMemo, useState } from 'preact/hooks'
import { createScalarForkTarget, type ForkMigrationContext, type ForkTarget } from '../protocol/forks.js'
import * as forkCopy from '../copy/forkMigration.js'

export type { ForkMigrationContext, ForkTarget } from '../protocol/forks.js'

function sameTarget(left: ForkTarget, right: ForkTarget) {
	return left.outcomeIndex === right.outcomeIndex
}

function toggleTarget(selectedTargets: readonly ForkTarget[], target: ForkTarget) {
	return selectedTargets.some(selected => sameTarget(selected, target)) ? selectedTargets.filter(selected => !sameTarget(selected, target)) : [...selectedTargets, target]
}

function TargetStatus({ target }: { target: ForkTarget }) {
	return <span class={`fork-target-status fork-target-status--${target.canonicalPool === undefined ? 'missing' : 'ready'}`}>{target.canonicalPool === undefined ? forkCopy.childPoolMissing : forkCopy.childPoolReady}</span>
}

function SelectedTargets({ selectedTargets, disabled, onChange }: { selectedTargets: readonly ForkTarget[]; disabled: boolean; onChange(targets: readonly ForkTarget[]): void }) {
	return (
		<OutcomeSelectionList
			className='fork-target-selection'
			emptyMessage={forkCopy.noBranchesSelected}
			items={selectedTargets.map(target => ({ key: target.outcomeIndex.toString(), label: target.label, details: <TargetStatus target={target} />, disabled, selected: true, onSelect: () => onChange(toggleTarget(selectedTargets, target)) }))}
		/>
	)
}

function CategoricalTargets({ context, selectedTargets, disabled, onChange }: { context: Extract<ForkMigrationContext, { kind: 'categorical' }>; selectedTargets: readonly ForkTarget[]; disabled: boolean; onChange(targets: readonly ForkTarget[]): void }) {
	return (
		<OutcomeSelectionList
			className='fork-target-grid'
			items={context.availableTargets.map(target => ({ key: target.outcomeIndex.toString(), label: target.label, details: <TargetStatus target={target} />, disabled, selected: selectedTargets.some(candidate => sameTarget(candidate, target)), onSelect: () => onChange(toggleTarget(selectedTargets, target)) }))}
		/>
	)
}

function ScalarTargets({ context, selectedTargets, disabled, onChange }: { context: Extract<ForkMigrationContext, { kind: 'scalar' }>; selectedTargets: readonly ForkTarget[]; disabled: boolean; onChange(targets: readonly ForkTarget[]): void }) {
	const [tickInput, setTickInput] = useState('0')
	const [invalid, setInvalid] = useState(false)
	const tick = useMemo(() => {
		if (!/^\d+$/.test(tickInput)) return undefined
		const parsedTick = BigInt(tickInput)
		return parsedTick <= context.numTicks ? parsedTick : undefined
	}, [context.numTicks, tickInput])
	let outcomeIndex: bigint | undefined
	if (invalid) outcomeIndex = 0n
	else if (tick !== undefined) outcomeIndex = getScalarOutcomeIndex(context, tick)
	const candidate = outcomeIndex === undefined ? undefined : createScalarForkTarget(context, outcomeIndex)
	const candidateSelected = candidate !== undefined && selectedTargets.some(target => sameTarget(target, candidate))
	let candidateLabel = forkCopy.exactTickPrompt
	if (invalid) candidateLabel = forkCopy.invalidTick
	else if (tick !== undefined) candidateLabel = formatScalarOutcomeLabel(context, tick)
	let selectedTickLabel = forkCopy.exactTickPrompt
	if (invalid) selectedTickLabel = forkCopy.invalidTick
	else if (tick !== undefined) selectedTickLabel = forkCopy.tickPosition(tick, context.numTicks)

	return (
		<div class='scalar-fork-picker'>
			<p class='fork-scalar-preview' aria-live='polite'>
				<span>{candidateSelected ? forkCopy.selectedBranch : forkCopy.branchToAdd}</span>
			</p>
			<ScalarOutcomePicker
				action={
					<button type='button' class='secondary-action' disabled={disabled || candidate === undefined} onClick={() => candidate === undefined || onChange(toggleTarget(selectedTargets, candidate))}>
						{candidateSelected ? forkCopy.removeScalarTarget : forkCopy.addScalarTarget}
					</button>
				}
				clampExactTickInput={false}
				details={{ answerUnit: context.answerUnit, displayValueMax: context.displayValueMax, displayValueMin: context.displayValueMin, maxValueLabel: formatScalarOutcomeLabel(context, context.numTicks), minValueLabel: formatScalarOutcomeLabel(context, 0n), numTicks: context.numTicks }}
				disabled={disabled}
				isInvalid={invalid}
				label={forkCopy.scalarForkTick}
				onInvalidChange={setInvalid}
				onSelectedTickChange={setTickInput}
				selectedOutcomeLabel={candidateLabel}
				selectedTick={tickInput}
				selectedTickLabel={selectedTickLabel}
			/>
			{context.availableTargets.length === 0 ? null : (
				<div class='fork-deployed-targets'>
					<span>{forkCopy.deployedScalarChildren}</span>
					{context.availableTargets.map(target => (
						<button key={target.outcomeIndex.toString()} type='button' class='quiet-action' aria-pressed={selectedTargets.some(selected => sameTarget(selected, target))} disabled={disabled} onClick={() => onChange(toggleTarget(selectedTargets, target))}>
							{target.label}
						</button>
					))}
				</div>
			)}
		</div>
	)
}

export function ForkMigrationTargets({ context, selectedTargets, disabled, onChange }: { context: ForkMigrationContext; selectedTargets: readonly ForkTarget[]; disabled: boolean; onChange(targets: readonly ForkTarget[]): void }) {
	return (
		<div class='fork-migration-targets'>
			<div class='fork-question-summary'>
				<span>{context.kind === 'scalar' ? forkCopy.scalarForkQuestion : forkCopy.categoricalForkQuestion}</span>
				<strong>{context.title}</strong>
			</div>
			<p class='fork-target-count' role='status'>
				{forkCopy.selectedTargetCount(selectedTargets.length)}
			</p>
			{context.kind === 'categorical' ? <CategoricalTargets context={context} selectedTargets={selectedTargets} disabled={disabled} onChange={onChange} /> : <ScalarTargets context={context} selectedTargets={selectedTargets} disabled={disabled} onChange={onChange} />}
			<SelectedTargets selectedTargets={selectedTargets} disabled={disabled} onChange={onChange} />
		</div>
	)
}
