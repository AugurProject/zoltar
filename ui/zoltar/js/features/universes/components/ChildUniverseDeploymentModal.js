import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
import { OperationModal } from '@zoltar/ui-core-shared/components/OperationModal.js';
import { RequirementsChecklist } from '@zoltar/ui-core-shared/components/RequirementsChecklist.js';
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js';
export function ChildUniverseDeploymentModal({ actionAvailability, children, description, idleLabel, isOpen, onClose, onConfirm, pending, pendingLabel, requirements, title, tone = 'secondary' }) {
    return (_jsxs(OperationModal, { isOpen: isOpen, onClose: onClose, title: title, description: description, children: [children, _jsx(RequirementsChecklist, { items: requirements }), _jsx("div", { className: 'actions', children: _jsx(TransactionActionButton, { idleLabel: idleLabel, pendingLabel: pendingLabel, onClick: onConfirm, pending: pending, tone: tone, availability: actionAvailability }) })] }));
}
//# sourceMappingURL=ChildUniverseDeploymentModal.js.map