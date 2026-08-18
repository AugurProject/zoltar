import type { ForkWorkflowSelectionStage, SelectedPoolView } from '../../security-pools/lib/securityPoolWorkflow.js';
type UseForkWorkflowSelectionStateParameters = {
    currentForkWorkflowSelectionStage: ForkWorkflowSelectionStage;
    legacyForkWorkflowSelectionStage: ForkWorkflowSelectionStage | undefined;
    onSelectedStageViewChange: (stage: ForkWorkflowSelectionStage) => void;
    selectedPoolAddress: string | undefined;
    view: SelectedPoolView;
};
export declare function useForkWorkflowSelectionState({ currentForkWorkflowSelectionStage, legacyForkWorkflowSelectionStage, onSelectedStageViewChange, selectedPoolAddress, view }: UseForkWorkflowSelectionStateParameters): {
    forkWorkflowSelectionStage: "migration" | "auction" | "settlement" | "fork-triggered";
    onForkWorkflowSelectionStageChange: (stage: ForkWorkflowSelectionStage) => void;
};
export {};
//# sourceMappingURL=useForkWorkflowSelectionState.d.ts.map