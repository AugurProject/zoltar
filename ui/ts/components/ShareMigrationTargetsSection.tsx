import type { ComponentChildren } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { OutcomeSelectionList } from './OutcomeSelectionList.js'
import { ScalarOutcomePicker } from './ScalarOutcomePicker.js'
import { WorkflowSubsection } from './WorkflowSubsection.js'
import { clampScalarTickIndex, formatScalarOutcomeIndexLabel, formatScalarOutcomeLabel, getScalarOutcomeIndex, getScalarOutcomeIndexDescriptor } from '../lib/scalarOutcome.js'
import {
	UI_STRING_ADD_TARGET,
	UI_STRING_CHILD_DEPLOYED,
	UI_STRING_CHILD_NOT_DEPLOYED,
	UI_STRING_CHILD_UNIVERSE_TARGETS_UNLOCK_AFTER_THIS_UNIVERSE_FORKS,
	UI_STRING_CLEAR,
	UI_STRING_INVALID,
	UI_STRING_LOADING_FORK_QUESTION_DETAILS,
	UI_STRING_LOADING_FORK_TARGET_UNIVERSES,
	UI_STRING_LOADING_SCALAR_FORK_DETAILS,
	UI_STRING_NO_TARGET_CHILD_UNIVERSES_AVAILABLE,
	UI_STRING_NOT_SELECTED,
	UI_STRING_REMOVE_TARGET,
	UI_STRING_SELECT_ALL,
	UI_STRING_SELECT_AT_LEAST_ONE_SCALAR_TARGET_UNIVERSE,
	UI_STRING_SELECT_SCALAR_TARGET,
	UI_STRING_SELECTED,
	UI_STRING_TARGET_CHILD_UNIVERSES,
	UI_TEMPLATE_MALFORMED_OUTCOME_LABEL,
	UI_TEMPLATE_SELECTED_TICK_LABEL,
} from '../lib/uiStrings.js'
import type { MarketDetails, ZoltarChildUniverseSummary, ZoltarUniverseSummary } from '../types/contracts.js'

type ShareMigrationTargetsSectionProps = {
	disabled: boolean
	forkUniverse: ZoltarUniverseSummary | undefined
	onClearOutcomeIndexes: () => void
	onSelectAllOutcomeIndexes: () => void
	onToggleOutcomeIndex: (outcomeIndex: bigint) => void
	selectedOutcomeIndexes: bigint[]
	selectedOutcomeIndexSet: Set<string>
}

type TargetOutcomePresentation = {
	exists: boolean
	label: string
	outcomeIndex: bigint
}

function getTargetOutcomeBadgeLabel(target: TargetOutcomePresentation) {
	return target.exists ? UI_STRING_CHILD_DEPLOYED : UI_STRING_CHILD_NOT_DEPLOYED
}

function renderTargetOutcomeRow(target: TargetOutcomePresentation, selected: boolean, disabled: boolean, onToggleOutcomeIndex: (outcomeIndex: bigint) => void) {
	return {
		details: (
			<>
				<span>
					<strong>{selected ? UI_STRING_SELECTED : UI_STRING_NOT_SELECTED}</strong>
				</span>
				<span>
					<strong>{getTargetOutcomeBadgeLabel(target)}</strong>
				</span>
			</>
		),
		disabled,
		key: target.outcomeIndex.toString(),
		label: target.label,
		onSelect: () => onToggleOutcomeIndex(target.outcomeIndex),
		selected,
	}
}

function getScalarSelectedTargetOutcomes(childUniverseByOutcomeIndex: Map<string, ZoltarChildUniverseSummary>, scalarQuestion: MarketDetails, selectedOutcomeIndexes: bigint[]) {
	return selectedOutcomeIndexes.map(outcomeIndex => {
		const childUniverse = childUniverseByOutcomeIndex.get(outcomeIndex.toString())
		const descriptor = getScalarOutcomeIndexDescriptor(scalarQuestion, outcomeIndex)
		const label = childUniverse?.outcomeLabel ?? (descriptor.kind === 'malformed' ? UI_TEMPLATE_MALFORMED_OUTCOME_LABEL(outcomeIndex.toString()) : formatScalarOutcomeIndexLabel(scalarQuestion, outcomeIndex))
		return {
			exists: childUniverse?.exists === true,
			label,
			outcomeIndex,
		} satisfies TargetOutcomePresentation
	})
}

function renderTargetSection(title: string, children: ComponentChildren, actions?: ComponentChildren) {
	return (
		<WorkflowSubsection badge={actions} className='share-migration-targets-section' title={title}>
			{children}
		</WorkflowSubsection>
	)
}

export function ShareMigrationTargetsSection({ disabled, forkUniverse, onClearOutcomeIndexes, onSelectAllOutcomeIndexes, onToggleOutcomeIndex, selectedOutcomeIndexes, selectedOutcomeIndexSet }: ShareMigrationTargetsSectionProps) {
	const [scalarOutcomeTick, setScalarOutcomeTick] = useState('0')
	const [scalarOutcomeInvalid, setScalarOutcomeInvalid] = useState(false)
	const childUniverseByOutcomeIndex = useMemo(() => new Map((forkUniverse?.childUniverses ?? []).map(child => [child.outcomeIndex.toString(), child])), [forkUniverse?.childUniverses])
	const scalarQuestion = forkUniverse?.forkQuestionDetails !== undefined && forkUniverse.forkQuestionDetails.marketType === 'scalar' ? forkUniverse.forkQuestionDetails : undefined
	const selectedScalarTick = BigInt(scalarOutcomeTick)

	useEffect(() => {
		if (scalarQuestion === undefined) return
		const nextTick = clampScalarTickIndex(selectedScalarTick, scalarQuestion.numTicks).toString()
		if (nextTick === scalarOutcomeTick) return
		setScalarOutcomeTick(nextTick)
	}, [scalarOutcomeTick, scalarQuestion, selectedScalarTick])

	if (forkUniverse === undefined) return renderTargetSection(UI_STRING_TARGET_CHILD_UNIVERSES, <p className='detail'>{UI_STRING_LOADING_FORK_TARGET_UNIVERSES}</p>)

	if (!forkUniverse.hasForked) return renderTargetSection(UI_STRING_TARGET_CHILD_UNIVERSES, <p className='detail'>{UI_STRING_CHILD_UNIVERSE_TARGETS_UNLOCK_AFTER_THIS_UNIVERSE_FORKS}</p>)

	if (forkUniverse.forkQuestionDetails === undefined) return renderTargetSection(UI_STRING_TARGET_CHILD_UNIVERSES, <p className='detail'>{UI_STRING_LOADING_FORK_QUESTION_DETAILS}</p>)

	if (forkUniverse.forkQuestionDetails.marketType !== 'scalar') {
		const childUniverses = forkUniverse.childUniverses.map(child => ({
			exists: child.exists,
			label: child.outcomeLabel,
			outcomeIndex: child.outcomeIndex,
		}))
		const hasSelectableTargets = childUniverses.length > 0

		return renderTargetSection(
			UI_STRING_TARGET_CHILD_UNIVERSES,
			<OutcomeSelectionList emptyMessage={UI_STRING_NO_TARGET_CHILD_UNIVERSES_AVAILABLE} items={childUniverses.map(target => renderTargetOutcomeRow(target, selectedOutcomeIndexSet.has(target.outcomeIndex.toString()), disabled, onToggleOutcomeIndex))} />,
			<div className='actions'>
				<button className='quiet' type='button' onClick={onSelectAllOutcomeIndexes} disabled={disabled || !hasSelectableTargets}>
					{UI_STRING_SELECT_ALL}
				</button>
				<button className='quiet' type='button' onClick={onClearOutcomeIndexes} disabled={disabled || selectedOutcomeIndexes.length === 0}>
					{UI_STRING_CLEAR}
				</button>
			</div>,
		)
	}

	if (scalarQuestion === undefined) return renderTargetSection(UI_STRING_TARGET_CHILD_UNIVERSES, <p className='detail'>{UI_STRING_LOADING_SCALAR_FORK_DETAILS}</p>)

	const clampedSelectedScalarTick = clampScalarTickIndex(selectedScalarTick, scalarQuestion.numTicks)
	const clampedScalarOutcomeTick = clampedSelectedScalarTick.toString()
	const candidateOutcomeIndex = scalarOutcomeInvalid ? 0n : getScalarOutcomeIndex(scalarQuestion, clampedSelectedScalarTick)
	const candidateOutcomeLabel = scalarOutcomeInvalid ? UI_STRING_INVALID : formatScalarOutcomeLabel(scalarQuestion, clampedSelectedScalarTick)
	const candidateSelected = selectedOutcomeIndexSet.has(candidateOutcomeIndex.toString())
	const selectedTargetOutcomes = getScalarSelectedTargetOutcomes(childUniverseByOutcomeIndex, scalarQuestion, selectedOutcomeIndexes)

	return renderTargetSection(
		UI_STRING_TARGET_CHILD_UNIVERSES,
		<>
			<OutcomeSelectionList emptyMessage={UI_STRING_SELECT_AT_LEAST_ONE_SCALAR_TARGET_UNIVERSE} items={selectedTargetOutcomes.map(target => renderTargetOutcomeRow(target, true, disabled, onToggleOutcomeIndex))} />
			<ScalarOutcomePicker
				action={
					<button className='secondary' type='button' onClick={() => onToggleOutcomeIndex(candidateOutcomeIndex)} disabled={disabled}>
						{candidateSelected ? UI_STRING_REMOVE_TARGET : UI_STRING_ADD_TARGET}
					</button>
				}
				details={{
					maxValueLabel: formatScalarOutcomeLabel(scalarQuestion, scalarQuestion.numTicks),
					minValueLabel: formatScalarOutcomeLabel(scalarQuestion, 0n),
					numTicks: scalarQuestion.numTicks,
				}}
				disabled={disabled}
				isInvalid={scalarOutcomeInvalid}
				label={UI_STRING_SELECT_SCALAR_TARGET}
				onInvalidChange={setScalarOutcomeInvalid}
				onSelectedTickChange={setScalarOutcomeTick}
				selectedOutcomeLabel={candidateOutcomeLabel}
				selectedTick={clampedScalarOutcomeTick}
				selectedTickLabel={scalarOutcomeInvalid ? UI_STRING_INVALID : UI_TEMPLATE_SELECTED_TICK_LABEL(clampedScalarOutcomeTick, scalarQuestion.numTicks.toString())}
			/>
		</>,
		<button className='quiet' type='button' onClick={onClearOutcomeIndexes} disabled={disabled || selectedOutcomeIndexes.length === 0}>
			{UI_STRING_CLEAR}
		</button>,
	)
}
