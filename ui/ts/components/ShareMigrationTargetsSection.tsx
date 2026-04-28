import { useEffect, useMemo, useState } from 'preact/hooks'
import { MetricField } from './MetricField.js'
import { clampScalarTickIndex, formatScalarOutcomeIndexLabel, formatScalarOutcomeLabel, getScalarOutcomeIndex, getScalarSliderFillWidth } from '../lib/scalarOutcome.js'
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
	return (
		<button key={target.outcomeIndex.toString()} aria-pressed={selected} className={`migration-outcome-row ${selected ? 'active' : ''}`} disabled={disabled} onClick={() => onToggleOutcomeIndex(target.outcomeIndex)} type='button'>
			<span className='migration-outcome-copy'>
				<span className='migration-outcome-label'>{target.label}</span>
				<span className='migration-outcome-metrics'>
					<span>
						<strong>{selected ? 'Selected' : 'Not selected'}</strong>
					</span>
					<span>
						<strong>{getTargetOutcomeBadgeLabel(target)}</strong>
					</span>
				</span>
			</span>
		</button>
	)
}

function getScalarSelectedTargetOutcomes(childUniverseByOutcomeIndex: Map<string, ZoltarChildUniverseSummary>, scalarQuestion: MarketDetails, selectedOutcomeIndexes: bigint[]) {
	return selectedOutcomeIndexes.map(outcomeIndex => {
		const childUniverse = childUniverseByOutcomeIndex.get(outcomeIndex.toString())
		let label = childUniverse?.outcomeLabel
		if (label === undefined) {
			try {
				label = formatScalarOutcomeIndexLabel(scalarQuestion, outcomeIndex)
			} catch {
				label = `Malformed (${outcomeIndex.toString()})`
			}
		}
		return {
			exists: childUniverse?.exists === true,
			label,
			outcomeIndex,
		} satisfies TargetOutcomePresentation
	})
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

	if (forkUniverse === undefined) {
		return (
			<div className='entity-card-subsection market-overview-subsection'>
				<div className='entity-card-subsection-header'>
					<h4>Target Child Universes</h4>
				</div>
				<p className='detail'>Loading fork target universes...</p>
			</div>
		)
	}

	if (!forkUniverse.hasForked) {
		return (
			<div className='entity-card-subsection market-overview-subsection'>
				<div className='entity-card-subsection-header'>
					<h4>Target Child Universes</h4>
				</div>
				<p className='detail'>Child-universe targets unlock after this universe forks.</p>
			</div>
		)
	}

	if (forkUniverse.forkQuestionDetails === undefined) {
		return (
			<div className='entity-card-subsection market-overview-subsection'>
				<div className='entity-card-subsection-header'>
					<h4>Target Child Universes</h4>
				</div>
				<p className='detail'>Loading fork question details...</p>
			</div>
		)
	}

	if (forkUniverse.forkQuestionDetails.marketType !== 'scalar') {
		const childUniverses = forkUniverse.childUniverses.map(child => ({
			exists: child.exists,
			label: child.outcomeLabel,
			outcomeIndex: child.outcomeIndex,
		}))
		const hasSelectableTargets = childUniverses.length > 0

		return (
			<div className='entity-card-subsection market-overview-subsection'>
				<div className='entity-card-subsection-header'>
					<h4>Target Child Universes</h4>
					<div className='actions'>
						<button className='quiet' type='button' onClick={onSelectAllOutcomeIndexes} disabled={disabled || !hasSelectableTargets}>
							Select all
						</button>
						<button className='quiet' type='button' onClick={onClearOutcomeIndexes} disabled={disabled || selectedOutcomeIndexes.length === 0}>
							Clear
						</button>
					</div>
				</div>
				{childUniverses.length === 0 ? <p className='detail'>No target child universes available.</p> : <div className='migration-outcome-list'>{childUniverses.map(target => renderTargetOutcomeRow(target, selectedOutcomeIndexSet.has(target.outcomeIndex.toString()), disabled, onToggleOutcomeIndex))}</div>}
			</div>
		)
	}

	if (scalarQuestion === undefined) {
		return (
			<div className='entity-card-subsection market-overview-subsection'>
				<div className='entity-card-subsection-header'>
					<h4>Target Child Universes</h4>
				</div>
				<p className='detail'>Loading scalar fork details...</p>
			</div>
		)
	}

	const clampedSelectedScalarTick = clampScalarTickIndex(selectedScalarTick, scalarQuestion.numTicks)
	const clampedScalarOutcomeTick = clampedSelectedScalarTick.toString()
	const candidateOutcomeIndex = scalarOutcomeInvalid ? 0n : getScalarOutcomeIndex(scalarQuestion, clampedSelectedScalarTick)
	const candidateOutcomeLabel = scalarOutcomeInvalid ? 'Invalid' : formatScalarOutcomeLabel(scalarQuestion, clampedSelectedScalarTick)
	const candidateSelected = selectedOutcomeIndexSet.has(candidateOutcomeIndex.toString())
	const selectedTargetOutcomes = getScalarSelectedTargetOutcomes(childUniverseByOutcomeIndex, scalarQuestion, selectedOutcomeIndexes)

	return (
		<div className='entity-card-subsection market-overview-subsection'>
			<div className='entity-card-subsection-header'>
				<h4>Target Child Universes</h4>
				<button className='quiet' type='button' onClick={onClearOutcomeIndexes} disabled={disabled || selectedOutcomeIndexes.length === 0}>
					Clear
				</button>
			</div>
			{selectedTargetOutcomes.length === 0 ? <p className='detail'>Select at least one scalar target universe.</p> : <div className='migration-outcome-list'>{selectedTargetOutcomes.map(target => renderTargetOutcomeRow(target, true, disabled, onToggleOutcomeIndex))}</div>}
			<div className='market-scalar-deploy'>
				<div className='field scalar-slider-field'>
					<span>Select Scalar Target</span>
					<div className='scalar-slider-with-invalid'>
						<div className={`scalar-slider-rail ${scalarOutcomeInvalid ? 'is-disabled' : ''}`}>
							<div className='scalar-slider-track' />
							<div className='scalar-slider-input-wrapper'>
								<div className='scalar-slider-fill' style={{ '--slider-fill': scalarOutcomeInvalid ? '0%' : getScalarSliderFillWidth(clampedSelectedScalarTick, scalarQuestion.numTicks) }} />
								<input
									disabled={disabled || scalarOutcomeInvalid}
									type='range'
									min='0'
									max={scalarQuestion.numTicks.toString()}
									step='1'
									value={clampedScalarOutcomeTick}
									aria-valuetext={candidateOutcomeLabel}
									onInput={event => {
										setScalarOutcomeTick(event.currentTarget.value)
									}}
								/>
							</div>
						</div>
						<span className='scalar-or-divider'>or</span>
						<label className='scalar-invalid-toggle'>
							<input
								type='checkbox'
								disabled={disabled}
								checked={scalarOutcomeInvalid}
								onChange={event => {
									setScalarOutcomeInvalid(event.currentTarget.checked)
								}}
							/>
							<span>Invalid</span>
						</label>
					</div>
				</div>
				<div className='workflow-question-grid scalar-slider-stats'>
					<MetricField label='Min Value'>{formatScalarOutcomeLabel(scalarQuestion, 0n)}</MetricField>
					<MetricField label='Selected Tick'>{scalarOutcomeInvalid ? 'Invalid' : `${clampedScalarOutcomeTick} / ${scalarQuestion.numTicks.toString()}`}</MetricField>
					<MetricField label='Selected Outcome'>{candidateOutcomeLabel}</MetricField>
					<MetricField label='Max Value'>{formatScalarOutcomeLabel(scalarQuestion, scalarQuestion.numTicks)}</MetricField>
				</div>
				<div className='actions'>
					<button className='secondary' type='button' onClick={() => onToggleOutcomeIndex(candidateOutcomeIndex)} disabled={disabled}>
						{candidateSelected ? 'Remove Target' : 'Add Target'}
					</button>
				</div>
			</div>
		</div>
	)
}
