import type { ComponentChildren } from 'preact';
import type { Address } from '@zoltar/shared/ethereum';
type SecurityPoolLinkProps = {
    ariaLabel?: string;
    children?: ComponentChildren;
    className?: string;
    securityPoolAddress: Address;
    selectedPoolView?: string;
    universeId?: bigint | undefined;
};
export declare function SecurityPoolLink({ ariaLabel, children, className, securityPoolAddress, selectedPoolView, universeId }: SecurityPoolLinkProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=SecurityPoolLink.d.ts.map