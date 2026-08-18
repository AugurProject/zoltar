import { zeroAddress } from '@zoltar/shared/ethereum';
import { DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS } from '@zoltar/shared/oracleInitialReport';
import * as protocol from '../protocol/index.js';
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js';
let scenarioProtocolOverride;
export function installStatoblastScenarioProtocolForTesting(override) {
    scenarioProtocolOverride = override;
}
function getScenarioProtocol() {
    return scenarioProtocolOverride ?? protocol;
}
import { createRangeProgressReporter, deploySimulationAppContracts, reportBootstrapProgress, requireQaAccount } from '@zoltar/ui-core-shared/simulation/bootstrap.js';
import { getTruthAuctionPriceAtTick, getTruthAuctionTickAtPrice } from '@zoltar/ui-core-shared/protocol/truthAuctionMath.js';
import { advanceSimulationTime, getSimulationChainTimestamp } from '@zoltar/ui-core-shared/simulation/clock.js';
export function getStatoblastScenarioLabel(scenario) {
    switch (scenario) {
        case 'security-pool':
            return 'Security pool';
        case 'securitypoolx2':
            return 'Security pool x2';
        case 'securitypoolx2-auction':
            return 'Security pool x2 auction';
        default:
            return assertNever(scenario);
    }
}
export function getStatoblastScenarioDescription(scenario) {
    switch (scenario) {
        case 'security-pool':
            return 'One seeded question, one security pool, and one funded vault with an active capacity ownership. Use it to test pool actions and liquidation paths.';
        case 'securitypoolx2':
            return 'Two seeded questions with two security pools and two funded vaults in each pool. Use it to test multi-pool selection and repeated pool actions.';
        case 'securitypoolx2-auction':
            return 'Two seeded questions with one own-escalation fork already triggered and one child truth auction seeded with ten bids. Use it to test the fork-auction bidbook and settlement actions.';
        default:
            return assertNever(scenario);
    }
}
const DAY_IN_SECONDS = 24n * 60n * 60n;
function getSeededCoordinatorInitialReportPrice() {
    return SEEDED_REP_ETH_PRICE;
}
const FORK_MIGRATION_TIME_SECONDS = 8n * 7n * DAY_IN_SECONDS;
const SEEDED_REP_ETH_PRICE = 3n * 10n ** 18n;
const STATOBLAST_SECURITY_MULTIPLIER_BPS = 20000n;
const SECURITY_POOL_REP_DEPOSIT = 10000n * 10n ** 18n;
const CAPACITY_OWNERSHIP_ATTO_REP = 80n * 10n ** 18n;
const SECURITY_POOL_X2_PRIMARY_REP_DEPOSIT = 12000n * 10n ** 18n;
const SECURITY_POOL_X2_PRIMARY_CAPACITY_OWNERSHIP_ATTO_REP = 40n * 10n ** 18n;
const SECURITY_POOL_X2_SECONDARY_REP_DEPOSIT = SECURITY_POOL_REP_DEPOSIT;
const SECURITY_POOL_X2_SECONDARY_CAPACITY_OWNERSHIP_ATTO_REP = 40n * 10n ** 18n;
const SECURITY_POOL_X2_AUCTION_EXTRA_REP_DEPOSIT = 2000000n * 10n ** 18n;
const SECURITY_POOL_X2_AUCTION_UNMIGRATED_REP_DEPOSIT = 1000n * 10n ** 18n;
const SECURITY_POOL_X2_AUCTION_BID_PRICES = [getTruthAuctionPriceAtTick(12n), getTruthAuctionPriceAtTick(10n), getTruthAuctionPriceAtTick(8n)];
const SECURITY_POOL_X2_AUCTION_BID_AMOUNTS = [3n * 10n ** 18n, 4n * 10n ** 18n, 5n * 10n ** 18n, 6n * 10n ** 18n, 3n * 10n ** 18n, 4n * 10n ** 18n, 5n * 10n ** 18n, 3n * 10n ** 18n, 4n * 10n ** 18n, 5n * 10n ** 18n];
function createSecurityPoolSeedParameters(currentTimestamp, title) {
    return {
        marketType: 'binary',
        outcomeLabels: ['Yes', 'No'],
        questionData: {
            answerUnit: '',
            description: '',
            displayValueMax: 0n,
            displayValueMin: 0n,
            endTime: currentTimestamp + 365n * DAY_IN_SECONDS,
            numTicks: 0n,
            startTime: 0n,
            title,
        },
    };
}
async function loadRequiredSeededPool(readClient, securityPoolAddress, poolLabel) {
    const seededPool = (await getScenarioProtocol().loadAllSecurityPools(readClient)).find(pool => pool.securityPoolAddress === securityPoolAddress);
    if (seededPool === undefined)
        throw new Error(`Expected ${poolLabel} at ${securityPoolAddress}`);
    return seededPool;
}
async function loadRequiredSecurityVault(readClient, securityPoolAddress, vaultAddress, label) {
    const vaultDetails = await getScenarioProtocol().loadSecurityVaultDetails(readClient, securityPoolAddress, vaultAddress);
    if (vaultDetails === undefined)
        throw new Error(`Expected seeded security vault details for ${label}`);
    return vaultDetails;
}
function getSeededVaultTargetHealthFactorBps(vault) {
    if (vault.capacityOwnershipAttoRep <= 0n)
        throw new Error('Seeded vault capacity ownership must be positive');
    const numerator = vault.vaultRepBackingDepositAttoRep * 10000n;
    if (numerator % vault.capacityOwnershipAttoRep !== 0n)
        throw new Error('Seeded vault capacity ownership must map to an exact target health factor');
    const targetHealthFactorBps = numerator / vault.capacityOwnershipAttoRep;
    if (targetHealthFactorBps < 10000n)
        throw new Error('Seeded vault target health factor must be at least 1.00×');
    return targetHealthFactorBps;
}
async function createSeededSecurityPool({ createWriteClient, currentTimestamp, deployerAccount, questionTitle }) {
    const deployerWriteClient = createWriteClient(deployerAccount);
    const marketResult = await getScenarioProtocol().createMarket(deployerWriteClient, createSecurityPoolSeedParameters(currentTimestamp, questionTitle));
    const questionId = BigInt(marketResult.questionId);
    const poolResult = await getScenarioProtocol().createSecurityPool(deployerWriteClient, {
        initialReportPriorityFeeAttoEthPerGas: DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS,
        questionId,
        statoblastSecurityMultiplierBps: STATOBLAST_SECURITY_MULTIPLIER_BPS,
    });
    return {
        questionId,
        securityPoolAddress: poolResult.securityPoolAddress,
    };
}
async function validateSeededSecurityPool({ expectedVaults, poolLabel, readClient, securityPoolAddress }) {
    const seededPool = await loadRequiredSeededPool(readClient, securityPoolAddress, poolLabel);
    const expectedVaultCount = BigInt(expectedVaults.length);
    let expectedRepDeposit = 0n;
    let expectedCapacityOwnershipAttoRep = 0n;
    for (const expectedVault of expectedVaults) {
        expectedRepDeposit += expectedVault.vaultRepBackingDepositAttoRep;
        expectedCapacityOwnershipAttoRep += expectedVault.capacityOwnershipAttoRep;
    }
    if (seededPool.vaultCount !== expectedVaultCount)
        throw new Error(`Expected ${poolLabel} to have ${expectedVaultCount.toString()} seeded vaults`);
    if (seededPool.totalPoolHeldAttoRep !== expectedRepDeposit)
        throw new Error(`Expected ${poolLabel} to have ${expectedRepDeposit.toString()} seeded REP`);
    if (seededPool.totalCapacityOwnershipAttoRep !== expectedCapacityOwnershipAttoRep)
        throw new Error(`Expected ${poolLabel} to have ${expectedCapacityOwnershipAttoRep.toString()} seeded capacity ownership`);
    for (const expectedVault of expectedVaults) {
        const vault = seededPool.vaults.find(candidate => candidate.vaultAddress === expectedVault.accountAddress);
        if (vault === undefined)
            throw new Error(`Expected ${poolLabel} to include seeded vault ${expectedVault.accountAddress}`);
        if (vault.vaultAttoRepBacking !== expectedVault.vaultRepBackingDepositAttoRep)
            throw new Error(`Expected ${poolLabel} vault ${expectedVault.accountAddress} to hold ${expectedVault.vaultRepBackingDepositAttoRep.toString()} seeded REP`);
        if (vault.capacityOwnershipAttoRep !== expectedVault.capacityOwnershipAttoRep)
            throw new Error(`Expected ${poolLabel} vault ${expectedVault.accountAddress} to hold ${expectedVault.capacityOwnershipAttoRep.toString()} seeded capacity ownership`);
    }
}
async function settleSeededOracleReport({ accountAddress, createWriteClient, managerAddress, onProgressStep, poolLabel, readClient, }) {
    const writeClient = createWriteClient(accountAddress);
    const initialReportPrice = getSeededCoordinatorInitialReportPrice();
    await getScenarioProtocol().requestOraclePrice(writeClient, managerAddress, initialReportPrice);
    await onProgressStep(`Configuring oracle manager for ${poolLabel}`);
    const oracleManagerDetails = await getScenarioProtocol().loadOracleManagerDetails(readClient, managerAddress);
    if (oracleManagerDetails.pendingReportId === 0n)
        throw new Error(`Expected a pending oracle report for ${poolLabel}`);
    await onProgressStep(`Opening seeded oracle report for ${poolLabel}`);
    return {
        openOracleAddress: oracleManagerDetails.openOracleAddress,
        pendingReportId: oracleManagerDetails.pendingReportId,
    };
}
async function settleOracleReportIfNeeded({ memoryClient, readClient, writeClient, openOracleAddress, pendingReportId }) {
    const seededReport = await getScenarioProtocol().loadOpenOracleReportDetails(readClient, openOracleAddress, pendingReportId);
    if (seededReport.isDistributed)
        return;
    const reportTimestamp = getSimulationReportTiming(seededReport.reportTimestamp);
    const settlementTime = getSimulationReportTiming(seededReport.settlementTime);
    if (reportTimestamp !== undefined && settlementTime !== undefined) {
        const settlementReadyTimestamp = reportTimestamp + settlementTime + 1n;
        const currentTimestamp = await getSimulationChainTimestamp(memoryClient);
        if (currentTimestamp < settlementReadyTimestamp) {
            await advanceSimulationTime(memoryClient, settlementReadyTimestamp - currentTimestamp);
        }
    }
    await getScenarioProtocol().settleOracleReport(writeClient, openOracleAddress, pendingReportId);
}
async function refreshSeededOraclePrice({ accountAddress, createWriteClient, managerAddress, memoryClient, readClient }) {
    const writeClient = createWriteClient(accountAddress);
    let managerDetails = await getScenarioProtocol().loadOracleManagerDetails(readClient, managerAddress);
    if (managerDetails.isPriceValid)
        return;
    if (managerDetails.pendingReportId === 0n) {
        const initialReportPrice = getSeededCoordinatorInitialReportPrice();
        await getScenarioProtocol().requestOraclePrice(writeClient, managerAddress, initialReportPrice);
        managerDetails = await getScenarioProtocol().loadOracleManagerDetails(readClient, managerAddress);
    }
    if (managerDetails.pendingReportId === 0n) {
        throw new Error(`Expected a pending oracle report for ${managerAddress}`);
    }
    const reportDetails = await getScenarioProtocol().loadOpenOracleReportDetails(readClient, managerDetails.openOracleAddress, managerDetails.pendingReportId);
    if (reportDetails.reportTimestamp === 0n || reportDetails.currentReporter === zeroAddress) {
        throw new Error(`Expected the coordinator request to submit the initial report for ${managerAddress}`);
    }
    await settleOracleReportIfNeeded({
        memoryClient,
        openOracleAddress: managerDetails.openOracleAddress,
        pendingReportId: managerDetails.pendingReportId,
        readClient,
        writeClient,
    });
    const refreshedManagerDetails = await getScenarioProtocol().loadOracleManagerDetails(readClient, managerAddress);
    if (!refreshedManagerDetails.isPriceValid)
        throw new Error(`Expected a valid seeded oracle price for ${managerAddress}`);
}
function getSimulationReportTiming(value) {
    if (typeof value === 'bigint')
        return value;
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
        return BigInt(value);
    return undefined;
}
async function seedSecurityPool({ createReadClient, createWriteClient, memoryClient, onProgress, poolSpec, profile, seedTimestamp, }) {
    const readClient = createReadClient();
    const primaryVaultSpec = poolSpec.vaults[0];
    if (primaryVaultSpec === undefined)
        throw new Error(`Missing primary seeded vault account for ${poolSpec.poolLabel}`);
    const primaryVaultAccount = primaryVaultSpec.accountAddress;
    const additionalVaults = poolSpec.vaults.slice(1);
    const stepCount = 2 + poolSpec.vaults.length + 3 + additionalVaults.length + 1;
    const reportStep = createRangeProgressReporter(onProgress, poolSpec.progressRange, stepCount);
    const poolResult = await createSeededSecurityPool({
        createWriteClient,
        currentTimestamp: seedTimestamp,
        deployerAccount: primaryVaultAccount,
        questionTitle: poolSpec.questionTitle,
    });
    await reportStep(`Creating seeded question for ${poolSpec.poolLabel}`);
    await reportStep(`Deploying seeded security pool for ${poolSpec.poolLabel}`);
    for (const [index, vaultSpec] of poolSpec.vaults.entries()) {
        const writeClient = createWriteClient(vaultSpec.accountAddress);
        await getScenarioProtocol().approveErc20(writeClient, profile.genesisRepTokenAddress, poolResult.securityPoolAddress, vaultSpec.vaultRepBackingDepositAttoRep, 'approveRep');
        await getScenarioProtocol().depositRepToVaultToSecurityPool(writeClient, poolResult.securityPoolAddress, vaultSpec.vaultRepBackingDepositAttoRep, getSeededVaultTargetHealthFactorBps(vaultSpec));
        const seededVault = await loadRequiredSecurityVault(readClient, poolResult.securityPoolAddress, vaultSpec.accountAddress, vaultSpec.accountAddress);
        if (seededVault.vaultAttoRepBacking !== vaultSpec.vaultRepBackingDepositAttoRep)
            throw new Error(`Expected seeded REP deposit for ${vaultSpec.accountAddress} in ${poolSpec.poolLabel}, got ${seededVault.vaultAttoRepBacking.toString()}`);
        await reportStep(`Funding seeded security vault ${index + 1} of ${poolSpec.vaults.length} for ${poolSpec.poolLabel}`);
    }
    const primaryVault = await loadRequiredSecurityVault(readClient, poolResult.securityPoolAddress, primaryVaultAccount, primaryVaultAccount);
    const seededOracleReport = await settleSeededOracleReport({
        accountAddress: primaryVaultAccount,
        createWriteClient,
        managerAddress: primaryVault.managerAddress,
        onProgressStep: reportStep,
        poolLabel: poolSpec.poolLabel,
        readClient,
    });
    await settleOracleReportIfNeeded({
        memoryClient,
        openOracleAddress: seededOracleReport.openOracleAddress,
        pendingReportId: seededOracleReport.pendingReportId,
        readClient,
        writeClient: createWriteClient(primaryVaultAccount),
    });
    await reportStep(`Settling seeded oracle report for ${poolSpec.poolLabel}`);
    const seededReport = await getScenarioProtocol().loadOpenOracleReportDetails(readClient, seededOracleReport.openOracleAddress, seededOracleReport.pendingReportId);
    if (!seededReport.isDistributed)
        throw new Error(`Expected the seeded oracle report to be settled for ${poolSpec.poolLabel}`);
    const primaryVaultAfterSettlement = await loadRequiredSecurityVault(readClient, poolResult.securityPoolAddress, primaryVaultAccount, primaryVaultAccount);
    if (primaryVaultAfterSettlement.capacityOwnershipAttoRep !== primaryVaultSpec.capacityOwnershipAttoRep) {
        throw new Error(`Expected seeded capacity ownership ${primaryVaultSpec.capacityOwnershipAttoRep.toString()} for ${primaryVaultAccount}`);
    }
    for (const index of additionalVaults.keys()) {
        await reportStep(`Configuring seeded security vault ${index + 2} of ${poolSpec.vaults.length} for ${poolSpec.poolLabel}`);
    }
    await validateSeededSecurityPool({
        expectedVaults: poolSpec.vaults,
        poolLabel: poolSpec.poolLabel,
        readClient,
        securityPoolAddress: poolResult.securityPoolAddress,
    });
    await reportStep(poolSpec.readyLabel);
}
async function seedSecurityPoolScenario({ accounts, createReadClient, createWriteClient, memoryClient, onProgress, profile, }) {
    const primaryAccount = requireQaAccount(accounts[0], 'Expected seeded simulation QA account A1');
    const currentTimestamp = await getSimulationChainTimestamp(memoryClient);
    await seedSecurityPool({
        createReadClient,
        createWriteClient,
        memoryClient,
        onProgress,
        poolSpec: {
            poolLabel: 'seeded security pool',
            progressRange: { start: 0.78, end: 0.98 },
            questionTitle: 'Will this resolve?',
            readyLabel: 'Seeded security-pool scenario is ready',
            vaults: [
                {
                    accountAddress: primaryAccount,
                    vaultRepBackingDepositAttoRep: SECURITY_POOL_REP_DEPOSIT,
                    capacityOwnershipAttoRep: CAPACITY_OWNERSHIP_ATTO_REP,
                },
            ],
        },
        profile,
        seedTimestamp: currentTimestamp,
    });
}
async function seedSecurityPoolX2Scenario({ accounts, createReadClient, createWriteClient, memoryClient, onProgress, profile, }) {
    const primaryAccount = requireQaAccount(accounts[0], 'Expected simulation QA account A1 for securitypoolx2');
    const secondaryAccount = requireQaAccount(accounts[1], 'Expected simulation QA account B2 for securitypoolx2');
    const currentTimestamp = await getSimulationChainTimestamp(memoryClient);
    const readClient = createReadClient();
    const reportStep = createRangeProgressReporter(onProgress, { start: 0.72, end: 0.98 }, 17);
    const seededVaults = [
        {
            accountAddress: primaryAccount,
            vaultRepBackingDepositAttoRep: SECURITY_POOL_X2_PRIMARY_REP_DEPOSIT,
            capacityOwnershipAttoRep: SECURITY_POOL_X2_PRIMARY_CAPACITY_OWNERSHIP_ATTO_REP,
        },
        {
            accountAddress: secondaryAccount,
            vaultRepBackingDepositAttoRep: SECURITY_POOL_X2_SECONDARY_REP_DEPOSIT,
            capacityOwnershipAttoRep: SECURITY_POOL_X2_SECONDARY_CAPACITY_OWNERSHIP_ATTO_REP,
        },
    ];
    const seededPools = [
        {
            poolLabel: 'securitypoolx2 pool 1',
            questionTitle: 'Will this resolve? (securitypoolx2 #1)',
            vaults: seededVaults,
        },
        {
            poolLabel: 'securitypoolx2 pool 2',
            questionTitle: 'Will this resolve? (securitypoolx2 #2)',
            vaults: seededVaults,
        },
    ];
    const preparedPools = [];
    for (const seededPool of seededPools) {
        const poolResult = await createSeededSecurityPool({
            createWriteClient,
            currentTimestamp,
            deployerAccount: primaryAccount,
            questionTitle: seededPool.questionTitle,
        });
        await reportStep(`Creating seeded question for ${seededPool.poolLabel}`);
        await reportStep(`Deploying seeded security pool for ${seededPool.poolLabel}`);
        for (const [index, vaultSpec] of seededPool.vaults.entries()) {
            const writeClient = createWriteClient(vaultSpec.accountAddress);
            await getScenarioProtocol().approveErc20(writeClient, profile.genesisRepTokenAddress, poolResult.securityPoolAddress, vaultSpec.vaultRepBackingDepositAttoRep, 'approveRep');
            await getScenarioProtocol().depositRepToVaultToSecurityPool(writeClient, poolResult.securityPoolAddress, vaultSpec.vaultRepBackingDepositAttoRep, getSeededVaultTargetHealthFactorBps(vaultSpec));
            const seededVault = await loadRequiredSecurityVault(readClient, poolResult.securityPoolAddress, vaultSpec.accountAddress, vaultSpec.accountAddress);
            if (seededVault.vaultAttoRepBacking !== vaultSpec.vaultRepBackingDepositAttoRep)
                throw new Error(`Expected seeded REP deposit for ${vaultSpec.accountAddress} in ${seededPool.poolLabel}, got ${seededVault.vaultAttoRepBacking.toString()}`);
            await reportStep(`Funding seeded security vault ${index + 1} of ${seededPool.vaults.length} for ${seededPool.poolLabel}`);
        }
        const primaryVault = await loadRequiredSecurityVault(readClient, poolResult.securityPoolAddress, primaryAccount, primaryAccount);
        const primaryVaultSpec = seededPool.vaults[0];
        if (primaryVaultSpec === undefined)
            throw new Error(`Expected a primary seeded vault for ${seededPool.poolLabel}`);
        const seededOracleReport = await settleSeededOracleReport({
            accountAddress: primaryAccount,
            createWriteClient,
            managerAddress: primaryVault.managerAddress,
            onProgressStep: reportStep,
            poolLabel: seededPool.poolLabel,
            readClient,
        });
        preparedPools.push({
            managerAddress: primaryVault.managerAddress,
            openOracleAddress: seededOracleReport.openOracleAddress,
            poolLabel: seededPool.poolLabel,
            pendingReportId: seededOracleReport.pendingReportId,
            primaryVault: primaryVaultSpec,
            securityPoolAddress: poolResult.securityPoolAddress,
            vaults: seededPool.vaults,
        });
    }
    for (const preparedPool of preparedPools) {
        await settleOracleReportIfNeeded({
            memoryClient,
            openOracleAddress: preparedPool.openOracleAddress,
            pendingReportId: preparedPool.pendingReportId,
            readClient,
            writeClient: createWriteClient(primaryAccount),
        });
        await reportStep(`Settling seeded oracle report for ${preparedPool.poolLabel}`);
        const seededReport = await getScenarioProtocol().loadOpenOracleReportDetails(readClient, preparedPool.openOracleAddress, preparedPool.pendingReportId);
        if (!seededReport.isDistributed)
            throw new Error(`Expected the seeded oracle report to be settled for ${preparedPool.poolLabel}`);
        const primaryVaultAfterSettlement = await loadRequiredSecurityVault(readClient, preparedPool.securityPoolAddress, primaryAccount, primaryAccount);
        if (primaryVaultAfterSettlement.capacityOwnershipAttoRep !== preparedPool.primaryVault.capacityOwnershipAttoRep) {
            throw new Error(`Expected seeded capacity ownership ${preparedPool.primaryVault.capacityOwnershipAttoRep.toString()} for ${primaryAccount}`);
        }
    }
    for (const preparedPool of preparedPools) {
        const secondaryVault = preparedPool.vaults[1];
        if (secondaryVault === undefined)
            throw new Error(`Expected a secondary seeded vault for ${preparedPool.poolLabel}`);
        await reportStep(`Configuring seeded security vault 2 of 2 for ${preparedPool.poolLabel}`);
        await validateSeededSecurityPool({
            expectedVaults: preparedPool.vaults,
            poolLabel: preparedPool.poolLabel,
            readClient,
            securityPoolAddress: preparedPool.securityPoolAddress,
        });
    }
    await reportStep('Seeded securitypoolx2 scenario is ready');
}
async function loadRequiredChildSecurityPool(readClient, parentSecurityPoolAddress, questionOutcome) {
    const childPool = (await getScenarioProtocol().loadAllSecurityPools(readClient)).find(pool => pool.parent === parentSecurityPoolAddress && pool.questionOutcome === questionOutcome);
    if (childPool === undefined)
        throw new Error(`Expected a ${questionOutcome} child pool for ${parentSecurityPoolAddress}`);
    return childPool;
}
async function seedSecurityPoolX2AuctionScenario({ accounts, createReadClient, createWriteClient, memoryClient, onProgress, profile, }) {
    await seedSecurityPoolX2Scenario({
        accounts,
        createReadClient,
        createWriteClient,
        memoryClient,
        onProgress,
        profile,
    });
    const primaryAccount = requireQaAccount(accounts[0], 'Expected simulation QA account A1 for securitypoolx2-auction');
    const secondaryAccount = requireQaAccount(accounts[1], 'Expected simulation QA account B2 for securitypoolx2-auction');
    const readClient = createReadClient();
    const writeClient = createWriteClient(primaryAccount);
    const x2Pools = await getScenarioProtocol().loadAllSecurityPools(readClient);
    const parentPool = x2Pools.find(pool => pool.marketDetails.title === 'Will this resolve? (securitypoolx2 #1)');
    if (parentPool === undefined)
        throw new Error('Expected the first securitypoolx2 parent pool for auction scenario seeding');
    await reportBootstrapProgress(onProgress, 'Preparing fork-auction seed pool', 0.985);
    await getScenarioProtocol().approveErc20(writeClient, profile.genesisRepTokenAddress, parentPool.securityPoolAddress, SECURITY_POOL_X2_AUCTION_EXTRA_REP_DEPOSIT, 'approveRep');
    await getScenarioProtocol().depositRepToVaultToSecurityPool(writeClient, parentPool.securityPoolAddress, SECURITY_POOL_X2_AUCTION_EXTRA_REP_DEPOSIT);
    const secondaryWriteClient = createWriteClient(secondaryAccount);
    await getScenarioProtocol().approveErc20(secondaryWriteClient, profile.genesisRepTokenAddress, parentPool.securityPoolAddress, SECURITY_POOL_X2_AUCTION_UNMIGRATED_REP_DEPOSIT, 'approveRep');
    await getScenarioProtocol().depositRepToVaultToSecurityPool(secondaryWriteClient, parentPool.securityPoolAddress, SECURITY_POOL_X2_AUCTION_UNMIGRATED_REP_DEPOSIT);
    await getScenarioProtocol().createCompleteSetInSecurityPool(createWriteClient(secondaryAccount), parentPool.securityPoolAddress, 20n * 10n ** 18n);
    const universeSummary = await getScenarioProtocol().loadZoltarUniverseSummary(readClient, parentPool.universeId);
    if (universeSummary === undefined)
        throw new Error(`Expected a Zoltar universe summary for parent pool ${parentPool.securityPoolAddress}`);
    const reportingDetailsBeforeFork = await getScenarioProtocol().loadReportingDetails(readClient, parentPool.securityPoolAddress, primaryAccount);
    if (reportingDetailsBeforeFork.marketDetails.endTime >= reportingDetailsBeforeFork.currentTime) {
        await advanceSimulationTime(memoryClient, reportingDetailsBeforeFork.marketDetails.endTime - reportingDetailsBeforeFork.currentTime + DAY_IN_SECONDS);
    }
    const ownForkDepositAmount = (universeSummary.forkThresholdAttoRep * 10000n) / STATOBLAST_SECURITY_MULTIPLIER_BPS;
    await refreshSeededOraclePrice({
        accountAddress: primaryAccount,
        createWriteClient,
        managerAddress: parentPool.managerAddress,
        memoryClient,
        readClient,
    });
    await reportBootstrapProgress(onProgress, 'Triggering own-escalation fork', 0.988);
    await getScenarioProtocol().reportOutcomeInSecurityPool(writeClient, parentPool.securityPoolAddress, 'yes', ownForkDepositAmount);
    await getScenarioProtocol().reportOutcomeInSecurityPool(writeClient, parentPool.securityPoolAddress, 'no', ownForkDepositAmount);
    await getScenarioProtocol().forkZoltarWithOwnEscalation(writeClient, parentPool.securityPoolAddress, parentPool.universeId);
    await reportBootstrapProgress(onProgress, 'Creating and funding Yes child universe', 0.99);
    await getScenarioProtocol().createChildUniverseFromSecurityPool(writeClient, parentPool.securityPoolAddress, parentPool.universeId, 'yes');
    await getScenarioProtocol().migrateRepToZoltarFromSecurityPool(writeClient, parentPool.securityPoolAddress, parentPool.universeId, ['yes']);
    await advanceSimulationTime(memoryClient, FORK_MIGRATION_TIME_SECONDS + DAY_IN_SECONDS);
    const yesChildPool = await loadRequiredChildSecurityPool(readClient, parentPool.securityPoolAddress, 'yes');
    const yesForkDetailsBeforeAuction = await getScenarioProtocol().loadForkAuctionDetails(readClient, yesChildPool.securityPoolAddress);
    await reportBootstrapProgress(onProgress, 'Starting seeded truth auction', 0.992);
    await getScenarioProtocol().startTruthAuctionForSecurityPool(writeClient, yesChildPool.securityPoolAddress, yesForkDetailsBeforeAuction.universeId);
    const yesForkDetails = await getScenarioProtocol().loadForkAuctionDetails(readClient, yesChildPool.securityPoolAddress);
    if (yesForkDetails.truthAuctionAddress === undefined || yesForkDetails.truthAuctionAddress === '0x0000000000000000000000000000000000000000') {
        throw new Error('Expected a seeded truth auction address for the Yes child pool');
    }
    if (yesForkDetails.truthAuction?.finalized) {
        await reportBootstrapProgress(onProgress, 'Seeded securitypoolx2-auction scenario is ready', 0.995);
        return;
    }
    const biddingAccounts = [primaryAccount, secondaryAccount, ...accounts.slice(2)];
    const bidPriceByIndex = [
        SECURITY_POOL_X2_AUCTION_BID_PRICES[0],
        SECURITY_POOL_X2_AUCTION_BID_PRICES[0],
        SECURITY_POOL_X2_AUCTION_BID_PRICES[0],
        SECURITY_POOL_X2_AUCTION_BID_PRICES[0],
        SECURITY_POOL_X2_AUCTION_BID_PRICES[1],
        SECURITY_POOL_X2_AUCTION_BID_PRICES[1],
        SECURITY_POOL_X2_AUCTION_BID_PRICES[1],
        SECURITY_POOL_X2_AUCTION_BID_PRICES[2],
        SECURITY_POOL_X2_AUCTION_BID_PRICES[2],
        SECURITY_POOL_X2_AUCTION_BID_PRICES[2],
    ];
    for (const [index, bidAmount] of SECURITY_POOL_X2_AUCTION_BID_AMOUNTS.entries()) {
        const bidderAccount = biddingAccounts[index % biddingAccounts.length];
        if (bidderAccount === undefined)
            throw new Error('Expected at least one QA account for seeded truth auction bids');
        const bidPrice = bidPriceByIndex[index];
        if (bidPrice === undefined)
            throw new Error(`Missing seeded truth auction bid price for bid ${index + 1}`);
        const bidTick = getTruthAuctionTickAtPrice(bidPrice);
        if (bidTick === undefined)
            throw new Error(`Unable to map seeded truth auction bid price to a tick for bid ${index + 1}`);
        await getScenarioProtocol().submitTruthAuctionBid(createWriteClient(bidderAccount), yesChildPool.securityPoolAddress, yesForkDetails.universeId, yesForkDetails.truthAuctionAddress, bidTick, bidAmount);
    }
    await reportBootstrapProgress(onProgress, 'Seeded securitypoolx2-auction scenario is ready', 0.995);
}
export async function applyStatoblastScenario({ accounts, createReadClient, createWriteClient, memoryClient, onProgress, profile, scenario }) {
    const primaryAccount = requireQaAccount(accounts[0], 'Expected seeded simulation QA account A1');
    switch (scenario) {
        case 'security-pool':
            await deploySimulationAppContracts(createWriteClient(primaryAccount), memoryClient, onProgress, profile, { start: 0.32, end: 0.78 }, getScenarioProtocol().getDeploymentSteps);
            await seedSecurityPoolScenario({
                accounts,
                createReadClient,
                createWriteClient,
                memoryClient,
                onProgress,
                profile,
            });
            return true;
        case 'securitypoolx2':
            await deploySimulationAppContracts(createWriteClient(primaryAccount), memoryClient, onProgress, profile, { start: 0.32, end: 0.7 }, getScenarioProtocol().getDeploymentSteps);
            await seedSecurityPoolX2Scenario({
                accounts,
                createReadClient,
                createWriteClient,
                memoryClient,
                onProgress,
                profile,
            });
            return true;
        case 'securitypoolx2-auction':
            await deploySimulationAppContracts(createWriteClient(primaryAccount), memoryClient, onProgress, profile, { start: 0.32, end: 0.7 }, getScenarioProtocol().getDeploymentSteps);
            await seedSecurityPoolX2AuctionScenario({
                accounts,
                createReadClient,
                createWriteClient,
                memoryClient,
                onProgress,
                profile,
            });
            return true;
        default:
            return false;
    }
}
//# sourceMappingURL=statoblastScenarios.js.map