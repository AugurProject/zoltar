import { UserMessage } from './UserMessage.js'
import * as commonCopy from '../copy/common.js'

import { DataGrid } from '../components/DataGrid.js'
import { FormInput } from '../components/FormInput.js'
import { MetricField } from '../components/MetricField.js'
import { tryParseBigIntInput } from '../forms/integerInput.js'
import type { ScalarOutcomePickerProps } from '../types/components.js'
import { MAX_PRECISE_SCALAR_TICK_COUNT, clampScalarTickIndex, getScalarSliderFillWidth } from '../lib/scalarOutcome.js'
import { useEffect, useId, useRef, useState } from 'preact/hooks'
import { tryParseDecimalInput } from '../forms/decimal.js'
import { formatScalarDisplayValue, getScalarDisplayValue, getScalarTickIndexForDisplayValue } from '@zoltar/zoltar-shared/questions/scalarOutcome'

function getSafeSelectedTickValue(selectedTick: string) {
	return selectedTick.trim() === '' ? 0n : (tryParseBigIntInput(selectedTick) ?? 0n)
}

export function ScalarOutcomePicker({ action, details, disabled = false, isInvalid, label, onInvalidChange, onSelectedTickChange, selectedOutcomeLabel, selectedTick, showMinMax = true }: ScalarOutcomePickerProps) {
	const sliderLabelId = useId()
	const scalarValueErrorId = useId()
	const scalarValueHelpId = useId()
	const rawSelectedTickValue = getSafeSelectedTickValue(selectedTick)
	const selectedTickIsInRange = selectedTick.trim() !== '' && rawSelectedTickValue >= 0n && rawSelectedTickValue <= details.numTicks
	const selectedTickValue = clampScalarTickIndex(rawSelectedTickValue, details.numTicks)
	const canUseNativeSlider = details.numTicks <= MAX_PRECISE_SCALAR_TICK_COUNT
	const resolvedSelectedTick = selectedTickValue.toString()
	const scalarQuestionDetails = { answerUnit: details.answerUnit ?? '', displayValueMax: details.displayValueMax, displayValueMin: details.displayValueMin, numTicks: details.numTicks }
	const selectedScalarValue = selectedTickIsInRange ? getScalarDisplayValue(scalarQuestionDetails, selectedTickValue) : undefined
	const resolvedScalarValueInput = selectedScalarValue === undefined ? undefined : formatScalarDisplayValue(selectedScalarValue)
	const [scalarValueInput, setScalarValueInput] = useState(resolvedScalarValueInput ?? '')
	const lastValidTick = useRef(resolvedSelectedTick)
	useEffect(() => {
		if (selectedTickIsInRange) lastValidTick.current = resolvedSelectedTick
	}, [selectedTickIsInRange, resolvedSelectedTick])
	const [scalarValueError, setScalarValueError] = useState<string | undefined>(undefined)
	useEffect(() => {
		if (isInvalid || resolvedScalarValueInput === undefined) return
		setScalarValueInput(resolvedScalarValueInput)
		setScalarValueError(undefined)
	}, [details.displayValueMax, details.displayValueMin, details.numTicks, isInvalid, resolvedScalarValueInput])
	const updateScalarValue = (value: string) => {
		setScalarValueInput(value)
		const parsedValue = tryParseDecimalInput(value)
		if (parsedValue === undefined) {
			setScalarValueError(commonCopy.scalarValueInvalid)
			onSelectedTickChange('')
			return
		}
		const tickIndex = getScalarTickIndexForDisplayValue(scalarQuestionDetails, parsedValue)
		if (tickIndex === undefined) {
			setScalarValueError(commonCopy.scalarValueInvalid)
			onSelectedTickChange('')
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
					) : undefined}
					{canUseNativeSlider ? <span className='scalar-or-divider'>{commonCopy.or}</span> : undefined}
					<label className='scalar-invalid-toggle'>
						<input
							type='checkbox'
							disabled={disabled}
							checked={isInvalid}
							onChange={event => {
								if (!event.currentTarget.checked && !selectedTickIsInRange) onSelectedTickChange(clampScalarTickIndex(BigInt(lastValidTick.current), details.numTicks).toString())
								onInvalidChange(event.currentTarget.checked)
							}}
						/>
						<span>{commonCopy.invalid}</span>
					</label>
				</div>
			</div>
			<DataGrid className='scalar-slider-stats'>
				{showMinMax ? <MetricField label={commonCopy.minValue}>{details.minValueLabel}</MetricField> : undefined}
				<MetricField label={showMinMax ? commonCopy.selectedOutcome : commonCopy.currentValue} valueTagName='span'>
					{isInvalid ? (
						selectedOutcomeLabel
					) : (
						<span className='scalar-value-editor'>
							<span className='scalar-value-input-row'>
								<FormInput
									aria-label={commonCopy.scalarValue}
									aria-describedby={scalarValueError === undefined ? scalarValueHelpId : scalarValueErrorId}
									disabled={disabled || isInvalid}
									inputMode='decimal'
									invalid={scalarValueError !== undefined}
									onBlur={() => {
										if (resolvedScalarValueInput === undefined) return
										setScalarValueInput(resolvedScalarValueInput)
										setScalarValueError(undefined)
									}}
									onInput={event => updateScalarValue(event.currentTarget.value)}
									value={scalarValueInput}
								/>
								{details.answerUnit === undefined || details.answerUnit === '' ? undefined : <span className='scalar-value-unit'>{details.answerUnit}</span>}
							</span>
							{scalarValueError === undefined ? <UserMessage placement='field' as='span' id={scalarValueHelpId} detail={commonCopy.scalarValueHelpText} /> : undefined}
							{scalarValueError === undefined ? undefined : <UserMessage placement='field' as='span' tone='error' id={scalarValueErrorId} detail={scalarValueError} />}
						</span>
					)}
				</MetricField>
				{showMinMax ? <MetricField label={commonCopy.maxValue}>{details.maxValueLabel}</MetricField> : undefined}
			</DataGrid>
			{action === undefined ? undefined : <div className='actions'>{action}</div>}
		</div>
	)
}
