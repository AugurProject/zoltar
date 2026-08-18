export type AppRoute = string;
export type RouteDefinition = {
    readonly hash: string;
    readonly name: AppRoute;
    readonly queryParameters?: ReadonlySet<string>;
};
export type RoutingConfig = {
    readonly defaultRoute: AppRoute;
    readonly routes: readonly RouteDefinition[];
};
type RoutingState = {
    readonly config: RoutingConfig;
    readonly routeByHash: Readonly<Record<string, AppRoute>>;
    readonly hashByRoute: Readonly<Record<string, string>>;
    readonly queryParametersByRoute: Readonly<Record<string, ReadonlySet<string>>>;
};
declare global {
    var __zoltarActiveRoutingState__: RoutingState | undefined;
}
export declare function installRouting(config: RoutingConfig): void;
export declare function resetRoutingForTesting(): void;
export declare function getRouteHashForName(route: AppRoute): string;
export declare function ensureRouteHash(): void;
export declare function getCurrentRoute(): AppRoute | 'not-found';
export declare function getRouteHash(route: AppRoute): string;
export declare function getRouteHashSearch(hash?: string): string;
export declare function getTopLevelRouteSearch(nextRoute: AppRoute, search?: string, preservedParameters?: ReadonlySet<string>): string;
export declare function getCurrentRouteHash(): string;
export declare function buildRouteHref(routeHash: string, search: string): string;
export {};
//# sourceMappingURL=routing.d.ts.map