import { bigintToSafeNumber, concatHex, encodeAbiParameters, keccak256, parseAbiParameters, zeroAddress } from '@zoltar/shared/ethereum';
import { Zoltar_Zoltar, peripherals_EscalationGame_EscalationGame, peripherals_SecurityPool_SecurityPool, peripherals_SecurityPoolForker_SecurityPoolForker } from '@zoltar/ui-core-shared/contractArtifact.js';
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js';
import { readRequiredMulticall, writeContractAndWait } from './core.js';
import { requireAddressValue, requireArrayValue, requireBigintValue, requireBooleanValue, requireIntegerLikeValue, requireObjectValue, requireTupleValue } from './decoders.js';
import { getInfraContractAddresses } from './deploymentHelpers.js';
import { getEscalationSideLabel, getReportingOutcomeKey, getReportingOutcomeValue, getSecurityPoolSystemState, hasTimestamp, requireSecurityVaultTupleArray } from './helpers.js';
import { executeForkAuctionAction, readSecurityPoolUniverseId } from '@zoltar/ui-core-shared/protocol/securityPoolActions.js';
import { loadMarketDetails } from './zoltar.js';
const MIGRATION_TIME_LENGTH = 4838400n;
const QUESTION_OUTCOME_ABI = [
    {
        inputs: [{ name: 'securityPool', type: 'address' }],
        name: 'getQuestionOutcome',
        outputs: [{ name: 'outcome', type: 'uint8' }],
        stateMutability: 'view',
        type: 'function',
    },
];
const ESCALATION_MIGRATION_ENTITLEMENT_STATUS_ABI = [
    {
        inputs: [
            { name: 'securityPool', type: 'address' },
            { name: 'vault', type: 'address' },
        ],
        name: 'getEscalationMigrationEntitlementStatus',
        outputs: [
            { name: 'initialized', type: 'bool' },
            { name: 'totalCurrentAttoRep', type: 'uint256' },
            { name: 'materializedByOutcome', type: 'bool[3]' },
        ],
        stateMutability: 'view',
        type: 'function',
    },
];
const CONTRACT_PAGE_SIZE = 30n;
const NULLIFIER_DEPTH = 64;
const EMPTY_CARRY_LEAF_HASH = ('0x' + '00'.repeat(32));
const CARRY_LEAF_ABI = parseAbiParameters('address depositor, uint8 outcome, uint256 amountAttoRep, uint256 parentDepositIndex, uint256 cumulativeAmountAttoRep, uint256 sourceNodeId');
function requireReportingBootstrapReadResult(value) {
    const [questionId, escalationGameAddress, settlementCollateralAttoEth, universeId, zoltarAddress, initialEscalationGameDepositAttoRep, systemStateValue, questionOutcomeValue, parentSecurityPoolAddress] = requireTupleValue(value, 9, 'reporting bootstrap');
    return {
        questionId: requireBigintValue(questionId, 'reporting question id'),
        escalationGameAddress: requireAddressValue(escalationGameAddress, 'reporting escalation game address'),
        settlementCollateralAttoEth: requireBigintValue(settlementCollateralAttoEth, 'reporting complete set collateral amount'),
        universeId: requireBigintValue(universeId, 'reporting universe id'),
        zoltarAddress: requireAddressValue(zoltarAddress, 'reporting zoltar address'),
        initialEscalationGameDepositAttoRep: requireBigintValue(initialEscalationGameDepositAttoRep, 'reporting initial escalation game deposit'),
        systemStateValue: requireIntegerLikeValue(systemStateValue, 'reporting system state'),
        questionOutcomeValue: requireIntegerLikeValue(questionOutcomeValue, 'reporting question outcome'),
        parentSecurityPoolAddress: requireAddressValue(parentSecurityPoolAddress, 'reporting parent security pool address'),
    };
}
function requireEscalationDepositView(value, context) {
    const deposit = requireObjectValue(value, context);
    if ('amountAttoRep' in deposit && 'cumulativeAmountAttoRep' in deposit && 'depositor' in deposit) {
        return {
            amountAttoRep: requireBigintValue(deposit.amountAttoRep, context),
            cumulativeAmountAttoRep: requireBigintValue(deposit.cumulativeAmountAttoRep, context),
            depositor: requireAddressValue(deposit.depositor, context),
        };
    }
    throw new Error(`Unexpected ${context} response`);
}
function requireEscalationDepositArray(value, context) {
    return requireArrayValue(value, context).map(deposit => requireEscalationDepositView(deposit, context));
}
export async function loadEscalationDeposits(client, escalationGameAddress, outcome) {
    let currentIndex = 0n;
    const deposits = [];
    while (true) {
        const page = requireEscalationDepositArray(await client.readContract({
            abi: peripherals_EscalationGame_EscalationGame.abi,
            address: escalationGameAddress,
            functionName: 'getDepositsByOutcome',
            args: [getReportingOutcomeValue(outcome), currentIndex, CONTRACT_PAGE_SIZE],
        }), 'escalation deposit page');
        const normalizedPage = page
            .map((deposit, index) => ({
            amountAttoRep: deposit.amountAttoRep,
            cumulativeAmountAttoRep: deposit.cumulativeAmountAttoRep,
            depositIndex: currentIndex + BigInt(index),
            depositor: deposit.depositor,
        }))
            .filter(deposit => deposit.depositor !== zeroAddress && deposit.amountAttoRep > 0n);
        deposits.push(...normalizedPage);
        if (BigInt(page.length) !== CONTRACT_PAGE_SIZE)
            break;
        currentIndex += CONTRACT_PAGE_SIZE;
    }
    return deposits;
}
function requireCarryLeafView(value, context) {
    const leaf = requireObjectValue(value, context);
    if ('amountAttoRep' in leaf && 'cumulativeAmountAttoRep' in leaf && 'depositor' in leaf && 'parentDepositIndex' in leaf && 'sourceNodeId' in leaf) {
        return {
            cumulativeAmountAttoRep: requireBigintValue(leaf.cumulativeAmountAttoRep, context),
            depositor: requireAddressValue(leaf.depositor, context),
            parentDepositIndex: requireBigintValue(leaf.parentDepositIndex, context),
            amountAttoRep: requireBigintValue(leaf.amountAttoRep, context),
            sourceNodeId: requireBigintValue(leaf.sourceNodeId, context),
        };
    }
    throw new Error(`Unexpected ${context} response`);
}
function requireCarryLeafPageResponse(value) {
    const [page, nextNodeId] = requireTupleValue(value, 2, 'carry leaf page');
    return {
        page: requireArrayValue(page, 'carry leaf page').map(leaf => requireCarryLeafView(leaf, 'carry leaf page')),
        nextNodeId: requireBigintValue(nextNodeId, 'carry leaf page'),
    };
}
async function loadCarryLeafPage(client, escalationGameAddress, outcome) {
    let startNodeId = 0n;
    const carryLeaves = [];
    while (true) {
        const { page, nextNodeId } = requireCarryLeafPageResponse(await client.readContract({
            abi: peripherals_EscalationGame_EscalationGame.abi,
            address: escalationGameAddress,
            functionName: 'getCarryLeafPageByOutcome',
            args: [getReportingOutcomeValue(outcome), startNodeId, CONTRACT_PAGE_SIZE],
        }));
        carryLeaves.push(...page);
        if (nextNodeId === 0n)
            break;
        startNodeId = nextNodeId;
    }
    return carryLeaves;
}
function requireHistoricalCarryNode(value, sourceNodeId, outcome) {
    const [parentNodeId, depositor, nodeOutcome, amountAttoRep, parentDepositIndex, cumulativeAmountAttoRep, carryLeafIndex] = requireTupleValue(value, 7, 'historical carry node');
    if (requireIntegerLikeValue(nodeOutcome, 'historical carry node outcome') !== getReportingOutcomeValue(outcome))
        throw new Error('Unexpected historical carry node outcome');
    return {
        leaf: {
            amountAttoRep: requireBigintValue(amountAttoRep, 'historical carry node amount'),
            carryLeafIndex: requireBigintValue(carryLeafIndex, 'historical carry node leaf index'),
            cumulativeAmountAttoRep: requireBigintValue(cumulativeAmountAttoRep, 'historical carry node cumulative amount'),
            depositor: requireAddressValue(depositor, 'historical carry node depositor'),
            parentDepositIndex: requireBigintValue(parentDepositIndex, 'historical carry node parent deposit index'),
            sourceNodeId,
        },
        parentNodeId: requireBigintValue(parentNodeId, 'historical carry node parent node id'),
    };
}
async function loadHistoricalLocalCarryLeaves(client, escalationGameAddress, outcome, localHeadNodeId) {
    let nodeId = localHeadNodeId;
    const visitedNodeIds = new Set();
    const carryLeaves = [];
    while (nodeId !== 0n) {
        const nodeKey = nodeId.toString();
        if (visitedNodeIds.has(nodeKey))
            throw new Error('Historical carry node chain contains a cycle.');
        visitedNodeIds.add(nodeKey);
        const { leaf, parentNodeId } = requireHistoricalCarryNode(await client.readContract({
            abi: peripherals_EscalationGame_EscalationGame.abi,
            address: escalationGameAddress,
            functionName: 'nodes',
            args: [nodeId],
        }), nodeId, outcome);
        carryLeaves.push(leaf);
        nodeId = parentNodeId;
    }
    return carryLeaves.sort((left, right) => compareBigintAscending(left.carryLeafIndex, right.carryLeafIndex));
}
async function buildHistoricalLocalCarrySnapshotEntries(client, escalationGameAddress, outcome, localLeaves) {
    const activeLeaves = await loadCarryLeafPage(client, escalationGameAddress, outcome);
    const activeSourceNodeIds = new Set(activeLeaves.map(leaf => leaf.sourceNodeId.toString()));
    const inactiveLeaves = localLeaves.filter(leaf => !activeSourceNodeIds.has(leaf.sourceNodeId.toString()));
    const directlyClaimedSourceNodeIds = new Set();
    if (inactiveLeaves.length > 0) {
        const securityPoolAddress = await client.readContract({
            abi: peripherals_EscalationGame_EscalationGame.abi,
            address: escalationGameAddress,
            functionName: 'securityPool',
            args: [],
        });
        const securityPoolForkerAddress = await client.readContract({
            abi: peripherals_SecurityPool_SecurityPool.abi,
            address: securityPoolAddress,
            functionName: 'securityPoolForker',
            args: [],
        });
        const directlyClaimed = await Promise.all(inactiveLeaves.map(async (leaf) => requireBooleanValue(await client.readContract({
            abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
            address: securityPoolForkerAddress,
            functionName: 'isEscalationDepositClaimedDirectly',
            args: [securityPoolAddress, getReportingOutcomeValue(outcome), leaf.parentDepositIndex],
        }), 'historical carry direct-claim status')));
        for (const [index, directlyClaimedLeaf] of directlyClaimed.entries()) {
            if (directlyClaimedLeaf) {
                const leaf = inactiveLeaves[index];
                if (leaf === undefined)
                    throw new Error('Missing directly claimed historical carry leaf.');
                directlyClaimedSourceNodeIds.add(leaf.sourceNodeId.toString());
            }
        }
    }
    return localLeaves.map(leaf => {
        const sourceNodeId = leaf.sourceNodeId.toString();
        return {
            leaf,
            leafHash: activeSourceNodeIds.has(sourceNodeId) || directlyClaimedSourceNodeIds.has(sourceNodeId) ? hashCarryLeaf(leaf, outcome) : EMPTY_CARRY_LEAF_HASH,
        };
    });
}
async function loadRecursiveHistoricalCarryLeaves(client, escalationGameAddress, outcome) {
    const [outcomeState, forkContinuation] = await Promise.all([readEscalationOutcomeState(client, escalationGameAddress, outcome), readForkContinuation(client, escalationGameAddress)]);
    const snapshotLeafCount = outcomeState.snapshotLeafCount;
    const localLeaves = await loadHistoricalLocalCarryLeaves(client, escalationGameAddress, outcome, outcomeState.localHeadNodeId);
    let inheritedLeaves = [];
    if (forkContinuation === true) {
        const securityPoolAddress = await client.readContract({
            abi: peripherals_EscalationGame_EscalationGame.abi,
            address: escalationGameAddress,
            functionName: 'securityPool',
            args: [],
        });
        const parentSecurityPoolAddress = await client.readContract({
            abi: peripherals_SecurityPool_SecurityPool.abi,
            address: securityPoolAddress,
            functionName: 'parent',
            args: [],
        });
        if (parentSecurityPoolAddress !== zeroAddress) {
            const parentEscalationGameAddress = await client.readContract({
                abi: peripherals_SecurityPool_SecurityPool.abi,
                address: parentSecurityPoolAddress,
                functionName: 'escalationGame',
                args: [],
            });
            if (parentEscalationGameAddress !== zeroAddress) {
                const parentLeaves = await loadRecursiveHistoricalCarryLeaves(client, parentEscalationGameAddress, outcome);
                if (BigInt(parentLeaves.length) < snapshotLeafCount)
                    throw new Error('Inherited historical carry snapshot is incomplete.');
                inheritedLeaves = parentLeaves.slice(0, bigintToSafeNumber(snapshotLeafCount, 'Snapshot leaf count'));
            }
        }
    }
    if (BigInt(inheritedLeaves.length) !== snapshotLeafCount)
        throw new Error('Inherited historical carry snapshot is not locally reconstructible.');
    for (const [localIndex, leaf] of localLeaves.entries()) {
        if (leaf.carryLeafIndex !== snapshotLeafCount + BigInt(localIndex))
            throw new Error('Historical carry leaf order is not locally reconstructible.');
    }
    const localEntries = await buildHistoricalLocalCarrySnapshotEntries(client, escalationGameAddress, outcome, localLeaves);
    return [...inheritedLeaves, ...localEntries];
}
async function loadProofConsumedCarriedDepositIndexes(client, escalationGameAddress, outcome) {
    let startIndex = 0n;
    const parentDepositIndexes = [];
    while (true) {
        const page = requireArrayValue(await client.readContract({
            abi: peripherals_EscalationGame_EscalationGame.abi,
            address: escalationGameAddress,
            functionName: 'getProofConsumedCarriedDepositIndexesByOutcome',
            args: [getReportingOutcomeValue(outcome), startIndex, CONTRACT_PAGE_SIZE],
        }), 'consumed carried deposit index page').map(item => requireBigintValue(item, 'consumed carried deposit index page'));
        parentDepositIndexes.push(...page);
        if (BigInt(page.length) !== CONTRACT_PAGE_SIZE)
            break;
        startIndex += CONTRACT_PAGE_SIZE;
    }
    return parentDepositIndexes;
}
async function loadRecursiveProofConsumedCarriedDepositIndexes(client, escalationGameAddress, outcome) {
    const [localConsumedIndexes, forkContinuation] = await Promise.all([loadProofConsumedCarriedDepositIndexes(client, escalationGameAddress, outcome), readForkContinuation(client, escalationGameAddress)]);
    if (forkContinuation !== true)
        return localConsumedIndexes;
    const securityPoolAddress = await client.readContract({
        abi: peripherals_EscalationGame_EscalationGame.abi,
        address: escalationGameAddress,
        functionName: 'securityPool',
        args: [],
    });
    const parentSecurityPoolAddress = await client.readContract({
        abi: peripherals_SecurityPool_SecurityPool.abi,
        address: securityPoolAddress,
        functionName: 'parent',
        args: [],
    });
    if (parentSecurityPoolAddress === zeroAddress)
        return localConsumedIndexes;
    const parentEscalationGameAddress = await client.readContract({
        abi: peripherals_SecurityPool_SecurityPool.abi,
        address: parentSecurityPoolAddress,
        functionName: 'escalationGame',
        args: [],
    });
    if (parentEscalationGameAddress === zeroAddress)
        return localConsumedIndexes;
    const inheritedConsumedIndexes = await loadRecursiveProofConsumedCarriedDepositIndexes(client, parentEscalationGameAddress, outcome);
    return [...inheritedConsumedIndexes, ...localConsumedIndexes];
}
async function readForkContinuation(client, escalationGameAddress) {
    return await client.readContract({
        abi: peripherals_EscalationGame_EscalationGame.abi,
        address: escalationGameAddress,
        functionName: 'forkContinuation',
        args: [],
    });
}
async function readEscalationOutcomeState(client, escalationGameAddress, outcome) {
    return await client.readContract({
        abi: peripherals_EscalationGame_EscalationGame.abi,
        address: escalationGameAddress,
        functionName: 'getOutcomeState',
        args: [getReportingOutcomeValue(outcome)],
    });
}
async function loadRecursiveCarrySnapshot(client, escalationGameAddress, outcome) {
    const [outcomeState, forkContinuation, localLeaves] = await Promise.all([readEscalationOutcomeState(client, escalationGameAddress, outcome), readForkContinuation(client, escalationGameAddress), loadCarryLeafPage(client, escalationGameAddress, outcome)]);
    const { currentCarryRoot: carryRoot, currentLeafCount: carryLeafCount, currentNullifierRoot: nullifierRoot } = outcomeState;
    const orderedLocalLeaves = [...localLeaves].sort((left, right) => compareBigintAscending(left.sourceNodeId, right.sourceNodeId));
    if (forkContinuation !== true) {
        return {
            orderedLeaves: orderedLocalLeaves,
            carryRoot,
            carryLeafCount,
            nullifierRoot,
        };
    }
    const securityPoolAddress = await client.readContract({
        abi: peripherals_EscalationGame_EscalationGame.abi,
        address: escalationGameAddress,
        functionName: 'securityPool',
        args: [],
    });
    const parentSecurityPoolAddress = await client.readContract({
        abi: peripherals_SecurityPool_SecurityPool.abi,
        address: securityPoolAddress,
        functionName: 'parent',
        args: [],
    });
    if (parentSecurityPoolAddress === zeroAddress) {
        return {
            orderedLeaves: orderedLocalLeaves,
            carryRoot,
            carryLeafCount,
            nullifierRoot,
        };
    }
    const parentEscalationGameAddress = await client.readContract({
        abi: peripherals_SecurityPool_SecurityPool.abi,
        address: parentSecurityPoolAddress,
        functionName: 'escalationGame',
        args: [],
    });
    if (parentEscalationGameAddress === zeroAddress) {
        return {
            orderedLeaves: orderedLocalLeaves,
            carryRoot,
            carryLeafCount,
            nullifierRoot,
        };
    }
    const parentSnapshot = await loadRecursiveCarrySnapshot(client, parentEscalationGameAddress, outcome);
    return {
        orderedLeaves: [...parentSnapshot.orderedLeaves, ...orderedLocalLeaves],
        carryRoot,
        carryLeafCount,
        nullifierRoot,
    };
}
async function loadForkCarriedEscalationDepositsFromParentSnapshot(client, childEscalationGameAddress, parentSecurityPoolAddress, outcome, depositor) {
    const parentEscalationGameAddress = await client.readContract({
        abi: peripherals_SecurityPool_SecurityPool.abi,
        address: parentSecurityPoolAddress,
        functionName: 'escalationGame',
        args: [],
    });
    if (parentEscalationGameAddress === zeroAddress)
        return [];
    const [{ orderedLeaves: parentSnapshotLeaves }, inheritedConsumedParentDepositIndexes, localConsumedParentDepositIndexes] = await Promise.all([
        loadRecursiveCarrySnapshot(client, parentEscalationGameAddress, outcome),
        loadRecursiveProofConsumedCarriedDepositIndexes(client, parentEscalationGameAddress, outcome),
        loadProofConsumedCarriedDepositIndexes(client, childEscalationGameAddress, outcome),
    ]);
    const consumedParentDepositIndexes = [...inheritedConsumedParentDepositIndexes, ...localConsumedParentDepositIndexes];
    const consumedParentDepositIndexSet = new Set(consumedParentDepositIndexes.map(value => value.toString()));
    return parentSnapshotLeaves
        .filter(leaf => sameAddress(leaf.depositor, depositor) && !consumedParentDepositIndexSet.has(leaf.parentDepositIndex.toString()))
        .map(leaf => ({
        amountAttoRep: leaf.amountAttoRep,
        cumulativeAmountAttoRep: leaf.cumulativeAmountAttoRep,
        depositor: leaf.depositor,
        parentDepositIndex: leaf.parentDepositIndex,
    }));
}
function hashCarryLeaf(leaf, outcome) {
    return keccak256(encodeAbiParameters(CARRY_LEAF_ABI, [leaf.depositor, getReportingOutcomeValue(outcome), leaf.amountAttoRep, leaf.parentDepositIndex, leaf.cumulativeAmountAttoRep, leaf.sourceNodeId]));
}
function hashCarryParent(left, right) {
    return keccak256(concatHex([left, right]));
}
function bagCarryPeaks(peaks) {
    if (peaks.length === 0)
        return ('0x' + '00'.repeat(32));
    let root = peaks[peaks.length - 1];
    if (root === undefined)
        throw new Error('Missing carry peak root');
    for (let index = peaks.length - 1; index > 0; index -= 1) {
        const previousPeak = peaks[index - 1];
        if (previousPeak === undefined)
            throw new Error('Missing carry peak root');
        root = hashCarryParent(previousPeak, root);
    }
    return root;
}
function buildCarryPeakHeights(leafCount) {
    const peakHeights = [];
    let remainingLeafCount = leafCount;
    let currentHeight = 0;
    while (remainingLeafCount > 0n) {
        if ((remainingLeafCount & 1n) === 1n)
            peakHeights.unshift(currentHeight);
        remainingLeafCount >>= 1n;
        currentHeight += 1;
    }
    return peakHeights;
}
function compareBigintAscending(left, right) {
    if (left < right)
        return -1;
    if (left > right)
        return 1;
    return 0;
}
function buildCarryMerkleMountainRangeProof(leafHashes, targetLeafIndex) {
    const leafCount = BigInt(leafHashes.length);
    const peakHeights = buildCarryPeakHeights(leafCount);
    let offset = 0;
    let targetPeakHeight;
    let targetPeakLeaves;
    let targetPeakOffset;
    const peakRootsByHeight = new Map();
    for (const peakHeight of peakHeights) {
        const peakSize = 1 << peakHeight;
        const peakLeaves = leafHashes.slice(offset, offset + peakSize);
        let levelHashes = [...peakLeaves];
        while (levelHashes.length > 1) {
            const nextLevelHashes = [];
            for (let index = 0; index < levelHashes.length; index += 2) {
                const left = levelHashes[index];
                const right = levelHashes[index + 1];
                if (left === undefined || right === undefined)
                    throw new Error('Invalid carry Merkle Mountain Range level');
                nextLevelHashes.push(hashCarryParent(left, right));
            }
            levelHashes = nextLevelHashes;
        }
        const peakRoot = levelHashes[0];
        if (peakRoot === undefined)
            throw new Error('Missing carry Merkle Mountain Range peak root');
        peakRootsByHeight.set(peakHeight, peakRoot);
        if (targetLeafIndex >= offset && targetLeafIndex < offset + peakSize) {
            targetPeakHeight = peakHeight;
            targetPeakLeaves = peakLeaves;
            targetPeakOffset = offset;
        }
        offset += peakSize;
    }
    if (targetPeakHeight === undefined || targetPeakLeaves === undefined || targetPeakOffset === undefined) {
        throw new Error('Target carry leaf is not inside the Merkle Mountain Range');
    }
    let relativeLeafIndex = targetLeafIndex - targetPeakOffset;
    const peakRelativeLeafIndex = relativeLeafIndex;
    let levelHashes = [...targetPeakLeaves];
    const merkleMountainRangeSiblings = [];
    while (levelHashes.length > 1) {
        const siblingIndex = relativeLeafIndex ^ 1;
        const siblingHash = levelHashes[siblingIndex];
        if (siblingHash === undefined)
            throw new Error('Missing carry Merkle Mountain Range sibling');
        merkleMountainRangeSiblings.push(siblingHash);
        const nextLevelHashes = [];
        for (let index = 0; index < levelHashes.length; index += 2) {
            const left = levelHashes[index];
            const right = levelHashes[index + 1];
            if (left === undefined || right === undefined)
                throw new Error('Invalid carry Merkle Mountain Range level');
            nextLevelHashes.push(hashCarryParent(left, right));
        }
        levelHashes = nextLevelHashes;
        relativeLeafIndex = Math.floor(relativeLeafIndex / 2);
    }
    const orderedPeakHeights = [...peakRootsByHeight.keys()].sort((left, right) => left - right);
    for (const peakHeight of orderedPeakHeights) {
        if (peakHeight === targetPeakHeight)
            continue;
        const peakRoot = peakRootsByHeight.get(peakHeight);
        if (peakRoot === undefined)
            throw new Error('Missing carry Merkle Mountain Range peak root');
        merkleMountainRangeSiblings.push(peakRoot);
    }
    const orderedPeaks = orderedPeakHeights.map(peakHeight => {
        const peakRoot = peakRootsByHeight.get(peakHeight);
        if (peakRoot === undefined)
            throw new Error('Missing carry Merkle Mountain Range peak root');
        return peakRoot;
    });
    const root = bagCarryPeaks(orderedPeaks);
    return { merkleMountainRangePeakIndex: BigInt(targetPeakHeight), merkleMountainRangeSiblings, peakRelativeLeafIndex, root };
}
function buildZeroHashes() {
    const zeroHashes = [('0x' + '00'.repeat(32))];
    let currentHash = ('0x' + '00'.repeat(32));
    for (let depth = 0; depth < NULLIFIER_DEPTH; depth += 1) {
        currentHash = hashCarryParent(currentHash, currentHash);
        zeroHashes.push(currentHash);
    }
    return zeroHashes;
}
class SparseNullifier {
    nodes = new Map();
    zeroHashes = buildZeroHashes();
    constructor(consumedParentDepositIndexes) {
        for (const parentDepositIndex of consumedParentDepositIndexes)
            this.consume(parentDepositIndex);
    }
    getNode(level, index) {
        return this.nodes.get(`${level}:${index.toString()}`) ?? this.zeroHashes[level];
    }
    getProof(parentDepositIndex) {
        const siblings = [];
        let index = BigInt.asUintN(64, BigInt(keccak256(encodeAbiParameters(parseAbiParameters('uint256 parentDepositIndex'), [parentDepositIndex]))));
        for (let level = 0; level < NULLIFIER_DEPTH; level += 1) {
            const siblingIndex = index ^ 1n;
            const siblingHash = this.getNode(level, siblingIndex);
            if (siblingHash === undefined)
                throw new Error('Missing nullifier sibling hash');
            siblings.push(siblingHash);
            index >>= 1n;
        }
        return siblings;
    }
    consume(parentDepositIndex) {
        let index = BigInt.asUintN(64, BigInt(keccak256(encodeAbiParameters(parseAbiParameters('uint256 parentDepositIndex'), [parentDepositIndex]))));
        let currentHash = ('0x' + '00'.repeat(31) + '01');
        for (let level = 0; level < NULLIFIER_DEPTH; level += 1) {
            this.nodes.set(`${level}:${index.toString()}`, currentHash);
            const siblingIndex = index ^ 1n;
            const siblingHash = this.getNode(level, siblingIndex);
            if (siblingHash === undefined)
                throw new Error('Missing nullifier sibling hash');
            currentHash = (index & 1n) === 0n ? hashCarryParent(currentHash, siblingHash) : hashCarryParent(siblingHash, currentHash);
            index >>= 1n;
        }
        this.nodes.set(`${NULLIFIER_DEPTH}:0`, currentHash);
    }
    getRoot() {
        const root = this.nodes.get(`${NULLIFIER_DEPTH}:0`);
        const fallbackRoot = this.zeroHashes[NULLIFIER_DEPTH];
        if (fallbackRoot === undefined)
            throw new Error('Missing empty nullifier root');
        return root ?? fallbackRoot;
    }
}
async function loadViewerReportingVaultState(client, securityPoolAddress, accountAddress) {
    if (accountAddress === undefined)
        return {
            viewerPoolHeldVaultRepBackingAttoRep: undefined,
            viewerEscalationMigrationEntitlement: undefined,
            viewerVaultExists: false,
            viewerVaultDisputeStakedAttoRep: undefined,
            viewerVaultRepBackingAttoRep: undefined,
        };
    const [viewerVaultTuple, escalationMigrationEntitlementTuple] = await Promise.all([
        client.readContract({
            abi: peripherals_SecurityPool_SecurityPool.abi,
            functionName: 'securityVaults',
            address: securityPoolAddress,
            args: [accountAddress],
        }),
        client.readContract({
            abi: ESCALATION_MIGRATION_ENTITLEMENT_STATUS_ABI,
            functionName: 'getEscalationMigrationEntitlementStatus',
            address: getInfraContractAddresses().securityPoolForker,
            args: [securityPoolAddress, accountAddress],
        }),
    ]);
    const [entitlementInitialized, entitlementTotalCurrentRep, materializedByOutcome] = escalationMigrationEntitlementTuple;
    const viewerVaultTuples = requireSecurityVaultTupleArray([viewerVaultTuple], 'viewer security vault tuple');
    const [viewerRepBackingUnits, viewerCapacityOwnershipAttoRep, viewerClaimableFeesAttoEth, viewerFeeIndex] = viewerVaultTuples[0] ?? [];
    if (typeof viewerRepBackingUnits !== 'bigint' || typeof viewerCapacityOwnershipAttoRep !== 'bigint' || typeof viewerClaimableFeesAttoEth !== 'bigint' || typeof viewerFeeIndex !== 'bigint')
        throw new Error('Unexpected viewer security vault tuple response');
    const viewerVaultRepBackingAttoRep = viewerRepBackingUnits === 0n
        ? 0n
        : await client.readContract({
            abi: peripherals_SecurityPool_SecurityPool.abi,
            functionName: 'backingUnitsToAttoRep',
            address: securityPoolAddress,
            args: [viewerRepBackingUnits],
        });
    const escalationGameAddress = await client.readContract({
        abi: peripherals_SecurityPool_SecurityPool.abi,
        functionName: 'escalationGame',
        address: securityPoolAddress,
        args: [],
    });
    const viewerVaultDisputeStakedAttoRep = sameAddress(escalationGameAddress, zeroAddress)
        ? 0n
        : await client.readContract({
            abi: peripherals_EscalationGame_EscalationGame.abi,
            functionName: 'disputeStakedRepByVaultAttoRep',
            address: escalationGameAddress,
            args: [accountAddress],
        });
    const viewerVaultExists = viewerRepBackingUnits !== 0n || viewerCapacityOwnershipAttoRep !== 0n || viewerClaimableFeesAttoEth !== 0n || viewerFeeIndex !== 0n || viewerVaultDisputeStakedAttoRep !== 0n;
    const viewerPoolHeldVaultRepBackingAttoRep = viewerVaultRepBackingAttoRep;
    return {
        viewerPoolHeldVaultRepBackingAttoRep,
        viewerEscalationMigrationEntitlement: {
            initialized: entitlementInitialized,
            materializedByOutcome: {
                invalid: materializedByOutcome[0],
                yes: materializedByOutcome[1],
                no: materializedByOutcome[2],
            },
            totalCurrentAttoRep: entitlementTotalCurrentRep,
        },
        viewerVaultExists,
        viewerVaultDisputeStakedAttoRep,
        viewerVaultRepBackingAttoRep,
    };
}
export async function loadReportingDetails(client, securityPoolAddress, accountAddress) {
    const reportingPoolReads = [
        {
            abi: peripherals_SecurityPool_SecurityPool.abi,
            functionName: 'questionId',
            address: securityPoolAddress,
            args: [],
        },
        {
            abi: peripherals_SecurityPool_SecurityPool.abi,
            functionName: 'escalationGame',
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
            abi: peripherals_SecurityPool_SecurityPool.abi,
            functionName: 'universeId',
            address: securityPoolAddress,
            args: [],
        },
        {
            abi: peripherals_SecurityPool_SecurityPool.abi,
            functionName: 'zoltar',
            address: securityPoolAddress,
            args: [],
        },
        {
            abi: peripherals_SecurityPool_SecurityPool.abi,
            functionName: 'initialEscalationGameDepositAttoRep',
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
            abi: QUESTION_OUTCOME_ABI,
            functionName: 'getQuestionOutcome',
            address: getInfraContractAddresses().securityPoolForker,
            args: [securityPoolAddress],
        },
        {
            abi: peripherals_SecurityPool_SecurityPool.abi,
            functionName: 'parent',
            address: securityPoolAddress,
            args: [],
        },
    ];
    const { questionId, escalationGameAddress, settlementCollateralAttoEth, universeId, zoltarAddress, initialEscalationGameDepositAttoRep, systemStateValue, questionOutcomeValue, parentSecurityPoolAddress } = requireReportingBootstrapReadResult(await readRequiredMulticall(client, reportingPoolReads));
    const systemState = getSecurityPoolSystemState(systemStateValue);
    const normalizedQuestionOutcome = getReportingOutcomeKey(questionOutcomeValue);
    const [marketDetails, block, escalationGameCode, viewerVaultState, forkThresholdAttoRep] = await Promise.all([
        loadMarketDetails(client, questionId),
        client.getBlock(),
        escalationGameAddress === zeroAddress ? Promise.resolve('0x') : client.getCode({ address: escalationGameAddress }),
        loadViewerReportingVaultState(client, securityPoolAddress, accountAddress),
        client.readContract({
            abi: Zoltar_Zoltar.abi,
            address: zoltarAddress,
            functionName: 'getForkThresholdAttoRep',
            args: [universeId],
        }),
    ]);
    if (!hasTimestamp(block))
        throw new Error('Unexpected block response');
    if (escalationGameAddress === zeroAddress || escalationGameCode === undefined || escalationGameCode === '0x') {
        const nonDecisionThresholdAttoRep = forkThresholdAttoRep / 2n + (forkThresholdAttoRep % 2n);
        const startBondAttoRep = nonDecisionThresholdAttoRep > 1n && initialEscalationGameDepositAttoRep >= nonDecisionThresholdAttoRep ? nonDecisionThresholdAttoRep - 1n : initialEscalationGameDepositAttoRep;
        return {
            settlementCollateralAttoEth,
            currentTime: block.timestamp,
            forkThresholdAttoRep,
            marketDetails,
            nonDecisionThresholdAttoRep,
            parentSecurityPoolAddress,
            questionOutcome: normalizedQuestionOutcome,
            securityPoolAddress,
            settlementState: normalizedQuestionOutcome !== 'none' && systemState === 'operational' ? 'resolved' : 'locked',
            startBondAttoRep,
            status: 'not-started',
            systemState,
            universeId,
            parentWithdrawalEnabled: false,
            ...viewerVaultState,
        };
    }
    const forkContinuationSnapshot = await readForkContinuation(client, escalationGameAddress);
    const [startBondAttoRep, nonDecisionThresholdAttoRep, activationTime, totalCostAttoRep, bindingCapital, invalidOutcomeState, yesOutcomeState, noOutcomeState, escalationEndTime, _questionOutcome, universeForkTime, hasReachedNonDecision] = await Promise.all([
        client.readContract({
            abi: peripherals_EscalationGame_EscalationGame.abi,
            functionName: 'startBondAttoRep',
            address: escalationGameAddress,
            args: [],
        }),
        client.readContract({
            abi: peripherals_EscalationGame_EscalationGame.abi,
            functionName: 'nonDecisionThresholdAttoRep',
            address: escalationGameAddress,
            args: [],
        }),
        client.readContract({
            abi: peripherals_EscalationGame_EscalationGame.abi,
            functionName: 'activationTime',
            address: escalationGameAddress,
            args: [],
        }),
        client.readContract({
            abi: peripherals_EscalationGame_EscalationGame.abi,
            functionName: 'totalCostAttoRep',
            address: escalationGameAddress,
            args: [],
        }),
        client.readContract({
            abi: peripherals_EscalationGame_EscalationGame.abi,
            functionName: 'getBindingCapitalAttoRep',
            address: escalationGameAddress,
            args: [],
        }),
        readEscalationOutcomeState(client, escalationGameAddress, 'invalid'),
        readEscalationOutcomeState(client, escalationGameAddress, 'yes'),
        readEscalationOutcomeState(client, escalationGameAddress, 'no'),
        client.readContract({
            abi: peripherals_EscalationGame_EscalationGame.abi,
            functionName: 'getEscalationGameEndDate',
            address: escalationGameAddress,
            args: [],
        }),
        client.readContract({
            abi: QUESTION_OUTCOME_ABI,
            functionName: 'getQuestionOutcome',
            address: getInfraContractAddresses().securityPoolForker,
            args: [securityPoolAddress],
        }),
        client.readContract({
            abi: Zoltar_Zoltar.abi,
            functionName: 'getForkTime',
            address: getInfraContractAddresses().zoltar,
            args: [universeId],
        }),
        client.readContract({
            abi: peripherals_EscalationGame_EscalationGame.abi,
            functionName: 'hasReachedNonDecision',
            address: escalationGameAddress,
            args: [],
        }),
    ]);
    const balances = [invalidOutcomeState.balanceAttoRep, yesOutcomeState.balanceAttoRep, noOutcomeState.balanceAttoRep];
    const useCarrySnapshot = forkContinuationSnapshot !== undefined;
    const [invalidDeposits, yesDeposits, noDeposits, invalidParentSnapshotDeposits, yesParentSnapshotDeposits, noParentSnapshotDeposits] = await Promise.all([
        loadEscalationDeposits(client, escalationGameAddress, 'invalid'),
        loadEscalationDeposits(client, escalationGameAddress, 'yes'),
        loadEscalationDeposits(client, escalationGameAddress, 'no'),
        accountAddress === undefined || parentSecurityPoolAddress === zeroAddress || !useCarrySnapshot ? Promise.resolve([]) : loadForkCarriedEscalationDepositsFromParentSnapshot(client, escalationGameAddress, parentSecurityPoolAddress, 'invalid', accountAddress),
        accountAddress === undefined || parentSecurityPoolAddress === zeroAddress || !useCarrySnapshot ? Promise.resolve([]) : loadForkCarriedEscalationDepositsFromParentSnapshot(client, escalationGameAddress, parentSecurityPoolAddress, 'yes', accountAddress),
        accountAddress === undefined || parentSecurityPoolAddress === zeroAddress || !useCarrySnapshot ? Promise.resolve([]) : loadForkCarriedEscalationDepositsFromParentSnapshot(client, escalationGameAddress, parentSecurityPoolAddress, 'no', accountAddress),
    ]);
    const sides = [
        {
            balance: balances[0] ?? 0n,
            deposits: invalidDeposits,
            importedUserDeposits: invalidParentSnapshotDeposits,
            key: 'invalid',
            label: getEscalationSideLabel('invalid'),
            userDeposits: accountAddress === undefined ? [] : invalidDeposits.filter(deposit => deposit.depositor === accountAddress),
        },
        {
            balance: balances[1] ?? 0n,
            deposits: yesDeposits,
            importedUserDeposits: yesParentSnapshotDeposits,
            key: 'yes',
            label: getEscalationSideLabel('yes'),
            userDeposits: accountAddress === undefined ? [] : yesDeposits.filter(deposit => deposit.depositor === accountAddress),
        },
        {
            balance: balances[2] ?? 0n,
            deposits: noDeposits,
            importedUserDeposits: noParentSnapshotDeposits,
            key: 'no',
            label: getEscalationSideLabel('no'),
            userDeposits: accountAddress === undefined ? [] : noDeposits.filter(deposit => deposit.depositor === accountAddress),
        },
    ];
    let settlementState = 'locked';
    if (normalizedQuestionOutcome !== 'none' && systemState === 'operational') {
        settlementState = 'resolved';
    }
    else if (universeForkTime > 0n && universeForkTime < escalationEndTime && hasReachedNonDecision === false) {
        settlementState = block.timestamp <= universeForkTime + MIGRATION_TIME_LENGTH ? 'migration-required' : 'migration-expired';
    }
    return {
        bindingCapital,
        settlementCollateralAttoEth,
        currentRequiredBond: totalCostAttoRep === 0n ? startBondAttoRep : totalCostAttoRep,
        currentTime: block.timestamp,
        escalationEndTime,
        escalationGameAddress,
        forkThresholdAttoRep,
        hasReachedNonDecision,
        marketDetails,
        nonDecisionThresholdAttoRep,
        parentSecurityPoolAddress,
        questionOutcome: normalizedQuestionOutcome,
        securityPoolAddress,
        sides,
        startBondAttoRep,
        status: 'active',
        systemState,
        settlementState,
        activationTime,
        totalCostAttoRep,
        universeId,
        parentWithdrawalEnabled: settlementState === 'resolved',
        ...viewerVaultState,
    };
}
export async function reportOutcomeInSecurityPool(client, securityPoolAddress, outcome, amountAttoRep) {
    const universeId = await readSecurityPoolUniverseId(client, securityPoolAddress);
    const hash = await writeContractAndWait(client, () => ({
        address: securityPoolAddress,
        abi: peripherals_SecurityPool_SecurityPool.abi,
        functionName: 'depositToEscalationGame',
        args: [getReportingOutcomeValue(outcome), amountAttoRep],
    }));
    return {
        action: 'reportOutcome',
        hash,
        outcome,
        securityPoolAddress,
        universeId,
    };
}
export async function withdrawEscalationFromSecurityPool(client, securityPoolAddress, outcome, depositIndexes) {
    const universeId = await readSecurityPoolUniverseId(client, securityPoolAddress);
    const hash = await writeContractAndWait(client, () => ({
        address: securityPoolAddress,
        abi: peripherals_SecurityPool_SecurityPool.abi,
        functionName: 'withdrawFromEscalationGame',
        args: [getReportingOutcomeValue(outcome), depositIndexes],
    }));
    return {
        action: 'withdrawEscalation',
        hash,
        outcome,
        securityPoolAddress,
        universeId,
    };
}
export async function buildForkCarriedEscalationProofs(client, securityPoolAddress, outcome, parentDepositIndexes) {
    const [parentSecurityPoolAddress, childEscalationGameAddress] = await readRequiredMulticall(client, [
        {
            address: securityPoolAddress,
            abi: peripherals_SecurityPool_SecurityPool.abi,
            functionName: 'parent',
            args: [],
        },
        {
            address: securityPoolAddress,
            abi: peripherals_SecurityPool_SecurityPool.abi,
            functionName: 'escalationGame',
            args: [],
        },
    ]);
    if (parentSecurityPoolAddress === zeroAddress)
        throw new Error('Fork-carried escalation proofs require a child pool.');
    if (childEscalationGameAddress === zeroAddress)
        throw new Error('Child escalation game unavailable for fork-carried settlement.');
    const parentEscalationGameAddress = await client.readContract({
        address: parentSecurityPoolAddress,
        abi: peripherals_SecurityPool_SecurityPool.abi,
        functionName: 'escalationGame',
        args: [],
    });
    if (parentEscalationGameAddress === zeroAddress)
        throw new Error('Parent escalation game unavailable for fork-carried settlement.');
    const [parentHistoricalLeaves, inheritedConsumedParentDepositIndexes, localConsumedParentDepositIndexes, childOutcomeState] = await Promise.all([
        loadRecursiveHistoricalCarryLeaves(client, parentEscalationGameAddress, outcome),
        loadRecursiveProofConsumedCarriedDepositIndexes(client, parentEscalationGameAddress, outcome),
        loadProofConsumedCarriedDepositIndexes(client, childEscalationGameAddress, outcome),
        readEscalationOutcomeState(client, childEscalationGameAddress, outcome),
    ]);
    const consumedParentDepositIndexes = [...inheritedConsumedParentDepositIndexes, ...localConsumedParentDepositIndexes];
    const { currentNullifierRoot: childNullifierRoot, snapshotLeafCount: parentCarryLeafCount, snapshotPeaks } = childOutcomeState;
    if (BigInt(parentHistoricalLeaves.length) < parentCarryLeafCount)
        throw new Error('Parent carry snapshot is not locally reconstructible.');
    const orderedEntries = parentHistoricalLeaves.slice(0, bigintToSafeNumber(parentCarryLeafCount, 'Parent carry leaf count'));
    const orderedLeaves = orderedEntries.map(entry => entry.leaf);
    const leafHashes = orderedEntries.map(entry => entry.leafHash);
    if (leafHashes.length > 0) {
        const { root: reconstructedRoot } = buildCarryMerkleMountainRangeProof(leafHashes, 0);
        const snapshotPeakHeights = buildCarryPeakHeights(parentCarryLeafCount).sort((left, right) => left - right);
        const snapshotRoot = bagCarryPeaks(snapshotPeakHeights.map(peakHeight => {
            const peak = snapshotPeaks[peakHeight];
            if (peak === undefined)
                throw new Error('Missing parent carry snapshot peak.');
            return peak;
        }));
        if (reconstructedRoot !== snapshotRoot)
            throw new Error('Parent carry snapshot root is not locally reconstructible.');
    }
    const nullifierTree = new SparseNullifier(consumedParentDepositIndexes);
    if (nullifierTree.getRoot() !== childNullifierRoot)
        throw new Error('Child proof-consumed carry state is not locally reconstructible.');
    const consumedParentDepositIndexSet = new Set(consumedParentDepositIndexes.map(parentDepositIndex => parentDepositIndex.toString()));
    const proofs = [];
    for (const parentDepositIndex of parentDepositIndexes) {
        const parentDepositIndexKey = parentDepositIndex.toString();
        if (consumedParentDepositIndexSet.has(parentDepositIndexKey))
            throw new Error(`Parent carry leaf ${parentDepositIndexKey} is already settled.`);
        const leafIndex = orderedLeaves.findIndex(leaf => leaf.parentDepositIndex === parentDepositIndex);
        if (leafIndex === -1)
            throw new Error(`Parent carry leaf ${parentDepositIndex.toString()} is unavailable.`);
        const targetLeaf = orderedLeaves[leafIndex];
        if (targetLeaf === undefined)
            throw new Error(`Parent carry leaf ${parentDepositIndex.toString()} is unavailable.`);
        const { merkleMountainRangePeakIndex, merkleMountainRangeSiblings, peakRelativeLeafIndex } = buildCarryMerkleMountainRangeProof(leafHashes, leafIndex);
        const nullifierSiblings = nullifierTree.getProof(parentDepositIndex);
        proofs.push({
            amountAttoRep: targetLeaf.amountAttoRep,
            cumulativeAmountAttoRep: targetLeaf.cumulativeAmountAttoRep,
            depositor: targetLeaf.depositor,
            leafIndex: BigInt(peakRelativeLeafIndex),
            merkleMountainRangePeakIndex,
            merkleMountainRangeSiblings,
            nullifierSiblings,
            parentDepositIndex: targetLeaf.parentDepositIndex,
            sourceNodeId: targetLeaf.sourceNodeId,
        });
        nullifierTree.consume(parentDepositIndex);
        consumedParentDepositIndexSet.add(parentDepositIndexKey);
    }
    return proofs;
}
export async function withdrawForkedEscalationDeposits(client, securityPoolAddress, outcome, proofs) {
    const universeId = await readSecurityPoolUniverseId(client, securityPoolAddress);
    return await executeForkAuctionAction(client, 'settleForkedEscalation', securityPoolAddress, universeId, async () => await writeContractAndWait(client, () => ({
        address: securityPoolAddress,
        abi: peripherals_SecurityPool_SecurityPool.abi,
        functionName: 'withdrawForkedEscalationDeposits',
        args: [
            getReportingOutcomeValue(outcome),
            proofs.map(proof => ({
                ...proof,
                merkleMountainRangeSiblings: Array.from(proof.merkleMountainRangeSiblings),
                nullifierSiblings: Array.from(proof.nullifierSiblings),
            })),
        ],
    })));
}
//# sourceMappingURL=reporting.js.map