import * as commonCopy from '../../../copy/common.js'
import * as marketCopy from '../../../copy/market.js'
import { DataGrid } from '../../../components/DataGrid.js'
import { FormInput } from '../../../components/FormInput.js'
import { MetricField } from '../../../components/MetricField.js'
import { tryParseBigIntInput } from '../lib/marketForm.js'
import type { ScalarOutcomePickerProps } from '../../types.js'
import { MAX_PRECISE_SCALAR_TICK_COUNT, clampScalarTickIndex, getScalarSliderFillWidth } from '../lib/scalarOutcome.js'
import { useEffect, useId, useState } from 'preact/hooks'
import { tryParseDecimalInput } from '../../../lib/decimal.js'
import { formatScalarDisplayValue, getScalarDisplayValue, getScalarTickIndexForDisplayValue } from '@zoltar/shared/scalarOutcome'

function getSafeSelectedTickValue(selectedTick: string) {
	return selectedTick.trim() === '' ? 0n : (tryParseBigIntInput(selectedTick) ?? 0n)
}

export function ScalarOutcomePicker({ action, details, disabled = false, isInvalid, label, onInvalidChange, onSelectedTickChange, selectedOutcomeLabel, selectedTick, selectedTickLabel, showMinMax = true }: ScalarOutcomePickerProps) {
	const sliderLabelId = useId()
	const scalarValueErrorId = useId()
	const selectedTickValue = clampScalarTickIndex(getSafeSelectedTickValue(selectedTick), details.numTicks)
	const resolvedSelectedTick = selectedTickValue.toString()
	const canUseNativeSlider = details.numTicks <= MAX_PRECISE_SCALAR_TICK_COUNT
	const [exactTickInputValue, setExactTickInputValue] = useState(resolvedSelectedTick)
	const scalarQuestionDetails = details.displayValueMin === undefined || details.displayValueMax === undefined ? undefined : { answerUnit: details.answerUnit ?? '', displayValueMax: details.displayValueMax, displayValueMin: details.displayValueMin, numTicks: details.numTicks }
	const selectedScalarValue = scalarQuestionDetails === undefined ? undefined : getScalarDisplayValue(scalarQuestionDetails, selectedTickValue)
	const resolvedScalarValueInput = selectedScalarValue === undefined ? undefined : formatScalarDisplayValue(selectedScalarValue)
	const [scalarValueInput, setScalarValueInput] = useState(resolvedScalarValueInput ?? '')
	const [scalarValueError, setScalarValueError] = useState<string | undefined>(undefined)
	useEffect(() => {
		setExactTickInputValue(resolvedSelectedTick)
	}, [resolvedSelectedTick])
	useEffect(() => {
		if (resolvedScalarValueInput === undefined) return
		setScalarValueInput(resolvedScalarValueInput)
		setScalarValueError(undefined)
	}, [resolvedScalarValueInput])
	const updateScalarValue = (value: string) => {
		setScalarValueInput(value)
		const parsedValue = tryParseDecimalInput(value)
		if (parsedValue === undefined || scalarQuestionDetails === undefined) {
			setScalarValueError(marketCopy.scalarValueInvalid)
			return
		}
		const tickIndex = getScalarTickIndexForDisplayValue(scalarQuestionDetails, parsedValue)
		if (tickIndex === undefined) {
			setScalarValueError(marketCopy.scalarValueInvalid)
			return
		}
		setScalarValueError(undefined)
		onSelectedTickChange(tickIndex.toString())
	}

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
							onInput={event => {
								const nextInputValue = event.currentTarget.value
								setExactTickInputValue(nextInputValue)
								const parsedTick = tryParseBigIntInput(nextInputValue)
								if (parsedTick === undefined) return
								onSelectedTickChange(clampScalarTickIndex(parsedTick, details.numTicks).toString())
							}}
						/>
					)}
					<span className='scalar-or-divider'>{marketCopy.or}</span>
					<label className='scalar-invalid-toggle'>
						<input type='checkbox' disabled={disabled} checked={isInvalid} onChange={event => onInvalidChange(event.currentTarget.checked)} />
						<span>{commonCopy.invalid}</span>
					</label>
				</div>
			</div>
			<DataGrid className='scalar-slider-stats'>
				{showMinMax ? <MetricField label={marketCopy.minValue}>{details.minValueLabel}</MetricField> : undefined}
				<MetricField label={marketCopy.selectedTick}>{selectedTickLabel}</MetricField>
				<MetricField label={showMinMax ? marketCopy.selectedOutcome : marketCopy.currentValue} valueTagName='span'>
					{resolvedScalarValueInput === undefined ? (
						selectedOutcomeLabel
					) : (
						<span className='scalar-value-editor'>
							<span className='scalar-value-input-row'>
								<FormInput
									aria-label={marketCopy.scalarValue}
									aria-describedby={scalarValueError === undefined ? undefined : scalarValueErrorId}
									disabled={disabled || isInvalid}
									inputMode='decimal'
									invalid={scalarValueError !== undefined}
									onBlur={() => {
										setScalarValueInput(resolvedScalarValueInput)
										setScalarValueError(undefined)
									}}
									onInput={event => updateScalarValue(event.currentTarget.value)}
									value={scalarValueInput}
								/>
								{details.answerUnit === undefined || details.answerUnit === '' ? undefined : <span>{details.answerUnit}</span>}
							</span>
							<span className='field-help'>{marketCopy.scalarValueHelpText}</span>
							{scalarValueError === undefined ? undefined : (
								<span className='field-error' id={scalarValueErrorId}>
									{scalarValueError}
								</span>
							)}
						</span>
					)}
				</MetricField>
				{showMinMax ? <MetricField label={marketCopy.maxValue}>{details.maxValueLabel}</MetricField> : undefined}
			</DataGrid>
			{action === undefined ? undefined : <div className='actions'>{action}</div>}
		</div>
	)
}
