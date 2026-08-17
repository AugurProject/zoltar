import { type ComponentChildren } from 'preact';
import type { GlobalTransactionPresentation } from '../types/components.js';
export declare function GlobalTransactionPresentationProvider({ children, transaction }: {
    children: ComponentChildren;
    transaction: GlobalTransactionPresentation | undefined;
}): import("preact").JSX.Element;
export declare function useGlobalTransactionPresentation(): GlobalTransactionPresentation | undefined;
export declare function isPendingGlobalTransactionPresentation(transaction: GlobalTransactionPresentation | undefined): boolean;
//# sourceMappingURL=GlobalTransactionPresentationContext.d.ts.map