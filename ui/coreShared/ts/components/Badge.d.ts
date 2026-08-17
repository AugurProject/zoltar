import type { ComponentChildren } from 'preact';
import type { BadgeTone } from '../types/components.js';
type BadgeProps = {
    ariaLabel?: string;
    children: ComponentChildren;
    className?: string;
    title?: string;
    tone?: BadgeTone;
};
export declare function Badge({ ariaLabel, children, className, title, tone }: BadgeProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=Badge.d.ts.map