import { getEscalationPhase, isPoolQuestionFinalized } from './reportingDomain.js';
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js';
import { formatRelativeTimestamp, formatTimestamp } from '@zoltar/ui-core-shared/lib/formatters.js';
const REPORTING_OUTCOME_OPTIONS = [
    { key: 'invalid', label: 'Invalid' },
    { key: 'yes', label: 'Yes' },
    { key: 'no', label: 'No' },
];
export const REPORTING_OUTCOME_DROPDOWN_OPTIONS = REPORTING_OUTCOME_OPTIONS.map(option => ({
    value: option.key,
    label: option.label,
}));
export function getReportingOutcomeLabel(outcome) {
    switch (outcome) {
        case 'invalid':
            return 'Invalid';
        case 'yes':
            return 'Yes';
        case 'no':
            return 'No';
        case 'none':
            return 'Unresolved';
        default:
            return assertNever(outcome);
    }
}
export function getReportingLockedUntilMessage(endTime, currentTimestamp) {
    if (currentTimestamp === undefined)
        return `Reporting opens when this pool's underlying question ends: ${formatTimestamp(endTime)}.`;
    return `Reporting opens when this pool's underlying question ends: ${formatTimestamp(endTime)} (${formatRelativeTimestamp(endTime, currentTimestamp)}).`;
}
export function hasReportingOpened(endTime, currentTimestamp) {
    if (currentTimestamp === undefined)
        return undefined;
    return currentTimestamp > endTime;
}
export function deriveReportingStage({ reportingDetails, reportingReady }) {
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
export function isReportingOutcomeEnabled(stage) {
    return stage === 'notStarted' || stage === 'activeLocked' || stage === 'activeWithdrawable';
}
export function isWithdrawEscalationEnabled(stage) {
    return stage === 'activeWithdrawable' || stage === 'resolved';
}
//# sourceMappingURL=reporting.js.map