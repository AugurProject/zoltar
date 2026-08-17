import type { ComponentChildren } from 'preact';
import type { ActionAvailability } from '../types/components.js';
type ActionLauncherButtonProps = {
    availability?: ActionAvailability;
    className?: string;
    describedBy?: string;
    disabled?: boolean;
    idleLabel: ComponentChildren;
    onClick: () => void;
    pending?: boolean;
    pendingLabel: ComponentChildren;
    showDisabledReason?: boolean;
    tone?: 'primary' | 'secondary';
    type?: 'button' | 'submit';
};
export declare function ActionLauncherButton({ availability, className, describedBy, disabled, idleLabel, onClick, pending, pendingLabel, showDisabledReason, tone, type }: ActionLauncherButtonProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=ActionLauncherButton.d.ts.map