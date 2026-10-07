import type { ComponentChildren } from 'preact'
import { useId, useMemo, useState } from 'preact/hooks'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as forkTargetCopy from '../../../copy/forkTargets.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { OutcomeSelectionList } from '@zoltar/ui-core-shared/components/OutcomeSelectionList.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { ScalarOutcomePicker } from '@zoltar/ui-core-shared/components/ScalarOutcomePicker.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import { formatScalarOutcomeLabel, getScalarOutcomeIndex } from '@zoltar/ui-core-shared/lib/scalarOutcome.js'
import { normalizeNumericInput } from '@zoltar/ui-core-shared/lib/numericInput.js'
import type { ScalarQuestionDetails } from '@zoltar/zoltar-shared/questions/scalarOutcome'

/** One child universe a migration can target, with the application's own deployment status for it. */
export type ForkTargetOption = Readonly<{
	/**
	 * Why this target cannot be chosen, such as a child universe the holder already migrated to. The row and its scalar shortcut
	 * stay visible but disabled, with this reason shown beside them and announced as their description; a selected row can still
	 * be removed.
	 */
	disabledReason?: string | undefined
	label: string
	outcomeIndex: bigint
	status: Readonly<{ label: string; tone: 'ok' | 'warning' }>
}>

/** A target with a reason is unavailable to add; one already selected stays removable so a stale selection never gets stuck. */
function isTargetBlocked(target: ForkTargetOption, selected: boolean) {
	return target.disabledReason !== undefined && !selected
}

function getTargetReasonId(idPrefix: string, target: ForkTargetOption) {
	return `${idPrefix}-${target.outcomeIndex.toString()}`
}

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
}

/** A row in a mixed list marks selection with a badge; a list that only holds selected targets does not repeat it. */
function renderTargetRow(target: ForkTargetOption, selected: boolean, disabled: boolean, onToggle: (outcomeIndex: bigint) => void, idPrefix: string, { selectedOnlyList = false } = {}) {
	const reasonId = getTargetReasonId(idPrefix, target)
	return {
		...(target.disabledReason === undefined ? {} : { describedById: reasonId }),
		details: (
			<>
				{selected && !selectedOnlyList ? <Badge>{commonCopy.selected}</Badge> : undefined}
				<Badge tone={target.status.tone}>{target.status.label}</Badge>
				{target.disabledReason === undefined ? undefined : <UserMessage placement='field' as='span' id={reasonId} detail={target.disabledReason} />}
			</>
		),
		disabled: disabled || isTargetBlocked(target, selected),
		key: target.outcomeIndex.toString(),
		label: target.label,
		onSelect: () => onToggle(target.outcomeIndex),
		selected,
	}
}

function ScalarTargets({
	disabled,
	idPrefix,
	onToggle,
	question,
	selectedOutcomeIndexes,
	selectedSet,
}: {
	disabled: boolean
	idPrefix: string
	onToggle: (outcomeIndex: bigint) => void
	question: Extract<ForkTargetQuestion, { kind: 'scalar' }>
	selectedOutcomeIndexes: readonly bigint[]
	selectedSet: ReadonlySet<string>
}) {
	const [tickInput, setTickInput] = useState('0')
	const [invalid, setInvalid] = useState(false)
	const { details } = question
	// An invalid human value clears the candidate instead of selecting another outcome.
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
	const candidateBlocked = candidate !== undefined && isTargetBlocked(candidate, candidateSelected)
	const candidateReasonId = `${idPrefix}-candidate`
	const blockedShortcuts = question.deployedTargets.filter(target => isTargetBlocked(target, selectedSet.has(target.outcomeIndex.toString())))
	let candidateLabel = forkTargetCopy.scalarValuePrompt
	if (invalid) candidateLabel = commonCopy.invalid
	else if (tick !== undefined) candidateLabel = formatScalarOutcomeLabel(details, tick)

	return (
		<div className='fork-target-scalar-picker'>
			<OutcomeSelectionList className='fork-target-selection' emptyMessage={forkTargetCopy.noTargetsSelected} items={selectedOutcomeIndexes.map(outcomeIndex => renderTargetRow(question.resolveTarget(outcomeIndex), true, disabled, onToggle, `${idPrefix}-selected`, { selectedOnlyList: true }))} />
			<ScalarOutcomePicker
				action={
					<button type='button' className='secondary' aria-describedby={candidateBlocked ? candidateReasonId : undefined} disabled={disabled || candidate === undefined || candidateBlocked} onClick={() => candidate === undefined || candidateBlocked || onToggle(candidate.outcomeIndex)}>
						{candidateSelected ? forkTargetCopy.removeTarget : forkTargetCopy.addTarget}
					</button>
				}
				details={{ answerUnit: details.answerUnit, displayValueMax: details.displayValueMax, displayValueMin: details.displayValueMin, maxValueLabel: formatScalarOutcomeLabel(details, details.numTicks), minValueLabel: formatScalarOutcomeLabel(details, 0n), numTicks: details.numTicks }}
				disabled={disabled}
				isInvalid={invalid}
				label={forkTargetCopy.selectScalarTarget}
				onInvalidChange={setInvalid}
				onSelectedTickChange={setTickInput}
				selectedOutcomeLabel={candidateLabel}
				selectedTick={tickInput}
			/>
			{candidate?.disabledReason === undefined || !candidateBlocked ? undefined : <UserMessage placement='field' id={candidateReasonId} detail={candidate.disabledReason} />}
			{question.deployedTargets.length === 0 ? undefined : (
				<div className='fork-target-shortcuts'>
					<span>{forkTargetCopy.deployedScalarChildren}</span>
					{question.deployedTargets.map(target => {
						const blocked = isTargetBlocked(target, selectedSet.has(target.outcomeIndex.toString()))
						return (
							<button
								key={target.outcomeIndex.toString()}
								type='button'
								className='quiet fork-target-shortcut'
								aria-describedby={blocked ? getTargetReasonId(`${idPrefix}-shortcut`, target) : undefined}
								aria-pressed={selectedSet.has(target.outcomeIndex.toString())}
								disabled={disabled || blocked}
								onClick={() => blocked || onToggle(target.outcomeIndex)}
							>
								{target.label}
							</button>
						)
					})}
				</div>
			)}
			{/* A disabled shortcut cannot show a tooltip on touch, so each one's reason is listed as text it references. */}
			{blockedShortcuts.map(target => (target.disabledReason === undefined ? undefined : <UserMessage key={target.outcomeIndex.toString()} placement='field' id={getTargetReasonId(`${idPrefix}-shortcut`, target)} detail={forkTargetCopy.formatTargetUnavailable(target.label, target.disabledReason)} />))}
		</div>
	)
}

/** Chooses the child universes a fork migration targets: a categorical list, or a scalar tick picker with the chosen ticks listed above it. */
export function ForkTargetPicker({ actions, disabled, onToggle, question, selectedOutcomeIndexes, summary }: ForkTargetPickerProps) {
	const selectedSet = useMemo(() => new Set(selectedOutcomeIndexes.map(outcomeIndex => outcomeIndex.toString())), [selectedOutcomeIndexes])
	const idPrefix = useId()
	return (
		<WorkflowSubsection badge={actions} className='fork-target-picker' title={forkTargetCopy.targetChildUniverses}>
			{summary}
			<p className='fork-target-count' role='status'>
				{forkTargetCopy.formatSelectedTargetCount(selectedOutcomeIndexes.length)}
			</p>
			{question.kind === 'categorical' ? (
				<OutcomeSelectionList emptyMessage={forkTargetCopy.noTargetsAvailable} items={question.targets.map(target => renderTargetRow(target, selectedSet.has(target.outcomeIndex.toString()), disabled, onToggle, idPrefix))} />
			) : (
				<ScalarTargets disabled={disabled} idPrefix={idPrefix} onToggle={onToggle} question={question} selectedOutcomeIndexes={selectedOutcomeIndexes} selectedSet={selectedSet} />
			)}
		</WorkflowSubsection>
	)
}
