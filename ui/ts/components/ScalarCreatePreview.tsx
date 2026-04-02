import { useEffect } from 'preact/hooks'
import { formatScalarOutcomeLabel, getScalarSliderProgress } from '../lib/scalarOutcome.js'
import { clampScalarTickIndex } from '../lib/scalarOutcome.js'

export type ScalarCreatePreviewDetails = {
	answerUnit: string
	displayValueMax: bigint
	displayValueMin: bigint
	numTicks: bigint
}

type ScalarCreatePreviewProps = {
	details: ScalarCreatePreviewDetails
	selectedTick: string
	onSelectedTickChange: (tick: string) => void
}

export function ScalarCreatePreview({ details, selectedTick, onSelectedTickChange }: ScalarCreatePreviewProps) {
	const selectedTickValue = BigInt(selectedTick)
	const clampedSelectedTickValue = clampScalarTickIndex(selectedTickValue, details.numTicks)
	const clampedSelectedTick = clampedSelectedTickValue.toString()
	const selectedProgress = getScalarSliderProgress(clampedSelectedTickValue, details.numTicks)

	useEffect(() => {
		if (clampedSelectedTick === selectedTick) return
		onSelectedTickChange(clampedSelectedTick)
	}, [clampedSelectedTick, onSelectedTickChange, selectedTick])

	return (
		<div className="market-scalar-deploy">
			<label className="field scalar-slider-field">
				<span>Scalar Preview</span>
				<div className="scalar-slider-rail">
					<div className="scalar-slider-track" />
					<div className="scalar-slider-fill" style={{ width: `${ selectedProgress }%` }} />
					<input aria-valuetext={formatScalarOutcomeLabel(details, clampedSelectedTickValue)} max={details.numTicks.toString()} min="0" step="1" type="range" value={clampedSelectedTick} onInput={event => onSelectedTickChange(event.currentTarget.value)} />
				</div>
			</label>
			<div className="workflow-question-grid market-scalar-deploy-grid scalar-slider-stats">
				<div>
					<span className="metric-label">Min Value</span>
					<strong>{formatScalarOutcomeLabel(details, 0n)}</strong>
				</div>
				<div>
					<span className="metric-label">Selected Tick</span>
					<strong>{`${ clampedSelectedTick } / ${ details.numTicks.toString() }`}</strong>
				</div>
				<div>
					<span className="metric-label">Selected Value</span>
					<strong>{formatScalarOutcomeLabel(details, clampedSelectedTickValue)}</strong>
				</div>
				<div>
					<span className="metric-label">Max Value</span>
					<strong>{formatScalarOutcomeLabel(details, details.numTicks)}</strong>
				</div>
			</div>
		</div>
	)
}
