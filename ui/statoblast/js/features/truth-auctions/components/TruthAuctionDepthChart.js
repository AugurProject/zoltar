import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "preact/jsx-runtime";
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
import * as forkAuctionCopy from '@zoltar/ui-zoltar/copy/forkAuction.js';
import { useRef } from 'preact/hooks';
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js';
import { formatCurrencyInputBalance, formatRoundedCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js';
import { getVisualRatio } from '@zoltar/ui-core-shared/lib/visualMetrics.js';
const CHART_WIDTH = 560;
const CHART_HEIGHT = 180;
const CHART_PADDING = {
    bottom: 22,
    left: 6,
    right: 6,
    top: 10,
};
let nextDepthGradientId = 0;
function formatTruthAuctionPriceLabel(price) {
    return forkAuctionCopy.formatEthPerRepValue(formatRoundedCurrencyBalance(price, 18, 4));
}
function getDepthRatio(value, maxDepth) {
    return getVisualRatio({ value, maxValue: maxDepth }) ?? 0;
}
function getMarkerClassName(point, clearingTick) {
    const classNames = ['truth-auction-depth-marker'];
    if (point.tick === clearingTick)
        classNames.push('is-clearing');
    if (point.isSelected)
        classNames.push('is-selected');
    if (point.isPreviewTick)
        classNames.push('is-preview');
    return classNames.join(' ');
}
function buildDepthAreaPath(points) {
    if (points.length === 0)
        return '';
    const plotWidth = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
    const plotHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
    const baselineY = CHART_HEIGHT - CHART_PADDING.bottom;
    const stepWidth = plotWidth / points.length;
    const maxDepth = points.reduce((currentMax, point) => (point.cumulativeBidAttoEth > currentMax ? point.cumulativeBidAttoEth : currentMax), 0n);
    const toY = (value) => {
        if (value <= 0n || maxDepth <= 0n)
            return baselineY;
        return baselineY - getDepthRatio(value, maxDepth) * plotHeight;
    };
    let path = `M ${CHART_PADDING.left} ${baselineY}`;
    for (const [index, point] of points.entries()) {
        const xStart = CHART_PADDING.left + stepWidth * index;
        const xEnd = CHART_PADDING.left + stepWidth * (index + 1);
        const y = toY(point.cumulativeBidAttoEth);
        path += ` L ${xStart} ${y} L ${xEnd} ${y}`;
    }
    path += ` L ${CHART_PADDING.left + plotWidth} ${baselineY} Z`;
    return path;
}
function buildDepthLinePath(points) {
    if (points.length === 0)
        return '';
    const plotWidth = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
    const plotHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
    const baselineY = CHART_HEIGHT - CHART_PADDING.bottom;
    const stepWidth = plotWidth / points.length;
    const maxDepth = points.reduce((currentMax, point) => (point.cumulativeBidAttoEth > currentMax ? point.cumulativeBidAttoEth : currentMax), 0n);
    const toY = (value) => {
        if (value <= 0n || maxDepth <= 0n)
            return baselineY;
        return baselineY - getDepthRatio(value, maxDepth) * plotHeight;
    };
    let path = '';
    for (const [index, point] of points.entries()) {
        const xStart = CHART_PADDING.left + stepWidth * index;
        const xEnd = CHART_PADDING.left + stepWidth * (index + 1);
        const y = toY(point.cumulativeBidAttoEth);
        if (index === 0)
            path = `M ${xStart} ${y}`;
        path += ` L ${xEnd} ${y}`;
        if (index < points.length - 1) {
            const nextPoint = points[index + 1];
            if (nextPoint !== undefined)
                path += ` L ${xEnd} ${toY(nextPoint.cumulativeBidAttoEth)}`;
        }
    }
    return path;
}
export function TruthAuctionDepthChart({ clearingTick, onSelectTick, points }) {
    if (points.length === 0)
        return null;
    const plotWidth = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
    const plotHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
    const baselineY = CHART_HEIGHT - CHART_PADDING.bottom;
    const gradientIdRef = useRef(undefined);
    if (gradientIdRef.current === undefined) {
        gradientIdRef.current = `truth-auction-depth-fill-${nextDepthGradientId.toString()}`;
        nextDepthGradientId += 1;
    }
    const gradientId = gradientIdRef.current;
    const highestLoadedPrice = points[0]?.price;
    const lowestLoadedPrice = points[points.length - 1]?.price;
    const midpointIndex = points.length >= 3 ? Math.floor(points.length / 2) : undefined;
    const midpointPrice = midpointIndex === undefined ? undefined : points[midpointIndex]?.price;
    const maxLoadedDepth = points.reduce((currentMax, point) => (point.cumulativeBidAttoEth > currentMax ? point.cumulativeBidAttoEth : currentMax), 0n);
    const midpointDepth = maxLoadedDepth >= 2n ? maxLoadedDepth / 2n : undefined;
    const getDepthYPosition = (value) => {
        if (value <= 0n || maxLoadedDepth <= 0n)
            return baselineY;
        return baselineY - getDepthRatio(value, maxLoadedDepth) * plotHeight;
    };
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: 'truth-auction-depth-frame', children: [_jsxs("div", { className: 'truth-auction-depth-y-axis', children: [_jsx("span", { className: 'truth-auction-depth-axis-title truth-auction-depth-axis-title-y', children: forkAuctionCopy.loadedDepthEth }), _jsxs("div", { className: 'truth-auction-depth-y-ticks', "aria-hidden": 'true', children: [_jsx("span", { className: 'truth-auction-depth-axis-tick truth-auction-depth-y-tick is-max', style: { top: `${(getDepthYPosition(maxLoadedDepth) / CHART_HEIGHT) * 100}%` }, children: _jsx(CurrencyValue, { copyable: false, value: maxLoadedDepth, suffix: commonCopy.eth }) }), midpointDepth === undefined ? undefined : (_jsx("span", { className: 'truth-auction-depth-axis-tick truth-auction-depth-y-tick is-mid', style: { top: `${(getDepthYPosition(midpointDepth) / CHART_HEIGHT) * 100}%` }, children: _jsx(CurrencyValue, { copyable: false, value: midpointDepth, suffix: commonCopy.eth }) })), _jsx("span", { className: 'truth-auction-depth-axis-tick truth-auction-depth-y-tick is-min', style: { top: `${(getDepthYPosition(0n) / CHART_HEIGHT) * 100}%` }, children: forkAuctionCopy.zeroEth })] })] }), _jsxs("div", { className: 'truth-auction-depth-chart', role: 'group', "aria-label": forkAuctionCopy.truthAuctionVisibleDepthChart, children: [_jsxs("svg", { "aria-hidden": 'true', viewBox: `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`, preserveAspectRatio: 'none', children: [_jsx("defs", { children: _jsxs("linearGradient", { id: gradientId, x1: '0%', x2: '100%', y1: '0%', y2: '0%', children: [_jsx("stop", { offset: '0%', "stop-color": '#e8a644', "stop-opacity": '0.28' }), _jsx("stop", { offset: '100%', "stop-color": '#3e9f78', "stop-opacity": '0.28' })] }) }), _jsx("rect", { className: 'truth-auction-depth-base', height: CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom, rx: '14', ry: '14', width: plotWidth, x: CHART_PADDING.left, y: CHART_PADDING.top }), _jsx("path", { className: 'truth-auction-depth-area', d: buildDepthAreaPath(points), fill: `url(#${gradientId})` }), _jsx("path", { className: 'truth-auction-depth-line', d: buildDepthLinePath(points) })] }), _jsx("div", { className: 'truth-auction-depth-hit-targets', children: points.map((point, index) => (_jsx("button", { "aria-label": forkAuctionCopy.formatSelectPriceValueEthRepFromDepthChart(formatCurrencyInputBalance(point.price)), "aria-pressed": point.isSelected, className: 'truth-auction-depth-hit-target', onClick: () => onSelectTick(point.tick), style: {
                                        left: `${(index / points.length) * 100}%`,
                                        width: `${100 / points.length}%`,
                                    }, type: 'button', children: _jsx("span", { className: getMarkerClassName(point, clearingTick), children: _jsx("span", { className: 'truth-auction-depth-marker-dot' }) }) }, point.tick.toString()))) })] })] }), _jsxs("div", { className: `truth-auction-depth-x-axis${midpointPrice === undefined ? ' no-midpoint' : ''}`, children: [highestLoadedPrice === undefined ? undefined : _jsx("span", { className: 'truth-auction-depth-axis-tick truth-auction-depth-x-tick is-max', children: formatTruthAuctionPriceLabel(highestLoadedPrice) }), midpointPrice === undefined ? undefined : _jsx("span", { className: 'truth-auction-depth-axis-tick truth-auction-depth-x-tick is-mid', children: formatTruthAuctionPriceLabel(midpointPrice) }), lowestLoadedPrice === undefined ? undefined : _jsx("span", { className: 'truth-auction-depth-axis-tick truth-auction-depth-x-tick is-min', children: formatTruthAuctionPriceLabel(lowestLoadedPrice) })] }), _jsx("div", { className: 'truth-auction-depth-axis-title truth-auction-depth-axis-title-x', children: forkAuctionCopy.priceEthPerRep })] }));
}
//# sourceMappingURL=TruthAuctionDepthChart.js.map