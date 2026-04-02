import { useState } from 'preact/hooks'
import type { Address } from 'viem'
import { ChildUniversesSection } from './ChildUniversesSection.js'
import { ChildUniverseDetails } from './ChildUniverseDetails.js'
import { useEffect } from 'preact/hooks'
import { clampScalarTickIndex, formatScalarOutcomeLabel, getScalarOutcomeIndex, getScalarSliderProgress } from '../lib/scalarOutcome.js'
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
	const [scalarDeployError, setScalarDeployError] = useState<string | undefined>(undefined)

	if (questionDetails === undefined) {
		return (
			<div className="entity-card-subsection market-overview-subsection">
				<div className="entity-card-subsection-header">
					<h4>Child universes</h4>
				</div>
				<p className="detail">Loading scalar range...</p>
			</div>
		)
	}

	const selectedScalarTick = BigInt(scalarOutcomeTick)
	const clampedSelectedScalarTick = clampScalarTickIndex(selectedScalarTick, questionDetails.numTicks)
	const clampedScalarOutcomeTick = clampedSelectedScalarTick.toString()
	const selectedScalarOutcomeLabel = formatScalarOutcomeLabel(questionDetails, clampedSelectedScalarTick)
	const selectedScalarOutcomeIndex = getScalarOutcomeIndex(questionDetails, clampedSelectedScalarTick)
	const selectedScalarChild = childUniverses.find(child => child.outcomeIndex === selectedScalarOutcomeIndex)
	const selectedScalarChildExists = selectedScalarChild?.exists === true
	const selectedScalarProgress = getScalarSliderProgress(clampedSelectedScalarTick, questionDetails.numTicks)
	const canDeployScalarChild = accountAddress !== undefined && isMainnet && hasForked && !selectedScalarChildExists

	useEffect(() => {
		const nextTick = clampScalarTickIndex(selectedScalarTick, questionDetails.numTicks).toString()
		if (nextTick === scalarOutcomeTick) return
		setScalarOutcomeTick(nextTick)
	}, [questionDetails.numTicks, scalarOutcomeTick, selectedScalarTick])

	return (
		<div className="entity-card-subsection market-overview-subsection">
			<ChildUniversesSection childUniverses={childUniverses} emptyMessage="No deployed child universes yet." headerTitle="Child universes" renderBadge={child => <span className={`badge ${child.exists ? 'ok' : 'pending'}`}>{child.exists ? 'Exists' : 'Not deployed'}</span>} renderBody={child => <ChildUniverseDetails child={child} />} />
			<div className="market-scalar-deploy">
				<div className="field scalar-slider-field">
					<span>Select Child Universe</span>
					<div className="scalar-slider-rail">
						<div className="scalar-slider-track" />
						<div className="scalar-slider-fill" style={{ width: `${selectedScalarProgress}%` }} />
						<input
							type="range"
							min="0"
							max={questionDetails.numTicks.toString()}
							step="1"
							value={clampedScalarOutcomeTick}
							aria-valuetext={selectedScalarOutcomeLabel}
							onInput={event => {
								setScalarDeployError(undefined)
								setScalarOutcomeTick(event.currentTarget.value)
							}}
						/>
					</div>
				</div>
				<div className="workflow-question-grid market-scalar-deploy-grid scalar-slider-stats">
					<div>
						<span className="metric-label">Min Value</span>
						<strong>{formatScalarOutcomeLabel(questionDetails, 0n)}</strong>
					</div>
					<div>
						<span className="metric-label">Selected Tick</span>
						<strong>{`${clampedScalarOutcomeTick} / ${questionDetails.numTicks.toString()}`}</strong>
					</div>
					<div>
						<span className="metric-label">Selected Value</span>
						<strong>{selectedScalarOutcomeLabel}</strong>
					</div>
					<div>
						<span className="metric-label">Max Value</span>
						<strong>{formatScalarOutcomeLabel(questionDetails, questionDetails.numTicks)}</strong>
					</div>
				</div>
				<div className="actions">
					<button
						className="secondary"
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
						{selectedScalarChildExists ? 'Deployed' : 'Deploy Universe'}
					</button>
				</div>
				{scalarDeployError === undefined ? undefined : <p className="notice error">{scalarDeployError}</p>}
			</div>
			{zoltarChildUniverseError === undefined ? undefined : <p className="notice error">{zoltarChildUniverseError}</p>}
		</div>
	)
}
