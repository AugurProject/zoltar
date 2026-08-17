import type { ComponentChildren } from 'preact';
import type { UserMessagePresentation } from '../lib/userCopy.js';
type StateHintProps = {
    actions?: ComponentChildren;
    announcement?: 'assertive' | 'polite';
    className?: string;
    id?: string | undefined;
    presentation: UserMessagePresentation;
    title?: ComponentChildren;
};
export declare function StateHint({ actions, announcement, className, id, presentation, title }: StateHintProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=StateHint.d.ts.map