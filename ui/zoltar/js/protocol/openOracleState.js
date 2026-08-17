import { decodeOpenOracleStatePreimage, hasOpenOracleFlag, OPEN_ORACLE_FLAG_TIME_TYPE, OPEN_ORACLE_REPORT_DISPUTED_TOPIC, OPEN_ORACLE_REPORT_SETTLED_TOPIC, OPEN_ORACLE_REPORT_SUBMITTED_TOPIC, getOpenOracleReportIdFromTopic } from '@zoltar/shared/openOracle';
function topicMatches(topic, expected) {
    return topic?.toLowerCase() === expected.toLowerCase();
}
function compareLogs(left, right) {
    const leftBlock = left.blockNumber ?? -1n;
    const rightBlock = right.blockNumber ?? -1n;
    if (leftBlock !== rightBlock)
        return leftBlock < rightBlock ? -1 : 1;
    const leftTransaction = left.transactionIndex ?? -1n;
    const rightTransaction = right.transactionIndex ?? -1n;
    if (leftTransaction !== rightTransaction)
        return leftTransaction < rightTransaction ? -1 : 1;
    const leftIndex = left.logIndex ?? -1n;
    const rightIndex = right.logIndex ?? -1n;
    if (leftIndex === rightIndex)
        return 0;
    return leftIndex < rightIndex ? -1 : 1;
}
function requireReportId(log) {
    const reportIdTopic = log.topics[1];
    if (reportIdTopic === undefined)
        throw new Error('OpenOracle lifecycle log is missing its report id topic');
    return getOpenOracleReportIdFromTopic(reportIdTopic);
}
export async function loadOpenOracleEventStates(client, openOracleAddress, requestedReportIds) {
    const reportIdTopics = requestedReportIds === undefined ? undefined : [...requestedReportIds].map(reportId => `0x${reportId.toString(16).padStart(64, '0')}`);
    const logs = await client.getLogs({
        address: openOracleAddress,
        fromBlock: 0n,
        topics: [[OPEN_ORACLE_REPORT_SUBMITTED_TOPIC, OPEN_ORACLE_REPORT_DISPUTED_TOPIC, OPEN_ORACLE_REPORT_SETTLED_TOPIC], ...(reportIdTopics === undefined ? [] : [reportIdTopics])],
    });
    const states = new Map();
    for (const log of [...logs].sort(compareLogs)) {
        if (log.removed === true)
            continue;
        const signature = log.topics[0];
        if (topicMatches(signature, OPEN_ORACLE_REPORT_SUBMITTED_TOPIC) || topicMatches(signature, OPEN_ORACLE_REPORT_DISPUTED_TOPIC)) {
            const reportId = requireReportId(log);
            if (requestedReportIds !== undefined && !requestedReportIds.has(reportId))
                continue;
            const preimage = decodeOpenOracleStatePreimage(log.data, reportId);
            const current = states.get(reportId);
            if (current === undefined) {
                states.set(reportId, { initial: preimage, latest: preimage, reportCount: 1n, settlementBlockNumber: undefined });
            }
            else {
                current.latest = preimage;
                current.reportCount += 1n;
            }
            continue;
        }
        if (!topicMatches(signature, OPEN_ORACLE_REPORT_SETTLED_TOPIC))
            continue;
        const reportId = requireReportId(log);
        if (requestedReportIds !== undefined && !requestedReportIds.has(reportId))
            continue;
        const state = states.get(reportId);
        if (state === undefined)
            throw new Error(`OpenOracle report #${reportId.toString()} settled without a preceding state log`);
        if (log.blockNumber === undefined)
            throw new Error(`OpenOracle report #${reportId.toString()} settlement log is missing its block number`);
        state.settlementBlockNumber = log.blockNumber;
    }
    const settlementBlocks = new Map();
    for (const state of states.values()) {
        if (state.settlementBlockNumber === undefined || settlementBlocks.has(state.settlementBlockNumber))
            continue;
        settlementBlocks.set(state.settlementBlockNumber, await client.getBlock({ blockNumber: state.settlementBlockNumber }));
    }
    const resolved = new Map();
    for (const [reportId, state] of states) {
        let latest = state.latest;
        if (state.settlementBlockNumber !== undefined) {
            const settlementBlock = settlementBlocks.get(state.settlementBlockNumber);
            if (settlementBlock === undefined)
                throw new Error(`Missing OpenOracle settlement block ${state.settlementBlockNumber.toString()}`);
            const settlementTimestamp = hasOpenOracleFlag(latest.game, OPEN_ORACLE_FLAG_TIME_TYPE) ? settlementBlock.timestamp : state.settlementBlockNumber;
            latest = { ...latest, game: { ...latest.game, settlementTimestamp } };
        }
        resolved.set(reportId, {
            initial: state.initial,
            latest,
            reportCount: state.reportCount,
            settled: state.settlementBlockNumber !== undefined,
        });
    }
    return resolved;
}
export async function loadOpenOracleEventState(client, openOracleAddress, reportId) {
    const states = await loadOpenOracleEventStates(client, openOracleAddress, new Set([reportId]));
    const state = states.get(reportId);
    if (state === undefined)
        throw new Error(`Oracle report #${reportId.toString()} does not exist`);
    return state;
}
//# sourceMappingURL=openOracleState.js.map