export type RepPriceSource = 'v4' | 'v3' | 'mock';
type RepPriceSourceCopy = {
    badgeLabel: string | undefined;
    linkTitle: string | undefined;
    quotedCollateralizationLabel: string;
    quotedRepPerEthLabel: string;
    tooltip: string;
};
export declare function getRepPriceSourceCopy(source: RepPriceSource | undefined): RepPriceSourceCopy;
export declare function renderRepPriceSourceLabel(source: RepPriceSource | undefined, sourceUrl: string | undefined): string | import("preact").JSX.Element | undefined;
export {};
//# sourceMappingURL=repPriceSource.d.ts.map