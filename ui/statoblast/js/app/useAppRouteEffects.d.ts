import type { Address } from '@zoltar/shared/ethereum';
import type { Route } from '../types/app.js';
type Props = {
    accountAddress: Address | undefined;
    augurStatoblastDeploymentMissing: boolean;
    activeEnvironmentNonce: number;
    environmentReady: boolean;
    loadOracleReport: (reportId: string) => Promise<void>;
    loadSecurityPools: (securityPoolAddress?: string) => Promise<boolean | void>;
    navigate: (route: 'deploy' | 'open-oracle' | 'security-pools') => void;
    resetSecurityPoolCreation: () => void;
    route: Route;
    securityPoolAddress: string;
    securityPoolQuestionId: string;
    securityPoolResultHash: string | undefined;
    selectedPoolSecurityPoolAddress: string | undefined;
    setForkAuctionFormSecurityPoolAddress: (securityPoolAddress: string) => void;
    setOpenOracleFormReportId: (reportId: string) => void;
    setReportingFormSecurityPoolAddress: (securityPoolAddress: string) => void;
    setSecurityVaultFormSelectedVaultOwner: (selectedVaultOwner: string) => void;
    setSecurityVaultFormSecurityPoolAddress: (securityPoolAddress: string) => void;
    setSecurityPoolFormMarketId: (marketId: string) => void;
    setTradingFormSecurityPoolAddress: (securityPoolAddress: string) => void;
    tradingResultHash: string | undefined;
    urlOpenOracleReportId: string;
    walletBootstrapComplete: boolean;
};
export declare function shouldLoadOpenOracleReportFromUrl({ environmentReady, route, urlOpenOracleReportId }: {
    environmentReady: boolean;
    route: Route;
    urlOpenOracleReportId: string;
}): boolean;
export declare function shouldRefreshSelectedPoolForRoute({ environmentReady, route, securityPoolAddress, selectedPoolSecurityPoolAddress, walletBootstrapComplete }: {
    environmentReady: boolean;
    route: Route;
    securityPoolAddress: string;
    selectedPoolSecurityPoolAddress: string | undefined;
    walletBootstrapComplete: boolean;
}): boolean;
export declare function shouldSyncSecurityPoolAddressToRouteForms({ route }: {
    route: Route;
    securityPoolAddress: string;
}): boolean;
export declare function getSelectedVaultOwnerForRoutePoolChange({ accountAddress, lastSecurityPoolAddress, route, securityPoolAddress }: {
    accountAddress: Address | undefined;
    lastSecurityPoolAddress: string | undefined;
    route: Route;
    securityPoolAddress: string;
}): string | undefined;
export declare function useAppRouteEffects({ accountAddress, augurStatoblastDeploymentMissing, activeEnvironmentNonce, environmentReady, loadOracleReport, loadSecurityPools, navigate, resetSecurityPoolCreation, route, securityPoolAddress, securityPoolQuestionId, securityPoolResultHash, selectedPoolSecurityPoolAddress, setForkAuctionFormSecurityPoolAddress, setOpenOracleFormReportId, setReportingFormSecurityPoolAddress, setSecurityVaultFormSelectedVaultOwner, setSecurityVaultFormSecurityPoolAddress, setSecurityPoolFormMarketId, setTradingFormSecurityPoolAddress, tradingResultHash, urlOpenOracleReportId, walletBootstrapComplete, }: Props): void;
export {};
//# sourceMappingURL=useAppRouteEffects.d.ts.map