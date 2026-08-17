import type { ReadBackendStatus } from '../../lib/chainBackend.js';
type AppStatusNoticesProps = {
    errorMessage?: string | undefined;
    errorMessages?: readonly string[];
    loadingZoltarUniverse?: boolean;
    onRetryZoltarUniverse?: (() => void) | undefined;
    readBackendMessage: string | undefined;
    readBackendStatus?: ReadBackendStatus | undefined;
    simulationBootstrapError: string | undefined;
    showAugurStatoblastDeploymentWarning: boolean;
    zoltarUniverseError?: string | undefined;
};
export declare function AppStatusNotices({ errorMessage, errorMessages, loadingZoltarUniverse, onRetryZoltarUniverse, readBackendMessage, readBackendStatus, simulationBootstrapError, showAugurStatoblastDeploymentWarning, zoltarUniverseError }: AppStatusNoticesProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=AppStatusNotices.d.ts.map