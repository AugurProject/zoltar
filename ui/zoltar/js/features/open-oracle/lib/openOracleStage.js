import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js';
import { formatDuration } from '@zoltar/ui-core-shared/lib/formatters.js';
function getDisputeWindowPendingPresentation(report) {
    const currentClock = report.timeType ? report.currentTime : report.currentBlockNumber;
    const disputeStart = report.reportTimestamp + report.disputeDelay;
    if (currentClock >= disputeStart)
        return undefined;
    const remaining = disputeStart - currentClock;
    const duration = report.timeType ? formatDuration(remaining) : `${remaining.toString()} block${remaining === 1n ? '' : 's'}`;
    return {
        availableActions: [],
        blockedActions: [],
        detail: `Disputes open in ${duration}.`,
        key: 'dispute-pending',
        label: 'Waiting For Dispute Window',
        tone: 'warning',
    };
}
export function getOpenOracleStagePresentation(actionMode, report) {
    switch (actionMode) {
        case 'dispute':
            if (report !== undefined) {
                const pendingPresentation = getDisputeWindowPendingPresentation(report);
                if (pendingPresentation !== undefined)
                    return pendingPresentation;
            }
            return {
                availableActions: [],
                blockedActions: [],
                key: 'dispute-window',
                label: 'Dispute Window Open',
                tone: 'default',
            };
        case 'settle':
            return {
                availableActions: [],
                blockedActions: [],
                key: 'ready-to-settle',
                label: 'Ready To Settle',
                tone: 'success',
            };
        case 'read-only':
            return {
                availableActions: [],
                blockedActions: [],
                key: 'settled',
                label: 'Settled',
                tone: 'success',
            };
        default:
            return assertNever(actionMode);
    }
}
//# sourceMappingURL=openOracleStage.js.map