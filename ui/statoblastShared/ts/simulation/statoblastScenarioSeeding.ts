import { getSeededVaultDepositTargetFactorBps } from './seededVaultTarget.js'
import { zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS } from '@zoltar/statoblast-shared/initialReport/oracleInitialReport'
import { getStatoblastScenarioProtocol as getScenarioProtocol } from './statoblastScenarioProtocol.js'
import { createRangeProgressReporter, type ProgressRange, type BootstrapScenarioApplyParameters, type TevmLikeClient } from '@zoltar/ui-core-shared/simulation/bootstrap.js'
import { advanceSimulationTime, getSimulationChainTimestamp } from '@zoltar/ui-core-shared/simulation/clock.js'
import type { ReadClient, WriteClient } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import type { QuestionData } from '@zoltar/ui-core-shared/types/contracts.js'

export const DAY_IN_SECONDS = 24n * 60n * 60n
const SEEDED_REP_ETH_PRICE = 3n * 10n ** 18n
export const STATOBLAST_SECURITY_MULTIPLIER_BPS = 20_000n
export const SECURITY_POOL_REP_DEPOSIT = 10_000n * 10n ** 18n
export const CAPACITY_OWNERSHIP_ATTO_REP = 80n * 10n ** 18n

function getSeededCoordinatorInitialReportPrice() {
	return SEEDED_REP_ETH_PRICE
}

export type ScenarioSeedParameters = Omit<BootstrapScenarioApplyParameters, 'scenario'>

export type SeededVaultSpec = {
	accountAddress: Address
	vaultRepBackingDepositAttoRep: bigint
	underwritingLimitAttoEth: bigint
}

type SeededSecurityPoolSpec = {
	poolLabel: string
	progressRange: ProgressRange
	questionTitle: string
	readyLabel: string
	vaults: readonly SeededVaultSpec[]
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
	const seededPool = (await getScenarioProtocol().loadAllSecurityPools(readClient)).find(pool => pool.securityPoolAddress === securityPoolAddress)
	if (seededPool === undefined) throw new Error(`Expected ${poolLabel} at ${securityPoolAddress}`)
	return seededPool
}

export async function loadRequiredSecurityVault(readClient: ReadClient, securityPoolAddress: Address, vaultAddress: Address, label: string) {
	const vaultDetails = await getScenarioProtocol().loadSecurityVaultDetails(readClient, securityPoolAddress, vaultAddress)
	if (vaultDetails === undefined) throw new Error(`Expected seeded security vault details for ${label}`)
	return vaultDetails
}

export async function createSeededSecurityPool({ createWriteClient, currentTimestamp, deployerAccount, questionTitle }: { createWriteClient: (accountAddress: Address) => WriteClient; currentTimestamp: bigint; deployerAccount: Address; questionTitle: string }) {
	const deployerWriteClient = createWriteClient(deployerAccount)
	const marketResult = await getScenarioProtocol().createMarket(deployerWriteClient, createSecurityPoolSeedParameters(currentTimestamp, questionTitle))
	const questionId = BigInt(marketResult.questionId)
	const poolResult = await getScenarioProtocol().createSecurityPool(deployerWriteClient, {
		initialReportPriorityFeeAttoEthPerGas: DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS,
		questionId,
		statoblastSecurityMultiplierBps: STATOBLAST_SECURITY_MULTIPLIER_BPS,
	})

	return {
		questionId,
		securityPoolAddress: poolResult.securityPoolAddress,
	}
}

export async function validateSeededSecurityPool({ expectedVaults, poolLabel, readClient, securityPoolAddress }: { expectedVaults: readonly SeededVaultSpec[]; poolLabel: string; readClient: ReadClient; securityPoolAddress: Address }) {
	const seededPool = await loadRequiredSeededPool(readClient, securityPoolAddress, poolLabel)
	const expectedVaultCount = BigInt(expectedVaults.length)
	let expectedRepDeposit = 0n
	let expectedUnderwritingLimitAttoEth = 0n

	for (const expectedVault of expectedVaults) {
		expectedRepDeposit += expectedVault.vaultRepBackingDepositAttoRep
		expectedUnderwritingLimitAttoEth += expectedVault.underwritingLimitAttoEth
	}

	if (seededPool.vaultCount !== expectedVaultCount) throw new Error(`Expected ${poolLabel} to have ${expectedVaultCount.toString()} seeded vaults`)
	if (seededPool.totalPoolHeldAttoRep !== expectedRepDeposit) throw new Error(`Expected ${poolLabel} to have ${expectedRepDeposit.toString()} seeded REP`)
	if (seededPool.totalUnderwritingLimitAttoEth !== expectedUnderwritingLimitAttoEth) throw new Error(`Expected ${poolLabel} to have ${expectedUnderwritingLimitAttoEth.toString()} seeded underwriting commitments`)

	for (const expectedVault of expectedVaults) {
		const vault = seededPool.vaults.find(candidate => candidate.vaultAddress === expectedVault.accountAddress)
		if (vault === undefined) throw new Error(`Expected ${poolLabel} to include seeded vault ${expectedVault.accountAddress}`)
		if (vault.vaultAttoRepBacking !== expectedVault.vaultRepBackingDepositAttoRep) throw new Error(`Expected ${poolLabel} vault ${expectedVault.accountAddress} to hold ${expectedVault.vaultRepBackingDepositAttoRep.toString()} seeded REP`)
		if (vault.underwritingLimitAttoEth !== expectedVault.underwritingLimitAttoEth) throw new Error(`Expected ${poolLabel} vault ${expectedVault.accountAddress} to hold ${expectedVault.underwritingLimitAttoEth.toString()} seeded underwriting commitments`)
	}
}

export async function settleSeededOracleReport({
	accountAddress,
	createWriteClient,
	managerAddress,
	onProgressStep,
	poolLabel,
	readClient,
}: {
	accountAddress: Address
	createWriteClient: (accountAddress: Address) => WriteClient
	managerAddress: Address
	onProgressStep: (label: string) => Promise<void>
	poolLabel: string
	readClient: ReadClient
}) {
	const writeClient = createWriteClient(accountAddress)
	const initialReportPrice = getSeededCoordinatorInitialReportPrice()
	await getScenarioProtocol().requestOraclePrice(writeClient, managerAddress, initialReportPrice)
	await onProgressStep(`Configuring oracle manager for ${poolLabel}`)

	const oracleManagerDetails = await getScenarioProtocol().loadOracleManagerDetails(readClient, managerAddress)
	if (oracleManagerDetails.pendingReportId === 0n) throw new Error(`Expected a pending oracle report for ${poolLabel}`)
	await onProgressStep(`Opening seeded oracle report for ${poolLabel}`)

	return {
		openOracleAddress: oracleManagerDetails.openOracleAddress,
		pendingReportId: oracleManagerDetails.pendingReportId,
	}
}

export async function settleOracleReportIfNeeded({ memoryClient, readClient, writeClient, openOracleAddress, pendingReportId }: { memoryClient: TevmLikeClient; readClient: ReadClient; writeClient: WriteClient; openOracleAddress: Address; pendingReportId: bigint }) {
	const seededReport = await getScenarioProtocol().loadOpenOracleReportDetails(readClient, openOracleAddress, pendingReportId)
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
	await getScenarioProtocol().settleOracleReport(writeClient, openOracleAddress, pendingReportId)
}

export async function refreshSeededOraclePrice({ accountAddress, createWriteClient, managerAddress, memoryClient, readClient }: { accountAddress: Address; createWriteClient: (accountAddress: Address) => WriteClient; managerAddress: Address; memoryClient: TevmLikeClient; readClient: ReadClient }) {
	const writeClient = createWriteClient(accountAddress)
	let managerDetails = await getScenarioProtocol().loadOracleManagerDetails(readClient, managerAddress)
	if (managerDetails.isPriceValid) return
	if (managerDetails.pendingReportId === 0n) {
		const initialReportPrice = getSeededCoordinatorInitialReportPrice()
		await getScenarioProtocol().requestOraclePrice(writeClient, managerAddress, initialReportPrice)
		managerDetails = await getScenarioProtocol().loadOracleManagerDetails(readClient, managerAddress)
	}
	if (managerDetails.pendingReportId === 0n) {
		throw new Error(`Expected a pending oracle report for ${managerAddress}`)
	}
	const reportDetails = await getScenarioProtocol().loadOpenOracleReportDetails(readClient, managerDetails.openOracleAddress, managerDetails.pendingReportId)
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
	const refreshedManagerDetails = await getScenarioProtocol().loadOracleManagerDetails(readClient, managerAddress)
	if (!refreshedManagerDetails.isPriceValid) throw new Error(`Expected a valid seeded oracle price for ${managerAddress}`)
}

function getSimulationReportTiming(value: unknown) {
	if (typeof value === 'bigint') return value
	if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value)
	return undefined
}

export async function seedSecurityPool({
	createReadClient,
	createWriteClient,
	memoryClient,
	onProgress,
	poolSpec,
	profile,
	seedTimestamp,
}: Omit<ScenarioSeedParameters, 'accounts'> & {
	poolSpec: SeededSecurityPoolSpec
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
	await reportStep(`Creating seeded question for ${poolSpec.poolLabel}`)
	await reportStep(`Deploying seeded security pool for ${poolSpec.poolLabel}`)

	for (const [index, vaultSpec] of poolSpec.vaults.entries()) {
		const writeClient = createWriteClient(vaultSpec.accountAddress)
		await getScenarioProtocol().approveErc20(writeClient, profile.genesisRepTokenAddress, poolResult.securityPoolAddress, vaultSpec.vaultRepBackingDepositAttoRep, 'approveRep')
		await getScenarioProtocol().depositRepToVaultToSecurityPool(writeClient, poolResult.securityPoolAddress, vaultSpec.vaultRepBackingDepositAttoRep, getSeededVaultDepositTargetFactorBps(vaultSpec, STATOBLAST_SECURITY_MULTIPLIER_BPS))
		const seededVault = await loadRequiredSecurityVault(readClient, poolResult.securityPoolAddress, vaultSpec.accountAddress, vaultSpec.accountAddress)
		if (seededVault.vaultAttoRepBacking !== vaultSpec.vaultRepBackingDepositAttoRep) throw new Error(`Expected seeded REP deposit for ${vaultSpec.accountAddress} in ${poolSpec.poolLabel}, got ${seededVault.vaultAttoRepBacking.toString()}`)
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
	})
	await settleOracleReportIfNeeded({
		memoryClient,
		openOracleAddress: seededOracleReport.openOracleAddress,
		pendingReportId: seededOracleReport.pendingReportId,
		readClient,
		writeClient: createWriteClient(primaryVaultAccount),
	})
	await reportStep(`Settling seeded oracle report for ${poolSpec.poolLabel}`)

	const seededReport = await getScenarioProtocol().loadOpenOracleReportDetails(readClient, seededOracleReport.openOracleAddress, seededOracleReport.pendingReportId)
	if (!seededReport.isDistributed) throw new Error(`Expected the seeded oracle report to be settled for ${poolSpec.poolLabel}`)

	for (const vault of poolSpec.vaults) await getScenarioProtocol().setUnderwritingLimit(createWriteClient(vault.accountAddress), poolResult.securityPoolAddress, vault.underwritingLimitAttoEth)

	const primaryVaultAfterSettlement = await loadRequiredSecurityVault(readClient, poolResult.securityPoolAddress, primaryVaultAccount, primaryVaultAccount)
	if (primaryVaultAfterSettlement.underwritingLimitAttoEth !== primaryVaultSpec.underwritingLimitAttoEth) {
		throw new Error(`Expected seeded underwriting commitments ${primaryVaultSpec.underwritingLimitAttoEth.toString()} for ${primaryVaultAccount}`)
	}

	for (const index of additionalVaults.keys()) {
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
