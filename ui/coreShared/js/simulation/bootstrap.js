import { encodeAbiParameters, encodeDeployData, getCreateAddress, keccak256, toHex } from '@zoltar/shared/ethereum';
import { ReputationToken_ReputationToken, Zoltar_Zoltar, peripherals_WETH9_WETH9 } from '../contractArtifact.js';
import { MAINNET_WETH_ADDRESS, setRuntimeNetworkProfile } from '../lib/networkProfile.js';
import { initializeSimulationClock } from './clock.js';
const ETH_BALANCE_AMOUNT = 10n ** 30n;
const GENESIS_UNIVERSE_ID = 0n;
const REP_TOKEN_MINT_AMOUNT = 3000000n * 10n ** 18n;
const WETH_TOKEN_MINT_AMOUNT = 10000n * 10n ** 18n;
const WETH_NAME_SLOT = 0n;
const WETH_SYMBOL_SLOT = 1n;
const WETH_DECIMALS_SLOT = 2n;
const ZOLTAR_GENESIS_REPUTATION_TOKEN_OFFSET = 3n;
const ZOLTAR_UNIVERSE_THEORETICAL_SUPPLIES_SLOT = 2n;
const ZOLTAR_UNIVERSES_SLOT = 0n;
async function yieldToBrowser() {
    await new Promise(resolve => {
        setTimeout(resolve, 0);
    });
}
async function withTimeout(work, timeoutMilliseconds, message) {
    let timeoutId = undefined;
    try {
        return await Promise.race([
            work,
            new Promise((_, reject) => {
                timeoutId = setTimeout(() => {
                    reject(new Error(message));
                }, timeoutMilliseconds);
            }),
        ]);
    }
    finally {
        if (timeoutId !== undefined)
            clearTimeout(timeoutId);
    }
}
function clampProgress(value) {
    return Math.max(0, Math.min(1, value));
}
export async function reportBootstrapProgress(onProgress, label, value) {
    await onProgress?.({
        label,
        value: clampProgress(value),
    });
    await yieldToBrowser();
}
function storageIndex(slot) {
    return toHex(slot, { size: 32 });
}
function storageValue(value) {
    return toHex(value, { size: 32 });
}
function shortStringStorageValue(value) {
    const valueHex = toHex(value).slice(2);
    const byteLength = valueHex.length / 2;
    if (byteLength > 31)
        throw new Error('Simulation token metadata exceeds Solidity short-string storage');
    return storageValue(BigInt(`0x${valueHex.padEnd(62, '0')}${(byteLength * 2).toString(16).padStart(2, '0')}`));
}
function requireReceiptContractAddress(code, address, label) {
    if (code === undefined || code === '0x')
        throw new Error(`Failed to deploy ${label} at ${address}`);
}
async function deployContract(writeClient, address, label, data) {
    const hash = await writeClient.sendTransaction({ data });
    await writeClient.waitForTransactionReceipt({ hash });
    const code = await writeClient.getCode({ address });
    requireReceiptContractAddress(code, address, label);
}
function getZoltarUniverseBaseSlot(universeId) {
    return BigInt(keccak256(encodeAbiParameters([{ type: 'uint248' }, { type: 'uint256' }], [universeId, ZOLTAR_UNIVERSES_SLOT])));
}
function getZoltarUniverseTheoreticalSupplyAttoRepSlot(universeId) {
    return BigInt(keccak256(encodeAbiParameters([{ type: 'uint248' }, { type: 'uint256' }], [universeId, ZOLTAR_UNIVERSE_THEORETICAL_SUPPLIES_SLOT])));
}
async function seedAccountBalances(memoryClient, accounts, onProgress) {
    for (const [index, account] of accounts.entries()) {
        await memoryClient.impersonateAccount({ address: account });
        await memoryClient.setBalance({ address: account, value: ETH_BALANCE_AMOUNT });
        await reportBootstrapProgress(onProgress, `Funding QA account ${index + 1} of ${accounts.length}`, 0.05 + ((index + 1) / Math.max(accounts.length, 1)) * 0.08);
    }
}
async function withSimulationAuthorityAccount(memoryClient, accountAddress, work) {
    const originalBalance = await memoryClient.getBalance({ address: accountAddress });
    await memoryClient.impersonateAccount({ address: accountAddress });
    await memoryClient.setBalance({ address: accountAddress, value: ETH_BALANCE_AMOUNT });
    try {
        return await work();
    }
    finally {
        await memoryClient.setBalance({ address: accountAddress, value: originalBalance });
    }
}
async function seedGenesisRepTokenState({ accounts, createWriteClient, memoryClient, onProgress, repAddress, zoltarAddress, }) {
    const originalNonce = await memoryClient.getTransactionCount({ address: zoltarAddress });
    try {
        return await withSimulationAuthorityAccount(memoryClient, zoltarAddress, async () => {
            const zoltarWriteClient = createWriteClient(zoltarAddress);
            const totalSupply = BigInt(accounts.length) * REP_TOKEN_MINT_AMOUNT;
            const syncHash = await zoltarWriteClient.writeContract({
                address: repAddress,
                abi: ReputationToken_ReputationToken.abi,
                functionName: 'setMaxTheoreticalSupplyAttoRep',
                args: [totalSupply],
            });
            await zoltarWriteClient.waitForTransactionReceipt({ hash: syncHash });
            for (const [index, account] of accounts.entries()) {
                const hash = await zoltarWriteClient.writeContract({
                    address: repAddress,
                    abi: ReputationToken_ReputationToken.abi,
                    functionName: 'mint',
                    args: [account, REP_TOKEN_MINT_AMOUNT],
                });
                await zoltarWriteClient.waitForTransactionReceipt({ hash });
                await reportBootstrapProgress(onProgress, `Seeding REP balances ${index + 1} of ${accounts.length}`, 0.16 + ((index + 1) / Math.max(accounts.length, 1)) * 0.06);
            }
            await reportBootstrapProgress(onProgress, 'Finalizing REP token state', 0.23);
            return totalSupply;
        });
    }
    finally {
        await memoryClient.setNonce({ address: zoltarAddress, nonce: originalNonce });
    }
}
export async function updateZoltarGenesisRepToken({ createWriteClient, memoryClient, repAddress, zoltarAddress }) {
    const universeBaseSlot = getZoltarUniverseBaseSlot(GENESIS_UNIVERSE_ID);
    const readClient = createWriteClient(zoltarAddress);
    const genesisTheoreticalSupply = await readClient.readContract({
        address: repAddress,
        abi: ReputationToken_ReputationToken.abi,
        functionName: 'getTotalTheoreticalSupplyAttoRep',
        args: [],
    });
    await memoryClient.setStorageAt({
        address: zoltarAddress,
        index: storageIndex(universeBaseSlot + ZOLTAR_GENESIS_REPUTATION_TOKEN_OFFSET),
        value: storageValue(BigInt(repAddress)),
    });
    await memoryClient.setStorageAt({
        address: zoltarAddress,
        index: storageIndex(getZoltarUniverseTheoreticalSupplyAttoRepSlot(GENESIS_UNIVERSE_ID)),
        value: storageValue(genesisTheoreticalSupply),
    });
    const patchedRepToken = await readClient.readContract({
        address: zoltarAddress,
        abi: Zoltar_Zoltar.abi,
        functionName: 'getRepToken',
        args: [GENESIS_UNIVERSE_ID],
    });
    if (patchedRepToken.toLowerCase() !== repAddress.toLowerCase()) {
        throw new Error(`Failed to patch simulation Zoltar genesis REP token. Expected ${repAddress}, received ${patchedRepToken}.`);
    }
    const patchedTheoreticalSupply = await readClient.readContract({
        address: zoltarAddress,
        abi: Zoltar_Zoltar.abi,
        functionName: 'getUniverseTheoreticalSupplyAttoRep',
        args: [GENESIS_UNIVERSE_ID],
    });
    if (patchedTheoreticalSupply !== genesisTheoreticalSupply) {
        throw new Error(`Failed to patch simulation Zoltar theoretical supply. Expected ${genesisTheoreticalSupply.toString()}, received ${patchedTheoreticalSupply.toString()}.`);
    }
}
export async function mintSimulationGenesisRep({ accountAddress, amount, createWriteClient, memoryClient, repAddress, zoltarAddress }) {
    if (amount <= 0n) {
        throw new Error('Simulation REP mint amount must be greater than zero');
    }
    const originalNonce = await memoryClient.getTransactionCount({ address: zoltarAddress });
    try {
        await withSimulationAuthorityAccount(memoryClient, zoltarAddress, async () => {
            const zoltarWriteClient = createWriteClient(zoltarAddress);
            const totalSupply = await zoltarWriteClient.readContract({
                address: repAddress,
                abi: ReputationToken_ReputationToken.abi,
                functionName: 'totalSupply',
                args: [],
            });
            const syncHash = await zoltarWriteClient.writeContract({
                address: repAddress,
                abi: ReputationToken_ReputationToken.abi,
                functionName: 'setMaxTheoreticalSupplyAttoRep',
                args: [totalSupply + amount],
            });
            await zoltarWriteClient.waitForTransactionReceipt({ hash: syncHash });
            const mintHash = await zoltarWriteClient.writeContract({
                address: repAddress,
                abi: ReputationToken_ReputationToken.abi,
                functionName: 'mint',
                args: [accountAddress, amount],
            });
            await zoltarWriteClient.waitForTransactionReceipt({ hash: mintHash });
            const zoltarCode = await memoryClient.getCode({
                address: zoltarAddress,
            });
            if (zoltarCode === undefined || zoltarCode === '0x') {
                return;
            }
            await updateZoltarGenesisRepToken({
                createWriteClient,
                memoryClient,
                repAddress,
                zoltarAddress,
            });
        });
    }
    finally {
        await memoryClient.setNonce({ address: zoltarAddress, nonce: originalNonce });
    }
}
async function deploySimulationTokens({ accounts, createWriteClient, memoryClient, onProgress, primaryAccount, profile, zoltarAddress, }) {
    const writeClient = createWriteClient(primaryAccount);
    const repDeploymentData = encodeDeployData({
        abi: ReputationToken_ReputationToken.abi,
        args: [zoltarAddress],
        bytecode: `0x${ReputationToken_ReputationToken.evm.bytecode.object}`,
    });
    await deployContract(writeClient, profile.genesisRepTokenAddress, 'simulation REP token', repDeploymentData);
    await reportBootstrapProgress(onProgress, 'Deploying simulation REP token', 0.18);
    await memoryClient.setCode({
        address: profile.wethAddress,
        bytecode: `0x${peripherals_WETH9_WETH9.evm.deployedBytecode.object}`,
    });
    await memoryClient.setStorageAt({ address: profile.wethAddress, index: storageIndex(WETH_NAME_SLOT), value: shortStringStorageValue('Wrapped Ether') });
    await memoryClient.setStorageAt({ address: profile.wethAddress, index: storageIndex(WETH_SYMBOL_SLOT), value: shortStringStorageValue('WETH') });
    await memoryClient.setStorageAt({ address: profile.wethAddress, index: storageIndex(WETH_DECIMALS_SLOT), value: storageValue(18n) });
    await reportBootstrapProgress(onProgress, 'Installing simulation WETH token', 0.2);
    await seedGenesisRepTokenState({
        accounts,
        createWriteClient,
        memoryClient,
        onProgress,
        repAddress: profile.genesisRepTokenAddress,
        zoltarAddress,
    });
}
export function predictSimulationTokenAddresses(accountAddress) {
    return {
        genesisRepTokenAddress: getCreateAddress({ from: accountAddress, nonce: 0n }),
        wethAddress: MAINNET_WETH_ADDRESS,
    };
}
async function seedWrappedEthBalances(createWriteClient, accounts, wethAddress, onProgress) {
    for (const [index, account] of accounts.entries()) {
        const writeClient = createWriteClient(account);
        const hash = await writeClient.sendTransaction({
            to: wethAddress,
            value: WETH_TOKEN_MINT_AMOUNT,
        });
        await writeClient.waitForTransactionReceipt({ hash });
        await reportBootstrapProgress(onProgress, `Wrapping ETH for QA account ${index + 1} of ${accounts.length}`, 0.24 + ((index + 1) / Math.max(accounts.length, 1)) * 0.06);
    }
}
export async function deploySimulationAppContracts(primaryWriteClient, memoryClient, onProgress, profile, range = { start: 0.32, end: 0.8 }, getDeploymentSteps) {
    const steps = getDeploymentSteps(profile);
    for (const [index, step] of steps.entries()) {
        const code = await memoryClient.getCode({ address: step.address });
        if (code !== undefined && code !== '0x') {
            await reportBootstrapProgress(onProgress, `Checking ${step.label}`, range.start + ((index + 1) / Math.max(steps.length, 1)) * (range.end - range.start));
            continue;
        }
        await step.deploy(primaryWriteClient);
        await reportBootstrapProgress(onProgress, `Deploying ${step.label}`, range.start + ((index + 1) / Math.max(steps.length, 1)) * (range.end - range.start));
    }
}
export function createRangeProgressReporter(onProgress, range, stepCount) {
    let completedStepCount = 0;
    return async (label) => {
        completedStepCount += 1;
        await reportBootstrapProgress(onProgress, label, range.start + (completedStepCount / Math.max(stepCount, 1)) * (range.end - range.start));
    };
}
export function requireQaAccount(account, label) {
    if (account === undefined)
        throw new Error(label);
    return account;
}
async function applyCoreScenario({ accounts, createWriteClient, getDeploymentSteps, memoryClient, onProgress, profile, scenario }) {
    const primaryAccount = requireQaAccount(accounts[0], 'Expected seeded simulation QA account A1');
    switch (scenario) {
        case 'baseline':
            await reportBootstrapProgress(onProgress, 'Using baseline simulation scenario', 0.84);
            return true;
        case 'deployed':
            await deploySimulationAppContracts(createWriteClient(primaryAccount), memoryClient, onProgress, profile, { start: 0.32, end: 0.92 }, getDeploymentSteps);
            return true;
        default:
            return false;
    }
}
export async function bootstrapSimulationChain({ accounts, applyScenario, createReadClient, createWriteClient, getDeploymentSteps, memoryClient, onProgress, primaryAccount, profile, scenario, }) {
    setRuntimeNetworkProfile(profile);
    await reportBootstrapProgress(onProgress, 'Initializing simulation engine', 0.01);
    await withTimeout(memoryClient.tevmReady(), 20_000, 'Simulation engine initialization timed out. Firefox may be struggling with main-thread simulation startup.');
    await reportBootstrapProgress(onProgress, 'Preparing simulation chain', 0.03);
    await initializeSimulationClock(memoryClient);
    await seedAccountBalances(memoryClient, accounts, onProgress);
    const zoltarStep = getDeploymentSteps(profile).find(step => step.id === 'zoltar');
    if (zoltarStep === undefined)
        throw new Error('Missing Zoltar deployment step for simulation bootstrap');
    await deploySimulationTokens({
        accounts,
        createWriteClient,
        memoryClient,
        onProgress,
        primaryAccount,
        profile,
        zoltarAddress: zoltarStep.address,
    });
    await seedWrappedEthBalances(createWriteClient, accounts, profile.wethAddress, onProgress);
    const extendedApplied = applyScenario === undefined
        ? false
        : await applyScenario({
            accounts,
            createReadClient,
            createWriteClient,
            memoryClient,
            onProgress,
            profile,
            scenario,
        });
    const scenarioApplied = extendedApplied ||
        (await applyCoreScenario({
            accounts,
            createWriteClient,
            getDeploymentSteps,
            memoryClient,
            onProgress,
            profile,
            scenario,
        }));
    if (!scenarioApplied)
        throw new Error(`Unknown simulation scenario: ${scenario}`);
    await reportBootstrapProgress(onProgress, 'Saving simulation snapshot', 0.99);
    await reportBootstrapProgress(onProgress, 'Simulation scenario ready', 1);
}
//# sourceMappingURL=bootstrap.js.map