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
import { ReputationToken_ReputationToken, peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator, peripherals_WETH9_WETH9 } from '../contractArtifact.js'
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

type ProgressRange = {
	end: number
	start: number
}

type SeededSecurityPoolSpec = {
	poolLabel: string
	progressRange: ProgressRange
	questionTitle: string
	readyLabel: string
	vaultAccounts: readonly Address[]
}

function createRangeProgressReporter(onProgress: BootstrapProgressHandler | undefined, range: ProgressRange, stepCount: number) {
	let completedStepCount = 0

	return async (label: string) => {
		completedStepCount += 1
		await reportBootstrapProgress(onProgress, label, range.start + (completedStepCount / Math.max(stepCount, 1)) * (range.end - range.start))
	}
}

function requireQaAccount(account: Address | undefined, label: string) {
	if (account === undefined) {
		throw new Error(label)
	}
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
	if (seededPool === undefined) {
		throw new Error(`Expected ${poolLabel} at ${securityPoolAddress}`)
	}
	return seededPool
}

async function loadRequiredSecurityVault(readClient: ReadClient, securityPoolAddress: Address, vaultAddress: Address, label: string) {
	const vaultDetails = await loadSecurityVaultDetails(readClient, securityPoolAddress, vaultAddress)
	if (vaultDetails === undefined) {
		throw new Error(`Expected seeded security vault details for ${label}`)
	}
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

async function validateSeededSecurityPool({ expectedVaultAccounts, poolLabel, readClient, securityPoolAddress }: { expectedVaultAccounts: readonly Address[]; poolLabel: string; readClient: ReadClient; securityPoolAddress: Address }) {
	const seededPool = await loadRequiredSeededPool(readClient, securityPoolAddress, poolLabel)
	const expectedVaultCount = BigInt(expectedVaultAccounts.length)
	const expectedRepDeposit = SECURITY_POOL_REP_DEPOSIT * expectedVaultCount
	const expectedSecurityBondAllowance = SECURITY_BOND_ALLOWANCE * expectedVaultCount

	if (seededPool.vaultCount !== expectedVaultCount) {
		throw new Error(`Expected ${poolLabel} to have ${expectedVaultCount.toString()} seeded vaults`)
	}
	if (seededPool.totalRepDeposit !== expectedRepDeposit) {
		throw new Error(`Expected ${poolLabel} to have ${expectedRepDeposit.toString()} seeded REP`)
	}
	if (seededPool.totalSecurityBondAllowance !== expectedSecurityBondAllowance) {
		throw new Error(`Expected ${poolLabel} to have ${expectedSecurityBondAllowance.toString()} seeded security bond allowance`)
	}

	for (const vaultAddress of expectedVaultAccounts) {
		const vault = seededPool.vaults.find(candidate => candidate.vaultAddress === vaultAddress)
		if (vault === undefined) {
			throw new Error(`Expected ${poolLabel} to include seeded vault ${vaultAddress}`)
		}
		if (vault.repDepositShare !== SECURITY_POOL_REP_DEPOSIT) {
			throw new Error(`Expected ${poolLabel} vault ${vaultAddress} to hold the seeded REP deposit`)
		}
		if (vault.securityBondAllowance !== SECURITY_BOND_ALLOWANCE) {
			throw new Error(`Expected ${poolLabel} vault ${vaultAddress} to hold the seeded security bond allowance`)
		}
	}
}

async function configureSecurityBondAllowance({
	accountAddress,
	createWriteClient,
	managerAddress,
	memoryClient,
	readClient,
	securityPoolAddress,
	profile,
}: {
	accountAddress: Address
	createWriteClient: (accountAddress: Address) => WriteClient
	managerAddress: Address
	memoryClient: TevmLikeClient
	profile: NetworkProfile
	readClient: ReadClient
	securityPoolAddress: Address
}) {
	const writeClient = createWriteClient(accountAddress)
	const queueResult = await queueOracleManagerOperation(writeClient, managerAddress, 'setSecurityBondsAllowance', accountAddress, SECURITY_BOND_ALLOWANCE)
	if (queueResult.stagedExecution?.success === false) {
		throw new Error(queueResult.stagedExecution.errorMessage ?? `Failed to seed security bond allowance for ${accountAddress}`)
	}
	let updatedVault = await loadRequiredSecurityVault(readClient, securityPoolAddress, accountAddress, accountAddress)
	if (updatedVault.securityBondAllowance !== SECURITY_BOND_ALLOWANCE) {
		const managerDetails = await loadOracleManagerDetails(readClient, managerAddress)
		if (managerDetails.pendingReportId > 0n) {
			if (managerDetails.callbackStateHash === undefined || managerDetails.exactToken1Report === undefined || managerDetails.token1 === undefined || managerDetails.token2 === undefined) {
				throw new Error(`Expected a pending oracle report for ${accountAddress}`)
			}

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
	if (updatedVault.securityBondAllowance !== SECURITY_BOND_ALLOWANCE) {
		const finalManagerDetails = await loadOracleManagerDetails(readClient, managerAddress)
		throw new Error(
			`Expected seeded security bond allowance for ${accountAddress} (allowance=${updatedVault.securityBondAllowance.toString()}, pendingReportId=${finalManagerDetails.pendingReportId.toString()}, pendingOperation=${finalManagerDetails.pendingOperation?.operation ?? 'none'}, pendingTarget=${finalManagerDetails.pendingOperation?.targetVault ?? 'none'}, isPriceValid=${finalManagerDetails.isPriceValid ? 'true' : 'false'})`,
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
}: {
	accountAddress: Address
	createWriteClient: (accountAddress: Address) => WriteClient
	managerAddress: Address
	onProgressStep: (label: string) => Promise<void>
	poolLabel: string
	profile: NetworkProfile
	readClient: ReadClient
}) {
	const writeClient = createWriteClient(accountAddress)
	await queueOracleManagerOperation(writeClient, managerAddress, 'setSecurityBondsAllowance', accountAddress, SECURITY_BOND_ALLOWANCE)
	await onProgressStep(`Configuring oracle manager for ${poolLabel}`)

	const oracleManagerDetails = await loadOracleManagerDetails(readClient, managerAddress)
	if (oracleManagerDetails.pendingReportId === 0n || oracleManagerDetails.callbackStateHash === undefined || oracleManagerDetails.exactToken1Report === undefined || oracleManagerDetails.token1 === undefined || oracleManagerDetails.token2 === undefined) {
		throw new Error(`Expected a pending oracle report for ${poolLabel}`)
	}

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
	const primaryVaultAccount = requireQaAccount(poolSpec.vaultAccounts[0], `Missing primary seeded vault account for ${poolSpec.poolLabel}`)
	const additionalVaultAccounts = poolSpec.vaultAccounts.slice(1)
	const stepCount = 2 + poolSpec.vaultAccounts.length + 3 + additionalVaultAccounts.length + 1
	const reportStep = createRangeProgressReporter(onProgress, poolSpec.progressRange, stepCount)

	const poolResult = await createSeededSecurityPool({
		createWriteClient,
		currentTimestamp: seedTimestamp,
		deployerAccount: primaryVaultAccount,
		questionTitle: poolSpec.questionTitle,
	})
	await reportStep(`Creating seeded market for ${poolSpec.poolLabel}`)
	await reportStep(`Deploying seeded security pool for ${poolSpec.poolLabel}`)

	for (const [index, vaultAccount] of poolSpec.vaultAccounts.entries()) {
		const writeClient = createWriteClient(vaultAccount)
		await approveErc20(writeClient, profile.genesisRepTokenAddress, poolResult.securityPoolAddress, SECURITY_POOL_REP_DEPOSIT, 'approveRep')
		await depositRepToSecurityPool(writeClient, poolResult.securityPoolAddress, SECURITY_POOL_REP_DEPOSIT)
		const seededVault = await loadRequiredSecurityVault(readClient, poolResult.securityPoolAddress, vaultAccount, vaultAccount)
		if (seededVault.repDepositShare !== SECURITY_POOL_REP_DEPOSIT) {
			throw new Error(`Expected seeded REP deposit for ${vaultAccount} in ${poolSpec.poolLabel}, got ${seededVault.repDepositShare.toString()}`)
		}
		await reportStep(`Funding seeded security vault ${index + 1} of ${poolSpec.vaultAccounts.length} for ${poolSpec.poolLabel}`)
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
	})
	await advanceSimulationTime(memoryClient, DAY_IN_SECONDS)
	await settleOracleReport(createWriteClient(primaryVaultAccount), seededOracleReport.openOracleAddress, seededOracleReport.pendingReportId)
	await reportStep(`Settling seeded oracle report for ${poolSpec.poolLabel}`)

	const seededReport = await loadOpenOracleReportDetails(readClient, seededOracleReport.openOracleAddress, seededOracleReport.pendingReportId)
	if (!seededReport.isDistributed) {
		throw new Error(`Expected the seeded oracle report to be settled for ${poolSpec.poolLabel}`)
	}

	const primaryVaultAfterSettlement = await loadRequiredSecurityVault(readClient, poolResult.securityPoolAddress, primaryVaultAccount, primaryVaultAccount)
	if (primaryVaultAfterSettlement.securityBondAllowance !== SECURITY_BOND_ALLOWANCE) {
		throw new Error(`Expected seeded security bond allowance for ${primaryVaultAccount}`)
	}

	for (const [index, vaultAccount] of additionalVaultAccounts.entries()) {
		await configureSecurityBondAllowance({
			accountAddress: vaultAccount,
			createWriteClient,
			managerAddress: primaryVault.managerAddress,
			memoryClient,
			profile,
			readClient,
			securityPoolAddress: poolResult.securityPoolAddress,
		})
		await reportStep(`Configuring seeded security vault ${index + 2} of ${poolSpec.vaultAccounts.length} for ${poolSpec.poolLabel}`)
	}

	await validateSeededSecurityPool({
		expectedVaultAccounts: poolSpec.vaultAccounts,
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
			vaultAccounts: [primaryAccount],
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
	const seededPools = [
		{
			poolLabel: 'securitypoolx2 pool 1',
			questionTitle: 'Will this resolve? (securitypoolx2 #1)',
			vaultAccounts: [primaryAccount, secondaryAccount],
		},
		{
			poolLabel: 'securitypoolx2 pool 2',
			questionTitle: 'Will this resolve? (securitypoolx2 #2)',
			vaultAccounts: [primaryAccount, secondaryAccount],
		},
	] as const

	const preparedPools = []

	for (const seededPool of seededPools) {
		const poolResult = await createSeededSecurityPool({
			createWriteClient,
			currentTimestamp,
			deployerAccount: primaryAccount,
			questionTitle: seededPool.questionTitle,
		})
		await reportStep(`Creating seeded market for ${seededPool.poolLabel}`)
		await reportStep(`Deploying seeded security pool for ${seededPool.poolLabel}`)

		for (const [index, vaultAccount] of seededPool.vaultAccounts.entries()) {
			const writeClient = createWriteClient(vaultAccount)
			await approveErc20(writeClient, profile.genesisRepTokenAddress, poolResult.securityPoolAddress, SECURITY_POOL_REP_DEPOSIT, 'approveRep')
			await depositRepToSecurityPool(writeClient, poolResult.securityPoolAddress, SECURITY_POOL_REP_DEPOSIT)
			const seededVault = await loadRequiredSecurityVault(readClient, poolResult.securityPoolAddress, vaultAccount, vaultAccount)
			if (seededVault.repDepositShare !== SECURITY_POOL_REP_DEPOSIT) {
				throw new Error(`Expected seeded REP deposit for ${vaultAccount} in ${seededPool.poolLabel}, got ${seededVault.repDepositShare.toString()}`)
			}
			await reportStep(`Funding seeded security vault ${index + 1} of ${seededPool.vaultAccounts.length} for ${seededPool.poolLabel}`)
		}

		const primaryVault = await loadRequiredSecurityVault(readClient, poolResult.securityPoolAddress, primaryAccount, primaryAccount)
		const seededOracleReport = await settleSeededOracleReport({
			accountAddress: primaryAccount,
			createWriteClient,
			managerAddress: primaryVault.managerAddress,
			onProgressStep: reportStep,
			poolLabel: seededPool.poolLabel,
			profile,
			readClient,
		})

		preparedPools.push({
			managerAddress: primaryVault.managerAddress,
			openOracleAddress: seededOracleReport.openOracleAddress,
			poolLabel: seededPool.poolLabel,
			pendingReportId: seededOracleReport.pendingReportId,
			securityPoolAddress: poolResult.securityPoolAddress,
			vaultAccounts: seededPool.vaultAccounts,
		})
	}

	await advanceSimulationTime(memoryClient, DAY_IN_SECONDS)

	for (const preparedPool of preparedPools) {
		await settleOracleReport(createWriteClient(primaryAccount), preparedPool.openOracleAddress, preparedPool.pendingReportId)
		await reportStep(`Settling seeded oracle report for ${preparedPool.poolLabel}`)

		const seededReport = await loadOpenOracleReportDetails(readClient, preparedPool.openOracleAddress, preparedPool.pendingReportId)
		if (!seededReport.isDistributed) {
			throw new Error(`Expected the seeded oracle report to be settled for ${preparedPool.poolLabel}`)
		}

		const primaryVaultAfterSettlement = await loadRequiredSecurityVault(readClient, preparedPool.securityPoolAddress, primaryAccount, primaryAccount)
		if (primaryVaultAfterSettlement.securityBondAllowance !== SECURITY_BOND_ALLOWANCE) {
			throw new Error(`Expected seeded security bond allowance for ${primaryAccount}`)
		}
	}

	for (const preparedPool of preparedPools) {
		await configureSecurityBondAllowance({
			accountAddress: secondaryAccount,
			createWriteClient,
			managerAddress: preparedPool.managerAddress,
			memoryClient,
			profile,
			readClient,
			securityPoolAddress: preparedPool.securityPoolAddress,
		})
		await reportStep(`Configuring seeded security vault 2 of 2 for ${preparedPool.poolLabel}`)

		await validateSeededSecurityPool({
			expectedVaultAccounts: preparedPool.vaultAccounts,
			poolLabel: preparedPool.poolLabel,
			readClient,
			securityPoolAddress: preparedPool.securityPoolAddress,
		})
	}

	await reportStep('Seeded securitypoolx2 scenario is ready')
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
		accounts,
		createReadClient,
		createWriteClient,
		memoryClient,
		onProgress,
		profile,
		scenario,
	})
	await reportBootstrapProgress(onProgress, 'Saving simulation snapshot', 0.99)
	onBaselineState(await memoryClient.tevmDumpState())
	await reportBootstrapProgress(onProgress, 'Simulation scenario ready', 1)
}
