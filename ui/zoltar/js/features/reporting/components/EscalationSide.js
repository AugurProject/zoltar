import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
import * as forkAuctionCopy from '../../../copy/forkAuction.js';
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js';
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js';
function getChartRatio(value, maxValue) {
    if (value === undefined || value <= 0n || maxValue <= 0n)
        return '0%';
    const basisPoints = (value * 10000n) / maxValue;
    const wholePercent = basisPoints / 100n;
    const fractionalPercent = (basisPoints % 100n).toString().padStart(2, '0');
    return `${wholePercent.toString()}.${fractionalPercent}%`;
}
function getArrowKeyDirection(key) {
    if (key === 'ArrowRight' || key === 'ArrowDown')
        return 1;
    if (key === 'ArrowLeft' || key === 'ArrowUp')
        return -1;
    return 0;
}
function moveSelectionWithArrowKey(event) {
    const direction = getArrowKeyDirection(event.key);
    if (direction === 0)
        return;
    const currentRadio = event.currentTarget;
    if (!(currentRadio instanceof HTMLElement))
        return;
    const radioGroup = currentRadio.closest('[role="radiogroup"]');
    if (!(radioGroup instanceof HTMLElement))
        return;
    const enabledRadios = Array.from(radioGroup.querySelectorAll('[role="radio"]')).filter(radio => !radio.hasAttribute('disabled') && radio.getAttribute('aria-disabled') !== 'true');
    const currentIndex = enabledRadios.indexOf(currentRadio);
    if (currentIndex === -1 || enabledRadios.length === 0)
        return;
    event.preventDefault();
    const nextRadio = enabledRadios[(currentIndex + direction + enabledRadios.length) % enabledRadios.length];
    nextRadio?.focus();
    nextRadio?.click();
}
export function EscalationSide({ bindingCapital, chartScaleMax, disabled = false, isLeading, isSelected, isTabStop, onSelect, side }) {
    const tabIndex = (() => {
        if (disabled)
            return undefined;
        return isTabStop ? 0 : -1;
    })();
    return (_jsx("button", { "aria-checked": isSelected, className: `escalation-side ${isSelected ? 'selected' : ''} ${isLeading ? 'leading' : ''}`, disabled: disabled, onClick: onSelect, onKeyDown: moveSelectionWithArrowKey, role: 'radio', style: {
            '--binding-ratio': getChartRatio(bindingCapital, chartScaleMax),
            '--side-ratio': getChartRatio(side.balance, chartScaleMax),
            '--user-ratio': getChartRatio(side.userStake, chartScaleMax),
        }, tabIndex: tabIndex, type: 'button', children: _jsxs("div", { className: 'escalation-side-row', children: [_jsx("div", { className: 'escalation-side-copy', children: _jsxs("div", { className: 'escalation-side-title-row', children: [_jsx("span", { className: 'panel-label', children: side.label }), isLeading || isSelected ? (_jsxs("div", { className: 'escalation-side-badges', children: [isSelected ? _jsx(Badge, { className: 'escalation-side-selected-badge', children: commonCopy.selected }) : undefined, isLeading ? _jsx(Badge, { tone: 'ok', children: forkAuctionCopy.leading }) : undefined] })) : undefined] }) }), _jsx("div", { "aria-hidden": 'true', className: 'escalation-side-chart', children: _jsxs("div", { className: 'escalation-side-track', children: [_jsx("div", { className: 'escalation-side-total-bar' }), _jsx("div", { className: 'escalation-side-user-bar' }), _jsx("div", { className: 'escalation-side-binding-marker' })] }) }), _jsxs("div", { className: 'escalation-side-values', children: [_jsxs("div", { className: 'escalation-side-value', children: [_jsx("span", { className: 'metric-label', children: forkAuctionCopy.totalDisputeStakedRep }), _jsx(CurrencyValue, { copyable: false, value: side.balance, suffix: commonCopy.rep })] }), _jsxs("div", { className: 'escalation-side-value', children: [_jsx("span", { className: 'metric-label', children: forkAuctionCopy.yourDisputeStakedRep }), _jsx(CurrencyValue, { copyable: false, value: side.userStake, suffix: commonCopy.rep })] })] })] }) }));
}
//# sourceMappingURL=EscalationSide.js.map