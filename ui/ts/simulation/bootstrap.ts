import { createMemoryClient } from 'tevm'
import { REPUTATION_TOKEN_THEORETICAL_SUPPLY_SLOT } from '@zoltar/shared/constants'
import { encodeAbiParameters, encodeDeployData, getCreateAddress, keccak256, toHex, zeroAddress, type Address, type Hex } from '@zoltar/shared/ethereum'
import {
	approveErc20,
	createMarket,
	createChildUniverseFromSecurityPool,
	createCompleteSetInSecurityPool,
	createSecurityPool,
	depositRepToSecurityPool,
	executeOracleManagerStagedOperation,
	forkZoltarWithOwnEscalation,
	getDeploymentSteps,
	loadAllSecurityPools,
	loadForkAuctionDetails,
	loadOracleManagerDetails,
	loadOpenOracleReportDetails,
	loadReportingDetails,
	loadSecurityVaultDetails,
	loadZoltarUniverseSummary,
	migrateRepToZoltarFromSecurityPool,
	queueOracleManagerOperation,
	reportOutcomeInSecurityPool,
	requestOraclePrice,
	settleOracleReport,
	startTruthAuctionForSecurityPool,
	submitTruthAuctionBid,
} from '../protocol/index.js'
import { ReputationToken_ReputationToken, Zoltar_Zoltar, peripherals_WETH9_WETH9 } from '../contractArtifact.js'
import { assertNever } from '../lib/assert.js'
import { getTruthAuctionPriceAtTick, getTruthAuctionTickAtPrice } from '../protocol/truthAuctionMath.js'
import type { ReadClient, WriteClient } from '../lib/chainBackend.js'
import { MAINNET_NETWORK_PROFILE, MAINNET_WETH_ADDRESS, type NetworkProfile } from '../lib/networkProfile.js'
import type { ListedSecurityPool, QuestionData } from '../types/contracts.js'
import { advanceSimulationTime, getSimulationChainTimestamp, initializeSimulationClock } from './clock.js'
import type { SimulationScenario } from './scenarios.js'

type TevmLikeClient = ReturnType<typeof createMemoryClient>
const COORDINATOR_PRICE_PRECISION = 10n ** 18n

async function readCoordinatorExactToken1Report(readClient: ReadClient, managerAddress: Address) {
	if ('readContract' in readClient && typeof readClient.readContract === 'function') {
		const exactToken1Report = await readClient.readContract({
			address: managerAddress,
			abi: [
				{
					type: 'function',
					name: 'exactToken1Report',
					stateMutability: 'view',
					inputs: [],
					outputs: [{ name: '', type: 'uint256' }],
				},
			] as const,
			functionName: 'exactToken1Report',
			args: [],
		})
		if (typeof exactToken1Report === 'bigint') return exactToken1Report
	}

	const managerDetails = await loadOracleManagerDetails(readClient, managerAddress)
	if (managerDetails.exactToken1Report === undefined) throw new Error('Missing coordinator exactToken1Report for seeded simulation bootstrap')
	return managerDetails.exactToken1Report
}

async function getSeededCoordinatorInitialReportAmount2(readClient: ReadClient, managerAddress: Address) {
	const exactToken1Report = await readCoordinatorExactToken1Report(readClient, managerAddress)
	const amount2 = (exactToken1Report * COORDINATOR_PRICE_PRECISION) / SEEDED_REP_ETH_PRICE
	return amount2 > 0n ? amount2 : 1n
}
type BootstrapProgressHandler = (progress: { label: string; value: number }) => Promise<void> | void

const DAY_IN_SECONDS = 24n * 60n * 60n
const FORK_MIGRATION_TIME_SECONDS = 8n * 7n * DAY_IN_SECONDS
const ETH_BALANCE_AMOUNT = 10n ** 30n
const GENESIS_UNIVERSE_ID = 0n
const SEEDED_REP_ETH_PRICE = 3n * 10n ** 18n
const REP_TOKEN_MINT_AMOUNT = 100_000_000n * 10n ** 18n
const SECURITY_MULTIPLIER = 2n
const SECURITY_POOL_REP_DEPOSIT = 10_000n * 10n ** 18n
const SECURITY_BOND_ALLOWANCE = 80n * 10n ** 18n
const SECURITY_POOL_X2_PRIMARY_REP_DEPOSIT = 12_000n * 10n ** 18n
const SECURITY_POOL_X2_PRIMARY_SECURITY_BOND_ALLOWANCE = 40n * 10n ** 18n
const SECURITY_POOL_X2_SECONDARY_REP_DEPOSIT = SECURITY_POOL_REP_DEPOSIT
const SECURITY_POOL_X2_SECONDARY_SECURITY_BOND_ALLOWANCE = 40n * 10n ** 18n
const STAGED_SELF_OPERATION_TIMEOUT_SECONDS = 5n * 60n
const SECURITY_POOL_X2_AUCTION_EXTRA_REP_DEPOSIT = 20_000_000n * 10n ** 18n
const SECURITY_POOL_X2_AUCTION_UNMIGRATED_REP_DEPOSIT = 1_000n * 10n ** 18n
const SECURITY_POOL_X2_AUCTION_BID_PRICES = [getTruthAuctionPriceAtTick(12n), getTruthAuctionPriceAtTick(10n), getTruthAuctionPriceAtTick(8n)] as const
const SECURITY_POOL_X2_AUCTION_BID_AMOUNTS = [3n * 10n ** 18n, 4n * 10n ** 18n, 5n * 10n ** 18n, 6n * 10n ** 18n, 3n * 10n ** 18n, 4n * 10n ** 18n, 5n * 10n ** 18n, 3n * 10n ** 18n, 4n * 10n ** 18n, 5n * 10n ** 18n] as const
const WETH_TOKEN_MINT_AMOUNT = 10_000n * 10n ** 18n
const WETH_NAME_SLOT = 0n
const WETH_SYMBOL_SLOT = 1n
const WETH_DECIMALS_SLOT = 2n
const ZOLTAR_CONSTRUCTOR_GENESIS_REP_TOKEN_ADDRESS = MAINNET_NETWORK_PROFILE.genesisRepTokenAddress
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
		if (timeoutId !== undefined) clearTimeout(timeoutId)
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

function shortStringStorageValue(value: string) {
	const valueHex = toHex(value).slice(2)
	const byteLength = valueHex.length / 2
	if (byteLength > 31) throw new Error('Simulation token metadata exceeds Solidity short-string storage')
	return storageValue(BigInt(`0x${valueHex.padEnd(62, '0')}${(byteLength * 2).toString(16).padStart(2, '0')}`))
}

function requireReceiptContractAddress(code: Hex | undefined, address: Address, label: string) {
	if (code === undefined || code === '0x') throw new Error(`Failed to deploy ${label} at ${address}`)
}

async function deployContract(writeClient: WriteClient, address: Address, label: string, data: Hex) {
	const hash = await writeClient.sendTransaction({ data })
	await writeClient.waitForTransactionReceipt({ hash })
	const code = await writeClient.getCode({ address })
	requireReceiptContractAddress(code, address, label)
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

async function withSimulationAuthorityAccount<TResult>(memoryClient: TevmLikeClient, accountAddress: Address, work: () => Promise<TResult>) {
	const originalBalance = await memoryClient.getBalance({ address: accountAddress })
	await memoryClient.impersonateAccount({ address: accountAddress })
	await memoryClient.setBalance({ address: accountAddress, value: ETH_BALANCE_AMOUNT })
	try {
		return await work()
	} finally {
		await memoryClient.setBalance({ address: accountAddress, value: originalBalance })
	}
}

async function seedGenesisRepTokenState({
	accounts,
	createWriteClient,
	memoryClient,
	onProgress,
	repAddress,
	zoltarAddress,
}: {
	accounts: readonly Address[]
	createWriteClient: (accountAddress: Address) => WriteClient
	memoryClient: TevmLikeClient
	onProgress: BootstrapProgressHandler | undefined
	repAddress: Address
	zoltarAddress: Address
}) {
	const originalNonce = await memoryClient.getTransactionCount({ address: zoltarAddress })
	try {
		return await withSimulationAuthorityAccount(memoryClient, zoltarAddress, async () => {
			const zoltarWriteClient = createWriteClient(zoltarAddress)
			const totalSupply = BigInt(accounts.length) * REP_TOKEN_MINT_AMOUNT
			const syncHash = await zoltarWriteClient.writeContract({
				address: repAddress,
				abi: ReputationToken_ReputationToken.abi,
				functionName: 'setMaxTheoreticalSupply',
				args: [totalSupply],
			})
			await zoltarWriteClient.waitForTransactionReceipt({ hash: syncHash })
			for (const [index, account] of accounts.entries()) {
				const hash = await zoltarWriteClient.writeContract({
					address: repAddress,
					abi: ReputationToken_ReputationToken.abi,
					functionName: 'mint',
					args: [account, REP_TOKEN_MINT_AMOUNT],
				})
				await zoltarWriteClient.waitForTransactionReceipt({ hash })
				await reportBootstrapProgress(onProgress, `Seeding REP balances ${index + 1} of ${accounts.length}`, 0.16 + ((index + 1) / Math.max(accounts.length, 1)) * 0.06)
			}
			await reportBootstrapProgress(onProgress, 'Finalizing REP token state', 0.23)
			return totalSupply
		})
	} finally {
		await memoryClient.setNonce({ address: zoltarAddress, nonce: originalNonce })
	}
}

async function seedZoltarConstructorGenesisRepToken({ memoryClient, profileGenesisRepTokenAddress, theoreticalSupply }: { memoryClient: TevmLikeClient; profileGenesisRepTokenAddress: Address; theoreticalSupply: bigint }) {
	if (profileGenesisRepTokenAddress.toLowerCase() === ZOLTAR_CONSTRUCTOR_GENESIS_REP_TOKEN_ADDRESS.toLowerCase()) return
	await memoryClient.setCode({
		address: ZOLTAR_CONSTRUCTOR_GENESIS_REP_TOKEN_ADDRESS,
		bytecode: `0x${ReputationToken_ReputationToken.evm.deployedBytecode.object}`,
	})
	await memoryClient.setStorageAt({
		address: ZOLTAR_CONSTRUCTOR_GENESIS_REP_TOKEN_ADDRESS,
		index: storageIndex(REPUTATION_TOKEN_THEORETICAL_SUPPLY_SLOT),
		value: storageValue(theoreticalSupply),
	})
}

export async function updateZoltarGenesisRepToken({ createWriteClient, memoryClient, repAddress, zoltarAddress }: { createWriteClient: (accountAddress: Address) => WriteClient; memoryClient: TevmLikeClient; repAddress: Address; zoltarAddress: Address }) {
	const universeBaseSlot = getZoltarUniverseBaseSlot(GENESIS_UNIVERSE_ID)
	const readClient = createWriteClient(zoltarAddress)
	const genesisTheoreticalSupply = await readClient.readContract({
		address: repAddress,
		abi: ReputationToken_ReputationToken.abi,
		functionName: 'getTotalTheoreticalSupply',
		args: [],
	})

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

	const patchedRepToken = await readClient.readContract({
		address: zoltarAddress,
		abi: Zoltar_Zoltar.abi,
		functionName: 'getRepToken',
		args: [GENESIS_UNIVERSE_ID],
	})
	if (patchedRepToken.toLowerCase() !== repAddress.toLowerCase()) {
		throw new Error(`Failed to patch simulation Zoltar genesis REP token. Expected ${repAddress}, received ${patchedRepToken}.`)
	}

	const patchedTheoreticalSupply = await readClient.readContract({
		address: zoltarAddress,
		abi: Zoltar_Zoltar.abi,
		functionName: 'getUniverseTheoreticalSupply',
		args: [GENESIS_UNIVERSE_ID],
	})
	if (patchedTheoreticalSupply !== genesisTheoreticalSupply) {
		throw new Error(`Failed to patch simulation Zoltar theoretical supply. Expected ${genesisTheoreticalSupply.toString()}, received ${patchedTheoreticalSupply.toString()}.`)
	}
}

export async function mintSimulationGenesisRep({ accountAddress, amount, createWriteClient, memoryClient, repAddress, zoltarAddress }: { accountAddress: Address; amount: bigint; createWriteClient: (accountAddress: Address) => WriteClient; memoryClient: TevmLikeClient; repAddress: Address; zoltarAddress: Address }) {
	if (amount <= 0n) {
		throw new Error('Simulation REP mint amount must be greater than zero')
	}

	const originalNonce = await memoryClient.getTransactionCount({ address: zoltarAddress })
	try {
		await withSimulationAuthorityAccount(memoryClient, zoltarAddress, async () => {
			const zoltarWriteClient = createWriteClient(zoltarAddress)
			const totalSupply = await zoltarWriteClient.readContract({
				address: repAddress,
				abi: ReputationToken_ReputationToken.abi,
				functionName: 'totalSupply',
				args: [],
			})
			const syncHash = await zoltarWriteClient.writeContract({
				address: repAddress,
				abi: ReputationToken_ReputationToken.abi,
				functionName: 'setMaxTheoreticalSupply',
				args: [totalSupply + amount],
			})
			await zoltarWriteClient.waitForTransactionReceipt({ hash: syncHash })
			const mintHash = await zoltarWriteClient.writeContract({
				address: repAddress,
				abi: ReputationToken_ReputationToken.abi,
				functionName: 'mint',
				args: [accountAddress, amount],
			})
			await zoltarWriteClient.waitForTransactionReceipt({ hash: mintHash })

			const zoltarCode = await memoryClient.getCode({
				address: zoltarAddress,
			})
			if (zoltarCode === undefined || zoltarCode === '0x') {
				return
			}

			await updateZoltarGenesisRepToken({
				createWriteClient,
				memoryClient,
				repAddress,
				zoltarAddress,
			})
		})
	} finally {
		await memoryClient.setNonce({ address: zoltarAddress, nonce: originalNonce })
	}
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
	await memoryClient.setStorageAt({ address: profile.wethAddress, index: storageIndex(WETH_NAME_SLOT), value: shortStringStorageValue('Wrapped Ether') })
	await memoryClient.setStorageAt({ address: profile.wethAddress, index: storageIndex(WETH_SYMBOL_SLOT), value: shortStringStorageValue('WETH') })
	await memoryClient.setStorageAt({ address: profile.wethAddress, index: storageIndex(WETH_DECIMALS_SLOT), value: storageValue(18n) })
	await reportBootstrapProgress(onProgress, 'Installing simulation WETH token', 0.2)
	const theoreticalSupply = await seedGenesisRepTokenState({
		accounts,
		createWriteClient,
		memoryClient,
		onProgress,
		repAddress: profile.genesisRepTokenAddress,
		zoltarAddress,
	})
	await seedZoltarConstructorGenesisRepToken({
		memoryClient,
		profileGenesisRepTokenAddress: profile.genesisRepTokenAddress,
		theoreticalSupply,
	})
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

type ProgressRange = {
	end: number
	start: number
}

type SeededVaultSpec = {
	accountAddress: Address
	repDeposit: bigint
	securityBondAllowance: bigint
}

type SeededSecurityPoolSpec = {
	poolLabel: string
	progressRange: ProgressRange
	questionTitle: string
	readyLabel: string
	vaults: readonly SeededVaultSpec[]
}

function createRangeProgressReporter(onProgress: BootstrapProgressHandler | undefined, range: ProgressRange, stepCount: number) {
	let completedStepCount = 0

	return async (label: string) => {
		completedStepCount += 1
		await reportBootstrapProgress(onProgress, label, range.start + (completedStepCount / Math.max(stepCount, 1)) * (range.end - range.start))
	}
}

function requireQaAccount(account: Address | undefined, label: string) {
	if (account === undefined) throw new Error(label)
	return account
}

function createSecurityPoolSeedParameters(
	currentTimestamp: bigint,
	title: string,
): {
	marketType: 'binary'
	outcomeLabels: string[]
	questionData: QuestionData
} {
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
	}
}

async function loadRequiredSeededPool(readClient: ReadClient, securityPoolAddress: Address, poolLabel: string) {
	const seededPool = (await loadAllSecurityPools(readClient)).find(pool => pool.securityPoolAddress === securityPoolAddress)
	if (seededPool === undefined) throw new Error(`Expected ${poolLabel} at ${securityPoolAddress}`)
	return seededPool
}

async function loadRequiredSecurityVault(readClient: ReadClient, securityPoolAddress: Address, vaultAddress: Address, label: string) {
	const vaultDetails = await loadSecurityVaultDetails(readClient, securityPoolAddress, vaultAddress)
	if (vaultDetails === undefined) throw new Error(`Expected seeded security vault details for ${label}`)
	return vaultDetails
}

async function getSeededSecurityBondAllowanceError({ accountAddress, managerAddress, readClient, securityBondAllowance, securityPoolAddress }: { accountAddress: Address; managerAddress: Address; readClient: ReadClient; securityBondAllowance: bigint; securityPoolAddress: Address }) {
	const updatedVault = await loadRequiredSecurityVault(readClient, securityPoolAddress, accountAddress, accountAddress)
	const managerDetails = await loadOracleManagerDetails(readClient, managerAddress)
	const pendingReport = managerDetails.pendingReportId === 0n ? undefined : await loadOpenOracleReportDetails(readClient, managerDetails.openOracleAddress, managerDetails.pendingReportId).catch(() => undefined)
	let isDistributed = 'n/a'
	if (pendingReport !== undefined) {
		isDistributed = pendingReport.isDistributed ? 'true' : 'false'
	}
	return `Expected seeded security bond allowance ${securityBondAllowance.toString()} for ${accountAddress} (allowance=${updatedVault.securityBondAllowance.toString()}, pendingReportId=${managerDetails.pendingReportId.toString()}, pendingOperation=${managerDetails.pendingOperation?.operation ?? 'none'}, pendingTarget=${managerDetails.pendingOperation?.targetVault ?? 'none'}, isPriceValid=${managerDetails.isPriceValid ? 'true' : 'false'}, reportTimestamp=${pendingReport?.reportTimestamp.toString() ?? 'n/a'}, currentReporter=${pendingReport?.currentReporter ?? 'n/a'}, isDistributed=${isDistributed})`
}

async function createSeededSecurityPool({ createWriteClient, currentTimestamp, deployerAccount, questionTitle }: { createWriteClient: (accountAddress: Address) => WriteClient; currentTimestamp: bigint; deployerAccount: Address; questionTitle: string }) {
	const deployerWriteClient = createWriteClient(deployerAccount)
	const marketResult = await createMarket(deployerWriteClient, createSecurityPoolSeedParameters(currentTimestamp, questionTitle))
	const questionId = BigInt(marketResult.questionId)
	const poolResult = await createSecurityPool(deployerWriteClient, {
		questionId,
		securityMultiplier: SECURITY_MULTIPLIER,
	})

	return {
		questionId,
		securityPoolAddress: poolResult.securityPoolAddress,
	}
}

async function validateSeededSecurityPool({ expectedVaults, poolLabel, readClient, securityPoolAddress }: { expectedVaults: readonly SeededVaultSpec[]; poolLabel: string; readClient: ReadClient; securityPoolAddress: Address }) {
	const seededPool = await loadRequiredSeededPool(readClient, securityPoolAddress, poolLabel)
	const expectedVaultCount = BigInt(expectedVaults.length)
	let expectedRepDeposit = 0n
	let expectedSecurityBondAllowance = 0n

	for (const expectedVault of expectedVaults) {
		expectedRepDeposit += expectedVault.repDeposit
		expectedSecurityBondAllowance += expectedVault.securityBondAllowance
	}

	if (seededPool.vaultCount !== expectedVaultCount) throw new Error(`Expected ${poolLabel} to have ${expectedVaultCount.toString()} seeded vaults`)
	if (seededPool.totalRepDeposit !== expectedRepDeposit) throw new Error(`Expected ${poolLabel} to have ${expectedRepDeposit.toString()} seeded REP`)
	if (seededPool.totalSecurityBondAllowance !== expectedSecurityBondAllowance) throw new Error(`Expected ${poolLabel} to have ${expectedSecurityBondAllowance.toString()} seeded security bond allowance`)

	for (const expectedVault of expectedVaults) {
		const vault = seededPool.vaults.find(candidate => candidate.vaultAddress === expectedVault.accountAddress)
		if (vault === undefined) throw new Error(`Expected ${poolLabel} to include seeded vault ${expectedVault.accountAddress}`)
		if (vault.repDepositShare !== expectedVault.repDeposit) throw new Error(`Expected ${poolLabel} vault ${expectedVault.accountAddress} to hold ${expectedVault.repDeposit.toString()} seeded REP`)
		if (vault.securityBondAllowance !== expectedVault.securityBondAllowance) throw new Error(`Expected ${poolLabel} vault ${expectedVault.accountAddress} to hold ${expectedVault.securityBondAllowance.toString()} seeded security bond allowance`)
	}
}

async function configureSecurityBondAllowance({
	accountAddress,
	createWriteClient,
	managerAddress,
	memoryClient,
	readClient,
	securityPoolAddress,
	securityBondAllowance,
}: {
	accountAddress: Address
	createWriteClient: (accountAddress: Address) => WriteClient
	managerAddress: Address
	memoryClient: TevmLikeClient
	readClient: ReadClient
	securityPoolAddress: Address
	securityBondAllowance: bigint
}) {
	const writeClient = createWriteClient(accountAddress)
	const initialReportAmount2 = await getSeededCoordinatorInitialReportAmount2(readClient, managerAddress)
	const queueResult = await queueOracleManagerOperation(writeClient, managerAddress, 'setSecurityBondsAllowance', accountAddress, securityBondAllowance, STAGED_SELF_OPERATION_TIMEOUT_SECONDS, initialReportAmount2)
	if (queueResult.stagedExecution?.success === false) throw new Error(queueResult.stagedExecution.errorMessage ?? `Failed to seed security bond allowance for ${accountAddress}`)
	await ensureSecurityBondAllowanceConfigured({
		accountAddress,
		managerAddress,
		memoryClient,
		readClient,
		securityBondAllowance,
		securityPoolAddress,
		writeClient,
	})
}

async function ensureSecurityBondAllowanceConfigured({
	accountAddress,
	managerAddress,
	memoryClient,
	readClient,
	securityBondAllowance,
	securityPoolAddress,
	writeClient,
}: {
	accountAddress: Address
	managerAddress: Address
	memoryClient: TevmLikeClient
	readClient: ReadClient
	securityBondAllowance: bigint
	securityPoolAddress: Address
	writeClient: WriteClient
}) {
	let updatedVault = await loadRequiredSecurityVault(readClient, securityPoolAddress, accountAddress, accountAddress)
	for (let attempt = 0; updatedVault.securityBondAllowance !== securityBondAllowance && attempt < 5; attempt += 1) {
		const managerDetails = await loadOracleManagerDetails(readClient, managerAddress)
		const initialReportAmount2 = await getSeededCoordinatorInitialReportAmount2(readClient, managerAddress)
		if (managerDetails.pendingOperation?.operation !== 'setSecurityBondsAllowance' || managerDetails.pendingOperation.targetVault !== accountAddress || managerDetails.pendingOperation.amount !== securityBondAllowance) {
			await queueOracleManagerOperation(writeClient, managerAddress, 'setSecurityBondsAllowance', accountAddress, securityBondAllowance, STAGED_SELF_OPERATION_TIMEOUT_SECONDS, initialReportAmount2)
		}

		if (managerDetails.pendingReportId > 0n) {
			const reportDetails = await loadOpenOracleReportDetails(readClient, managerDetails.openOracleAddress, managerDetails.pendingReportId)
			if (reportDetails.reportTimestamp === 0n || reportDetails.currentReporter === zeroAddress) {
				throw new Error(`Expected the coordinator request to submit the initial report for ${accountAddress}`)
			}
			if (!reportDetails.isDistributed) {
				await advanceSimulationTime(memoryClient, reportDetails.settlementTime + 1n)
				await settleOracleReport(writeClient, managerDetails.openOracleAddress, managerDetails.pendingReportId)
			}
		}

		const refreshedManagerDetails = await loadOracleManagerDetails(readClient, managerAddress)
		await executeReadySecurityBondAllowanceOperation({
			accountAddress,
			managerDetails: refreshedManagerDetails,
			readClient,
			securityBondAllowance,
			securityPoolAddress,
			writeClient,
		})

		updatedVault = await loadRequiredSecurityVault(readClient, securityPoolAddress, accountAddress, accountAddress)
	}
	if (updatedVault.securityBondAllowance !== securityBondAllowance) {
		throw new Error(
			await getSeededSecurityBondAllowanceError({
				accountAddress,
				managerAddress,
				readClient,
				securityBondAllowance,
				securityPoolAddress,
			}),
		)
	}
}

async function executeReadySecurityBondAllowanceOperation({
	accountAddress,
	managerDetails,
	readClient,
	securityBondAllowance,
	securityPoolAddress,
	writeClient,
}: {
	accountAddress: Address
	managerDetails: Awaited<ReturnType<typeof loadOracleManagerDetails>>
	readClient: ReadClient
	securityBondAllowance: bigint
	securityPoolAddress: Address
	writeClient: WriteClient
}) {
	if (managerDetails.pendingOperation?.operation !== 'setSecurityBondsAllowance') return
	if (managerDetails.pendingOperation.targetVault !== accountAddress) return

	try {
		await executeOracleManagerStagedOperation(writeClient, managerDetails.managerAddress, managerDetails.pendingOperation.operationId)
	} catch (error) {
		const updatedVault = await loadRequiredSecurityVault(readClient, securityPoolAddress, accountAddress, accountAddress)
		if (updatedVault.securityBondAllowance === securityBondAllowance) return
		throw error
	}
}

async function settleSeededOracleReport({
	accountAddress,
	createWriteClient,
	managerAddress,
	onProgressStep,
	poolLabel,
	readClient,
	securityBondAllowance,
}: {
	accountAddress: Address
	createWriteClient: (accountAddress: Address) => WriteClient
	managerAddress: Address
	onProgressStep: (label: string) => Promise<void>
	poolLabel: string
	readClient: ReadClient
	securityBondAllowance: bigint
}) {
	const writeClient = createWriteClient(accountAddress)
	const initialReportAmount2 = await getSeededCoordinatorInitialReportAmount2(readClient, managerAddress)
	await queueOracleManagerOperation(writeClient, managerAddress, 'setSecurityBondsAllowance', accountAddress, securityBondAllowance, STAGED_SELF_OPERATION_TIMEOUT_SECONDS, initialReportAmount2)
	await onProgressStep(`Configuring oracle manager for ${poolLabel}`)

	const oracleManagerDetails = await loadOracleManagerDetails(readClient, managerAddress)
	if (oracleManagerDetails.pendingReportId === 0n) throw new Error(`Expected a pending oracle report for ${poolLabel}`)
	await onProgressStep(`Opening seeded oracle report for ${poolLabel}`)

	return {
		openOracleAddress: oracleManagerDetails.openOracleAddress,
		pendingReportId: oracleManagerDetails.pendingReportId,
	}
}

async function settleOracleReportIfNeeded({ memoryClient, readClient, writeClient, openOracleAddress, pendingReportId }: { memoryClient: TevmLikeClient; readClient: ReadClient; writeClient: WriteClient; openOracleAddress: Address; pendingReportId: bigint }) {
	const seededReport = await loadOpenOracleReportDetails(readClient, openOracleAddress, pendingReportId)
	if (seededReport.isDistributed) return
	const reportTimestamp = getSimulationReportTiming(seededReport.reportTimestamp)
	const settlementTime = getSimulationReportTiming(seededReport.settlementTime)
	if (reportTimestamp !== undefined && settlementTime !== undefined) {
		const settlementReadyTimestamp = reportTimestamp + settlementTime + 1n
		const currentTimestamp = await getSimulationChainTimestamp(memoryClient)
		if (currentTimestamp < settlementReadyTimestamp) {
			await advanceSimulationTime(memoryClient, settlementReadyTimestamp - currentTimestamp)
		}
	}
	await settleOracleReport(writeClient, openOracleAddress, pendingReportId)
}

async function refreshSeededOraclePrice({ accountAddress, createWriteClient, managerAddress, memoryClient, readClient }: { accountAddress: Address; createWriteClient: (accountAddress: Address) => WriteClient; managerAddress: Address; memoryClient: TevmLikeClient; readClient: ReadClient }) {
	const writeClient = createWriteClient(accountAddress)
	let managerDetails = await loadOracleManagerDetails(readClient, managerAddress)
	if (managerDetails.isPriceValid) return
	if (managerDetails.pendingReportId === 0n) {
		const initialReportAmount2 = await getSeededCoordinatorInitialReportAmount2(readClient, managerAddress)
		await requestOraclePrice(writeClient, managerAddress, initialReportAmount2)
		managerDetails = await loadOracleManagerDetails(readClient, managerAddress)
	}
	if (managerDetails.pendingReportId === 0n) {
		throw new Error(`Expected a pending oracle report for ${managerAddress}`)
	}
	const reportDetails = await loadOpenOracleReportDetails(readClient, managerDetails.openOracleAddress, managerDetails.pendingReportId)
	if (reportDetails.reportTimestamp === 0n || reportDetails.currentReporter === zeroAddress) {
		throw new Error(`Expected the coordinator request to submit the initial report for ${managerAddress}`)
	}
	await settleOracleReportIfNeeded({
		memoryClient,
		openOracleAddress: managerDetails.openOracleAddress,
		pendingReportId: managerDetails.pendingReportId,
		readClient,
		writeClient,
	})
	const refreshedManagerDetails = await loadOracleManagerDetails(readClient, managerAddress)
	if (!refreshedManagerDetails.isPriceValid) throw new Error(`Expected a valid seeded oracle price for ${managerAddress}`)
}

function getSimulationReportTiming(value: unknown) {
	if (typeof value === 'bigint') return value
	if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value)
	return undefined
}

async function seedSecurityPool({
	createReadClient,
	createWriteClient,
	memoryClient,
	onProgress,
	poolSpec,
	profile,
	seedTimestamp,
}: {
	createReadClient: () => ReadClient
	createWriteClient: (accountAddress: Address) => WriteClient
	memoryClient: TevmLikeClient
	onProgress: BootstrapProgressHandler | undefined
	poolSpec: SeededSecurityPoolSpec
	profile: NetworkProfile
	seedTimestamp: bigint
}) {
	const readClient = createReadClient()
	const primaryVaultSpec = poolSpec.vaults[0]
	if (primaryVaultSpec === undefined) throw new Error(`Missing primary seeded vault account for ${poolSpec.poolLabel}`)
	const primaryVaultAccount = primaryVaultSpec.accountAddress
	const additionalVaults = poolSpec.vaults.slice(1)
	const stepCount = 2 + poolSpec.vaults.length + 3 + additionalVaults.length + 1
	const reportStep = createRangeProgressReporter(onProgress, poolSpec.progressRange, stepCount)

	const poolResult = await createSeededSecurityPool({
		createWriteClient,
		currentTimestamp: seedTimestamp,
		deployerAccount: primaryVaultAccount,
		questionTitle: poolSpec.questionTitle,
	})
	await reportStep(`Creating seeded market for ${poolSpec.poolLabel}`)
	await reportStep(`Deploying seeded security pool for ${poolSpec.poolLabel}`)

	for (const [index, vaultSpec] of poolSpec.vaults.entries()) {
		const writeClient = createWriteClient(vaultSpec.accountAddress)
		await approveErc20(writeClient, profile.genesisRepTokenAddress, poolResult.securityPoolAddress, vaultSpec.repDeposit, 'approveRep')
		await depositRepToSecurityPool(writeClient, poolResult.securityPoolAddress, vaultSpec.repDeposit)
		const seededVault = await loadRequiredSecurityVault(readClient, poolResult.securityPoolAddress, vaultSpec.accountAddress, vaultSpec.accountAddress)
		if (seededVault.repDepositShare !== vaultSpec.repDeposit) throw new Error(`Expected seeded REP deposit for ${vaultSpec.accountAddress} in ${poolSpec.poolLabel}, got ${seededVault.repDepositShare.toString()}`)
		await reportStep(`Funding seeded security vault ${index + 1} of ${poolSpec.vaults.length} for ${poolSpec.poolLabel}`)
	}

	const primaryVault = await loadRequiredSecurityVault(readClient, poolResult.securityPoolAddress, primaryVaultAccount, primaryVaultAccount)
	const seededOracleReport = await settleSeededOracleReport({
		accountAddress: primaryVaultAccount,
		createWriteClient,
		managerAddress: primaryVault.managerAddress,
		onProgressStep: reportStep,
		poolLabel: poolSpec.poolLabel,
		readClient,
		securityBondAllowance: primaryVaultSpec.securityBondAllowance,
	})
	await settleOracleReportIfNeeded({
		memoryClient,
		openOracleAddress: seededOracleReport.openOracleAddress,
		pendingReportId: seededOracleReport.pendingReportId,
		readClient,
		writeClient: createWriteClient(primaryVaultAccount),
	})
	await reportStep(`Settling seeded oracle report for ${poolSpec.poolLabel}`)

	const seededReport = await loadOpenOracleReportDetails(readClient, seededOracleReport.openOracleAddress, seededOracleReport.pendingReportId)
	if (!seededReport.isDistributed) throw new Error(`Expected the seeded oracle report to be settled for ${poolSpec.poolLabel}`)

	await ensureSecurityBondAllowanceConfigured({
		accountAddress: primaryVaultAccount,
		managerAddress: primaryVault.managerAddress,
		memoryClient,
		readClient,
		securityBondAllowance: primaryVaultSpec.securityBondAllowance,
		securityPoolAddress: poolResult.securityPoolAddress,
		writeClient: createWriteClient(primaryVaultAccount),
	})

	const primaryVaultAfterSettlement = await loadRequiredSecurityVault(readClient, poolResult.securityPoolAddress, primaryVaultAccount, primaryVaultAccount)
	if (primaryVaultAfterSettlement.securityBondAllowance !== primaryVaultSpec.securityBondAllowance) {
		throw new Error(
			await getSeededSecurityBondAllowanceError({
				accountAddress: primaryVaultAccount,
				managerAddress: primaryVault.managerAddress,
				readClient,
				securityBondAllowance: primaryVaultSpec.securityBondAllowance,
				securityPoolAddress: poolResult.securityPoolAddress,
			}),
		)
	}

	for (const [index, vaultSpec] of additionalVaults.entries()) {
		await configureSecurityBondAllowance({
			accountAddress: vaultSpec.accountAddress,
			createWriteClient,
			managerAddress: primaryVault.managerAddress,
			memoryClient,
			readClient,
			securityPoolAddress: poolResult.securityPoolAddress,
			securityBondAllowance: vaultSpec.securityBondAllowance,
		})
		await reportStep(`Configuring seeded security vault ${index + 2} of ${poolSpec.vaults.length} for ${poolSpec.poolLabel}`)
	}

	await validateSeededSecurityPool({
		expectedVaults: poolSpec.vaults,
		poolLabel: poolSpec.poolLabel,
		readClient,
		securityPoolAddress: poolResult.securityPoolAddress,
	})
	await reportStep(poolSpec.readyLabel)
}

async function seedSecurityPoolScenario({
	accounts,
	createReadClient,
	createWriteClient,
	memoryClient,
	onProgress,
	profile,
}: {
	accounts: readonly Address[]
	createReadClient: () => ReadClient
	createWriteClient: (accountAddress: Address) => WriteClient
	memoryClient: TevmLikeClient
	onProgress: BootstrapProgressHandler | undefined
	profile: NetworkProfile
}) {
	const primaryAccount = requireQaAccount(accounts[0], 'Expected seeded simulation QA account A1')
	const currentTimestamp = await getSimulationChainTimestamp(memoryClient)

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
					repDeposit: SECURITY_POOL_REP_DEPOSIT,
					securityBondAllowance: SECURITY_BOND_ALLOWANCE,
				},
			],
		},
		profile,
		seedTimestamp: currentTimestamp,
	})
}

async function seedSecurityPoolX2Scenario({
	accounts,
	createReadClient,
	createWriteClient,
	memoryClient,
	onProgress,
	profile,
}: {
	accounts: readonly Address[]
	createReadClient: () => ReadClient
	createWriteClient: (accountAddress: Address) => WriteClient
	memoryClient: TevmLikeClient
	onProgress: BootstrapProgressHandler | undefined
	profile: NetworkProfile
}) {
	const primaryAccount = requireQaAccount(accounts[0], 'Expected simulation QA account A1 for securitypoolx2')
	const secondaryAccount = requireQaAccount(accounts[1], 'Expected simulation QA account B2 for securitypoolx2')
	const currentTimestamp = await getSimulationChainTimestamp(memoryClient)
	const readClient = createReadClient()
	const reportStep = createRangeProgressReporter(onProgress, { start: 0.72, end: 0.98 }, 17)
	const seededVaults = [
		{
			accountAddress: primaryAccount,
			repDeposit: SECURITY_POOL_X2_PRIMARY_REP_DEPOSIT,
			securityBondAllowance: SECURITY_POOL_X2_PRIMARY_SECURITY_BOND_ALLOWANCE,
		},
		{
			accountAddress: secondaryAccount,
			repDeposit: SECURITY_POOL_X2_SECONDARY_REP_DEPOSIT,
			securityBondAllowance: SECURITY_POOL_X2_SECONDARY_SECURITY_BOND_ALLOWANCE,
		},
	] as const
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
	] as const

	const preparedPools: Array<{
		managerAddress: Address
		openOracleAddress: Address
		poolLabel: string
		pendingReportId: bigint
		primaryVault: SeededVaultSpec
		securityPoolAddress: Address
		vaults: readonly SeededVaultSpec[]
	}> = []

	for (const seededPool of seededPools) {
		const poolResult = await createSeededSecurityPool({
			createWriteClient,
			currentTimestamp,
			deployerAccount: primaryAccount,
			questionTitle: seededPool.questionTitle,
		})
		await reportStep(`Creating seeded market for ${seededPool.poolLabel}`)
		await reportStep(`Deploying seeded security pool for ${seededPool.poolLabel}`)

		for (const [index, vaultSpec] of seededPool.vaults.entries()) {
			const writeClient = createWriteClient(vaultSpec.accountAddress)
			await approveErc20(writeClient, profile.genesisRepTokenAddress, poolResult.securityPoolAddress, vaultSpec.repDeposit, 'approveRep')
			await depositRepToSecurityPool(writeClient, poolResult.securityPoolAddress, vaultSpec.repDeposit)
			const seededVault = await loadRequiredSecurityVault(readClient, poolResult.securityPoolAddress, vaultSpec.accountAddress, vaultSpec.accountAddress)
			if (seededVault.repDepositShare !== vaultSpec.repDeposit) throw new Error(`Expected seeded REP deposit for ${vaultSpec.accountAddress} in ${seededPool.poolLabel}, got ${seededVault.repDepositShare.toString()}`)
			await reportStep(`Funding seeded security vault ${index + 1} of ${seededPool.vaults.length} for ${seededPool.poolLabel}`)
		}

		const primaryVault = await loadRequiredSecurityVault(readClient, poolResult.securityPoolAddress, primaryAccount, primaryAccount)
		const primaryVaultSpec = seededPool.vaults[0]
		if (primaryVaultSpec === undefined) throw new Error(`Expected a primary seeded vault for ${seededPool.poolLabel}`)
		const seededOracleReport = await settleSeededOracleReport({
			accountAddress: primaryAccount,
			createWriteClient,
			managerAddress: primaryVault.managerAddress,
			onProgressStep: reportStep,
			poolLabel: seededPool.poolLabel,
			readClient,
			securityBondAllowance: primaryVaultSpec.securityBondAllowance,
		})

		preparedPools.push({
			managerAddress: primaryVault.managerAddress,
			openOracleAddress: seededOracleReport.openOracleAddress,
			poolLabel: seededPool.poolLabel,
			pendingReportId: seededOracleReport.pendingReportId,
			primaryVault: primaryVaultSpec,
			securityPoolAddress: poolResult.securityPoolAddress,
			vaults: seededPool.vaults,
		})
	}

	for (const preparedPool of preparedPools) {
		await settleOracleReportIfNeeded({
			memoryClient,
			openOracleAddress: preparedPool.openOracleAddress,
			pendingReportId: preparedPool.pendingReportId,
			readClient,
			writeClient: createWriteClient(primaryAccount),
		})
		await reportStep(`Settling seeded oracle report for ${preparedPool.poolLabel}`)

		const seededReport = await loadOpenOracleReportDetails(readClient, preparedPool.openOracleAddress, preparedPool.pendingReportId)
		if (!seededReport.isDistributed) throw new Error(`Expected the seeded oracle report to be settled for ${preparedPool.poolLabel}`)

		await ensureSecurityBondAllowanceConfigured({
			accountAddress: primaryAccount,
			managerAddress: preparedPool.managerAddress,
			memoryClient,
			readClient,
			securityBondAllowance: preparedPool.primaryVault.securityBondAllowance,
			securityPoolAddress: preparedPool.securityPoolAddress,
			writeClient: createWriteClient(primaryAccount),
		})

		const primaryVaultAfterSettlement = await loadRequiredSecurityVault(readClient, preparedPool.securityPoolAddress, primaryAccount, primaryAccount)
		if (primaryVaultAfterSettlement.securityBondAllowance !== preparedPool.primaryVault.securityBondAllowance) {
			throw new Error(
				await getSeededSecurityBondAllowanceError({
					accountAddress: primaryAccount,
					managerAddress: preparedPool.managerAddress,
					readClient,
					securityBondAllowance: preparedPool.primaryVault.securityBondAllowance,
					securityPoolAddress: preparedPool.securityPoolAddress,
				}),
			)
		}
	}

	for (const preparedPool of preparedPools) {
		const secondaryVault = preparedPool.vaults[1]
		if (secondaryVault === undefined) throw new Error(`Expected a secondary seeded vault for ${preparedPool.poolLabel}`)
		await configureSecurityBondAllowance({
			accountAddress: secondaryVault.accountAddress,
			createWriteClient,
			managerAddress: preparedPool.managerAddress,
			memoryClient,
			readClient,
			securityPoolAddress: preparedPool.securityPoolAddress,
			securityBondAllowance: secondaryVault.securityBondAllowance,
		})
		await reportStep(`Configuring seeded security vault 2 of 2 for ${preparedPool.poolLabel}`)

		await validateSeededSecurityPool({
			expectedVaults: preparedPool.vaults,
			poolLabel: preparedPool.poolLabel,
			readClient,
			securityPoolAddress: preparedPool.securityPoolAddress,
		})
	}

	await reportStep('Seeded securitypoolx2 scenario is ready')
}

async function loadRequiredChildSecurityPool(readClient: ReadClient, parentSecurityPoolAddress: Address, questionOutcome: ListedSecurityPool['questionOutcome']) {
	const childPool = (await loadAllSecurityPools(readClient)).find(pool => pool.parent === parentSecurityPoolAddress && pool.questionOutcome === questionOutcome)
	if (childPool === undefined) throw new Error(`Expected a ${questionOutcome} child pool for ${parentSecurityPoolAddress}`)
	return childPool
}

async function seedSecurityPoolX2AuctionScenario({
	accounts,
	createReadClient,
	createWriteClient,
	memoryClient,
	onProgress,
	profile,
}: {
	accounts: readonly Address[]
	createReadClient: () => ReadClient
	createWriteClient: (accountAddress: Address) => WriteClient
	memoryClient: TevmLikeClient
	onProgress: BootstrapProgressHandler | undefined
	profile: NetworkProfile
}) {
	await seedSecurityPoolX2Scenario({
		accounts,
		createReadClient,
		createWriteClient,
		memoryClient,
		onProgress,
		profile,
	})

	const primaryAccount = requireQaAccount(accounts[0], 'Expected simulation QA account A1 for securitypoolx2-auction')
	const secondaryAccount = requireQaAccount(accounts[1], 'Expected simulation QA account B2 for securitypoolx2-auction')
	const readClient = createReadClient()
	const writeClient = createWriteClient(primaryAccount)
	const x2Pools = await loadAllSecurityPools(readClient)
	const parentPool = x2Pools.find(pool => pool.marketDetails.title === 'Will this resolve? (securitypoolx2 #1)')
	if (parentPool === undefined) throw new Error('Expected the first securitypoolx2 parent pool for auction scenario seeding')

	await reportBootstrapProgress(onProgress, 'Preparing fork-auction seed pool', 0.985)
	await approveErc20(writeClient, profile.genesisRepTokenAddress, parentPool.securityPoolAddress, SECURITY_POOL_X2_AUCTION_EXTRA_REP_DEPOSIT, 'approveRep')
	await depositRepToSecurityPool(writeClient, parentPool.securityPoolAddress, SECURITY_POOL_X2_AUCTION_EXTRA_REP_DEPOSIT)
	const secondaryWriteClient = createWriteClient(secondaryAccount)
	await approveErc20(secondaryWriteClient, profile.genesisRepTokenAddress, parentPool.securityPoolAddress, SECURITY_POOL_X2_AUCTION_UNMIGRATED_REP_DEPOSIT, 'approveRep')
	await depositRepToSecurityPool(secondaryWriteClient, parentPool.securityPoolAddress, SECURITY_POOL_X2_AUCTION_UNMIGRATED_REP_DEPOSIT)
	await createCompleteSetInSecurityPool(createWriteClient(secondaryAccount), parentPool.securityPoolAddress, 20n * 10n ** 18n)

	const universeSummary = await loadZoltarUniverseSummary(readClient, parentPool.universeId)
	if (universeSummary === undefined) throw new Error(`Expected a Zoltar universe summary for parent pool ${parentPool.securityPoolAddress}`)
	const reportingDetailsBeforeFork = await loadReportingDetails(readClient, parentPool.securityPoolAddress, primaryAccount)
	if (reportingDetailsBeforeFork.marketDetails.endTime >= reportingDetailsBeforeFork.currentTime) {
		await advanceSimulationTime(memoryClient, reportingDetailsBeforeFork.marketDetails.endTime - reportingDetailsBeforeFork.currentTime + DAY_IN_SECONDS)
	}

	const ownForkDepositAmount = universeSummary.forkThreshold / SECURITY_MULTIPLIER
	await refreshSeededOraclePrice({
		accountAddress: primaryAccount,
		createWriteClient,
		managerAddress: parentPool.managerAddress,
		memoryClient,
		readClient,
	})
	await reportBootstrapProgress(onProgress, 'Triggering own-escalation fork', 0.988)
	await reportOutcomeInSecurityPool(writeClient, parentPool.securityPoolAddress, 'yes', ownForkDepositAmount)
	await reportOutcomeInSecurityPool(writeClient, parentPool.securityPoolAddress, 'no', ownForkDepositAmount)
	await forkZoltarWithOwnEscalation(writeClient, parentPool.securityPoolAddress, parentPool.universeId)

	await reportBootstrapProgress(onProgress, 'Creating and funding Yes child universe', 0.99)
	await createChildUniverseFromSecurityPool(writeClient, parentPool.securityPoolAddress, parentPool.universeId, 'yes')
	await migrateRepToZoltarFromSecurityPool(writeClient, parentPool.securityPoolAddress, parentPool.universeId, ['yes'])
	await advanceSimulationTime(memoryClient, FORK_MIGRATION_TIME_SECONDS + DAY_IN_SECONDS)

	const yesChildPool = await loadRequiredChildSecurityPool(readClient, parentPool.securityPoolAddress, 'yes')
	const yesForkDetailsBeforeAuction = await loadForkAuctionDetails(readClient, yesChildPool.securityPoolAddress)
	await reportBootstrapProgress(onProgress, 'Starting seeded truth auction', 0.992)
	await startTruthAuctionForSecurityPool(writeClient, yesChildPool.securityPoolAddress, yesForkDetailsBeforeAuction.universeId)

	const yesForkDetails = await loadForkAuctionDetails(readClient, yesChildPool.securityPoolAddress)
	if (yesForkDetails.truthAuctionAddress === undefined || yesForkDetails.truthAuctionAddress === '0x0000000000000000000000000000000000000000') {
		throw new Error('Expected a seeded truth auction address for the Yes child pool')
	}
	if (yesForkDetails.truthAuction?.finalized) {
		await reportBootstrapProgress(onProgress, 'Seeded securitypoolx2-auction scenario is ready', 0.995)
		return
	}

	const biddingAccounts = [primaryAccount, secondaryAccount, ...accounts.slice(2)]
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
	] as const

	for (const [index, bidAmount] of SECURITY_POOL_X2_AUCTION_BID_AMOUNTS.entries()) {
		const bidderAccount = biddingAccounts[index % biddingAccounts.length]
		if (bidderAccount === undefined) throw new Error('Expected at least one QA account for seeded truth auction bids')
		const bidPrice = bidPriceByIndex[index]
		if (bidPrice === undefined) throw new Error(`Missing seeded truth auction bid price for bid ${index + 1}`)
		const bidTick = getTruthAuctionTickAtPrice(bidPrice)
		if (bidTick === undefined) throw new Error(`Unable to map seeded truth auction bid price to a tick for bid ${index + 1}`)
		await submitTruthAuctionBid(createWriteClient(bidderAccount), yesChildPool.securityPoolAddress, yesForkDetails.universeId, yesForkDetails.truthAuctionAddress, bidTick, bidAmount)
	}

	await reportBootstrapProgress(onProgress, 'Seeded securitypoolx2-auction scenario is ready', 0.995)
}

async function applyScenario({
	accounts,
	createReadClient,
	createWriteClient,
	memoryClient,
	onProgress,
	profile,
	scenario,
}: {
	accounts: readonly Address[]
	createReadClient: () => ReadClient
	createWriteClient: (accountAddress: Address) => WriteClient
	memoryClient: TevmLikeClient
	onProgress: BootstrapProgressHandler | undefined
	profile: NetworkProfile
	scenario: SimulationScenario
}) {
	const primaryAccount = requireQaAccount(accounts[0], 'Expected seeded simulation QA account A1')

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
				accounts,
				createReadClient,
				createWriteClient,
				memoryClient,
				onProgress,
				profile,
			})
			return
		case 'securitypoolx2':
			await deploySimulationAppContracts(createWriteClient(primaryAccount), memoryClient, onProgress, { start: 0.32, end: 0.7 })
			await seedSecurityPoolX2Scenario({
				accounts,
				createReadClient,
				createWriteClient,
				memoryClient,
				onProgress,
				profile,
			})
			return
		case 'securitypoolx2-auction':
			await deploySimulationAppContracts(createWriteClient(primaryAccount), memoryClient, onProgress, { start: 0.32, end: 0.7 })
			await seedSecurityPoolX2AuctionScenario({
				accounts,
				createReadClient,
				createWriteClient,
				memoryClient,
				onProgress,
				profile,
			})
			return
		default:
			return assertNever(scenario)
	}
}

export async function bootstrapSimulationChain({
	accounts,
	createReadClient,
	createWriteClient,
	memoryClient,
	onProgress,
	primaryAccount,
	profile,
	scenario,
}: {
	accounts: readonly Address[]
	createReadClient: () => ReadClient
	createWriteClient: (accountAddress: Address) => WriteClient
	memoryClient: TevmLikeClient
	onProgress: BootstrapProgressHandler | undefined
	primaryAccount: Address
	profile: NetworkProfile
	scenario: SimulationScenario
}) {
	await reportBootstrapProgress(onProgress, 'Initializing simulation engine', 0.01)
	await withTimeout(memoryClient.tevmReady(), 20_000, 'Simulation engine initialization timed out. Firefox may be struggling with main-thread simulation startup.')
	await reportBootstrapProgress(onProgress, 'Preparing simulation chain', 0.03)
	await initializeSimulationClock(memoryClient)
	await seedAccountBalances(memoryClient, accounts, onProgress)
	const zoltarStep = getDeploymentSteps().find(step => step.id === 'zoltar')
	if (zoltarStep === undefined) throw new Error('Missing Zoltar deployment step for simulation bootstrap')

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
		accounts,
		createReadClient,
		createWriteClient,
		memoryClient,
		onProgress,
		profile,
		scenario,
	})
	await reportBootstrapProgress(onProgress, 'Saving simulation snapshot', 0.99)
	await reportBootstrapProgress(onProgress, 'Simulation scenario ready', 1)
}
