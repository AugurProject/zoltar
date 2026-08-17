type UrlState = {
    activeUniverseId: bigint;
    openOracleView: string;
    openOracleReportId: string;
    securityPoolsView: string;
    selectedPoolView: string;
    securityPoolAddress: string;
    securityPoolQuestionId: string;
    zoltarView: string;
};
type UseUrlStateResult = UrlState & {
    setActiveUniverseId: (universeId: bigint | undefined) => void;
    setOpenOracleReport: (reportId: string | undefined) => void;
    setOpenOracleView: (view: string | undefined) => void;
    setSecurityPoolsView: (view: string | undefined) => void;
    setSelectedPoolView: (view: string | undefined) => void;
    setSecurityPoolAddress: (securityPoolAddress: string) => void;
    setSecurityPoolQuestionId: (questionId: string | undefined) => void;
    setZoltarView: (view: string | undefined) => void;
};
export declare function useUrlState(): UseUrlStateResult;
export {};
//# sourceMappingURL=useUrlState.d.ts.map