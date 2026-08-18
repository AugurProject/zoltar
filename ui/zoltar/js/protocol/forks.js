import { zeroAddress } from '@zoltar/shared/ethereum';
import { ABIS } from '@zoltar/ui-core-shared/abis.js';
import { deriveHasForkActivity } from './forkActivity.js';
import { Zoltar_Zoltar, peripherals_SecurityPoolForker_SecurityPoolForker, peripherals_SecurityPool_SecurityPool, peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction } from '@zoltar/ui-core-shared/contractArtifact.js';
import { getForkOutcomeKey, getQuestionIdHex, getReportingOutcomeKey, getReportingOutcomeValue, getSecurityPoolSystemState, hasTimestamp } from './helpers.js';
import { readRequiredMulticall, writeContractAndWait } from './core.js';
import { getInfraContractAddresses, getZoltarAddress } from './deploymentHelpers.js';
import { requireForkDataView } from './forkData.js';
import { executeForkAuctionAction } from '@zoltar/ui-core-shared/protocol/securityPoolActions.js';
import { getDeploymentSteps } from './deployment.js';
import { loadMarketDetails } from './zoltar.js';
const MIGRATION_TIME_LENGTH = 4838400n;
const TRUTH_AUCTION_TIME_LENGTH = 604800n;
const QUESTION_OUTCOME_ABI = [
    {
        inputs: [{ name: 'securityPool', type: 'address' }],
        name: 'getQuestionOutcome',
        outputs: [{ name: 'outcome', type: 'uint8' }],
        stateMutability: 'view',
        type: 'function',
    },
];
function getDeploymentStep(id) {
    const step = getDeploymentSteps().find(candidate => candidate.id === id);
    if (step === undefined)
        throw new Error(`Unknown deployment step: ${id}`);
    return step;
}
export async function loadForkOutcomeMigrationSeedStatus(client, { childSecurityPoolAddress, outcome, securityPoolAddress, universeId, }) {
    const childUniverseId = await client.readContract({
        abi: Zoltar_Zoltar.abi,
        functionName: 'getChildUniverseId',
        address: getZoltarAddress(),
        args: [universeId, BigInt(getReportingOutcomeValue(outcome))],
    });
    const migrationProxyAddress = await client.readContract({
        abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
        functionName: 'getMigrationProxyAddress',
        address: getInfraContractAddresses().securityPoolForker,
        args: [securityPoolAddress],
    });
    const childRepToken = await client.readContract({
        abi: Zoltar_Zoltar.abi,
        functionName: 'getRepToken',
        address: getZoltarAddress(),
        args: [childUniverseId],
    });
    if (childRepToken === zeroAddress) {
        return {
            childPoolRepBalanceAttoRep: 0n,
            childRepToken: undefined,
            childUniverseId,
            migrationProxyAddress,
            pendingProxyRepBalanceAttoRep: 0n,
            seeded: false,
        };
    }
    const pendingProxyRepBalanceAttoRep = await client.readContract({
        abi: ABIS.mainnet.erc20,
        functionName: 'balanceOf',
        address: childRepToken,
        args: [migrationProxyAddress],
    });
    const childPoolRepBalanceAttoRep = childSecurityPoolAddress === undefined
        ? 0n
        : await client.readContract({
            abi: ABIS.mainnet.erc20,
            functionName: 'balanceOf',
            address: childRepToken,
            args: [childSecurityPoolAddress],
        });
    return {
        childPoolRepBalanceAttoRep,
        childRepToken,
        childUniverseId,
        migrationProxyAddress,
        pendingProxyRepBalanceAttoRep,
        seeded: pendingProxyRepBalanceAttoRep > 0n || childPoolRepBalanceAttoRep > 0n,
    };
}
export async function loadForkAuctionDetails(client, securityPoolAddress) {
    const [[questionId, parentSecurityPoolAddress, universeId, systemStateValue, truthAuctionAddress, settlementCollateralAttoEth, forkData, questionOutcome], ownForkMigrationStatusTuple, block] = await Promise.all([
        readRequiredMulticall(client, [
            {
                abi: peripherals_SecurityPool_SecurityPool.abi,
                functionName: 'questionId',
                address: securityPoolAddress,
                args: [],
            },
            {
                abi: peripherals_SecurityPool_SecurityPool.abi,
                functionName: 'parent',
                address: securityPoolAddress,
                args: [],
            },
            {
                abi: peripherals_SecurityPool_SecurityPool.abi,
                functionName: 'universeId',
                address: securityPoolAddress,
                args: [],
            },
            {
                abi: peripherals_SecurityPool_SecurityPool.abi,
                functionName: 'systemState',
                address: securityPoolAddress,
                args: [],
            },
            {
                abi: peripherals_SecurityPool_SecurityPool.abi,
                functionName: 'truthAuction',
                address: securityPoolAddress,
                args: [],
            },
            {
                abi: peripherals_SecurityPool_SecurityPool.abi,
                functionName: 'settlementCollateralAttoEth',
                address: securityPoolAddress,
                args: [],
            },
            {
                abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
                functionName: 'forkData',
                address: getInfraContractAddresses().securityPoolForker,
                args: [securityPoolAddress],
            },
            {
                abi: QUESTION_OUTCOME_ABI,
                functionName: 'getQuestionOutcome',
                address: getInfraContractAddresses().securityPoolForker,
                args: [securityPoolAddress],
            },
        ]),
        client.readContract({
            abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
            functionName: 'getOwnForkMigrationStatus',
            address: getInfraContractAddresses().securityPoolForker,
            args: [securityPoolAddress],
        }),
        client.getBlock(),
    ]);
    if (!hasTimestamp(block))
        throw new Error('Unexpected block response');
    const marketDetails = await loadMarketDetails(client, questionId);
    const { auctionableAttoRepAtFork, truthAuctionStartedAt, migratedAttoRep, auctionedCapacityOwnershipAttoRep, forkOwnSecurityPool, forkOutcomeIndex } = requireForkDataView(forkData);
    const [ownForkMigrationOwnFork, ownForkMigrationAuctionableRepAtFork, vaultRepAtForkAttoRep, escalationChildRepPerSelectedOutcomeAttoRep, escrowSourceRepAtForkAttoRep] = ownForkMigrationStatusTuple;
    const systemState = getSecurityPoolSystemState(systemStateValue);
    const forkOutcome = getForkOutcomeKey(forkOutcomeIndex, parentSecurityPoolAddress);
    const hasForkActivity = deriveHasForkActivity({
        forkOutcome,
        migratedAttoRep,
        systemState,
        truthAuctionStartedAt,
    });
    const universeForkTime = (await readRequiredMulticall(client, [
        {
            abi: Zoltar_Zoltar.abi,
            functionName: 'getForkTime',
            address: getInfraContractAddresses().zoltar,
            args: [universeId],
        },
    ]))[0];
    const migrationEndsAt = universeForkTime === 0n ? undefined : universeForkTime + MIGRATION_TIME_LENGTH;
    let truthAuction;
    if (truthAuctionAddress !== zeroAddress && truthAuctionStartedAt > 0n) {
        const [computeClearingResult, attoEthRaiseCap, attoEthRaised, finalized, maxAttoRepBeingSold, minBidSizeAttoEth, totalAttoRepPurchased, underfunded, underfundedThreshold, underfundedWinningAttoEth, storedClearingTick] = await readRequiredMulticall(client, [
            {
                abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
                functionName: 'computeClearing',
                address: truthAuctionAddress,
                args: [],
            },
            {
                abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
                functionName: 'attoEthRaiseCap',
                address: truthAuctionAddress,
                args: [],
            },
            {
                abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
                functionName: 'attoEthRaised',
                address: truthAuctionAddress,
                args: [],
            },
            {
                abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
                functionName: 'finalized',
                address: truthAuctionAddress,
                args: [],
            },
            {
                abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
                functionName: 'maxAttoRepBeingSold',
                address: truthAuctionAddress,
                args: [],
            },
            {
                abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
                functionName: 'minBidSizeAttoEth',
                address: truthAuctionAddress,
                args: [],
            },
            {
                abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
                functionName: 'totalAttoRepPurchased',
                address: truthAuctionAddress,
                args: [],
            },
            {
                abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
                functionName: 'underfunded',
                address: truthAuctionAddress,
                args: [],
            },
            {
                abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
                functionName: 'underfundedThreshold',
                address: truthAuctionAddress,
                args: [],
            },
            {
                abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
                functionName: 'underfundedWinningAttoEth',
                address: truthAuctionAddress,
                args: [],
            },
            {
                abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
                functionName: 'clearingTick',
                address: truthAuctionAddress,
                args: [],
            },
        ]);
        const computeClearingTuple = computeClearingResult;
        const [hitCap, computedClearingTick, accumulatedBidAttoEth, bidAtClearingTickAttoEth] = computeClearingTuple;
        const clearingTick = finalized ? storedClearingTick : computedClearingTick;
        let clearingPrice;
        if (underfunded) {
            clearingPrice = underfundedWinningAttoEth > 0n ? underfundedThreshold : undefined;
        }
        else if (!(clearingTick === 0n && accumulatedBidAttoEth === 0n)) {
            clearingPrice = await client.readContract({
                abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
                functionName: 'tickToPrice',
                address: truthAuctionAddress,
                args: [clearingTick],
            });
        }
        truthAuction = {
            accumulatedBidAttoEth,
            auctionEndsAt: truthAuctionStartedAt + TRUTH_AUCTION_TIME_LENGTH,
            clearingPrice,
            clearingTick,
            bidAtClearingTickAttoEth,
            attoEthRaiseCap,
            attoEthRaised,
            finalized,
            hitCap,
            maxAttoRepBeingSold,
            minBidSizeAttoEth,
            attoRepPurchasableAtBid: clearingPrice === undefined || clearingPrice === 0n ? undefined : (attoEthRaiseCap * 10n ** 18n) / clearingPrice,
            timeRemaining: finalized || block.timestamp >= truthAuctionStartedAt + TRUTH_AUCTION_TIME_LENGTH ? 0n : truthAuctionStartedAt + TRUTH_AUCTION_TIME_LENGTH - block.timestamp,
            totalAttoRepPurchased,
            underfunded,
            underfundedThreshold: underfunded ? underfundedThreshold : undefined,
            underfundedWinningAttoEth,
        };
    }
    return {
        auctionedCapacityOwnershipAttoRep,
        claimingAvailable: systemState === 'operational' && truthAuctionAddress !== zeroAddress,
        settlementCollateralAttoEth,
        currentTime: block.timestamp,
        forkOutcome,
        forkOwnSecurityPool,
        hasForkActivity,
        marketDetails,
        migratedAttoRep,
        migrationEndsAt,
        parentSecurityPoolAddress,
        questionOutcome: getReportingOutcomeKey(questionOutcome),
        ...(ownForkMigrationOwnFork
            ? {
                ownForkRepBuckets: {
                    vaultRepAtForkAttoRep,
                    escalationChildRepPerSelectedOutcomeAttoRep,
                    escrowSourceRepAtForkAttoRep,
                },
            }
            : {}),
        auctionableAttoRepAtFork: ownForkMigrationOwnFork ? ownForkMigrationAuctionableRepAtFork : auctionableAttoRepAtFork,
        securityPoolAddress,
        systemState,
        truthAuction,
        truthAuctionAddress,
        truthAuctionStartedAt,
        universeId,
    };
}
export async function forkZoltarWithOwnEscalation(client, securityPoolAddress, universeId) {
    return await executeForkAuctionAction(client, 'forkWithOwnEscalation', securityPoolAddress, universeId, async () => await writeContractAndWait(client, () => ({
        address: getInfraContractAddresses().securityPoolForker,
        abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
        functionName: 'forkZoltarWithOwnEscalationGame',
        args: [securityPoolAddress],
    })));
}
export async function initiateSecurityPoolFork(client, securityPoolAddress, universeId) {
    return await executeForkAuctionAction(client, 'initiateFork', securityPoolAddress, universeId, async () => await writeContractAndWait(client, () => ({
        address: getInfraContractAddresses().securityPoolForker,
        abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
        functionName: 'initiateSecurityPoolFork',
        args: [securityPoolAddress],
    })));
}
export async function createChildUniverseFromSecurityPool(client, securityPoolAddress, universeId, outcome) {
    return await executeForkAuctionAction(client, 'createChildUniverse', securityPoolAddress, universeId, async () => await writeContractAndWait(client, () => ({
        address: getInfraContractAddresses().securityPoolForker,
        abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
        functionName: 'createChildUniverse',
        args: [securityPoolAddress, BigInt(getReportingOutcomeValue(outcome))],
    })));
}
export async function createZoltarChildUniverse(client, universeId, outcomeIndex) {
    const hash = await writeContractAndWait(client, () => ({
        address: getDeploymentStep('zoltar').address,
        abi: Zoltar_Zoltar.abi,
        functionName: 'deployChild',
        args: [universeId, outcomeIndex],
    }));
    return {
        action: 'createChildUniverse',
        hash,
        outcomeIndex,
        universeId,
    };
}
async function executeZoltarMigrationAction(client, action, universeId, amountAttoRep, outcomeIndexes, callParams) {
    const hash = await writeContractAndWait(client, () => callParams);
    return {
        action,
        amountAttoRep,
        hash,
        outcomeIndexes,
        universeId,
    };
}
export async function prepareRepForMigrationInZoltar(client, universeId, amountAttoRep) {
    const callParams = {
        address: getDeploymentStep('zoltar').address,
        abi: Zoltar_Zoltar.abi,
        functionName: 'addRepToMigrationBalance',
        args: [universeId, amountAttoRep],
    };
    return await executeZoltarMigrationAction(client, 'addRepToMigrationBalance', universeId, amountAttoRep, [], callParams);
}
export async function migrateInternalRepInZoltar(client, universeId, amountAttoRep, outcomeIndexes) {
    const callParams = {
        address: getDeploymentStep('zoltar').address,
        abi: Zoltar_Zoltar.abi,
        functionName: 'splitMigrationRep',
        args: [universeId, amountAttoRep, outcomeIndexes],
    };
    return await executeZoltarMigrationAction(client, 'splitMigrationRep', universeId, amountAttoRep, outcomeIndexes, callParams);
}
export async function migrateRepToZoltarFromSecurityPool(client, securityPoolAddress, universeId, outcomes) {
    return await executeForkAuctionAction(client, 'migrateRepToZoltar', securityPoolAddress, universeId, async () => await writeContractAndWait(client, () => ({
        address: getInfraContractAddresses().securityPoolForker,
        abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
        functionName: 'migrateRepToZoltar',
        args: [securityPoolAddress, outcomes.map(outcome => BigInt(getReportingOutcomeValue(outcome)))],
    })));
}
export async function migrateSecurityVault(client, securityPoolAddress, universeId, outcome) {
    return await executeForkAuctionAction(client, 'migrateVault', securityPoolAddress, universeId, async () => await writeContractAndWait(client, () => ({
        address: getInfraContractAddresses().securityPoolForker,
        abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
        functionName: 'migrateVault',
        args: [securityPoolAddress, BigInt(getReportingOutcomeValue(outcome))],
    })));
}
export async function claimParentEscalationDeposits(client, securityPoolAddress, universeId, vaultAddress, outcome, depositIndexes) {
    const outcomeIndex = getReportingOutcomeValue(outcome);
    return await executeForkAuctionAction(client, 'claimParentEscalationDeposits', securityPoolAddress, universeId, async () => {
        return await writeContractAndWait(client, () => ({
            address: getInfraContractAddresses().securityPoolForker,
            abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
            functionName: 'claimForkedEscalationDeposits',
            args: [securityPoolAddress, vaultAddress, outcomeIndex, depositIndexes],
        }));
    });
}
export async function migrateVaultWithUnresolvedEscalation(client, securityPoolAddress, vaultAddress, universeId, outcome) {
    const outcomeIndex = getReportingOutcomeValue(outcome);
    return await executeForkAuctionAction(client, 'migrateUnresolvedEscalation', securityPoolAddress, universeId, async () => await writeContractAndWait(client, () => ({
        address: getInfraContractAddresses().securityPoolForker,
        abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
        functionName: 'migrateVaultWithUnresolvedEscalation',
        args: [securityPoolAddress, vaultAddress, BigInt(outcomeIndex)],
    })));
}
export async function forkUniverseDirectly(client, universeId, questionId, securityPoolAddress) {
    const hash = await writeContractAndWait(client, () => ({
        address: getInfraContractAddresses().zoltar,
        abi: Zoltar_Zoltar.abi,
        functionName: 'forkUniverse',
        args: [universeId, questionId],
    }));
    return {
        action: 'forkUniverse',
        hash,
        securityPoolAddress,
        universeId,
    };
}
export async function forkZoltarUniverse(client, universeId, questionId) {
    const hash = await writeContractAndWait(client, () => ({
        address: getInfraContractAddresses().zoltar,
        abi: Zoltar_Zoltar.abi,
        functionName: 'forkUniverse',
        args: [universeId, questionId],
    }));
    return {
        action: 'forkZoltar',
        hash,
        questionId: getQuestionIdHex(questionId),
        universeId,
    };
}
//# sourceMappingURL=forks.js.map