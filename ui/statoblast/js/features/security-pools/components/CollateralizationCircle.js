import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "preact/jsx-runtime";
import * as pricingCopy from '@zoltar/ui-core-shared/copy/pricing.js';
import { formatCollateralizationCompactPercentLabel, getCollateralizationVisualPercent, getToneRatioThreshold, getVisualRatio } from '@zoltar/ui-core-shared/lib/visualMetrics.js';
const MAX_RING_COLLATERALIZATION_PERCENT = 999n * 10n ** 18n;
function getOverflowStatus(collateralizationPercent, targetCollateralizationPercent) {
    if (collateralizationPercent === undefined || targetCollateralizationPercent === undefined)
        return pricingCopy.aboveDisplayRange;
    if (collateralizationPercent > targetCollateralizationPercent)
        return pricingCopy.aboveTarget;
    if (collateralizationPercent < targetCollateralizationPercent)
        return pricingCopy.belowTarget;
    return pricingCopy.atTarget;
}
export function CollateralizationCircle({ collateralizationPercent, className = '', label = pricingCopy.collateralizationLabel, size = 'medium', successThreshold = 1, targetCollateralizationPercent, tone, warningThreshold = 0.65 }) {
    const toneRatio = getVisualRatio({ value: collateralizationPercent, maxValue: targetCollateralizationPercent });
    const resolvedTone = tone ??
        getToneRatioThreshold({
            ratio: toneRatio,
            successThreshold,
            warningThreshold,
        });
    const collateralizationVisualPercent = getCollateralizationVisualPercent({
        collateralizationPercent,
        targetCollateralizationPercent,
    });
    const displayValue = formatCollateralizationCompactPercentLabel(collateralizationPercent);
    const collateralizationCircleRadius = 46 * 0.8;
    const circumference = 2 * Math.PI * collateralizationCircleRadius;
    const clampedCollateralizationVisualPercent = collateralizationVisualPercent === undefined ? 0 : Math.max(0, Math.min(100, collateralizationVisualPercent));
    const strokeDashoffset = circumference - circumference * (clampedCollateralizationVisualPercent / 100);
    const displayValueFitsInRing = collateralizationPercent === undefined || collateralizationPercent <= MAX_RING_COLLATERALIZATION_PERCENT;
    const ringDisplayValue = displayValueFitsInRing ? displayValue : pricingCopy.aboveRingRange;
    const targetDisplayValue = formatCollateralizationCompactPercentLabel(targetCollateralizationPercent);
    const exactValueTitle = collateralizationPercent === undefined ? pricingCopy.formatValueUnavailable(label) : pricingCopy.formatCollateralizationWithTarget(label, displayValue, targetDisplayValue);
    const overflowStatus = getOverflowStatus(collateralizationPercent, targetCollateralizationPercent);
    return (_jsxs("div", { className: ['collateralization-gauge', `collateralization-gauge-size-${size}`, resolvedTone === undefined ? '' : `tone-${resolvedTone}`, className].filter(Boolean).join(' ').trim(), title: exactValueTitle, children: [_jsx("span", { className: 'collateralization-gauge-ring', children: _jsxs("svg", { className: 'collateralization-gauge-svg', viewBox: '0 0 100 100', "aria-hidden": 'true', children: [_jsx("circle", { className: 'collateralization-gauge-track', cx: '50', cy: '50', r: collateralizationCircleRadius }), _jsx("circle", { className: 'collateralization-gauge-progress', cx: '50', cy: '50', r: collateralizationCircleRadius, strokeDasharray: `${circumference}`, strokeDashoffset: `${strokeDashoffset}` })] }) }), _jsx("strong", { className: 'collateralization-gauge-value', children: ringDisplayValue }), _jsxs("span", { className: 'collateralization-gauge-copy', children: [_jsx("span", { className: 'collateralization-gauge-label', children: label }), displayValueFitsInRing ? undefined : (_jsxs(_Fragment, { children: [_jsx("strong", { className: 'collateralization-gauge-status', children: overflowStatus }), _jsx("span", { className: 'collateralization-gauge-exact', children: displayValue })] })), _jsx("span", { className: 'collateralization-gauge-target', children: pricingCopy.formatTargetValue(targetDisplayValue) })] })] }));
}
//# sourceMappingURL=CollateralizationCircle.js.map