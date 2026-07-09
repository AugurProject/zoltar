import { DataGrid } from './DataGrid.js'
import { MetricField } from './MetricField.js'
import { UI_STRINGS } from '../lib/uiStrings.js'
import { tryParseBigIntInput } from '../lib/marketForm.js'
import type { ScalarOutcomePickerProps } from '../types/components.js'
import { clampScalarTickIndex, getScalarSliderFillWidth } from '../lib/scalarOutcome.js'

function getSafeSelectedTickValue(selectedTick: string) {
	return selectedTick.trim() === '' ? 0n : (tryParseBigIntInput(selectedTick) ?? 0n)
}

export function ScalarOutcomePicker({ action, details, disabled = false, isInvalid, label, onInvalidChange, onSelectedTickChange, selectedOutcomeLabel, selectedTick, selectedTickLabel, showMinMax = true }: ScalarOutcomePickerProps) {
	const selectedTickValue = clampScalarTickIndex(getSafeSelectedTickValue(selectedTick), details.numTicks)
	const resolvedSelectedTick = selectedTickValue.toString()

	return (
		<div className='market-scalar-deploy workflow-subsection'>
			<div className='field scalar-slider-field'>
				<span>{label}</span>
				<div className='scalar-slider-with-invalid'>
					<div className={`scalar-slider-rail ${isInvalid ? 'is-disabled' : ''}`}>
						<div className='scalar-slider-track' />
						<div className='scalar-slider-input-wrapper'>
							<div className='scalar-slider-fill' style={{ '--slider-fill': isInvalid ? '0%' : getScalarSliderFillWidth(selectedTickValue, details.numTicks) }} />
							<input disabled={disabled || isInvalid} type='range' min='0' max={details.numTicks.toString()} step='1' value={resolvedSelectedTick} aria-valuetext={typeof selectedOutcomeLabel === 'string' ? selectedOutcomeLabel : undefined} onInput={event => onSelectedTickChange(event.currentTarget.value)} />
						</div>
					</div>
					<span className='scalar-or-divider'>{UI_STRINGS.scalarOutcomePicker.orLabel}</span>
					<label className='scalar-invalid-toggle'>
						<input type='checkbox' disabled={disabled} checked={isInvalid} onChange={event => onInvalidChange(event.currentTarget.checked)} />
						<span>{UI_STRINGS.scalarOutcomePicker.invalidLabel}</span>
					</label>
				</div>
			</div>
			<DataGrid className='scalar-slider-stats'>
				{showMinMax ? <MetricField label={UI_STRINGS.scalarOutcomePicker.minValueLabel}>{details.minValueLabel}</MetricField> : undefined}
				<MetricField label={UI_STRINGS.scalarOutcomePicker.selectedTickLabel}>{selectedTickLabel}</MetricField>
				<MetricField label={showMinMax ? UI_STRINGS.scalarOutcomePicker.selectedOutcomeLabel : UI_STRINGS.scalarOutcomePicker.currentValueLabel}>{selectedOutcomeLabel}</MetricField>
				{showMinMax ? <MetricField label={UI_STRINGS.scalarOutcomePicker.maxValueLabel}>{details.maxValueLabel}</MetricField> : undefined}
			</DataGrid>
			{action === undefined ? undefined : <div className='actions'>{action}</div>}
		</div>
	)
}
