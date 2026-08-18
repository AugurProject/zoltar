import { decodeEventLog, encodeAbiParameters, encodeDeployData, getCreate2Address, keccak256, zeroAddress } from '@zoltar/shared/ethereum';
import { peripherals_EscalationGame_EscalationGame, peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator, peripherals_SecurityPool_SecurityPool, peripherals_SecurityPoolForker_SecurityPoolForker, peripherals_factories_SecurityPoolFactory_SecurityPoolFactory, peripherals_tokens_ShareToken_ShareToken, Zoltar_Zoltar, } from '@zoltar/ui-core-shared/contractArtifact.js';
import { isIgnorableLogDecodeError } from '@zoltar/ui-core-shared/lib/errors.js';
import { deriveHasForkActivity } from '@zoltar/ui-zoltar/protocol/forkActivity.js';
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js';
import { readRequiredMulticall, writeContractAndWaitForReceipt } from '@zoltar/ui-zoltar/protocol/core.js';
import { requireForkDataView } from '@zoltar/ui-zoltar/protocol/forkData.js';
import { getForkOutcomeKey, getProtocolPageOffset, getQuestionIdHex, getReportingOutcomeKey, getSecurityPoolSystemState, requireSecurityPoolDeploymentTupleArray, requireSecurityVaultTupleArray } from '@zoltar/ui-zoltar/protocol/helpers.js';
import { getDeploymentSteps } from './deployment.js';
import { getInfraContractAddresses, getZoltarAddress } from '@zoltar/ui-zoltar/protocol/deploymentHelpers.js';
import { loadMarketDetails } from '@zoltar/ui-zoltar/protocol/zoltar.js';
const QUESTION_OUTCOME_ABI = [
    {
        inputs: [{ name: 'securityPool', type: 'address' }],
        name: 'getQuestionOutcome',
        outputs: [{ name: 'outcome', type: 'uint8' }],
        stateMutability: 'view',
        type: 'function',
    },
];
const SECURITY_POOL_LIST_VAULT_PREVIEW_LIMIT = 50n;
const SECURITY_POOL_PAGE_VAULT_PREVIEW_LIMIT = 3n;
const SECURITY_POOL_VAULT_SCAN_LIMIT = 500n;
const SECURITY_POOL_VAULT_SCAN_PAGE_SIZE = 50n;
function getDeploymentStepAddress(id) {
    const step = getDeploymentSteps().find(candidate => candidate.id === id);
    if (step === undefined)
        throw new Error(`Unknown deployment step: ${id}`);
    return step.address;
}
function getSecurityPoolAddressFromReceipt(receipt) {
    const securityPoolFactory = getInfraContractAddresses().securityPoolFactory;
    for (const log of receipt.logs) {
        if (!sameAddress(log.address, securityPoolFactory))
            continue;
        try {
            const decodedLog = decodeEventLog({
                abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
                data: log.data,
                topics: log.topics,
            });
            if (decodedLog.eventName !== 'DeploySecurityPool')
                continue;
            const securityPoolAddress = decodedLog.args.securityPool;
            if (securityPoolAddress === undefined)
                throw new Error('Deployment event missing security pool address');
            return securityPoolAddress;
        }
        catch (error) {
            if (!isIgnorableLogDecodeError(error))
                throw error;
            continue;
        }
    }
    throw new Error('Security pool deployment transaction succeeded without a DeploySecurityPool event');
}
function getOriginSecurityPoolShareTokenSalt(questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas) {
    return keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint248' }], [questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas, 0n]));
}
function getOriginSecurityPoolShareTokenAddress(questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas) {
    return getCreate2Address({
        from: getInfraContractAddresses().shareTokenFactory,
        salt: getOriginSecurityPoolShareTokenSalt(questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas),
        bytecode: encodeDeployData({
            abi: peripherals_tokens_ShareToken_ShareToken.abi,
            bytecode: `0x${peripherals_tokens_ShareToken_ShareToken.evm.bytecode.object}`,
            args: [getInfraContractAddresses().securityPoolFactory, getZoltarAddress(), questionId],
        }),
    });
}
async function securityPoolExists(client, securityPoolAddress) {
    const code = await client.getCode({ address: securityPoolAddress });
    return code !== undefined && code !== '0x';
}
async function getSecurityPoolVaultCount(client, securityPoolAddress, blockNumber) {
    return await client.readContract({
        abi: peripherals_SecurityPool_SecurityPool.abi,
        functionName: 'getVaultCount',
        address: securityPoolAddress,
        args: [],
        blockNumber,
    });
}
async function getSecurityPoolVaults(client, securityPoolAddress, startIndex, count, blockNumber) {
    return await client.readContract({
        abi: peripherals_SecurityPool_SecurityPool.abi,
        functionName: 'getVaults',
        address: securityPoolAddress,
        args: [startIndex, count],
        blockNumber,
    });
}
async function loadEscalationVaultData(client, securityPoolAddress, vaultAddresses, blockNumber) {
    if (vaultAddresses.length === 0)
        return [];
    const escalationGameAddress = await client.readContract({
        abi: peripherals_SecurityPool_SecurityPool.abi,
        functionName: 'escalationGame',
        address: securityPoolAddress,
        args: [],
        blockNumber,
    });
    if (sameAddress(escalationGameAddress, zeroAddress)) {
        return vaultAddresses.map(() => ({ disputeStakedAttoRep: 0n }));
    }
    const disputeStakeContracts = vaultAddresses.map(vaultAddress => ({
        abi: peripherals_EscalationGame_EscalationGame.abi,
        functionName: 'disputeStakedRepByVaultAttoRep',
        address: escalationGameAddress,
        args: [vaultAddress],
    }));
    const disputeStakedAttoRep = await readRequiredMulticall(client, disputeStakeContracts, blockNumber);
    return disputeStakedAttoRep.map(value => {
        if (typeof value !== 'bigint')
            throw new Error('Unexpected escalation vault response');
        return { disputeStakedAttoRep: value };
    });
}
function hasCurrentSecurityVaultState(vaultData) {
    const [repBackingUnits, capacityOwnershipAttoRep, claimableFeesAttoEth] = vaultData;
    return repBackingUnits > 0n || capacityOwnershipAttoRep > 0n || claimableFeesAttoEth > 0n;
}
function getVaultRepBackingAttoRepFromRepBackingUnits({ repBackingUnits, totalRepBackingUnits, totalPoolHeldRepBalanceAttoRep }) {
    if (repBackingUnits === 0n || totalRepBackingUnits === 0n)
        return 0n;
    return (repBackingUnits * totalPoolHeldRepBalanceAttoRep) / totalRepBackingUnits;
}
async function loadSecurityPoolVaultSummaries(client, securityPoolAddress, options = {}) {
    const blockNumber = await client.getBlockNumber();
    const vaultCount = await getSecurityPoolVaultCount(client, securityPoolAddress, blockNumber);
    const previewLimit = options.previewLimit ?? SECURITY_POOL_LIST_VAULT_PREVIEW_LIMIT;
    if (vaultCount === 0n && options.accountAddress === undefined) {
        return {
            hasLoadedVaults: true,
            vaultScanCapped: false,
            vaultCount,
            vaults: [],
        };
    }
    const poolRepBackingTotalsPromise = Promise.all([
        client.readContract({
            abi: peripherals_SecurityPool_SecurityPool.abi,
            functionName: 'getTotalPoolHeldAttoRep',
            address: securityPoolAddress,
            args: [],
            blockNumber,
        }),
        client.readContract({
            abi: peripherals_SecurityPool_SecurityPool.abi,
            functionName: 'totalRepBackingUnits',
            address: securityPoolAddress,
            args: [],
            blockNumber,
        }),
    ]);
    const loadCurrentVaultSummaries = async (vaultAddresses) => {
        const securityVaultSummaryContracts = vaultAddresses.map(vaultAddress => ({
            abi: peripherals_SecurityPool_SecurityPool.abi,
            functionName: 'securityVaults',
            address: securityPoolAddress,
            args: [vaultAddress],
        }));
        const vaultOpenInterestContracts = vaultAddresses.map(vaultAddress => ({
            abi: peripherals_SecurityPool_SecurityPool.abi,
            functionName: 'getVaultOpenInterestAttoEth',
            address: securityPoolAddress,
            args: [vaultAddress],
        }));
        const vaultBadDebtContracts = vaultAddresses.map(vaultAddress => ({
            abi: peripherals_SecurityPool_SecurityPool.abi,
            functionName: 'vaultBadDebtAttoEth',
            address: securityPoolAddress,
            args: [vaultAddress],
        }));
        const [vaultData, vaultOpenInterest, vaultBadDebt, [totalPoolHeldRepBalanceAttoRep, totalRepBackingUnits], escalationVaultData] = await Promise.all([
            readRequiredMulticall(client, securityVaultSummaryContracts, blockNumber).then(result => requireSecurityVaultTupleArray(result, 'security vault tuple')),
            readRequiredMulticall(client, vaultOpenInterestContracts, blockNumber),
            readRequiredMulticall(client, vaultBadDebtContracts, blockNumber),
            poolRepBackingTotalsPromise,
            loadEscalationVaultData(client, securityPoolAddress, vaultAddresses, blockNumber),
        ]);
        return vaultAddresses.flatMap((vaultAddress, index) => {
            const currentVaultData = vaultData[index];
            if (currentVaultData === undefined)
                throw new Error('Unexpected vault data response');
            const currentEscalationData = escalationVaultData[index];
            if (currentEscalationData === undefined)
                throw new Error('Unexpected escalation vault response');
            const badDebtAttoEth = vaultBadDebt[index];
            if (typeof badDebtAttoEth !== 'bigint')
                throw new Error('Unexpected vault bad debt response');
            const openInterestAttoEth = vaultOpenInterest[index];
            if (typeof openInterestAttoEth !== 'bigint')
                throw new Error('Unexpected vault open interest response');
            if (!hasCurrentSecurityVaultState(currentVaultData) && currentEscalationData.disputeStakedAttoRep === 0n && badDebtAttoEth === 0n && openInterestAttoEth === 0n)
                return [];
            const [repBackingUnits, capacityOwnershipAttoRep, claimableFeesAttoEth] = currentVaultData;
            return [
                {
                    badDebtAttoEth,
                    openInterestAttoEth,
                    disputeStakedAttoRep: currentEscalationData.disputeStakedAttoRep,
                    repBackingUnits,
                    totalRepBackingUnits,
                    vaultAttoRepBacking: getVaultRepBackingAttoRepFromRepBackingUnits({
                        repBackingUnits,
                        totalRepBackingUnits,
                        totalPoolHeldRepBalanceAttoRep,
                    }),
                    capacityOwnershipAttoRep,
                    totalPoolHeldRepBalanceAttoRep,
                    claimableFeesAttoEth,
                    vaultAddress,
                },
            ];
        });
    };
    const vaults = [];
    const scannedVaultAddresses = [];
    let separatelyLoadedAccountVaults;
    let registryOffset = 0n;
    while (registryOffset < vaultCount && registryOffset < SECURITY_POOL_VAULT_SCAN_LIMIT && BigInt(vaults.length) < previewLimit) {
        const remainingVaultCount = vaultCount - registryOffset;
        const remainingScanCount = SECURITY_POOL_VAULT_SCAN_LIMIT - registryOffset;
        let pageSize = SECURITY_POOL_VAULT_SCAN_PAGE_SIZE;
        if (remainingVaultCount < pageSize)
            pageSize = remainingVaultCount;
        if (remainingScanCount < pageSize)
            pageSize = remainingScanCount;
        const pageVaultAddresses = await getSecurityPoolVaults(client, securityPoolAddress, registryOffset, pageSize, blockNumber);
        scannedVaultAddresses.push(...pageVaultAddresses);
        const summaryVaultAddresses = [...pageVaultAddresses];
        const shouldLoadAccountWithFirstPage = registryOffset === 0n && options.accountAddress !== undefined && !pageVaultAddresses.some(vaultAddress => sameAddress(vaultAddress, options.accountAddress));
        if (shouldLoadAccountWithFirstPage && options.accountAddress !== undefined)
            summaryVaultAddresses.push(options.accountAddress);
        const currentPageVaults = await loadCurrentVaultSummaries(summaryVaultAddresses);
        for (const vault of currentPageVaults) {
            if (options.accountAddress !== undefined && sameAddress(vault.vaultAddress, options.accountAddress) && (shouldLoadAccountWithFirstPage || separatelyLoadedAccountVaults !== undefined || BigInt(vaults.length) >= previewLimit)) {
                separatelyLoadedAccountVaults = [vault];
                continue;
            }
            if (BigInt(vaults.length) >= previewLimit)
                continue;
            vaults.push(vault);
        }
        registryOffset += pageSize;
    }
    if (options.accountAddress !== undefined && !vaults.some(vault => sameAddress(vault.vaultAddress, options.accountAddress))) {
        if (separatelyLoadedAccountVaults === undefined && !scannedVaultAddresses.some(vaultAddress => sameAddress(vaultAddress, options.accountAddress))) {
            separatelyLoadedAccountVaults = await loadCurrentVaultSummaries([options.accountAddress]);
        }
        if (separatelyLoadedAccountVaults !== undefined)
            vaults.push(...separatelyLoadedAccountVaults);
    }
    return {
        hasLoadedVaults: true,
        vaultScanCapped: registryOffset < vaultCount && BigInt(vaults.length) < previewLimit,
        vaultCount,
        vaults,
    };
}
export async function loadSecurityPoolVaultSummary(client, securityPoolAddress, vaultAddress) {
    const { vaults } = await loadSecurityPoolVaultSummaries(client, securityPoolAddress, {
        accountAddress: vaultAddress,
        previewLimit: 0n,
    });
    return (vaults.find(vault => sameAddress(vault.vaultAddress, vaultAddress)) ?? {
        badDebtAttoEth: 0n,
        openInterestAttoEth: 0n,
        disputeStakedAttoRep: 0n,
        vaultAttoRepBacking: 0n,
        capacityOwnershipAttoRep: 0n,
        claimableFeesAttoEth: 0n,
        vaultAddress,
    });
}
function shouldLoadSecurityPoolVaults(deployment, options) {
    if (options.vaultDetailMode === 'all')
        return true;
    if (options.selectedSecurityPoolAddress === undefined)
        return false;
    return sameAddress(deployment.securityPool, options.selectedSecurityPoolAddress) || sameAddress(deployment.parent, options.selectedSecurityPoolAddress);
}
function createDeferredSecurityPoolVaultSummary(vaultCount) {
    return {
        hasLoadedVaults: vaultCount === 0n,
        vaultScanCapped: false,
        vaultCount,
        vaults: [],
    };
}
async function loadSecurityPoolDetails(client, deployment, options) {
    const { initialReportPriorityFeeAttoEthPerGas, parent, priceOracleManagerAndOperatorQueuer: managerAddress, questionId, statoblastSecurityMultiplierBps, securityPool: securityPoolAddress, truthAuction: truthAuctionAddress, universeId } = deployment;
    const shouldLoadVaults = shouldLoadSecurityPoolVaults(deployment, options);
    const [[settlementCollateralAttoEth, currentRetentionRate, minimumSecurityBondDebtAttoEth, minimumVaultRepDepositAttoRep, forkData, lastOraclePrice, lastSettlementTimestamp, questionOutcome, systemStateValue, shareTokenSupplyAttoShares, totalPoolHeldAttoRep, poolAccountingSnapshot, universeForkTime], marketDetails, vaultSummaries,] = await Promise.all([
        readRequiredMulticall(client, [
            {
                abi: peripherals_SecurityPool_SecurityPool.abi,
                functionName: 'settlementCollateralAttoEth',
                address: securityPoolAddress,
                args: [],
            },
            {
                abi: peripherals_SecurityPool_SecurityPool.abi,
                functionName: 'currentRetentionRate',
                address: securityPoolAddress,
                args: [],
            },
            {
                abi: peripherals_SecurityPool_SecurityPool.abi,
                functionName: 'minimumSecurityBondDebtAttoEth',
                address: securityPoolAddress,
                args: [],
            },
            {
                abi: peripherals_SecurityPool_SecurityPool.abi,
                functionName: 'minimumVaultRepDepositAttoRep',
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
                abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
                functionName: 'lastPrice',
                address: managerAddress,
                args: [],
            },
            {
                abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
                functionName: 'lastSettlementTimestamp',
                address: managerAddress,
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
                functionName: 'systemState',
                address: securityPoolAddress,
                args: [],
            },
            {
                abi: peripherals_SecurityPool_SecurityPool.abi,
                functionName: 'shareTokenSupplyAttoShares',
                address: securityPoolAddress,
                args: [],
            },
            {
                abi: peripherals_SecurityPool_SecurityPool.abi,
                functionName: 'getTotalPoolHeldAttoRep',
                address: securityPoolAddress,
                args: [],
            },
            {
                abi: peripherals_SecurityPool_SecurityPool.abi,
                functionName: 'getPoolAccountingSnapshot',
                address: securityPoolAddress,
                args: [],
            },
            {
                abi: Zoltar_Zoltar.abi,
                functionName: 'getForkTime',
                address: getInfraContractAddresses().zoltar,
                args: [universeId],
            },
        ]),
        loadMarketDetails(client, questionId),
        shouldLoadVaults
            ? loadSecurityPoolVaultSummaries(client, securityPoolAddress, {
                ...(options.accountAddress === undefined ? {} : { accountAddress: options.accountAddress }),
                previewLimit: options.vaultPreviewLimit,
            })
            : getSecurityPoolVaultCount(client, securityPoolAddress).then(createDeferredSecurityPoolVaultSummary),
    ]);
    const { truthAuctionStartedAt, migratedAttoRep, forkOwnSecurityPool, forkOutcomeIndex } = requireForkDataView(forkData);
    const forkOutcome = getForkOutcomeKey(forkOutcomeIndex, parent);
    const systemState = getSecurityPoolSystemState(systemStateValue);
    return {
        settlementCollateralAttoEth,
        currentRetentionRate,
        feeAccrualState: {
            feeIndexRemainder: poolAccountingSnapshot.feeIndexRemainder,
            lastUpdatedFeeAccumulator: poolAccountingSnapshot.lastUpdatedFeeAccumulator,
            totalFeesOwedRemainder: poolAccountingSnapshot.totalFeesOwedRemainder,
        },
        feeEligibleCapacityOwnershipAttoRep: poolAccountingSnapshot.feeEligibleCapacityOwnershipAttoRep,
        forkOutcome,
        forkOwnSecurityPool,
        hasForkActivity: deriveHasForkActivity({
            forkOutcome,
            migratedAttoRep,
            systemState,
            truthAuctionStartedAt,
        }),
        initialReportPriorityFeeAttoEthPerGas,
        lastOraclePrice: lastSettlementTimestamp > 0n ? lastOraclePrice : undefined,
        lastOracleSettlementTimestamp: lastSettlementTimestamp,
        managerAddress,
        minimumSecurityBondDebtAttoEth,
        minimumVaultRepDepositAttoRep,
        marketDetails,
        migratedAttoRep,
        parent,
        questionOutcome: getReportingOutcomeKey(questionOutcome),
        questionId: getQuestionIdHex(questionId),
        statoblastSecurityMultiplierBps,
        securityPoolAddress,
        shareTokenSupplyAttoShares,
        systemState,
        totalPoolHeldAttoRep,
        totalCapacityOwnershipAttoRep: poolAccountingSnapshot.totalCapacityOwnershipAttoRep,
        truthAuctionAddress,
        truthAuctionStartedAt,
        universeHasForked: universeForkTime > 0n,
        universeId,
        hasLoadedVaults: vaultSummaries.hasLoadedVaults,
        vaultScanCapped: vaultSummaries.vaultScanCapped,
        vaultCount: vaultSummaries.vaultCount,
        vaults: vaultSummaries.vaults,
    };
}
async function loadSecurityPoolDeployments(client, startIndex, count) {
    if (count === 0n)
        return [];
    return requireSecurityPoolDeploymentTupleArray(await client.readContract({
        address: getInfraContractAddresses().securityPoolFactory,
        abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
        functionName: 'securityPoolDeploymentsRange',
        args: [startIndex, count],
    }), 'security pool deployments range');
}
async function loadListedSecurityPools(client, deployments, options) {
    return await Promise.all(deployments.map(async (deployment) => await loadSecurityPoolDetails(client, deployment, options)));
}
function applyChildForkActivityHints(pools) {
    return pools.map(pool => {
        if (pool.hasForkActivity)
            return pool;
        if (!pools.some(candidate => sameAddress(candidate.parent, pool.securityPoolAddress)))
            return pool;
        return {
            ...pool,
            hasForkActivity: true,
        };
    });
}
export async function loadAllSecurityPools(client, options = {}) {
    const deploymentCount = await client.readContract({
        address: getInfraContractAddresses().securityPoolFactory,
        abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
        functionName: 'securityPoolDeploymentCount',
        args: [],
    });
    const deployments = await loadSecurityPoolDeployments(client, 0n, deploymentCount);
    const pools = await loadListedSecurityPools(client, deployments, {
        ...(options.accountAddress === undefined ? {} : { accountAddress: options.accountAddress }),
        ...(options.selectedSecurityPoolAddress === undefined ? {} : { selectedSecurityPoolAddress: options.selectedSecurityPoolAddress }),
        vaultDetailMode: options.vaultDetailMode ?? 'all',
        vaultPreviewLimit: SECURITY_POOL_LIST_VAULT_PREVIEW_LIMIT,
    });
    return applyChildForkActivityHints(pools);
}
export async function createSecurityPool(client, parameters) {
    const { hash: deployPoolHash, receipt } = await writeContractAndWaitForReceipt(client, () => ({
        address: getDeploymentStepAddress('securityPoolFactory'),
        abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
        functionName: 'deployOriginSecurityPool',
        args: [0n, parameters.questionId, parameters.statoblastSecurityMultiplierBps, parameters.initialReportPriorityFeeAttoEthPerGas],
    }));
    return {
        deployPoolHash,
        initialReportPriorityFeeAttoEthPerGas: parameters.initialReportPriorityFeeAttoEthPerGas,
        questionId: getQuestionIdHex(parameters.questionId),
        securityPoolAddress: getSecurityPoolAddressFromReceipt(receipt),
        statoblastSecurityMultiplierBps: parameters.statoblastSecurityMultiplierBps,
        universeId: 0n,
    };
}
export async function originSecurityPoolExists(client, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas) {
    const shareTokenAddress = getOriginSecurityPoolShareTokenAddress(questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas);
    const code = await client.getCode({ address: shareTokenAddress });
    return code !== undefined && code !== '0x';
}
export async function loadSecurityPoolPage(client, pageIndex, pageSize, accountAddress) {
    const startIndex = getProtocolPageOffset(pageIndex, pageSize);
    const poolCount = await client.readContract({
        address: getInfraContractAddresses().securityPoolFactory,
        abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
        functionName: 'securityPoolDeploymentCount',
        args: [],
    });
    if (startIndex >= poolCount) {
        return {
            pageIndex,
            pageSize,
            poolCount,
            pools: [],
        };
    }
    const count = poolCount - startIndex < BigInt(pageSize) ? poolCount - startIndex : BigInt(pageSize);
    const deployments = await loadSecurityPoolDeployments(client, startIndex, count);
    const pools = await loadListedSecurityPools(client, deployments, {
        ...(accountAddress === undefined ? {} : { accountAddress }),
        vaultDetailMode: 'all',
        vaultPreviewLimit: SECURITY_POOL_PAGE_VAULT_PREVIEW_LIMIT,
    });
    return {
        pageIndex,
        pageSize,
        poolCount,
        pools,
    };
}
export async function loadSecurityVaultDetails(client, securityPoolAddress, vaultAddress) {
    if (!(await securityPoolExists(client, securityPoolAddress)))
        return undefined;
    const [badDebtAttoEth, currentRetentionRate, managerAddress, minimumSecurityBondDebtAttoEth, minimumVaultRepDepositAttoRep, totalRepBackingUnits, repToken, totalPoolHeldRepBalanceAttoRep, totalCapacityOwnershipAttoRep, universeId, vaultData, disputeStakedRepByVaultAttoRep] = await Promise.all([
        client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'vaultBadDebtAttoEth', address: securityPoolAddress, args: [vaultAddress] }),
        client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'currentRetentionRate', address: securityPoolAddress, args: [] }),
        client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'priceOracleManagerAndOperatorQueuer', address: securityPoolAddress, args: [] }),
        client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'minimumSecurityBondDebtAttoEth', address: securityPoolAddress, args: [] }),
        client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'minimumVaultRepDepositAttoRep', address: securityPoolAddress, args: [] }),
        client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'totalRepBackingUnits', address: securityPoolAddress, args: [] }),
        client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'repToken', address: securityPoolAddress, args: [] }),
        client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'getTotalPoolHeldAttoRep', address: securityPoolAddress, args: [] }),
        client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'totalCapacityOwnershipAttoRep', address: securityPoolAddress, args: [] }),
        client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'universeId', address: securityPoolAddress, args: [] }),
        client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'securityVaults', address: securityPoolAddress, args: [vaultAddress] }),
        loadEscalationVaultData(client, securityPoolAddress, [vaultAddress]).then(values => values[0]?.disputeStakedAttoRep ?? 0n),
    ]);
    const [repBackingUnits, capacityOwnershipAttoRep, claimableFeesAttoEth] = vaultData;
    const vaultAttoRepBacking = getVaultRepBackingAttoRepFromRepBackingUnits({
        repBackingUnits,
        totalRepBackingUnits,
        totalPoolHeldRepBalanceAttoRep,
    });
    return {
        badDebtAttoEth,
        currentRetentionRate,
        disputeStakedAttoRep: disputeStakedRepByVaultAttoRep,
        managerAddress,
        minimumSecurityBondDebtAttoEth,
        minimumVaultRepDepositAttoRep,
        totalRepBackingUnits,
        vaultAttoRepBacking,
        repToken,
        capacityOwnershipAttoRep,
        securityPoolAddress,
        totalCapacityOwnershipAttoRep,
        claimableFeesAttoEth,
        universeId,
        vaultAddress,
    };
}
//# sourceMappingURL=securityPools.js.map