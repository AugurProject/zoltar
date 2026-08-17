import { jsx as _jsx } from "preact/jsx-runtime";
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js';
import { EntityCard } from '@zoltar/ui-core-shared/components/EntityCard.js';
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js';
import { UniverseLink } from './UniverseLink.js';
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js';
export function ChildUniverseStatusBadge({ child }) {
    return _jsx(Badge, { tone: child.exists ? 'ok' : 'pending', children: child.exists ? commonCopy.exists : commonCopy.notDeployed });
}
export function ChildUniversesSection({ action, childUniverses, emptyMessage, headerSubtitle, headerTitle, renderBody, renderBadge, renderTitle, surface }) {
    return (_jsx(WorkflowSubsection, { badge: headerSubtitle === undefined ? undefined : _jsx("span", { className: 'detail', children: headerSubtitle }), className: 'child-universes-section', title: headerTitle, children: childUniverses.length === 0 ? (_jsx("p", { className: 'detail', children: emptyMessage })) : (_jsx("div", { className: 'entity-card-list', children: childUniverses.map(child => {
                const childAction = action?.(child);
                return (_jsx(EntityCard, { surface: surface, className: 'compact', title: renderTitle === undefined ? _jsx(UniverseLink, { universeId: child.universeId }) : renderTitle(child), badge: renderBadge === undefined ? undefined : renderBadge(child), actions: childAction === undefined ? undefined : (_jsx(TransactionActionButton, { idleLabel: childAction.label, pendingLabel: childAction.pendingLabel ?? commonCopy.working, onClick: childAction.onClick, pending: childAction.pending === true, tone: childAction.tone ?? 'secondary', availability: childAction.availability ?? { disabled: false, reason: undefined }, showDisabledReason: childAction.showDisabledReason ?? false })), children: renderBody(child) }, child.universeId.toString()));
            }) })) }));
}
//# sourceMappingURL=ChildUniversesSection.js.map