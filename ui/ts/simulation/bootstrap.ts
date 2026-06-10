import { createMemoryClient } from 'tevm'
import { encodeAbiParameters, encodeDeployData, getCreateAddress, keccak256, toHex, type Address, type Hex } from 'viem'
import {
	approveErc20,
	createMarket,
	createChildUniverseFromSecurityPool,
	createCompleteSetInSecurityPool,
	createSecurityPool,
	depositRepToSecurityPool,
	forkZoltarWithOwnEscalation,
	getDeploymentSteps,
	loadAllSecurityPools,
	loadErc20Balance,
	loadForkAuctionDetails,
	loadOracleManagerDetails,
	loadOpenOracleReportDetails,
	loadReportingDetails,
	loadSecurityVaultDetails,
	loadZoltarUniverseSummary,
	migrateRepToZoltarFromSecurityPool,
	queueOracleManagerOperation,
	reportOutcomeInSecurityPool,
	settleOracleReport,
	startTruthAuctionForSecurityPool,
	submitInitialOracleReport,
	submitTruthAuctionBid,
} from '../contracts.js'
import { ReputationToken_ReputationToken, Zoltar_Zoltar, peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator, peripherals_WETH9_WETH9 } from '../contractArtifact.js'
import { assertNever } from '../lib/assert.js'
import { getTruthAuctionPriceAtTick, getTruthAuctionTickAtPrice } from '../lib/forkAuction.js'
import type { ReadClient, WriteClient } from '../lib/chainBackend.js'
import { MAINNET_WETH_ADDRESS, type NetworkProfile } from '../lib/networkProfile.js'
import type { ListedSecurityPool, QuestionData } from '../types/contracts.js'
import { advanceSimulationTime, getSimulationChainTimestamp, initializeSimulationClock } from './clock.js'
import type { SimulationScenario } from './scenarios.js'

type TevmLikeClient = ReturnType<typeof createMemoryClient>
type BootstrapProgressHandler = (progress: { label: string; value: number }) => Promise<void> | void

const DAY_IN_SECONDS = 24n * 60n * 60n
const ETH_BALANCE_AMOUNT = 10n ** 30n
const GENESIS_UNIVERSE_ID = 0n
const MAX_RETENTION_RATE = 999_999_996_848_000_000n
const SEEDED_REP_ETH_PRICE = 3n * 10n ** 18n
const REP_TOKEN_MINT_AMOUNT = 100_000_000n * 10n ** 18n
const SECURITY_MULTIPLIER = 2n
const SECURITY_POOL_REP_DEPOSIT = 10_000n * 10n ** 18n
const SECURITY_BOND_ALLOWANCE = SECURITY_POOL_REP_DEPOSIT / 4n
const SECURITY_POOL_X2_PRIMARY_REP_DEPOSIT = 12_000n * 10n ** 18n
const SECURITY_POOL_X2_PRIMARY_SECURITY_BOND_ALLOWANCE = 1_000n * 10n ** 18n
const SECURITY_POOL_X2_SECONDARY_REP_DEPOSIT = SECURITY_POOL_REP_DEPOSIT
const SECURITY_POOL_X2_SECONDARY_SECURITY_BOND_ALLOWANCE = SECURITY_BOND_ALLOWANCE
const STAGED_SELF_OPERATION_TIMEOUT_SECONDS = 30n * 60n
const SECURITY_POOL_X2_AUCTION_EXTRA_REP_DEPOSIT = 20_000_000n * 10n ** 18n
const SECURITY_POOL_X2_AUCTION_BID_PRICES = [getTruthAuctionPriceAtTick(12n), getTruthAuctionPriceAtTick(10n), getTruthAuctionPriceAtTick(8n)] as const
const SECURITY_POOL_X2_AUCTION_BID_AMOUNTS = [3n * 10n ** 18n, 4n * 10n ** 18n, 5n * 10n ** 18n, 6n * 10n ** 18n, 3n * 10n ** 18n, 4n * 10n ** 18n, 5n * 10n ** 18n, 3n * 10n ** 18n, 4n * 10n ** 18n, 5n * 10n ** 18n] as const
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
		await withSimulationAuthorityAccount(memoryClient, zoltarAddress, async () => {
			const zoltarWriteClient = createWriteClient(zoltarAddress)
			let totalSupply = 0n
			for (const [index, account] of accounts.entries()) {
				totalSupply += REP_TOKEN_MINT_AMOUNT
				const hash = await zoltarWriteClient.writeContract({
					address: repAddress,
					abi: ReputationToken_ReputationToken.abi,
					functionName: 'mint',
					args: [account, REP_TOKEN_MINT_AMOUNT],
				})
				await zoltarWriteClient.waitForTransactionReceipt({ hash })
				await reportBootstrapProgress(onProgress, `Seeding REP balances ${index + 1} of ${accounts.length}`, 0.16 + ((index + 1) / Math.max(accounts.length, 1)) * 0.06)
			}

			const syncHash = await zoltarWriteClient.writeContract({
				address: repAddress,
				abi: ReputationToken_ReputationToken.abi,
				functionName: 'setMaxTheoreticalSupply',
				args: [totalSupply],
			})
			await zoltarWriteClient.waitForTransactionReceipt({ hash: syncHash })
			await reportBootstrapProgress(onProgress, 'Finalizing REP token state', 0.23)
		})
	} finally {
		await memoryClient.setNonce({ address: zoltarAddress, nonce: originalNonce })
	}
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
			const mintHash = await zoltarWriteClient.writeContract({
				address: repAddress,
				abi: ReputationToken_ReputationToken.abi,
				functionName: 'mint',
				args: [accountAddress, amount],
			})
			await zoltarWriteClient.waitForTransactionReceipt({ hash: mintHash })
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
				args: [totalSupply],
			})
			await zoltarWriteClient.waitForTransactionReceipt({ hash: syncHash })

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
	await reportBootstrapProgress(onProgress, 'Installing simulation WETH token', 0.2)
	await seedGenesisRepTokenState({
		accounts,
		createWriteClient,
		memoryClient,
		onProgress,
		repAddress: profile.genesisRepTokenAddress,
		zoltarAddress,
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

async function ensureSufficientWethBalance(readClient: ReadClient, writeClient: WriteClient, profile: NetworkProfile, accountAddress: Address, requiredAmount: bigint) {
	const currentBalance = await loadErc20Balance(readClient, profile.wethAddress, accountAddress)
	if (currentBalance >= requiredAmount) return
	const missingBalance = requiredAmount - currentBalance
	const hash = await writeClient.sendTransaction({
		to: profile.wethAddress,
		value: missingBalance,
	})
	await writeClient.waitForTransactionReceipt({ hash })
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

async function createSeededSecurityPool({ createWriteClient, currentTimestamp, deployerAccount, questionTitle }: { createWriteClient: (accountAddress: Address) => WriteClient; currentTimestamp: bigint; deployerAccount: Address; questionTitle: string }) {
	const deployerWriteClient = createWriteClient(deployerAccount)
	const marketResult = await createMarket(deployerWriteClient, createSecurityPoolSeedParameters(currentTimestamp, questionTitle))
	const questionId = BigInt(marketResult.questionId)
	const poolResult = await createSecurityPool(deployerWriteClient, {
		currentRetentionRate: MAX_RETENTION_RATE,
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
	profile,
}: {
	accountAddress: Address
	createWriteClient: (accountAddress: Address) => WriteClient
	managerAddress: Address
	memoryClient: TevmLikeClient
	profile: NetworkProfile
	readClient: ReadClient
	securityPoolAddress: Address
	securityBondAllowance: bigint
}) {
	const writeClient = createWriteClient(accountAddress)
	const queueResult = await queueOracleManagerOperation(writeClient, managerAddress, 'setSecurityBondsAllowance', accountAddress, securityBondAllowance, STAGED_SELF_OPERATION_TIMEOUT_SECONDS)
	if (queueResult.stagedExecution?.success === false) throw new Error(queueResult.stagedExecution.errorMessage ?? `Failed to seed security bond allowance for ${accountAddress}`)
	let updatedVault = await loadRequiredSecurityVault(readClient, securityPoolAddress, accountAddress, accountAddress)
	if (updatedVault.securityBondAllowance !== securityBondAllowance) {
		const managerDetails = await loadOracleManagerDetails(readClient, managerAddress)
		if (managerDetails.pendingReportId > 0n) {
			if (managerDetails.callbackStateHash === undefined || managerDetails.exactToken1Report === undefined || managerDetails.token1 === undefined || managerDetails.token2 === undefined) throw new Error(`Expected a pending oracle report for ${accountAddress}`)

			const amount1 = managerDetails.exactToken1Report
			const amount2 = (amount1 * 10n ** 18n) / SEEDED_REP_ETH_PRICE
			await approveErc20(writeClient, managerDetails.token1, managerDetails.openOracleAddress, amount1, 'approveToken1')
			await ensureSufficientWethBalance(readClient, writeClient, profile, accountAddress, amount2)
			await approveErc20(writeClient, managerDetails.token2, managerDetails.openOracleAddress, amount2, 'approveToken2')
			await submitInitialOracleReport(writeClient, managerDetails.openOracleAddress, managerDetails.pendingReportId, amount1, amount2, managerDetails.callbackStateHash)
			await advanceSimulationTime(memoryClient, DAY_IN_SECONDS)
			await settleOracleReport(writeClient, managerDetails.openOracleAddress, managerDetails.pendingReportId)
		}

		const refreshedManagerDetails = await loadOracleManagerDetails(readClient, managerAddress)
		if (refreshedManagerDetails.pendingOperation?.operation === 'setSecurityBondsAllowance' && refreshedManagerDetails.pendingOperation.targetVault === accountAddress && refreshedManagerDetails.isPriceValid) {
			const hash = await writeClient.writeContract({
				address: managerAddress,
				abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
				functionName: 'executeStagedOperation',
				args: [refreshedManagerDetails.pendingOperation.operationId],
			})
			await writeClient.waitForTransactionReceipt({ hash })
		}

		updatedVault = await loadRequiredSecurityVault(readClient, securityPoolAddress, accountAddress, accountAddress)
	}
	if (updatedVault.securityBondAllowance !== securityBondAllowance) {
		const finalManagerDetails = await loadOracleManagerDetails(readClient, managerAddress)
		throw new Error(
			`Expected seeded security bond allowance ${securityBondAllowance.toString()} for ${accountAddress} (allowance=${updatedVault.securityBondAllowance.toString()}, pendingReportId=${finalManagerDetails.pendingReportId.toString()}, pendingOperation=${finalManagerDetails.pendingOperation?.operation ?? 'none'}, pendingTarget=${finalManagerDetails.pendingOperation?.targetVault ?? 'none'}, isPriceValid=${finalManagerDetails.isPriceValid ? 'true' : 'false'})`,
		)
	}
}

async function settleSeededOracleReport({
	accountAddress,
	createWriteClient,
	managerAddress,
	onProgressStep,
	poolLabel,
	profile,
	readClient,
	securityBondAllowance,
}: {
	accountAddress: Address
	createWriteClient: (accountAddress: Address) => WriteClient
	managerAddress: Address
	onProgressStep: (label: string) => Promise<void>
	poolLabel: string
	profile: NetworkProfile
	readClient: ReadClient
	securityBondAllowance: bigint
}) {
	const writeClient = createWriteClient(accountAddress)
	await queueOracleManagerOperation(writeClient, managerAddress, 'setSecurityBondsAllowance', accountAddress, securityBondAllowance, STAGED_SELF_OPERATION_TIMEOUT_SECONDS)
	await onProgressStep(`Configuring oracle manager for ${poolLabel}`)

	const oracleManagerDetails = await loadOracleManagerDetails(readClient, managerAddress)
	if (oracleManagerDetails.pendingReportId === 0n || oracleManagerDetails.callbackStateHash === undefined || oracleManagerDetails.exactToken1Report === undefined || oracleManagerDetails.token1 === undefined || oracleManagerDetails.token2 === undefined)
		throw new Error(`Expected a pending oracle report for ${poolLabel}`)

	const amount1 = oracleManagerDetails.exactToken1Report
	const amount2 = (amount1 * 10n ** 18n) / SEEDED_REP_ETH_PRICE
	await approveErc20(writeClient, oracleManagerDetails.token1, oracleManagerDetails.openOracleAddress, amount1, 'approveToken1')
	await ensureSufficientWethBalance(readClient, writeClient, profile, accountAddress, amount2)
	await approveErc20(writeClient, oracleManagerDetails.token2, oracleManagerDetails.openOracleAddress, amount2, 'approveToken2')
	await submitInitialOracleReport(writeClient, oracleManagerDetails.openOracleAddress, oracleManagerDetails.pendingReportId, amount1, amount2, oracleManagerDetails.callbackStateHash)
	await onProgressStep(`Submitting seeded oracle report for ${poolLabel}`)

	return {
		openOracleAddress: oracleManagerDetails.openOracleAddress,
		pendingReportId: oracleManagerDetails.pendingReportId,
	}
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
		profile,
		readClient,
		securityBondAllowance: primaryVaultSpec.securityBondAllowance,
	})
	await advanceSimulationTime(memoryClient, DAY_IN_SECONDS)
	await settleOracleReport(createWriteClient(primaryVaultAccount), seededOracleReport.openOracleAddress, seededOracleReport.pendingReportId)
	await reportStep(`Settling seeded oracle report for ${poolSpec.poolLabel}`)

	const seededReport = await loadOpenOracleReportDetails(readClient, seededOracleReport.openOracleAddress, seededOracleReport.pendingReportId)
	if (!seededReport.isDistributed) throw new Error(`Expected the seeded oracle report to be settled for ${poolSpec.poolLabel}`)

	const primaryVaultAfterSettlement = await loadRequiredSecurityVault(readClient, poolResult.securityPoolAddress, primaryVaultAccount, primaryVaultAccount)
	if (primaryVaultAfterSettlement.securityBondAllowance !== primaryVaultSpec.securityBondAllowance) throw new Error(`Expected seeded security bond allowance for ${primaryVaultAccount}`)

	for (const [index, vaultSpec] of additionalVaults.entries()) {
		await configureSecurityBondAllowance({
			accountAddress: vaultSpec.accountAddress,
			createWriteClient,
			managerAddress: primaryVault.managerAddress,
			memoryClient,
			profile,
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
			profile,
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

	await advanceSimulationTime(memoryClient, DAY_IN_SECONDS)

	for (const preparedPool of preparedPools) {
		await settleOracleReport(createWriteClient(primaryAccount), preparedPool.openOracleAddress, preparedPool.pendingReportId)
		await reportStep(`Settling seeded oracle report for ${preparedPool.poolLabel}`)

		const seededReport = await loadOpenOracleReportDetails(readClient, preparedPool.openOracleAddress, preparedPool.pendingReportId)
		if (!seededReport.isDistributed) throw new Error(`Expected the seeded oracle report to be settled for ${preparedPool.poolLabel}`)

		const primaryVaultAfterSettlement = await loadRequiredSecurityVault(readClient, preparedPool.securityPoolAddress, primaryAccount, primaryAccount)
		if (primaryVaultAfterSettlement.securityBondAllowance !== preparedPool.primaryVault.securityBondAllowance) throw new Error(`Expected seeded security bond allowance for ${primaryAccount}`)
	}

	for (const preparedPool of preparedPools) {
		const secondaryVault = preparedPool.vaults[1]
		if (secondaryVault === undefined) throw new Error(`Expected a secondary seeded vault for ${preparedPool.poolLabel}`)
		await configureSecurityBondAllowance({
			accountAddress: secondaryVault.accountAddress,
			createWriteClient,
			managerAddress: preparedPool.managerAddress,
			memoryClient,
			profile,
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
	await createCompleteSetInSecurityPool(createWriteClient(secondaryAccount), parentPool.securityPoolAddress, 20n * 10n ** 18n)

	const universeSummary = await loadZoltarUniverseSummary(readClient, parentPool.universeId)
	if (universeSummary === undefined) throw new Error(`Expected a Zoltar universe summary for parent pool ${parentPool.securityPoolAddress}`)
	const reportingDetailsBeforeFork = await loadReportingDetails(readClient, parentPool.securityPoolAddress, primaryAccount)
	if (reportingDetailsBeforeFork.marketDetails.endTime >= reportingDetailsBeforeFork.currentTime) {
		await advanceSimulationTime(memoryClient, reportingDetailsBeforeFork.marketDetails.endTime - reportingDetailsBeforeFork.currentTime + DAY_IN_SECONDS)
	}

	const ownForkDepositAmount = universeSummary.forkThreshold / SECURITY_MULTIPLIER
	await reportBootstrapProgress(onProgress, 'Triggering own-escalation fork', 0.988)
	await reportOutcomeInSecurityPool(writeClient, parentPool.securityPoolAddress, 'yes', ownForkDepositAmount)
	await reportOutcomeInSecurityPool(writeClient, parentPool.securityPoolAddress, 'no', ownForkDepositAmount)
	await forkZoltarWithOwnEscalation(writeClient, parentPool.securityPoolAddress, parentPool.universeId)

	await reportBootstrapProgress(onProgress, 'Creating and funding Yes child universe', 0.99)
	await createChildUniverseFromSecurityPool(writeClient, parentPool.securityPoolAddress, parentPool.universeId, 'yes')
	await migrateRepToZoltarFromSecurityPool(writeClient, parentPool.securityPoolAddress, parentPool.universeId, ['yes'])
	await advanceSimulationTime(memoryClient, 8n * DAY_IN_SECONDS + DAY_IN_SECONDS)

	const yesChildPool = await loadRequiredChildSecurityPool(readClient, parentPool.securityPoolAddress, 'yes')
	const yesForkDetailsBeforeAuction = await loadForkAuctionDetails(readClient, yesChildPool.securityPoolAddress)
	await reportBootstrapProgress(onProgress, 'Starting seeded truth auction', 0.992)
	await startTruthAuctionForSecurityPool(writeClient, yesChildPool.securityPoolAddress, yesForkDetailsBeforeAuction.universeId)

	const yesForkDetails = await loadForkAuctionDetails(readClient, yesChildPool.securityPoolAddress)
	if (yesForkDetails.truthAuctionAddress === undefined || yesForkDetails.truthAuctionAddress === '0x0000000000000000000000000000000000000000') {
		throw new Error('Expected a seeded truth auction address for the Yes child pool')
	}
	if (yesForkDetails.truthAuction?.finalized) {
		throw new Error('Expected the seeded truth auction to remain active after startTruthAuction')
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
