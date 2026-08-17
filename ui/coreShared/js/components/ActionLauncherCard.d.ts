import type { ComponentChildren } from 'preact';
import type { ReadinessAction } from '../types/components.js';
type ActionLauncherCardProps = {
    action: ReadinessAction;
    children?: ComponentChildren;
    pending?: boolean;
    pendingLabel?: string;
    tone?: 'primary' | 'secondary';
};
export declare function ActionLauncherCard({ action, children, pending, pendingLabel, tone }: ActionLauncherCardProps): import("preact").JSX.Element | undefined;
export {};
//# sourceMappingURL=ActionLauncherCard.d.ts.map