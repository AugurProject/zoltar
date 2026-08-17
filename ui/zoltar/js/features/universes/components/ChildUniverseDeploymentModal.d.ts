import type { ComponentChildren } from 'preact';
import type { ActionAvailability, ReadinessBlocker } from '../../types.js';
type ChildUniverseDeploymentModalProps = {
    actionAvailability: ActionAvailability;
    children?: ComponentChildren;
    description?: ComponentChildren;
    idleLabel: ComponentChildren;
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    pending: boolean;
    pendingLabel: ComponentChildren;
    requirements: ReadinessBlocker[];
    title: ComponentChildren;
    tone?: 'primary' | 'secondary';
};
export declare function ChildUniverseDeploymentModal({ actionAvailability, children, description, idleLabel, isOpen, onClose, onConfirm, pending, pendingLabel, requirements, title, tone }: ChildUniverseDeploymentModalProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=ChildUniverseDeploymentModal.d.ts.map