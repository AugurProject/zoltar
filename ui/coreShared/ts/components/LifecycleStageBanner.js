import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
import * as commonCopy from '../copy/common.js';
import { LoadingAwareText } from '../components/LoadingText.js';
import { WarningSurface } from '../components/WarningSurface.js';
function renderStageActionGroup(label, items, tone) {
    if (items.length === 0)
        return undefined;
    return (_jsxs("div", { className: 'lifecycle-stage-banner-action-group', children: [_jsx("span", { className: 'panel-label', children: label }), _jsx("div", { className: 'lifecycle-stage-banner-action-row', role: 'list', "aria-label": label, children: items.map(item => (_jsx("span", { className: `lifecycle-stage-banner-action-chip ${tone}`, role: 'listitem', children: item }, `${label}-${item}`))) })] }));
}
export function LifecycleStageBanner({ detailId, flat = false, stage }) {
    if (stage === undefined)
        return undefined;
    const hasActions = stage.availableActions.length > 0 || stage.blockedActions.length > 0;
    const actions = !hasActions ? undefined : (_jsxs("div", { className: 'lifecycle-stage-banner-actions', children: [renderStageActionGroup(commonCopy.availableNow, stage.availableActions, 'available'), renderStageActionGroup(commonCopy.blocked, stage.blockedActions, 'blocked')] }));
    if (stage.tone === 'warning')
        return (_jsxs(WarningSurface, { className: 'lifecycle-stage-banner', surface: flat ? 'flat' : 'card', children: [_jsxs("div", { className: 'lifecycle-stage-banner-main', children: [_jsx("h3", { children: stage.label }), stage.detail === undefined ? undefined : (_jsx("p", { className: 'detail', id: detailId, children: _jsx(LoadingAwareText, { children: stage.detail }) }))] }), actions] }));
    return (_jsxs("section", { className: `lifecycle-stage-banner ${stage.tone}${flat ? ' flat' : ''}`, children: [_jsxs("div", { className: 'lifecycle-stage-banner-main', children: [_jsx("h3", { children: stage.label }), stage.detail === undefined ? undefined : (_jsx("p", { className: 'detail', id: detailId, children: _jsx(LoadingAwareText, { children: stage.detail }) }))] }), actions] }));
}
//# sourceMappingURL=LifecycleStageBanner.js.map