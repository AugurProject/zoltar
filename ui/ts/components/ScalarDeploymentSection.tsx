import { useState } from 'preact/hooks'
import type { Address } from 'viem'
import { ChildUniversesSection } from './ChildUniversesSection.js'
import { ChildUniverseDetails } from './ChildUniverseDetails.js'
import { ErrorNotice } from './ErrorNotice.js'
import { useEffect } from 'preact/hooks'
import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { clampScalarTickIndex, formatScalarOutcomeLabel, getScalarOutcomeIndex, getScalarSliderFillWidth } from '../lib/scalarOutcome.js'
import type { MarketDetails, ZoltarChildUniverseSummary } from '../types/contracts.js'

type ScalarDeploymentSectionProps = {
	accountAddress: Address | undefined
	childUniverses: ZoltarChildUniverseSummary[]
	hasForked: boolean
	isMainnet: boolean
	onCreateChildUniverseForOutcomeIndex: (outcomeIndex: bigint) => void
	questionDetails: MarketDetails | undefined
	zoltarChildUniverseError: string | undefined
}

export function ScalarDeploymentSection({ accountAddress, childUniverses, hasForked, isMainnet, onCreateChildUniverseForOutcomeIndex, questionDetails, zoltarChildUniverseError }: ScalarDeploymentSectionProps) {
	const [scalarOutcomeTick, setScalarOutcomeTick] = useState('0')
	const [scalarOutcomeInvalid, setScalarOutcomeInvalid] = useState(false)
	const [scalarDeployError, setScalarDeployError] = useState<string | undefined>(undefined)

	if (questionDetails === undefined) {
		return (
			<div className='entity-card-subsection market-overview-subsection'>
				<div className='entity-card-subsection-header'>
					<h4>Child universes</h4>
				</div>
				<p className='detail'>
					<LoadingText>Loading scalar range...</LoadingText>
				</p>
			</div>
		)
	}

	const selectedScalarTick = BigInt(scalarOutcomeTick)
	const clampedSelectedScalarTick = clampScalarTickIndex(selectedScalarTick, questionDetails.numTicks)
	const clampedScalarOutcomeTick = clampedSelectedScalarTick.toString()
	const selectedScalarOutcomeLabel = scalarOutcomeInvalid ? 'Invalid' : formatScalarOutcomeLabel(questionDetails, clampedSelectedScalarTick)
	const selectedScalarOutcomeIndex = scalarOutcomeInvalid ? 0n : getScalarOutcomeIndex(questionDetails, clampedSelectedScalarTick)
	const selectedScalarChild = childUniverses.find(child => child.outcomeIndex === selectedScalarOutcomeIndex)
	const selectedScalarChildExists = selectedScalarChild?.exists === true
	const canDeployScalarChild = accountAddress !== undefined && isMainnet && hasForked && !selectedScalarChildExists

	useEffect(() => {
		const nextTick = clampScalarTickIndex(selectedScalarTick, questionDetails.numTicks).toString()
		if (nextTick === scalarOutcomeTick) return
		setScalarOutcomeTick(nextTick)
	}, [questionDetails.numTicks, scalarOutcomeTick, selectedScalarTick])

	return (
		<div className='entity-card-subsection market-overview-subsection'>
			<ChildUniversesSection
				childUniverses={childUniverses}
				emptyMessage='No deployed child universes yet.'
				headerTitle='Child universes'
				renderBadge={child => <span className={`badge ${child.exists ? 'ok' : 'pending'}`}>{child.exists ? 'Exists' : 'Not deployed'}</span>}
				renderBody={child => <ChildUniverseDetails child={child} />}
			/>
			<div className='market-scalar-deploy'>
				<div className='field scalar-slider-field'>
					<span>Select Child Universe</span>
					<div className='scalar-slider-with-invalid'>
						<div className={`scalar-slider-rail ${scalarOutcomeInvalid ? 'is-disabled' : ''}`}>
							<div className='scalar-slider-track' />
							<div className='scalar-slider-input-wrapper'>
								<div className='scalar-slider-fill' style={{ '--slider-fill': scalarOutcomeInvalid ? '0%' : getScalarSliderFillWidth(clampedSelectedScalarTick, questionDetails.numTicks) }} />
								<input
									disabled={scalarOutcomeInvalid}
									type='range'
									min='0'
									max={questionDetails.numTicks.toString()}
									step='1'
									value={clampedScalarOutcomeTick}
									aria-valuetext={selectedScalarOutcomeLabel}
									onInput={event => {
										setScalarDeployError(undefined)
										setScalarOutcomeTick(event.currentTarget.value)
									}}
								/>
							</div>
						</div>
						<span className='scalar-or-divider'>or</span>
						<label className='scalar-invalid-toggle'>
							<input
								type='checkbox'
								checked={scalarOutcomeInvalid}
								onChange={event => {
									setScalarDeployError(undefined)
									setScalarOutcomeInvalid(event.currentTarget.checked)
								}}
							/>
							<span>Invalid</span>
						</label>
					</div>
				</div>
				<div className='workflow-question-grid scalar-slider-stats'>
					<MetricField label='Min Value'>{formatScalarOutcomeLabel(questionDetails, 0n)}</MetricField>
					<MetricField label='Selected Tick'>{scalarOutcomeInvalid ? 'Invalid' : `${clampedScalarOutcomeTick} / ${questionDetails.numTicks.toString()}`}</MetricField>
					<MetricField label='Selected Outcome'>{selectedScalarOutcomeLabel}</MetricField>
					<MetricField label='Max Value'>{formatScalarOutcomeLabel(questionDetails, questionDetails.numTicks)}</MetricField>
				</div>
				<div className='actions'>
					<button
						className='secondary'
						onClick={() => {
							try {
								setScalarDeployError(undefined)
								onCreateChildUniverseForOutcomeIndex(selectedScalarOutcomeIndex)
							} catch (error) {
								setScalarDeployError(error instanceof Error ? error.message : 'Selected tick is invalid')
							}
						}}
						disabled={!canDeployScalarChild}
					>
						{selectedScalarChildExists ? 'Deployed' : scalarOutcomeInvalid ? 'Deploy Invalid Universe' : 'Deploy Universe'}
					</button>
				</div>
				<ErrorNotice message={scalarDeployError} />
			</div>
			<ErrorNotice message={zoltarChildUniverseError} />
		</div>
	)
}
