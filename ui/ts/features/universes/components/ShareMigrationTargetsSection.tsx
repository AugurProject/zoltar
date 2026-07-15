import * as commonCopy from '../../../copy/common.js'
import * as tradingCopy from '../../../copy/trading.js'
import type { ComponentChildren } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { OutcomeSelectionList } from '../../markets/components/OutcomeSelectionList.js'
import { ScalarOutcomePicker } from '../../markets/components/ScalarOutcomePicker.js'
import { WorkflowSubsection } from '../../../components/WorkflowSubsection.js'
import { clampScalarTickIndex, formatScalarOutcomeIndexLabel, formatScalarOutcomeLabel, getScalarOutcomeIndex, getScalarOutcomeIndexDescriptor } from '../../markets/lib/scalarOutcome.js'
import type { MarketDetails, ZoltarChildUniverseSummary, ZoltarUniverseSummary } from '../../../types/contracts.js'

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
	return target.exists ? tradingCopy.childDeployed : tradingCopy.childNotDeployed
}

function renderTargetOutcomeRow(target: TargetOutcomePresentation, selected: boolean, disabled: boolean, onToggleOutcomeIndex: (outcomeIndex: bigint) => void) {
	return {
		details: (
			<>
				<span>
					<strong>{selected ? commonCopy.selected : tradingCopy.notSelected}</strong>
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
		const label = childUniverse?.outcomeLabel ?? (descriptor.kind === 'malformed' ? tradingCopy.formatMalformedOutcomeLabel(outcomeIndex.toString()) : formatScalarOutcomeIndexLabel(scalarQuestion, outcomeIndex))
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

	if (forkUniverse === undefined) return renderTargetSection(tradingCopy.targetChildUniverses, <p className='detail'>{tradingCopy.loadingForkTargetUniverses}</p>)

	if (!forkUniverse.hasForked) return renderTargetSection(tradingCopy.targetChildUniverses, <p className='detail'>{tradingCopy.childTargetsLockedReason}</p>)

	if (forkUniverse.forkQuestionDetails === undefined) return renderTargetSection(tradingCopy.targetChildUniverses, <p className='detail'>{tradingCopy.loadingForkQuestionDetails}</p>)

	if (forkUniverse.forkQuestionDetails.marketType !== 'scalar') {
		const childUniverses = forkUniverse.childUniverses.map(child => ({
			exists: child.exists,
			label: child.outcomeLabel,
			outcomeIndex: child.outcomeIndex,
		}))
		const hasSelectableTargets = childUniverses.length > 0

		return renderTargetSection(
			tradingCopy.targetChildUniverses,
			<OutcomeSelectionList emptyMessage={tradingCopy.targetChildUniversesEmpty} items={childUniverses.map(target => renderTargetOutcomeRow(target, selectedOutcomeIndexSet.has(target.outcomeIndex.toString()), disabled, onToggleOutcomeIndex))} />,
			<div className='actions'>
				<button className='quiet' type='button' onClick={onSelectAllOutcomeIndexes} disabled={disabled || !hasSelectableTargets}>
					{tradingCopy.selectAll}
				</button>
				<button className='quiet' type='button' onClick={onClearOutcomeIndexes} disabled={disabled || selectedOutcomeIndexes.length === 0}>
					{tradingCopy.clear}
				</button>
			</div>,
		)
	}

	if (scalarQuestion === undefined) return renderTargetSection(tradingCopy.targetChildUniverses, <p className='detail'>{tradingCopy.loadingScalarForkDetails}</p>)

	const clampedSelectedScalarTick = clampScalarTickIndex(selectedScalarTick, scalarQuestion.numTicks)
	const clampedScalarOutcomeTick = clampedSelectedScalarTick.toString()
	const candidateOutcomeIndex = scalarOutcomeInvalid ? 0n : getScalarOutcomeIndex(scalarQuestion, clampedSelectedScalarTick)
	const candidateOutcomeLabel = scalarOutcomeInvalid ? commonCopy.invalid : formatScalarOutcomeLabel(scalarQuestion, clampedSelectedScalarTick)
	const candidateSelected = selectedOutcomeIndexSet.has(candidateOutcomeIndex.toString())
	const selectedTargetOutcomes = getScalarSelectedTargetOutcomes(childUniverseByOutcomeIndex, scalarQuestion, selectedOutcomeIndexes)

	return renderTargetSection(
		tradingCopy.targetChildUniverses,
		<>
			<OutcomeSelectionList emptyMessage={tradingCopy.scalarTargetSelectionRequired} items={selectedTargetOutcomes.map(target => renderTargetOutcomeRow(target, true, disabled, onToggleOutcomeIndex))} />
			<ScalarOutcomePicker
				action={
					<button className='secondary' type='button' onClick={() => onToggleOutcomeIndex(candidateOutcomeIndex)} disabled={disabled}>
						{candidateSelected ? tradingCopy.removeTarget : tradingCopy.addTarget}
					</button>
				}
				details={{
					maxValueLabel: formatScalarOutcomeLabel(scalarQuestion, scalarQuestion.numTicks),
					minValueLabel: formatScalarOutcomeLabel(scalarQuestion, 0n),
					numTicks: scalarQuestion.numTicks,
				}}
				disabled={disabled}
				isInvalid={scalarOutcomeInvalid}
				label={tradingCopy.selectScalarTarget}
				onInvalidChange={setScalarOutcomeInvalid}
				onSelectedTickChange={setScalarOutcomeTick}
				selectedOutcomeLabel={candidateOutcomeLabel}
				selectedTick={clampedScalarOutcomeTick}
				selectedTickLabel={scalarOutcomeInvalid ? commonCopy.invalid : commonCopy.formatSelectedTickLabel(clampedScalarOutcomeTick, scalarQuestion.numTicks.toString())}
			/>
		</>,
		<button className='quiet' type='button' onClick={onClearOutcomeIndexes} disabled={disabled || selectedOutcomeIndexes.length === 0}>
			{tradingCopy.clear}
		</button>,
	)
}
