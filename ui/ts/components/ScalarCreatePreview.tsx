import { useEffect, useState } from 'preact/hooks'
import { clampScalarTickIndex, formatScalarOutcomeLabel, getScalarSliderFillWidth } from '../lib/scalarOutcome.js'

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
	const [isInvalid, setIsInvalid] = useState(false)
	const selectedTickValue = BigInt(selectedTick)
	const clampedSelectedTickValue = clampScalarTickIndex(selectedTickValue, details.numTicks)
	const clampedSelectedTick = clampedSelectedTickValue.toString()
	useEffect(() => {
		if (clampedSelectedTick === selectedTick) return
		onSelectedTickChange(clampedSelectedTick)
	}, [clampedSelectedTick, onSelectedTickChange, selectedTick])

	return (
		<div className='market-scalar-deploy'>
			<div className='field scalar-slider-field'>
				<span>Scalar Preview</span>
				<div className='scalar-slider-with-invalid'>
					<div className={`scalar-slider-rail ${isInvalid ? 'is-disabled' : ''}`}>
						<div className='scalar-slider-track' />
						<div className='scalar-slider-input-wrapper'>
							<div className='scalar-slider-fill' style={{ width: isInvalid ? '0' : getScalarSliderFillWidth(clampedSelectedTickValue, details.numTicks) }} />
							<input disabled={isInvalid} aria-valuetext={isInvalid ? 'Invalid' : formatScalarOutcomeLabel(details, clampedSelectedTickValue)} max={details.numTicks.toString()} min='0' step='1' type='range' value={clampedSelectedTick} onInput={event => onSelectedTickChange(event.currentTarget.value)} />
						</div>
					</div>
					<span className='scalar-or-divider'>or</span>
					<label className='scalar-invalid-toggle'>
						<input type='checkbox' checked={isInvalid} onChange={event => setIsInvalid(event.currentTarget.checked)} />
						<span>Invalid</span>
					</label>
				</div>
			</div>
			<div className='workflow-question-grid market-scalar-deploy-grid scalar-slider-stats'>
				<div>
					<span className='metric-label'>Selected Tick</span>
					<strong>{isInvalid ? 'Invalid' : `${clampedSelectedTick} / ${details.numTicks.toString()}`}</strong>
				</div>
				<div>
					<span className='metric-label'>Current Value</span>
					<strong>{isInvalid ? 'Invalid' : formatScalarOutcomeLabel(details, clampedSelectedTickValue)}</strong>
				</div>
			</div>
		</div>
	)
}
