import type { Route } from '../types/app.js';
import type { OpenOracleView } from '@zoltar/ui-zoltar/features/types.js';
import type { SecurityPoolsView } from '../features/types.js';
export type AppPageTitleInput = {
    activeOpenOracleView: OpenOracleView;
    activeSecurityPoolsView: SecurityPoolsView;
    route: Route;
};
export declare function getAppPageTitle({ activeOpenOracleView, activeSecurityPoolsView, route }: AppPageTitleInput): "Security Pools" | "Deploy Contracts" | "Create Security Pool" | "Manage Security Pool" | "Create Open Oracle Report" | "Open Oracle Report Details" | "Open Oracle" | "Page Not Found";
export declare function formatAppDocumentTitle(pageTitle: string): string;
//# sourceMappingURL=appPageTitle.d.ts.map