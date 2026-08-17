import type { ComponentChildren } from 'preact';
type EntityCardProps = {
    actions?: ComponentChildren;
    badge?: ComponentChildren;
    children: ComponentChildren;
    className?: string;
    surface?: 'card' | 'flat';
    title: ComponentChildren;
    variant?: 'compact' | 'record';
};
export declare function EntityCard({ actions, badge, children, className, surface, title, variant }: EntityCardProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=EntityCard.d.ts.map