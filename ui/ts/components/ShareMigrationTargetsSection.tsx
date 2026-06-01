import type { ComponentChildren } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { OutcomeSelectionList } from './OutcomeSelectionList.js'
import { ScalarOutcomePicker } from './ScalarOutcomePicker.js'
import { WorkflowSubsection } from './WorkflowSubsection.js'
import { clampScalarTickIndex, formatScalarOutcomeIndexLabel, formatScalarOutcomeLabel, getScalarOutcomeIndex } from '../lib/scalarOutcome.js'
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
	return target.exists ? 'Child deployed' : 'Child not deployed'
}

function renderTargetOutcomeRow(target: TargetOutcomePresentation, selected: boolean, disabled: boolean, onToggleOutcomeIndex: (outcomeIndex: bigint) => void) {
	return {
		details: (
			<>
				<span>
					<strong>{selected ? 'Selected' : 'Not selected'}</strong>
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
		let label = childUniverse?.outcomeLabel
		if (label === undefined)
			try {
				label = formatScalarOutcomeIndexLabel(scalarQuestion, outcomeIndex)
			} catch (_error) {
				label = `Malformed (${outcomeIndex.toString()})`
			}
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

	if (forkUniverse === undefined) return renderTargetSection('Target Child Universes', <p className='detail'>Loading fork target universes...</p>)

	if (!forkUniverse.hasForked) return renderTargetSection('Target Child Universes', <p className='detail'>Child-universe targets unlock after this universe forks.</p>)

	if (forkUniverse.forkQuestionDetails === undefined) return renderTargetSection('Target Child Universes', <p className='detail'>Loading fork question details...</p>)

	if (forkUniverse.forkQuestionDetails.marketType !== 'scalar') {
		const childUniverses = forkUniverse.childUniverses.map(child => ({
			exists: child.exists,
			label: child.outcomeLabel,
			outcomeIndex: child.outcomeIndex,
		}))
		const hasSelectableTargets = childUniverses.length > 0

		return renderTargetSection(
			'Target Child Universes',
			<OutcomeSelectionList emptyMessage='No target child universes available.' items={childUniverses.map(target => renderTargetOutcomeRow(target, selectedOutcomeIndexSet.has(target.outcomeIndex.toString()), disabled, onToggleOutcomeIndex))} />,
			<div className='actions'>
				<button className='quiet' type='button' onClick={onSelectAllOutcomeIndexes} disabled={disabled || !hasSelectableTargets}>
					Select all
				</button>
				<button className='quiet' type='button' onClick={onClearOutcomeIndexes} disabled={disabled || selectedOutcomeIndexes.length === 0}>
					Clear
				</button>
			</div>,
		)
	}

	if (scalarQuestion === undefined) return renderTargetSection('Target Child Universes', <p className='detail'>Loading scalar fork details...</p>)

	const clampedSelectedScalarTick = clampScalarTickIndex(selectedScalarTick, scalarQuestion.numTicks)
	const clampedScalarOutcomeTick = clampedSelectedScalarTick.toString()
	const candidateOutcomeIndex = scalarOutcomeInvalid ? 0n : getScalarOutcomeIndex(scalarQuestion, clampedSelectedScalarTick)
	const candidateOutcomeLabel = scalarOutcomeInvalid ? 'Invalid' : formatScalarOutcomeLabel(scalarQuestion, clampedSelectedScalarTick)
	const candidateSelected = selectedOutcomeIndexSet.has(candidateOutcomeIndex.toString())
	const selectedTargetOutcomes = getScalarSelectedTargetOutcomes(childUniverseByOutcomeIndex, scalarQuestion, selectedOutcomeIndexes)

	return renderTargetSection(
		'Target Child Universes',
		<>
			<OutcomeSelectionList emptyMessage='Select at least one scalar target universe.' items={selectedTargetOutcomes.map(target => renderTargetOutcomeRow(target, true, disabled, onToggleOutcomeIndex))} />
			<ScalarOutcomePicker
				action={
					<button className='secondary' type='button' onClick={() => onToggleOutcomeIndex(candidateOutcomeIndex)} disabled={disabled}>
						{candidateSelected ? 'Remove Target' : 'Add Target'}
					</button>
				}
				details={{
					maxValueLabel: formatScalarOutcomeLabel(scalarQuestion, scalarQuestion.numTicks),
					minValueLabel: formatScalarOutcomeLabel(scalarQuestion, 0n),
					numTicks: scalarQuestion.numTicks,
				}}
				disabled={disabled}
				isInvalid={scalarOutcomeInvalid}
				label='Select Scalar Target'
				onInvalidChange={setScalarOutcomeInvalid}
				onSelectedTickChange={setScalarOutcomeTick}
				selectedOutcomeLabel={candidateOutcomeLabel}
				selectedTick={clampedScalarOutcomeTick}
				selectedTickLabel={scalarOutcomeInvalid ? 'Invalid' : `${clampedScalarOutcomeTick} / ${scalarQuestion.numTicks.toString()}`}
			/>
		</>,
		<button className='quiet' type='button' onClick={onClearOutcomeIndexes} disabled={disabled || selectedOutcomeIndexes.length === 0}>
			Clear
		</button>,
	)
}
