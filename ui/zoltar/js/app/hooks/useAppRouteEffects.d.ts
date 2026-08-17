type AppRoute = 'deploy' | 'not-found' | 'open-oracle' | 'zoltar';
type Props = {
    augurStatoblastDeploymentMissing: boolean;
    activeEnvironmentNonce: number;
    environmentReady: boolean;
    loadOracleReport: (reportId: string) => Promise<void>;
    navigate: (route: 'deploy' | 'open-oracle' | 'zoltar') => void;
    route: AppRoute;
    setOpenOracleFormReportId: (reportId: string) => void;
    urlOpenOracleReportId: string;
};
export declare function shouldLoadOpenOracleReportFromUrl({ environmentReady, route, urlOpenOracleReportId }: {
    environmentReady: boolean;
    route: AppRoute;
    urlOpenOracleReportId: string;
}): boolean;
export declare function useAppRouteEffects({ augurStatoblastDeploymentMissing, activeEnvironmentNonce, environmentReady, loadOracleReport, navigate, route, setOpenOracleFormReportId, urlOpenOracleReportId }: Props): void;
export {};
//# sourceMappingURL=useAppRouteEffects.d.ts.map