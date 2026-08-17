import type { ComponentChildren } from 'preact';
type LoadingTextProps = {
    announce?: boolean;
    children?: ComponentChildren;
    className?: string;
};
export declare function isLoadingText(value: ComponentChildren): value is string;
export declare function LoadingText({ announce, children, className }: LoadingTextProps): import("preact").JSX.Element;
export declare function LoadingAwareText({ children }: {
    children: ComponentChildren;
}): import("preact").JSX.Element;
export {};
//# sourceMappingURL=LoadingText.d.ts.map