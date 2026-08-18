import { peripherals_SecurityPoolForker_SecurityPoolForker, peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction } from '@zoltar/ui-core-shared/contractArtifact.js';
import { writeContractAndWait } from '@zoltar/ui-zoltar/protocol/core.js';
import { getInfraContractAddresses } from '@zoltar/ui-zoltar/protocol/deploymentHelpers.js';
import { executeForkAuctionAction } from '@zoltar/ui-core-shared/protocol/securityPoolActions.js';
export async function startTruthAuctionForSecurityPool(client, securityPoolAddress, universeId) {
    return await executeForkAuctionAction(client, 'startTruthAuction', securityPoolAddress, universeId, async () => await writeContractAndWait(client, () => ({
        address: getInfraContractAddresses().securityPoolForker,
        abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
        functionName: 'startTruthAuction',
        args: [securityPoolAddress],
    })));
}
export async function submitTruthAuctionBid(client, securityPoolAddress, universeId, truthAuctionAddress, tick, amount) {
    return await executeForkAuctionAction(client, 'submitBid', securityPoolAddress, universeId, async () => {
        const callParams = {
            address: truthAuctionAddress,
            abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
            functionName: 'submitBid',
            args: [tick],
            value: amount,
        };
        return await writeContractAndWait(client, () => callParams);
    });
}
export async function refundTruthAuctionBid(client, securityPoolAddress, universeId, truthAuctionAddress, tick, bidIndex, selectedBids) {
    return await executeForkAuctionAction(client, 'refundLosingBids', securityPoolAddress, universeId, async () => await writeContractAndWait(client, () => ({
        address: truthAuctionAddress,
        abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
        functionName: 'refundLosingBids',
        args: selectedBids === undefined ? [{ tick, bidIndex }] : selectedBids,
    })));
}
export async function settleTruthAuctionBids(client, securityPoolAddress, universeId, vaultAddress, claimTickIndices, refundTickIndices) {
    return await executeForkAuctionAction(client, 'claimAuctionProceeds', securityPoolAddress, universeId, async () => await writeContractAndWait(client, () => ({
        address: getInfraContractAddresses().securityPoolForker,
        abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
        functionName: 'settleAuctionBids',
        args: [securityPoolAddress, vaultAddress, claimTickIndices, refundTickIndices],
    })));
}
export async function finalizeSecurityPoolTruthAuction(client, securityPoolAddress, universeId) {
    return await executeForkAuctionAction(client, 'finalizeTruthAuction', securityPoolAddress, universeId, async () => await writeContractAndWait(client, () => ({
        address: getInfraContractAddresses().securityPoolForker,
        abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
        functionName: 'finalizeTruthAuction',
        args: [securityPoolAddress],
    })));
}
//# sourceMappingURL=truthAuctionActions.js.map