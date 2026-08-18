import type { SecurityPoolActionId, SecurityPoolForkStage, SecurityPoolLifecycleState, SecurityPoolReportingStage } from './types.js';
type ActionList = readonly SecurityPoolActionId[];
export declare const ALL_SECURITY_POOL_ACTIONS: ActionList;
export declare const LIFECYCLE_ACTIONS: ActionList;
export declare const REPORTING_ACTIONS: ActionList;
export declare const FORK_ACTIONS: ActionList;
export declare const ENABLED_ACTIONS_BY_LIFECYCLE: Record<SecurityPoolLifecycleState, ActionList>;
export declare const ENABLED_ACTIONS_BY_REPORTING_STAGE: Record<SecurityPoolReportingStage, ActionList>;
export declare const ENABLED_ACTIONS_BY_FORK_STAGE: Record<SecurityPoolForkStage, ActionList>;
export declare const UNIVERSE_FORKED_ENABLE: ActionList;
export declare const UNIVERSE_FORKED_DISABLE: ActionList;
export {};
//# sourceMappingURL=matrix.d.ts.map