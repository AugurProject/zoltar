import type { ComponentChildren } from 'preact'
import { useMemo, useState } from 'preact/hooks'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as forkTargetCopy from '../../../copy/forkTargets.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { OutcomeSelectionList } from '@zoltar/ui-core-shared/components/OutcomeSelectionList.js'
import { ScalarOutcomePicker } from '@zoltar/ui-core-shared/components/ScalarOutcomePicker.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import { formatScalarOutcomeLabel, getScalarOutcomeIndex } from '@zoltar/ui-core-shared/lib/scalarOutcome.js'
import { normalizeNumericInput } from '@zoltar/ui-core-shared/lib/numericInput.js'
import type { ScalarQuestionDetails } from '@zoltar/zoltar-shared/questions/scalarOutcome'

/** One child universe a migration can target, with the application's own deployment status for it. */
export type ForkTargetOption = Readonly<{
	label: string
	outcomeIndex: bigint
	status: Readonly<{ label: string; tone: 'ok' | 'warning' }>
}>

type ForkTargetQuestion =
	| Readonly<{ kind: 'categorical'; targets: readonly ForkTargetOption[] }>
	| Readonly<{
			kind: 'scalar'
			/** Child universes that already exist; rendered as shortcuts under the tick picker. */
			deployedTargets: readonly ForkTargetOption[]
			details: ScalarQuestionDetails
			/** Resolves any outcome index the picker produces (including undeployed ticks and Invalid) to its presentation. */
			resolveTarget: (outcomeIndex: bigint) => ForkTargetOption
	  }>

type ForkTargetPickerProps = {
	/** Header actions such as select all and clear. */
	actions?: ComponentChildren
	disabled: boolean
	onToggle: (outcomeIndex: bigint) => void
	question: ForkTargetQuestion
	selectedOutcomeIndexes: readonly bigint[]
	/** Content above the targets, such as the fork question the targets belong to. */
	summary?: ComponentChildren
	title: string
}

/** A row in a mixed list marks selection with a badge; a list that only holds selected targets does not repeat it. */
function renderTargetRow(target: ForkTargetOption, selected: boolean, disabled: boolean, onToggle: (outcomeIndex: bigint) => void, { selectedOnlyList = false } = {}) {
	return {
		details: (
			<>
				{selected && !selectedOnlyList ? <Badge>{commonCopy.selected}</Badge> : undefined}
				<Badge tone={target.status.tone}>{target.status.label}</Badge>
			</>
		),
		disabled,
		key: target.outcomeIndex.toString(),
		label: target.label,
		onSelect: () => onToggle(target.outcomeIndex),
		selected,
	}
}

function ScalarTargets({ disabled, onToggle, question, selectedOutcomeIndexes, selectedSet }: { disabled: boolean; onToggle: (outcomeIndex: bigint) => void; question: Extract<ForkTargetQuestion, { kind: 'scalar' }>; selectedOutcomeIndexes: readonly bigint[]; selectedSet: ReadonlySet<string> }) {
	const [tickInput, setTickInput] = useState('0')
	const [invalid, setInvalid] = useState(false)
	const { details } = question
	// The exact tick input is never clamped: an out-of-range tick is reported instead of silently moved.
	const tick = useMemo(() => {
		const normalized = normalizeNumericInput(tickInput)
		if (!/^\d+$/.test(normalized)) return undefined
		const parsedTick = BigInt(normalized)
		return parsedTick <= details.numTicks ? parsedTick : undefined
	}, [details.numTicks, tickInput])
	let candidateOutcomeIndex: bigint | undefined
	if (invalid) candidateOutcomeIndex = 0n
	else if (tick !== undefined) candidateOutcomeIndex = getScalarOutcomeIndex(details, tick)
	const candidate = candidateOutcomeIndex === undefined ? undefined : question.resolveTarget(candidateOutcomeIndex)
	const candidateSelected = candidate !== undefined && selectedSet.has(candidate.outcomeIndex.toString())
	let candidateLabel = forkTargetCopy.exactTickPrompt
	if (invalid) candidateLabel = commonCopy.invalid
	else if (tick !== undefined) candidateLabel = formatScalarOutcomeLabel(details, tick)
	let selectedTickLabel = forkTargetCopy.exactTickPrompt
	if (invalid) selectedTickLabel = commonCopy.invalid
	else if (tick !== undefined) selectedTickLabel = commonCopy.formatSelectedTickLabel(tick.toString(), details.numTicks.toString())

	return (
		<div className='fork-target-scalar-picker'>
			<OutcomeSelectionList className='fork-target-selection' emptyMessage={forkTargetCopy.noTargetsSelected} items={selectedOutcomeIndexes.map(outcomeIndex => renderTargetRow(question.resolveTarget(outcomeIndex), true, disabled, onToggle, { selectedOnlyList: true }))} />
			<ScalarOutcomePicker
				action={
					<button type='button' className='secondary' disabled={disabled || candidate === undefined} onClick={() => candidate === undefined || onToggle(candidate.outcomeIndex)}>
						{candidateSelected ? forkTargetCopy.removeTarget : forkTargetCopy.addTarget}
					</button>
				}
				clampExactTickInput={false}
				details={{ answerUnit: details.answerUnit, displayValueMax: details.displayValueMax, displayValueMin: details.displayValueMin, maxValueLabel: formatScalarOutcomeLabel(details, details.numTicks), minValueLabel: formatScalarOutcomeLabel(details, 0n), numTicks: details.numTicks }}
				disabled={disabled}
				isInvalid={invalid}
				label={forkTargetCopy.selectScalarTarget}
				onInvalidChange={setInvalid}
				onSelectedTickChange={setTickInput}
				selectedOutcomeLabel={candidateLabel}
				selectedTick={tickInput}
				selectedTickLabel={selectedTickLabel}
			/>
			{question.deployedTargets.length === 0 ? undefined : (
				<div className='fork-target-shortcuts'>
					<span>{forkTargetCopy.deployedScalarChildren}</span>
					{question.deployedTargets.map(target => (
						<button key={target.outcomeIndex.toString()} type='button' className='quiet fork-target-shortcut' aria-pressed={selectedSet.has(target.outcomeIndex.toString())} disabled={disabled} onClick={() => onToggle(target.outcomeIndex)}>
							{target.label}
						</button>
					))}
				</div>
			)}
		</div>
	)
}

/** Chooses the child universes a fork migration targets: a categorical list, or a scalar tick picker with the chosen ticks listed above it. */
export function ForkTargetPicker({ actions, disabled, onToggle, question, selectedOutcomeIndexes, summary, title }: ForkTargetPickerProps) {
	const selectedSet = useMemo(() => new Set(selectedOutcomeIndexes.map(outcomeIndex => outcomeIndex.toString())), [selectedOutcomeIndexes])
	return (
		<WorkflowSubsection badge={actions} className='fork-target-picker' title={title}>
			{summary}
			<p className='fork-target-count' role='status'>
				{forkTargetCopy.selectedTargetCount(selectedOutcomeIndexes.length)}
			</p>
			{question.kind === 'categorical' ? (
				<OutcomeSelectionList emptyMessage={forkTargetCopy.noTargetsAvailable} items={question.targets.map(target => renderTargetRow(target, selectedSet.has(target.outcomeIndex.toString()), disabled, onToggle))} />
			) : (
				<ScalarTargets disabled={disabled} onToggle={onToggle} question={question} selectedOutcomeIndexes={selectedOutcomeIndexes} selectedSet={selectedSet} />
			)}
		</WorkflowSubsection>
	)
}
