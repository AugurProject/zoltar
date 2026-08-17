import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
import * as commonCopy from '../copy/common.js';
import { DataGrid } from '../components/DataGrid.js';
import { FormInput } from '../components/FormInput.js';
import { MetricField } from '../components/MetricField.js';
import { tryParseBigIntInput } from '../lib/integerInput.js';
import { MAX_PRECISE_SCALAR_TICK_COUNT, clampScalarTickIndex, getScalarSliderFillWidth } from '../lib/scalarOutcome.js';
import { useEffect, useId, useState } from 'preact/hooks';
function getSafeSelectedTickValue(selectedTick) {
    return selectedTick.trim() === '' ? 0n : (tryParseBigIntInput(selectedTick) ?? 0n);
}
export function ScalarOutcomePicker({ action, details, disabled = false, isInvalid, label, onInvalidChange, onSelectedTickChange, selectedOutcomeLabel, selectedTick, selectedTickLabel, showMinMax = true }) {
    const sliderLabelId = useId();
    const selectedTickValue = clampScalarTickIndex(getSafeSelectedTickValue(selectedTick), details.numTicks);
    const resolvedSelectedTick = selectedTickValue.toString();
    const canUseNativeSlider = details.numTicks <= MAX_PRECISE_SCALAR_TICK_COUNT;
    const [exactTickInputValue, setExactTickInputValue] = useState(resolvedSelectedTick);
    useEffect(() => {
        setExactTickInputValue(resolvedSelectedTick);
    }, [resolvedSelectedTick]);
    return (_jsxs("div", { className: 'market-scalar-deploy workflow-subsection', children: [_jsxs("div", { className: 'field scalar-slider-field', children: [_jsx("span", { id: sliderLabelId, children: label }), _jsxs("div", { className: 'scalar-slider-with-invalid', children: [canUseNativeSlider ? (_jsxs("div", { className: `scalar-slider-rail ${isInvalid ? 'is-disabled' : ''}`, children: [_jsx("div", { className: 'scalar-slider-track' }), _jsxs("div", { className: 'scalar-slider-input-wrapper', children: [_jsx("div", { className: 'scalar-slider-fill', style: { '--slider-fill': isInvalid ? '0%' : getScalarSliderFillWidth(selectedTickValue, details.numTicks) } }), _jsx("input", { "aria-labelledby": sliderLabelId, disabled: disabled || isInvalid, type: 'range', min: '0', max: details.numTicks.toString(), step: '1', value: resolvedSelectedTick, "aria-valuetext": typeof selectedOutcomeLabel === 'string' ? selectedOutcomeLabel : undefined, onInput: event => onSelectedTickChange(event.currentTarget.value) })] })] })) : (_jsx(FormInput, { "aria-labelledby": sliderLabelId, className: 'scalar-exact-tick-input', disabled: disabled || isInvalid, inputMode: 'numeric', value: exactTickInputValue, onBlur: () => setExactTickInputValue(resolvedSelectedTick), onInput: (event) => {
                                    const nextInputValue = event.currentTarget.value;
                                    setExactTickInputValue(nextInputValue);
                                    const parsedTick = tryParseBigIntInput(nextInputValue);
                                    if (parsedTick === undefined)
                                        return;
                                    onSelectedTickChange(clampScalarTickIndex(parsedTick, details.numTicks).toString());
                                } })), _jsx("span", { className: 'scalar-or-divider', children: commonCopy.or }), _jsxs("label", { className: 'scalar-invalid-toggle', children: [_jsx("input", { type: 'checkbox', disabled: disabled, checked: isInvalid, onChange: event => onInvalidChange(event.currentTarget.checked) }), _jsx("span", { children: commonCopy.invalid })] })] })] }), _jsxs(DataGrid, { className: 'scalar-slider-stats', children: [showMinMax ? _jsx(MetricField, { label: commonCopy.minValue, children: details.minValueLabel }) : undefined, _jsx(MetricField, { label: commonCopy.selectedTick, children: selectedTickLabel }), _jsx(MetricField, { label: showMinMax ? commonCopy.selectedOutcome : commonCopy.currentValue, children: selectedOutcomeLabel }), showMinMax ? _jsx(MetricField, { label: commonCopy.maxValue, children: details.maxValueLabel }) : undefined] }), action === undefined ? undefined : _jsx("div", { className: 'actions', children: action })] }));
}
//# sourceMappingURL=ScalarOutcomePicker.js.map