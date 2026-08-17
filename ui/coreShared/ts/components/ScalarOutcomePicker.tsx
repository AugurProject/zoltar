import * as commonCopy from '../copy/common.js'

import { DataGrid } from '../components/DataGrid.js'
import { FormInput } from '../components/FormInput.js'
import { MetricField } from '../components/MetricField.js'
import { tryParseBigIntInput } from '../lib/integerInput.js'
import type { ScalarOutcomePickerProps } from '../types/components.js'
import { MAX_PRECISE_SCALAR_TICK_COUNT, clampScalarTickIndex, getScalarSliderFillWidth } from '../lib/scalarOutcome.js'
import { useEffect, useId, useState } from 'preact/hooks'
import type * as preact from 'preact'

function getSafeSelectedTickValue(selectedTick: string) {
	return selectedTick.trim() === '' ? 0n : (tryParseBigIntInput(selectedTick) ?? 0n)
}

export function ScalarOutcomePicker({ action, details, disabled = false, isInvalid, label, onInvalidChange, onSelectedTickChange, selectedOutcomeLabel, selectedTick, selectedTickLabel, showMinMax = true }: ScalarOutcomePickerProps) {
	const sliderLabelId = useId()
	const selectedTickValue = clampScalarTickIndex(getSafeSelectedTickValue(selectedTick), details.numTicks)
	const resolvedSelectedTick = selectedTickValue.toString()
	const canUseNativeSlider = details.numTicks <= MAX_PRECISE_SCALAR_TICK_COUNT
	const [exactTickInputValue, setExactTickInputValue] = useState(resolvedSelectedTick)
	useEffect(() => {
		setExactTickInputValue(resolvedSelectedTick)
	}, [resolvedSelectedTick])

	return (
		<div className='market-scalar-deploy workflow-subsection'>
			<div className='field scalar-slider-field'>
				<span id={sliderLabelId}>{label}</span>
				<div className='scalar-slider-with-invalid'>
					{canUseNativeSlider ? (
						<div className={`scalar-slider-rail ${isInvalid ? 'is-disabled' : ''}`}>
							<div className='scalar-slider-track' />
							<div className='scalar-slider-input-wrapper'>
								<div className='scalar-slider-fill' style={{ '--slider-fill': isInvalid ? '0%' : getScalarSliderFillWidth(selectedTickValue, details.numTicks) }} />
								<input
									aria-labelledby={sliderLabelId}
									disabled={disabled || isInvalid}
									type='range'
									min='0'
									max={details.numTicks.toString()}
									step='1'
									value={resolvedSelectedTick}
									aria-valuetext={typeof selectedOutcomeLabel === 'string' ? selectedOutcomeLabel : undefined}
									onInput={event => onSelectedTickChange(event.currentTarget.value)}
								/>
							</div>
						</div>
					) : (
						<FormInput
							aria-labelledby={sliderLabelId}
							className='scalar-exact-tick-input'
							disabled={disabled || isInvalid}
							inputMode='numeric'
							value={exactTickInputValue}
							onBlur={() => setExactTickInputValue(resolvedSelectedTick)}
							onInput={(event: preact.JSX.TargetedEvent<HTMLInputElement>) => {
								const nextInputValue = event.currentTarget.value
								setExactTickInputValue(nextInputValue)
								const parsedTick = tryParseBigIntInput(nextInputValue)
								if (parsedTick === undefined) return
								onSelectedTickChange(clampScalarTickIndex(parsedTick, details.numTicks).toString())
							}}
						/>
					)}
					<span className='scalar-or-divider'>{commonCopy.or}</span>
					<label className='scalar-invalid-toggle'>
						<input type='checkbox' disabled={disabled} checked={isInvalid} onChange={event => onInvalidChange(event.currentTarget.checked)} />
						<span>{commonCopy.invalid}</span>
					</label>
				</div>
			</div>
			<DataGrid className='scalar-slider-stats'>
				{showMinMax ? <MetricField label={commonCopy.minValue}>{details.minValueLabel}</MetricField> : undefined}
				<MetricField label={commonCopy.selectedTick}>{selectedTickLabel}</MetricField>
				<MetricField label={showMinMax ? commonCopy.selectedOutcome : commonCopy.currentValue}>{selectedOutcomeLabel}</MetricField>
				{showMinMax ? <MetricField label={commonCopy.maxValue}>{details.maxValueLabel}</MetricField> : undefined}
			</DataGrid>
			{action === undefined ? undefined : <div className='actions'>{action}</div>}
		</div>
	)
}
