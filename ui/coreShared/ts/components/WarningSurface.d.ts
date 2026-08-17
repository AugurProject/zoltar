import type { ComponentChildren, JSX } from 'preact';
type WarningSurfaceProps = {
    ariaLive?: 'assertive' | 'polite';
    as?: 'article' | 'div' | 'section';
    children: ComponentChildren;
    className?: string;
    role?: JSX.AriaRole | undefined;
    surface?: 'card' | 'flat';
    variant?: 'compact' | 'default';
};
export declare function WarningSurface({ ariaLive, as, children, className, role, surface, variant }: WarningSurfaceProps): JSX.Element;
export {};
//# sourceMappingURL=WarningSurface.d.ts.map