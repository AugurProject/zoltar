export function getOpenOracleReadinessActions({ actionMode, disputeMessage, hasReport, settleMessage }) {
    const baseBlocker = !hasReport ? 'Select a report first.' : undefined;
    const actions = [];
    if (actionMode === 'dispute') {
        const disputeBlocker = baseBlocker ?? disputeMessage;
        actions.push({
            actionLabel: 'Dispute & swap',
            description: 'Challenge the current report and provide the replacement swap amounts.',
            key: 'dispute-report',
            readiness: disputeBlocker === undefined ? 'ready' : 'blocked',
            title: 'Dispute & Swap',
            ...(disputeBlocker === undefined ? {} : { blocker: disputeBlocker }),
        });
        const settleBlocker = baseBlocker ?? settleMessage;
        actions.push({
            actionLabel: 'Settle report',
            key: 'settle-report',
            readiness: settleBlocker === undefined ? 'ready' : 'blocked',
            title: 'Settle Report',
            ...(settleBlocker === undefined ? {} : { blocker: settleBlocker }),
        });
    }
    if (actionMode === 'settle') {
        const settleBlocker = baseBlocker ?? settleMessage;
        actions.push({
            actionLabel: 'Settle report',
            key: 'settle-report',
            readiness: settleBlocker === undefined ? 'ready' : 'blocked',
            title: 'Settle Report',
            ...(settleBlocker === undefined ? {} : { blocker: settleBlocker }),
        });
    }
    return actions;
}
//# sourceMappingURL=openOracleReadiness.js.map