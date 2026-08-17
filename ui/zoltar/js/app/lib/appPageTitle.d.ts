import type { Route } from '../../types/app.js';
import type { OpenOracleView, ZoltarView } from '../../features/types.js';
export type AppPageTitleInput = {
    activeOpenOracleView: OpenOracleView;
    activeZoltarView: ZoltarView;
    route: Route;
};
export declare function getAppPageTitle({ activeOpenOracleView, activeZoltarView, route }: AppPageTitleInput): any;
export declare function formatAppDocumentTitle(pageTitle: string): string;
//# sourceMappingURL=appPageTitle.d.ts.map