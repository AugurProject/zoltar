import { formatScalarOutcomeLabel, getScalarOutcomeIndex, MAX_PRECISE_SCALAR_TICK_COUNT } from '@zoltar/shared/scalarOutcome'
import { useMemo, useState } from 'preact/hooks'
import { createScalarForkTarget, type ForkMigrationContext, type ForkTarget } from '../protocol/forks.ts'

export type { ForkMigrationContext, ForkTarget } from '../protocol/forks.ts'

function sameTarget(left: ForkTarget, right: ForkTarget) {
	return left.outcomeIndex === right.outcomeIndex
}

function toggleTarget(selectedTargets: readonly ForkTarget[], target: ForkTarget) {
	return selectedTargets.some(selected => sameTarget(selected, target)) ? selectedTargets.filter(selected => !sameTarget(selected, target)) : [...selectedTargets, target]
}

function TargetStatus({ target }: { target: ForkTarget }) {
	return <span class={`fork-target-status fork-target-status--${target.canonicalPool === undefined ? 'missing' : 'ready'}`}>{target.canonicalPool === undefined ? 'Child pool missing' : 'Child pool ready'}</span>
}

function SelectedTargets({ selectedTargets, disabled, onChange }: { selectedTargets: readonly ForkTarget[]; disabled: boolean; onChange(targets: readonly ForkTarget[]): void }) {
	if (selectedTargets.length === 0) return <p class='muted'>No child branches selected.</p>
	return (
		<ul class='fork-target-selection' aria-label='Selected fork targets'>
			{selectedTargets.map(target => (
				<li key={target.outcomeIndex.toString()}>
					<div>
						<strong>{target.label}</strong>
						<TargetStatus target={target} />
					</div>
					<button type='button' class='quiet-action' disabled={disabled} aria-label={`Remove target ${target.label}`} onClick={() => onChange(toggleTarget(selectedTargets, target))}>
						Remove target
					</button>
				</li>
			))}
		</ul>
	)
}

function CategoricalTargets({ context, selectedTargets, disabled, onChange }: { context: Extract<ForkMigrationContext, { kind: 'categorical' }>; selectedTargets: readonly ForkTarget[]; disabled: boolean; onChange(targets: readonly ForkTarget[]): void }) {
	return (
		<div class='fork-target-grid'>
			{context.availableTargets.map(target => {
				const selected = selectedTargets.some(candidate => sameTarget(candidate, target))
				return (
					<label class={`fork-target-option${selected ? ' fork-target-option--selected' : ''}`} key={target.outcomeIndex.toString()}>
						<input type='checkbox' checked={selected} disabled={disabled} aria-label={`${target.label} fork branch`} onChange={() => onChange(toggleTarget(selectedTargets, target))} />
						<span>
							<strong>{target.label}</strong>
							<TargetStatus target={target} />
						</span>
					</label>
				)
			})}
		</div>
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
	let candidateLabel = 'Enter an exact tick'
	if (invalid) candidateLabel = 'Invalid'
	else if (tick !== undefined) candidateLabel = formatScalarOutcomeLabel(context, tick)
	const inputType = context.numTicks <= MAX_PRECISE_SCALAR_TICK_COUNT ? 'range' : 'text'

	return (
		<div class='scalar-fork-picker'>
			<label class='field'>
				<span>Scalar fork tick</span>
				<input
					type={inputType}
					inputMode='numeric'
					min={inputType === 'range' ? '0' : undefined}
					max={inputType === 'range' ? context.numTicks.toString() : undefined}
					step={inputType === 'range' ? '1' : undefined}
					value={tickInput}
					disabled={disabled || invalid}
					onInput={event => setTickInput(event.currentTarget.value)}
				/>
			</label>
			<label class='fork-invalid-option'>
				<input type='checkbox' checked={invalid} disabled={disabled} aria-label='Invalid fork outcome' onChange={event => setInvalid(event.currentTarget.checked)} />
				<span>Invalid fork outcome</span>
			</label>
			<div class='fork-scalar-preview' aria-live='polite'>
				<span>{candidateSelected ? 'Selected branch' : 'Branch to add'}</span>
				<strong>{candidateLabel}</strong>
				{tick === undefined || invalid ? null : (
					<small>
						Tick {tick.toString()} of {context.numTicks.toString()}
					</small>
				)}
			</div>
			<button type='button' class='secondary-action' disabled={disabled || candidate === undefined} onClick={() => candidate === undefined || onChange(toggleTarget(selectedTargets, candidate))}>
				{candidateSelected ? 'Remove scalar target' : 'Add scalar target'}
			</button>
			{context.availableTargets.length === 0 ? null : (
				<div class='fork-deployed-targets'>
					<span>Deployed scalar children</span>
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
				<span>{context.kind === 'scalar' ? 'Scalar fork question' : 'Categorical fork question'}</span>
				<strong>{context.title}</strong>
			</div>
			<p class='fork-target-count' role='status'>
				{selectedTargets.length === 1 ? '1 target selected' : `${selectedTargets.length.toString()} targets selected`}
			</p>
			{context.kind === 'categorical' ? <CategoricalTargets context={context} selectedTargets={selectedTargets} disabled={disabled} onChange={onChange} /> : <ScalarTargets context={context} selectedTargets={selectedTargets} disabled={disabled} onChange={onChange} />}
			<SelectedTargets selectedTargets={selectedTargets} disabled={disabled} onChange={onChange} />
		</div>
	)
}
