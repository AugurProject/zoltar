import { createMemoryClient, type DumpStateResult } from 'tevm'
import { encodeAbiParameters, encodeDeployData, getCreateAddress, keccak256, toHex, type Address, type Hex } from 'viem'
import {
	approveErc20,
	createMarket,
	createSecurityPool,
	depositRepToSecurityPool,
	getDeploymentSteps,
	loadAllSecurityPools,
	loadErc20Balance,
	loadOracleManagerDetails,
	loadOpenOracleReportDetails,
	loadSecurityVaultDetails,
	queueOracleManagerOperation,
	settleOracleReport,
	submitInitialOracleReport,
} from '../contracts.js'
import { ReputationToken_ReputationToken, peripherals_WETH9_WETH9 } from '../contractArtifact.js'
import type { ReadClient, WriteClient } from '../lib/chainBackend.js'
import { MAINNET_WETH_ADDRESS, type NetworkProfile } from '../lib/networkProfile.js'
import type { QuestionData } from '../types/contracts.js'
import type { SimulationScenario } from './scenarios.js'

type TevmLikeClient = ReturnType<typeof createMemoryClient>
type BootstrapProgressHandler = (progress: { label: string; value: number }) => Promise<void> | void

const DAY_IN_SECONDS = 24n * 60n * 60n
const ETH_BALANCE_AMOUNT = 10n ** 30n
const ERC20_TOTAL_SUPPLY_SLOT = 2n
const GENESIS_UNIVERSE_ID = 0n
const MAX_RETENTION_RATE = 999_999_996_848_000_000n
const SEEDED_REP_ETH_PRICE = 3n * 10n ** 18n
const REP_TOTAL_THEORETICAL_SUPPLY_SLOT = 5n
const REP_TOKEN_MINT_AMOUNT = 100_000_000n * 10n ** 18n
const SECURITY_MULTIPLIER = 2n
const SECURITY_POOL_REP_DEPOSIT = 10_000n * 10n ** 18n
const SECURITY_BOND_ALLOWANCE = SECURITY_POOL_REP_DEPOSIT / 4n
const WETH_TOKEN_MINT_AMOUNT = 10_000n * 10n ** 18n
const ZOLTAR_GENESIS_REPUTATION_TOKEN_OFFSET = 3n
const ZOLTAR_UNIVERSE_THEORETICAL_SUPPLIES_SLOT = 2n
const ZOLTAR_UNIVERSES_SLOT = 0n

async function yieldToBrowser() {
	await new Promise<void>(resolve => {
		setTimeout(resolve, 0)
	})
}

async function withTimeout<TResult>(work: Promise<TResult>, timeoutMilliseconds: number, message: string) {
	let timeoutId: ReturnType<typeof setTimeout> | undefined = undefined
	try {
		return await Promise.race([
			work,
			new Promise<TResult>((_, reject) => {
				timeoutId = setTimeout(() => {
					reject(new Error(message))
				}, timeoutMilliseconds)
			}),
		])
	} finally {
		if (timeoutId !== undefined) {
			clearTimeout(timeoutId)
		}
	}
}

function clampProgress(value: number) {
	return Math.max(0, Math.min(1, value))
}

async function reportBootstrapProgress(onProgress: BootstrapProgressHandler | undefined, label: string, value: number) {
	await onProgress?.({
		label,
		value: clampProgress(value),
	})
	await yieldToBrowser()
}

function storageIndex(slot: bigint) {
	return toHex(slot, { size: 32 })
}

function storageValue(value: bigint) {
	return toHex(value, { size: 32 })
}

function requireReceiptContractAddress(code: Hex | undefined, address: Address, label: string) {
	if (code === undefined || code === '0x') {
		throw new Error(`Failed to deploy ${label} at ${address}`)
	}
}

async function deployContract(writeClient: WriteClient, address: Address, label: string, data: Hex) {
	const hash = await writeClient.sendTransaction({ data })
	await writeClient.waitForTransactionReceipt({ hash })
	const code = await writeClient.getCode({ address })
	requireReceiptContractAddress(code, address, label)
}

function getErc20BalanceSlot(accountAddress: Address) {
	return keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [accountAddress, 0n]))
}

function getZoltarUniverseBaseSlot(universeId: bigint) {
	return BigInt(keccak256(encodeAbiParameters([{ type: 'uint248' }, { type: 'uint256' }], [universeId, ZOLTAR_UNIVERSES_SLOT])))
}

function getZoltarUniverseTheoreticalSupplySlot(universeId: bigint) {
	return BigInt(keccak256(encodeAbiParameters([{ type: 'uint248' }, { type: 'uint256' }], [universeId, ZOLTAR_UNIVERSE_THEORETICAL_SUPPLIES_SLOT])))
}

async function seedAccountBalances(memoryClient: TevmLikeClient, accounts: readonly Address[], onProgress?: BootstrapProgressHandler) {
	for (const [index, account] of accounts.entries()) {
		await memoryClient.impersonateAccount({ address: account })
		await memoryClient.setBalance({ address: account, value: ETH_BALANCE_AMOUNT })
		await reportBootstrapProgress(onProgress, `Funding QA account ${index + 1} of ${accounts.length}`, 0.05 + ((index + 1) / Math.max(accounts.length, 1)) * 0.08)
	}
}

async function seedGenesisRepTokenState(memoryClient: TevmLikeClient, repAddress: Address, accounts: readonly Address[], onProgress?: BootstrapProgressHandler) {
	let totalSupply = 0n
	for (const [index, account] of accounts.entries()) {
		totalSupply += REP_TOKEN_MINT_AMOUNT
		await memoryClient.setStorageAt({
			address: repAddress,
			index: getErc20BalanceSlot(account),
			value: storageValue(REP_TOKEN_MINT_AMOUNT),
		})
		await reportBootstrapProgress(onProgress, `Seeding REP balances ${index + 1} of ${accounts.length}`, 0.16 + ((index + 1) / Math.max(accounts.length, 1)) * 0.06)
	}

	await memoryClient.setStorageAt({
		address: repAddress,
		index: storageIndex(ERC20_TOTAL_SUPPLY_SLOT),
		value: storageValue(totalSupply),
	})
	await memoryClient.setStorageAt({
		address: repAddress,
		index: storageIndex(REP_TOTAL_THEORETICAL_SUPPLY_SLOT),
		value: storageValue(totalSupply),
	})
	await reportBootstrapProgress(onProgress, 'Finalizing REP token state', 0.23)
}

async function getSimulationChainTimestamp(memoryClient: TevmLikeClient) {
	const block = await memoryClient.getBlock()
	if (block.timestamp === undefined) {
		throw new Error('Simulation block timestamp was unavailable')
	}
	return block.timestamp
}

async function mineSimulationBlockAtTimestamp(memoryClient: TevmLikeClient, timestamp: bigint) {
	const vm = await memoryClient.transport.tevm.getVm()
	const parentBlock = await vm.blockchain.getCanonicalHeadBlock()
	const builder = await vm.buildBlock({
		headerData: {
			timestamp,
		},
		parentBlock,
	})
	await builder.build()
}

async function advanceSimulationTime(memoryClient: TevmLikeClient, seconds: bigint) {
	const currentTimestamp = await getSimulationChainTimestamp(memoryClient)
	await mineSimulationBlockAtTimestamp(memoryClient, currentTimestamp + seconds)
}

export async function updateZoltarGenesisRepToken(memoryClient: TevmLikeClient, zoltarAddress: Address, repAddress: Address) {
	const universeBaseSlot = getZoltarUniverseBaseSlot(GENESIS_UNIVERSE_ID)
	const genesisTheoreticalSupplyHex = await memoryClient.getStorageAt({
		address: repAddress,
		slot: storageIndex(REP_TOTAL_THEORETICAL_SUPPLY_SLOT),
	})
	const genesisTheoreticalSupply = genesisTheoreticalSupplyHex === undefined ? 0n : BigInt(genesisTheoreticalSupplyHex)

	await memoryClient.setStorageAt({
		address: zoltarAddress,
		index: storageIndex(universeBaseSlot + ZOLTAR_GENESIS_REPUTATION_TOKEN_OFFSET),
		value: storageValue(BigInt(repAddress)),
	})
	await memoryClient.setStorageAt({
		address: zoltarAddress,
		index: storageIndex(getZoltarUniverseTheoreticalSupplySlot(GENESIS_UNIVERSE_ID)),
		value: storageValue(genesisTheoreticalSupply),
	})
}

async function deploySimulationTokens({
	accounts,
	createWriteClient,
	memoryClient,
	onProgress,
	primaryAccount,
	profile,
	zoltarAddress,
}: {
	accounts: readonly Address[]
	createWriteClient: (accountAddress: Address) => WriteClient
	memoryClient: TevmLikeClient
	onProgress: BootstrapProgressHandler | undefined
	primaryAccount: Address
	profile: NetworkProfile
	zoltarAddress: Address
}) {
	const writeClient = createWriteClient(primaryAccount)
	const repDeploymentData = encodeDeployData({
		abi: ReputationToken_ReputationToken.abi,
		args: [zoltarAddress],
		bytecode: `0x${ReputationToken_ReputationToken.evm.bytecode.object}`,
	})

	await deployContract(writeClient, profile.genesisRepTokenAddress, 'simulation REP token', repDeploymentData)
	await reportBootstrapProgress(onProgress, 'Deploying simulation REP token', 0.18)
	await memoryClient.setCode({
		address: profile.wethAddress,
		bytecode: `0x${peripherals_WETH9_WETH9.evm.deployedBytecode.object}`,
	})
	await reportBootstrapProgress(onProgress, 'Installing simulation WETH token', 0.2)
	await seedGenesisRepTokenState(memoryClient, profile.genesisRepTokenAddress, accounts, onProgress)
}

export function predictSimulationTokenAddresses(accountAddress: Address): { genesisRepTokenAddress: Address; wethAddress: Address } {
	return {
		genesisRepTokenAddress: getCreateAddress({ from: accountAddress, nonce: 0n }),
		wethAddress: MAINNET_WETH_ADDRESS,
	}
}

async function seedWrappedEthBalances(createWriteClient: (accountAddress: Address) => WriteClient, accounts: readonly Address[], wethAddress: Address, onProgress: BootstrapProgressHandler | undefined) {
	for (const [index, account] of accounts.entries()) {
		const writeClient = createWriteClient(account)
		const hash = await writeClient.sendTransaction({
			to: wethAddress,
			value: WETH_TOKEN_MINT_AMOUNT,
		})
		await writeClient.waitForTransactionReceipt({ hash })
		await reportBootstrapProgress(onProgress, `Wrapping ETH for QA account ${index + 1} of ${accounts.length}`, 0.24 + ((index + 1) / Math.max(accounts.length, 1)) * 0.06)
	}
}

async function deploySimulationAppContracts(primaryWriteClient: WriteClient, memoryClient: TevmLikeClient, onProgress: BootstrapProgressHandler | undefined, range: { start: number; end: number } = { start: 0.32, end: 0.8 }) {
	const steps = getDeploymentSteps()
	for (const [index, step] of steps.entries()) {
		const code = await memoryClient.getCode({ address: step.address })
		if (code !== undefined && code !== '0x') {
			await reportBootstrapProgress(onProgress, `Checking ${step.label}`, range.start + ((index + 1) / Math.max(steps.length, 1)) * (range.end - range.start))
			continue
		}
		await step.deploy(primaryWriteClient)
		await reportBootstrapProgress(onProgress, `Deploying ${step.label}`, range.start + ((index + 1) / Math.max(steps.length, 1)) * (range.end - range.start))
	}
}

function createSecurityPoolSeedParameters(currentTimestamp: bigint): {
	marketType: 'binary'
	outcomeLabels: string[]
	questionData: QuestionData
} {
	return {
		marketType: 'binary',
		outcomeLabels: ['Yes', 'No'],
		questionData: {
			answerUnit: '',
			description: 'Seeded simulation security pool',
			displayValueMax: 0n,
			displayValueMin: 0n,
			endTime: currentTimestamp + 365n * DAY_IN_SECONDS,
			numTicks: 0n,
			startTime: 0n,
			title: 'Simulation security pool',
		},
	}
}

async function ensureSufficientWethBalance(readClient: ReadClient, writeClient: WriteClient, profile: NetworkProfile, accountAddress: Address, requiredAmount: bigint, onProgress: BootstrapProgressHandler | undefined) {
	const currentBalance = await loadErc20Balance(readClient, profile.wethAddress, accountAddress)
	if (currentBalance >= requiredAmount) return
	const missingBalance = requiredAmount - currentBalance
	const hash = await writeClient.sendTransaction({
		to: profile.wethAddress,
		value: missingBalance,
	})
	await writeClient.waitForTransactionReceipt({ hash })
	await reportBootstrapProgress(onProgress, 'Wrapping additional WETH for seeded oracle report', 0.9)
}

async function seedSecurityPoolScenario({
	createReadClient,
	createWriteClient,
	memoryClient,
	onProgress,
	primaryAccount,
	profile,
}: {
	createReadClient: () => ReadClient
	createWriteClient: (accountAddress: Address) => WriteClient
	memoryClient: TevmLikeClient
	onProgress: BootstrapProgressHandler | undefined
	primaryAccount: Address
	profile: NetworkProfile
}) {
	const primaryWriteClient = createWriteClient(primaryAccount)
	const readClient = createReadClient()
	const currentTimestamp = await getSimulationChainTimestamp(memoryClient)
	const marketParameters = createSecurityPoolSeedParameters(currentTimestamp)
	const marketResult = await createMarket(primaryWriteClient, marketParameters)
	await reportBootstrapProgress(onProgress, 'Creating seeded market', 0.82)
	const questionId = BigInt(marketResult.questionId)
	await createSecurityPool(primaryWriteClient, {
		currentRetentionRate: MAX_RETENTION_RATE,
		questionId,
		securityMultiplier: SECURITY_MULTIPLIER,
	})
	await reportBootstrapProgress(onProgress, 'Deploying seeded security pool', 0.85)
	const seededPool = (await loadAllSecurityPools(readClient))[0]
	if (seededPool === undefined) {
		throw new Error('Expected a seeded security pool after deployment')
	}

	await approveErc20(primaryWriteClient, profile.genesisRepTokenAddress, seededPool.securityPoolAddress, SECURITY_POOL_REP_DEPOSIT, 'approveRep')
	await depositRepToSecurityPool(primaryWriteClient, seededPool.securityPoolAddress, SECURITY_POOL_REP_DEPOSIT)
	await reportBootstrapProgress(onProgress, 'Funding seeded security vault', 0.88)

	const vaultDetails = await loadSecurityVaultDetails(readClient, seededPool.securityPoolAddress, primaryAccount)
	if (vaultDetails === undefined) {
		throw new Error('Expected seeded security vault details')
	}

	await queueOracleManagerOperation(primaryWriteClient, vaultDetails.managerAddress, 'setSecurityBondsAllowance', primaryAccount, SECURITY_BOND_ALLOWANCE)
	const oracleManagerDetails = await loadOracleManagerDetails(readClient, vaultDetails.managerAddress)
	await reportBootstrapProgress(onProgress, 'Configuring oracle manager', 0.9)

	if (oracleManagerDetails.pendingReportId === 0n || oracleManagerDetails.callbackStateHash === undefined || oracleManagerDetails.exactToken1Report === undefined || oracleManagerDetails.token1 === undefined || oracleManagerDetails.token2 === undefined) {
		throw new Error('Expected a pending oracle report for the seeded security pool scenario')
	}

	const amount1 = oracleManagerDetails.exactToken1Report
	const amount2 = (amount1 * 10n ** 18n) / SEEDED_REP_ETH_PRICE
	await approveErc20(primaryWriteClient, oracleManagerDetails.token1, oracleManagerDetails.openOracleAddress, amount1, 'approveToken1')
	await ensureSufficientWethBalance(readClient, primaryWriteClient, profile, primaryAccount, amount2, onProgress)
	await approveErc20(primaryWriteClient, oracleManagerDetails.token2, oracleManagerDetails.openOracleAddress, amount2, 'approveToken2')
	await submitInitialOracleReport(primaryWriteClient, oracleManagerDetails.openOracleAddress, oracleManagerDetails.pendingReportId, amount1, amount2, oracleManagerDetails.callbackStateHash)
	await reportBootstrapProgress(onProgress, 'Submitting seeded oracle report', 0.93)
	await advanceSimulationTime(memoryClient, DAY_IN_SECONDS)
	await settleOracleReport(primaryWriteClient, oracleManagerDetails.openOracleAddress, oracleManagerDetails.pendingReportId)
	await reportBootstrapProgress(onProgress, 'Settling seeded oracle report', 0.96)

	const seededReport = await loadOpenOracleReportDetails(readClient, oracleManagerDetails.openOracleAddress, oracleManagerDetails.pendingReportId)
	if (!seededReport.isDistributed) {
		throw new Error('Expected the seeded oracle report to be settled')
	}
	await reportBootstrapProgress(onProgress, 'Seeded security-pool scenario is ready', 0.98)
}

async function applyScenario({
	createReadClient,
	createWriteClient,
	memoryClient,
	onProgress,
	primaryAccount,
	profile,
	scenario,
}: {
	createReadClient: () => ReadClient
	createWriteClient: (accountAddress: Address) => WriteClient
	memoryClient: TevmLikeClient
	onProgress: BootstrapProgressHandler | undefined
	primaryAccount: Address
	profile: NetworkProfile
	scenario: SimulationScenario
}) {
	switch (scenario) {
		case 'baseline':
			await reportBootstrapProgress(onProgress, 'Using baseline simulation scenario', 0.84)
			return
		case 'deployed':
			await deploySimulationAppContracts(createWriteClient(primaryAccount), memoryClient, onProgress, { start: 0.32, end: 0.92 })
			return
		case 'security-pool':
			await deploySimulationAppContracts(createWriteClient(primaryAccount), memoryClient, onProgress, { start: 0.32, end: 0.78 })
			await seedSecurityPoolScenario({
				createReadClient,
				createWriteClient,
				memoryClient,
				onProgress,
				primaryAccount,
				profile,
			})
			return
	}
}

export async function bootstrapSimulationChain({
	accounts,
	createReadClient,
	createWriteClient,
	memoryClient,
	onBaselineState,
	onProgress,
	primaryAccount,
	profile,
	scenario,
}: {
	accounts: readonly Address[]
	createReadClient: () => ReadClient
	createWriteClient: (accountAddress: Address) => WriteClient
	memoryClient: TevmLikeClient
	onBaselineState: (state: DumpStateResult) => void
	onProgress: BootstrapProgressHandler | undefined
	primaryAccount: Address
	profile: NetworkProfile
	scenario: SimulationScenario
}) {
	await reportBootstrapProgress(onProgress, 'Initializing simulation engine', 0.01)
	await withTimeout(memoryClient.tevmReady(), 20_000, 'Simulation engine initialization timed out. Firefox may be struggling with main-thread simulation startup.')
	await reportBootstrapProgress(onProgress, 'Preparing simulation chain', 0.03)
	await seedAccountBalances(memoryClient, accounts, onProgress)
	const zoltarStep = getDeploymentSteps().find(step => step.id === 'zoltar')
	if (zoltarStep === undefined) {
		throw new Error('Missing Zoltar deployment step for simulation bootstrap')
	}

	await deploySimulationTokens({
		accounts,
		createWriteClient,
		memoryClient,
		onProgress,
		primaryAccount,
		profile,
		zoltarAddress: zoltarStep.address,
	})
	await seedWrappedEthBalances(createWriteClient, accounts, profile.wethAddress, onProgress)
	await applyScenario({
		createReadClient,
		createWriteClient,
		memoryClient,
		onProgress,
		primaryAccount,
		profile,
		scenario,
	})
	await reportBootstrapProgress(onProgress, 'Saving simulation snapshot', 0.99)
	onBaselineState(await memoryClient.tevmDumpState())
	await reportBootstrapProgress(onProgress, 'Simulation scenario ready', 1)
}
