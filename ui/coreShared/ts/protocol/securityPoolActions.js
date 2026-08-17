import { peripherals_SecurityPool_SecurityPool } from '../contractArtifact.js';
export async function readSecurityPoolUniverseId(client, securityPoolAddress) {
    return await client.readContract({
        address: securityPoolAddress,
        abi: peripherals_SecurityPool_SecurityPool.abi,
        functionName: 'universeId',
        args: [],
    });
}
export async function executeForkAuctionAction(client, action, securityPoolAddress, universeId, request) {
    const hash = await request();
    await client.waitForTransactionReceipt({ hash });
    return {
        action,
        hash,
        securityPoolAddress,
        universeId,
    };
}
//# sourceMappingURL=securityPoolActions.js.map