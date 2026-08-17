import { encodeAbiParameters, getAddress, keccak256, zeroAddress } from '@zoltar/shared/ethereum';
export function bigintToAddress(value) {
    return getAddress(`0x${value.toString(16).padStart(40, '0')}`);
}
function isObjectRecord(value) {
    return typeof value === 'object' && value !== null;
}
function isIntegerLike(value) {
    return typeof value === 'bigint' || typeof value === 'number';
}
export function isStringArray(value) {
    return Array.isArray(value) && value.every(item => typeof item === 'string');
}
export function isBigintTriple(value) {
    return Array.isArray(value) && value.length === 3 && value.every(item => typeof item === 'bigint');
}
export function getMinBigintValue(values) {
    const [firstValue, ...restValues] = values;
    if (firstValue === undefined)
        return undefined;
    let minValue = firstValue;
    for (const value of restValues) {
        if (value < minValue)
            minValue = value;
    }
    return minValue;
}
export function getProtocolPageOffset(pageIndex, pageSize) {
    if (!Number.isSafeInteger(pageIndex) || pageIndex < 0)
        throw new Error('Page index must be a non-negative integer within the safe range');
    if (!Number.isSafeInteger(pageSize) || pageSize <= 0)
        throw new Error('Page size must be a positive integer within the safe range');
    return BigInt(pageIndex) * BigInt(pageSize);
}
export function hasTimestamp(value) {
    return isObjectRecord(value) && typeof value['timestamp'] === 'bigint';
}
export function hasTimestampAndNumber(value) {
    return isObjectRecord(value) && typeof value['timestamp'] === 'bigint' && typeof value['number'] === 'bigint';
}
function isUniverseTuple(value) {
    return Array.isArray(value) && value.length === 5 && typeof value[0] === 'bigint' && typeof value[1] === 'bigint' && typeof value[2] === 'bigint' && typeof value[3] === 'string' && typeof value[4] === 'bigint';
}
export function requireUniverseTupleArray(value, context) {
    if (Array.isArray(value) && value.every(isUniverseTuple))
        return value;
    throw new Error(`Unexpected ${context} response`);
}
function isStagedOperationTuple(value) {
    return isObjectRecord(value) && typeof value['operationAmountAttoRepOrAttoEth'] === 'bigint' && typeof value['operator'] === 'string' && isIntegerLike(value['operation']) && typeof value['targetVault'] === 'string';
}
export function requireStagedOperationTupleArray(value, context) {
    if (Array.isArray(value) && value.every(isStagedOperationTuple))
        return value;
    throw new Error(`Unexpected ${context} response`);
}
function isSecurityPoolDeploymentTuple(value) {
    return (isObjectRecord(value) &&
        typeof value['initialReportPriorityFeeAttoEthPerGas'] === 'bigint' &&
        typeof value['parent'] === 'string' &&
        typeof value['priceOracleManagerAndOperatorQueuer'] === 'string' &&
        typeof value['questionId'] === 'bigint' &&
        typeof value['statoblastSecurityMultiplierBps'] === 'bigint' &&
        typeof value['securityPool'] === 'string' &&
        typeof value['truthAuction'] === 'string' &&
        typeof value['universeId'] === 'bigint');
}
export function requireSecurityPoolDeploymentTupleArray(value, context) {
    if (Array.isArray(value) && value.every(isSecurityPoolDeploymentTuple))
        return value;
    throw new Error(`Unexpected ${context} response`);
}
function isDeployedChildUniverseTuple(value) {
    return isObjectRecord(value) && typeof value['forkQuestionId'] === 'bigint' && typeof value['forkTime'] === 'bigint' && typeof value['forkingOutcomeIndex'] === 'bigint' && typeof value['parentUniverseId'] === 'bigint' && typeof value['reputationToken'] === 'string';
}
export function requireDeployedChildUniverseTupleArray(value, context) {
    if (Array.isArray(value) && value.every(isDeployedChildUniverseTuple))
        return value;
    throw new Error(`Unexpected ${context} response`);
}
function isEscalationGameTuple(value) {
    return (Array.isArray(value) &&
        value.length === 10 &&
        typeof value[0] === 'bigint' &&
        typeof value[1] === 'bigint' &&
        typeof value[2] === 'bigint' &&
        typeof value[3] === 'bigint' &&
        typeof value[4] === 'bigint' &&
        isBigintTriple(value[5]) &&
        typeof value[6] === 'bigint' &&
        isIntegerLike(value[7]) &&
        typeof value[8] === 'bigint' &&
        typeof value[9] === 'boolean');
}
export function requireEscalationGameTuple(value, context) {
    if (isEscalationGameTuple(value))
        return value;
    throw new Error(`Unexpected ${context} response`);
}
function isSecurityVaultTuple(value) {
    return Array.isArray(value) && (value.length === 4 || value.length === 5) && value.every(item => typeof item === 'bigint');
}
export function requireSecurityVaultTupleArray(value, context) {
    if (Array.isArray(value) && value.every(isSecurityVaultTuple))
        return value;
    throw new Error(`Unexpected ${context} response`);
}
export function getQuestionId(questionData, outcomeOptions) {
    return BigInt(keccak256(encodeAbiParameters([
        {
            type: 'tuple',
            components: [
                { name: 'title', type: 'string' },
                { name: 'description', type: 'string' },
                { name: 'startTime', type: 'uint256' },
                { name: 'endTime', type: 'uint256' },
                { name: 'numTicks', type: 'uint120' },
                { name: 'displayValueMin', type: 'int256' },
                { name: 'displayValueMax', type: 'int256' },
                { name: 'answerUnit', type: 'string' },
            ],
        },
        { type: 'string[]' },
    ], [questionData, outcomeOptions])));
}
export function getQuestionIdHex(questionId) {
    return `0x${questionId.toString(16)}`;
}
export function getReportingOutcomeValue(outcome) {
    switch (outcome) {
        case 'invalid':
            return 0;
        case 'yes':
            return 1;
        case 'no':
            return 2;
        default:
            throw new Error(`Unhandled reporting outcome: ${JSON.stringify(outcome)}`);
    }
}
export function getReportingOutcomeKey(outcome) {
    switch (outcome) {
        case 0:
        case 0n:
            return 'invalid';
        case 1:
        case 1n:
            return 'yes';
        case 2:
        case 2n:
            return 'no';
        default:
            return 'none';
    }
}
export function getForkOutcomeKey(outcome, parentSecurityPoolAddress) {
    if (parentSecurityPoolAddress === zeroAddress)
        return 'none';
    return getReportingOutcomeKey(outcome);
}
export function getEscalationSideLabel(key) {
    switch (key) {
        case 'invalid':
            return 'Invalid';
        case 'yes':
            return 'Yes';
        case 'no':
            return 'No';
        default:
            throw new Error(`Unhandled escalation side: ${JSON.stringify(key)}`);
    }
}
export function getSecurityPoolSystemState(value) {
    switch (value) {
        case 0:
        case 0n:
            return 'operational';
        case 1:
        case 1n:
            return 'poolForked';
        case 2:
        case 2n:
            return 'forkMigration';
        case 3:
        case 3n:
            return 'forkTruthAuction';
        default:
            throw new Error(`Unhandled security pool system state: ${JSON.stringify(value)}`);
    }
}
export function getMarketType(questionData, outcomeLabels) {
    if (outcomeLabels.length === 0 && questionData.numTicks > 0n)
        return 'scalar';
    if (outcomeLabels.length === 2 && outcomeLabels[0] === 'Yes' && outcomeLabels[1] === 'No')
        return 'binary';
    return 'categorical';
}
//# sourceMappingURL=helpers.js.map