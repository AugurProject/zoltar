import type { ComponentChildren } from 'preact';
import type { StickyContextItem } from '../types/components.js';
type StickyObjectContextProps = {
    badge?: ComponentChildren;
    children?: ComponentChildren;
    eyebrow?: string;
    items: StickyContextItem[];
    sticky?: boolean;
    title: string;
    variant?: 'context-strip' | 'default' | 'embedded-context-strip';
};
export declare function StickyObjectContext({ badge, children, eyebrow, items, sticky, title, variant }: StickyObjectContextProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=StickyObjectContext.d.ts.map