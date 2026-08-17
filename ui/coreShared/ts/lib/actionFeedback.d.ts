import type { ComponentChildren } from 'preact';
import type { Hash } from '@zoltar/shared/ethereum';
type ActionFeedbackStatus = {
    detail: ComponentChildren;
    hash?: Hash;
    title: ComponentChildren;
    tone: 'pending' | 'success' | 'warning' | 'error';
};
export type ActionFeedback<TAction extends string> = {
    action: TAction;
    status: ActionFeedbackStatus;
};
export declare function createPendingActionFeedback<TAction extends string>(action: TAction, title: string, detail?: string): ActionFeedback<TAction>;
export declare function createSuccessActionFeedback<TAction extends string>(action: TAction, title: string, hash: Hash, detail?: string): ActionFeedback<TAction>;
export declare function createWarningActionFeedback<TAction extends string>(action: TAction, title: string, detail: string, hash?: Hash): ActionFeedback<TAction>;
export declare function createErrorActionFeedback<TAction extends string>(action: TAction, title: string, detail: string): ActionFeedback<TAction>;
export {};
//# sourceMappingURL=actionFeedback.d.ts.map