import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js';
import { getEscalationPhase, isPoolQuestionFinalized } from '@zoltar/ui-zoltar/features/reporting/lib/reportingDomain.js';
export function isSecurityPoolEnded({ hasForkActivity, isChildPool, questionOutcome, systemState, universeHasForked, }) {
    if (universeHasForked === true && systemState === 'operational' && isChildPool !== true)
        return false;
    return systemState === 'operational' && hasForkActivity !== true && questionOutcome !== undefined && questionOutcome !== 'none';
}
export function deriveSecurityPoolLifecycleState({ hasForkActivity, isChildPool, questionOutcome, systemState, universeHasForked, }) {
    if (systemState === undefined)
        return undefined;
    if (universeHasForked === true && systemState === 'operational' && isChildPool !== true)
        return 'poolForked';
    if (isSecurityPoolEnded({ hasForkActivity, isChildPool, questionOutcome, systemState, universeHasForked }))
        return 'ended';
    return systemState;
}
export function deriveSecurityPoolReportingStage({ reportingDetails, reportingReady }) {
    if (reportingReady === false)
        return 'preOpen';
    if (reportingDetails === undefined)
        return undefined;
    if (isPoolQuestionFinalized(reportingDetails))
        return 'resolved';
    if (reportingDetails.status === 'not-started')
        return 'notStarted';
    const escalationPhase = getEscalationPhase(reportingDetails);
    switch (escalationPhase) {
        case 'Resolved':
            return 'resolved';
        case 'Fork Triggered':
            return 'forkTriggered';
        case 'Timed Out':
            return 'timedOut';
        case 'Pending Start':
        case 'Active':
            if (reportingDetails.settlementState === 'migration-required' || reportingDetails.settlementState === 'migration-expired')
                return 'forkTriggered';
            return reportingDetails.parentWithdrawalEnabled ? 'activeWithdrawable' : 'activeLocked';
        default:
            return assertNever(escalationPhase);
    }
}
export function deriveSecurityPoolForkStage({ currentStage, workflowDisabled }) {
    if (workflowDisabled === true)
        return 'disabled';
    if (currentStage === undefined)
        return undefined;
    return currentStage;
}
//# sourceMappingURL=axes.js.map