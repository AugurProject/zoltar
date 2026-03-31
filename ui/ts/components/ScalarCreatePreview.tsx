import { formatScalarOutcomeLabel, getScalarSliderProgress } from '../lib/scalarOutcome.js'

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
	const selectedProgress = getScalarSliderProgress(selectedTickValue, details.numTicks)

	return (
		<div className="market-scalar-deploy">
			<label className="field scalar-slider-field">
				<span>Scalar Preview</span>
				<div className="scalar-slider-rail">
					<div className="scalar-slider-track" />
					<div className="scalar-slider-fill" style={{ width: `${ selectedProgress }%` }} />
					<input aria-valuetext={formatScalarOutcomeLabel(details, selectedTickValue)} max={details.numTicks.toString()} min="0" step="1" type="range" value={selectedTick} onInput={event => onSelectedTickChange(event.currentTarget.value)} />
				</div>
			</label>
			<div className="workflow-question-grid market-scalar-deploy-grid scalar-slider-stats">
				<div>
					<span className="metric-label">Min Value</span>
					<strong>{formatScalarOutcomeLabel(details, 0n)}</strong>
				</div>
				<div>
					<span className="metric-label">Selected Tick</span>
					<strong>{`${ selectedTick } / ${ details.numTicks.toString() }`}</strong>
				</div>
				<div>
					<span className="metric-label">Selected Value</span>
					<strong>{formatScalarOutcomeLabel(details, selectedTickValue)}</strong>
				</div>
				<div>
					<span className="metric-label">Max Value</span>
					<strong>{formatScalarOutcomeLabel(details, details.numTicks)}</strong>
				</div>
			</div>
		</div>
	)
}
