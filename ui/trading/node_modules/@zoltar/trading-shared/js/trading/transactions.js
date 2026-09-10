async function blockIdentity(client) {
    const block = await client.getBlock();
    if (block.number === null || block.hash === null)
        throw new Error('Latest block identity is unavailable');
    return { number: block.number, hash: block.hash };
}
export function enterPositionRequest(router, pair, longOutcome, amountAttoEth, minimumLongAttoShares, recipient, deadline) {
    return { address: router, functionName: 'enterPosition', args: [pair, longOutcome === 'YES' ? 1 : 2, minimumLongAttoShares, recipient, deadline], value: amountAttoEth };
}
export function exitPositionRequest(router, pair, longOutcome, completeSetShares, maximumLongShares, minimumAttoEth, recipient, deadline) {
    return { address: router, functionName: 'exitPosition', args: [pair, longOutcome === 'YES' ? 1 : 2, completeSetShares, maximumLongShares, minimumAttoEth, recipient, deadline] };
}
export function initializeLiquidityRequest(router, pool, amountAttoEth, conditionalYesBps, minimumLiquidity, recipient, deadline) {
    return { address: router, functionName: 'createPairAndInitializeWithEth', args: [pool, conditionalYesBps, minimumLiquidity, recipient, deadline], value: amountAttoEth };
}
export function addLiquidityRequest(router, pair, amountAttoEth, minimumLiquidity, recipient, deadline) {
    return { address: router, functionName: 'addLiquidityWithEth', args: [pair, minimumLiquidity, recipient, deadline], value: amountAttoEth };
}
export function removeLiquidityRequest(router, pair, liquidity, minimumYes, minimumNo, recipient, deadline) {
    return { address: router, functionName: 'removeLiquidity', args: [pair, liquidity, minimumYes, minimumNo, recipient, deadline] };
}
export function redeemCompleteSetRequest(router, securityPool, amountAttoShares, minimumAttoEth, recipient, deadline) {
    return { address: router, functionName: 'redeemCompleteSet', args: [securityPool, amountAttoShares, minimumAttoEth, recipient, deadline] };
}
export function redeemWinningSharesRequest(securityPool) {
    return { address: securityPool, functionName: 'redeemShares', args: [] };
}
export function migrateSharesRequest(shareToken, universeId, sourceOutcome, targetOutcomeIndexes) {
    let outcome = 2n;
    if (sourceOutcome === 'INVALID')
        outcome = 0n;
    else if (sourceOutcome === 'YES')
        outcome = 1n;
    return { address: shareToken, functionName: 'migrate', args: [(universeId << 8n) | outcome, targetOutcomeIndexes] };
}
export async function simulateAuthoritatively(client, request) {
    const before = await blockIdentity(client);
    const result = await client.simulate(request, before.hash);
    const after = await blockIdentity(client);
    if (after.number !== before.number || after.hash !== before.hash)
        throw new Error('Block changed during simulation; simulate the router call again');
    return { blockNumber: before.number, blockHash: before.hash, request, result };
}
export async function requireFreshSimulation(client, simulation) {
    const current = await blockIdentity(client);
    if (current.number !== simulation.blockNumber || current.hash !== simulation.blockHash)
        throw new Error('Quote is stale; simulate the router call again');
    return simulation.request;
}
export function extractEventResult(logs, decode, eventName) {
    for (const log of logs) {
        const decoded = decode(log);
        if (decoded?.eventName === eventName)
            return decoded.args;
    }
    throw new Error(`Transaction receipt is missing ${eventName}`);
}
