import { getSeededVaultDepositTargetFactorBps } from './seededVaultTarget.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { getStatoblastScenarioProtocol as getScenarioProtocol } from './statoblastScenarioProtocol.js'
import { createRangeProgressReporter, deploySimulationAppContracts, reportBootstrapProgress, requireQaAccount, type BootstrapScenarioApplyParameters } from '@zoltar/ui-core-shared/simulation/bootstrap.js'
import { getTruthAuctionPriceAtTick, getTruthAuctionTickAtPrice } from '../protocol/truthAuctionMath.js'
import { TRUTH_AUCTION_TIME_LENGTH } from '../protocol/truthAuctionTiming.js'
import { FORK_MIGRATION_DURATION_SECONDS } from '../protocol/forkMigrationTiming.js'
import { advanceSimulationTime, getSimulationChainTimestamp } from '@zoltar/ui-core-shared/simulation/clock.js'
import type { ReadClient } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import type { ListedSecurityPool } from '../types/contracts.js'
import {
	CAPACITY_OWNERSHIP_ATTO_REP,
	DAY_IN_SECONDS,
	SECURITY_POOL_REP_DEPOSIT,
	STATOBLAST_SECURITY_MULTIPLIER_BPS,
	createSeededSecurityPool,
	loadRequiredSecurityVault,
	refreshSeededOraclePrice,
	seedSecurityPool,
	settleOracleReportIfNeeded,
	settleSeededOracleReport,
	validateSeededSecurityPool,
	type ScenarioSeedParameters,
	type SeededVaultSpec,
} from './statoblastScenarioSeeding.js'
import { seedEndedPoolCommitmentScenario, seedEscalationInProgressScenario, seedLiquidationDistanceScenario, seedNearMinimumVaultScenario } from './statoblastWorkflowScenarios.js'
import { STATOBLAST_SCENARIOS, type StatoblastScenario } from './statoblastScenarioDescriptions.js'

export { STATOBLAST_SCENARIOS, getStatoblastScenarioLabel, getStatoblastScenarioDescription } from './statoblastScenarioDescriptions.js'

const SECURITY_POOL_X2_FIRST_QUESTION_TITLE = 'Will this resolve? (securitypoolx2 #1)'
const SECURITY_POOL_X2_PRIMARY_REP_DEPOSIT = 12_000n * 10n ** 18n
const SECURITY_POOL_X2_PRIMARY_CAPACITY_OWNERSHIP_ATTO_REP = 40n * 10n ** 18n
const SECURITY_POOL_X2_SECONDARY_REP_DEPOSIT = SECURITY_POOL_REP_DEPOSIT
const SECURITY_POOL_X2_SECONDARY_CAPACITY_OWNERSHIP_ATTO_REP = 40n * 10n ** 18n
const SECURITY_POOL_X2_AUCTION_EXTRA_REP_DEPOSIT = 2_000_000n * 10n ** 18n
const SECURITY_POOL_X2_AUCTION_UNMIGRATED_REP_DEPOSIT = 1_000n * 10n ** 18n
const SECURITY_POOL_X2_AUCTION_BID_PRICES = [getTruthAuctionPriceAtTick(12n), getTruthAuctionPriceAtTick(10n), getTruthAuctionPriceAtTick(8n)] as const
const SECURITY_POOL_X2_AUCTION_BID_AMOUNTS = [3n * 10n ** 18n, 4n * 10n ** 18n, 5n * 10n ** 18n, 6n * 10n ** 18n, 3n * 10n ** 18n, 4n * 10n ** 18n, 5n * 10n ** 18n, 3n * 10n ** 18n, 4n * 10n ** 18n, 5n * 10n ** 18n] as const

async function seedSecurityPoolScenario({ accounts, createReadClient, createWriteClient, memoryClient, onProgress, profile }: ScenarioSeedParameters) {
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
					vaultRepBackingDepositAttoRep: SECURITY_POOL_REP_DEPOSIT,
					underwritingLimitAttoEth: CAPACITY_OWNERSHIP_ATTO_REP,
				},
			],
		},
		profile,
		seedTimestamp: currentTimestamp,
	})
}

async function seedSecurityPoolX2Scenario({ accounts, createReadClient, createWriteClient, memoryClient, onProgress, profile }: ScenarioSeedParameters) {
	const primaryAccount = requireQaAccount(accounts[0], 'Expected simulation QA account A1 for securitypoolx2')
	const secondaryAccount = requireQaAccount(accounts[1], 'Expected simulation QA account B2 for securitypoolx2')
	const currentTimestamp = await getSimulationChainTimestamp(memoryClient)
	const readClient = createReadClient()
	const reportStep = createRangeProgressReporter(onProgress, { start: 0.72, end: 0.98 }, 17)
	const seededVaults = [
		{
			accountAddress: primaryAccount,
			vaultRepBackingDepositAttoRep: SECURITY_POOL_X2_PRIMARY_REP_DEPOSIT,
			underwritingLimitAttoEth: SECURITY_POOL_X2_PRIMARY_CAPACITY_OWNERSHIP_ATTO_REP,
		},
		{
			accountAddress: secondaryAccount,
			vaultRepBackingDepositAttoRep: SECURITY_POOL_X2_SECONDARY_REP_DEPOSIT,
			underwritingLimitAttoEth: SECURITY_POOL_X2_SECONDARY_CAPACITY_OWNERSHIP_ATTO_REP,
		},
	] as const
	const seededPools = [
		{
			poolLabel: 'securitypoolx2 pool 1',
			questionTitle: SECURITY_POOL_X2_FIRST_QUESTION_TITLE,
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
		await reportStep(`Creating seeded question for ${seededPool.poolLabel}`)
		await reportStep(`Deploying seeded security pool for ${seededPool.poolLabel}`)

		for (const [index, vaultSpec] of seededPool.vaults.entries()) {
			const writeClient = createWriteClient(vaultSpec.accountAddress)
			await getScenarioProtocol().approveErc20(writeClient, profile.genesisRepTokenAddress, poolResult.securityPoolAddress, vaultSpec.vaultRepBackingDepositAttoRep, 'approveRep')
			await getScenarioProtocol().depositRepToVaultToSecurityPool(writeClient, poolResult.securityPoolAddress, vaultSpec.vaultRepBackingDepositAttoRep, getSeededVaultDepositTargetFactorBps(vaultSpec, STATOBLAST_SECURITY_MULTIPLIER_BPS))
			const seededVault = await loadRequiredSecurityVault(readClient, poolResult.securityPoolAddress, vaultSpec.accountAddress, vaultSpec.accountAddress)
			if (seededVault.vaultAttoRepBacking !== vaultSpec.vaultRepBackingDepositAttoRep) throw new Error(`Expected seeded REP deposit for ${vaultSpec.accountAddress} in ${seededPool.poolLabel}, got ${seededVault.vaultAttoRepBacking.toString()}`)
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

		const seededReport = await getScenarioProtocol().loadOpenOracleReportDetails(readClient, preparedPool.openOracleAddress, preparedPool.pendingReportId)
		if (!seededReport.isDistributed) throw new Error(`Expected the seeded oracle report to be settled for ${preparedPool.poolLabel}`)

		for (const vault of preparedPool.vaults) await getScenarioProtocol().setUnderwritingLimit(createWriteClient(vault.accountAddress), preparedPool.securityPoolAddress, vault.underwritingLimitAttoEth)

		const primaryVaultAfterSettlement = await loadRequiredSecurityVault(readClient, preparedPool.securityPoolAddress, primaryAccount, primaryAccount)
		if (primaryVaultAfterSettlement.underwritingLimitAttoEth !== preparedPool.primaryVault.underwritingLimitAttoEth) {
			throw new Error(`Expected seeded underwriting commitments ${preparedPool.primaryVault.underwritingLimitAttoEth.toString()} for ${primaryAccount}`)
		}
	}

	for (const preparedPool of preparedPools) {
		const secondaryVault = preparedPool.vaults[1]
		if (secondaryVault === undefined) throw new Error(`Expected a secondary seeded vault for ${preparedPool.poolLabel}`)
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
	const childPool = (await getScenarioProtocol().loadAllSecurityPools(readClient)).find(pool => pool.parent === parentSecurityPoolAddress && pool.questionOutcome === questionOutcome)
	if (childPool === undefined) throw new Error(`Expected a ${questionOutcome} child pool for ${parentSecurityPoolAddress}`)
	return childPool
}

/**
 * Forks the pool's universe the way a reporter would: let the question end, refresh the oracle price, open and
 * counter the pool's own escalation game with fork-threshold deposits, fork Zoltar with that game, then create and
 * fund the Yes child universe so at least one fork branch has a canonical child pool.
 */
export async function forkSecurityPoolUniverseWithOwnEscalation({
	accountAddress,
	createWriteClient,
	memoryClient,
	onProgress,
	parentPool,
	profile,
	readClient,
}: Pick<ScenarioSeedParameters, 'createWriteClient' | 'memoryClient' | 'onProgress' | 'profile'> & {
	accountAddress: Address
	parentPool: Pick<ListedSecurityPool, 'managerAddress' | 'securityPoolAddress' | 'universeId'>
	readClient: ReadClient
}) {
	const writeClient = createWriteClient(accountAddress)
	const universeSummary = await getScenarioProtocol().loadZoltarUniverseSummary(readClient, parentPool.universeId)
	if (universeSummary === undefined) throw new Error(`Expected a Zoltar universe summary for parent pool ${parentPool.securityPoolAddress}`)
	const reportingDetailsBeforeFork = await getScenarioProtocol().loadReportingDetails(readClient, parentPool.securityPoolAddress, accountAddress)
	if (reportingDetailsBeforeFork.marketDetails.endTime >= reportingDetailsBeforeFork.currentTime) {
		await advanceSimulationTime(memoryClient, reportingDetailsBeforeFork.marketDetails.endTime - reportingDetailsBeforeFork.currentTime + DAY_IN_SECONDS)
	}

	const ownForkDepositAmount = (universeSummary.forkThresholdAttoRep * 10_000n) / STATOBLAST_SECURITY_MULTIPLIER_BPS
	await refreshSeededOraclePrice({
		accountAddress,
		createWriteClient,
		managerAddress: parentPool.managerAddress,
		memoryClient,
		readClient,
	})
	await reportBootstrapProgress(onProgress, 'Triggering own-escalation fork', 0.988)
	await getScenarioProtocol().approveErc20(writeClient, profile.genesisRepTokenAddress, parentPool.securityPoolAddress, ownForkDepositAmount, 'approveRep')
	await getScenarioProtocol().reportOutcomeInSecurityPool(writeClient, parentPool.securityPoolAddress, 'yes', ownForkDepositAmount)
	const activeReportingDetails = await getScenarioProtocol().loadReportingDetails(readClient, parentPool.securityPoolAddress, accountAddress)
	if (activeReportingDetails.status !== 'active') throw new Error('Expected the seeded ordinary escalation game to be active')
	await getScenarioProtocol().approveErc20(writeClient, profile.genesisRepTokenAddress, parentPool.securityPoolAddress, ownForkDepositAmount, 'approveRep')
	await getScenarioProtocol().reportOutcomeInSecurityPool(writeClient, parentPool.securityPoolAddress, 'no', ownForkDepositAmount)
	await getScenarioProtocol().forkZoltarWithOwnEscalation(writeClient, parentPool.securityPoolAddress, parentPool.universeId)

	await reportBootstrapProgress(onProgress, 'Creating and funding Yes child universe', 0.99)
	await getScenarioProtocol().createChildUniverseFromSecurityPool(writeClient, parentPool.securityPoolAddress, parentPool.universeId, 'yes')
	await getScenarioProtocol().migrateRepToZoltarFromSecurityPool(writeClient, parentPool.securityPoolAddress, parentPool.universeId, ['yes'])
}

/** Returns the Yes child pool holding the seeded truth auction, with its universe id, so follow-up scenarios can build on it. */
async function seedSecurityPoolX2AuctionScenario(parameters: ScenarioSeedParameters, readyLabel: string) {
	const { accounts, createReadClient, createWriteClient, memoryClient, onProgress, profile } = parameters
	await seedSecurityPoolX2Scenario(parameters)

	const primaryAccount = requireQaAccount(accounts[0], 'Expected simulation QA account A1 for securitypoolx2-auction')
	const secondaryAccount = requireQaAccount(accounts[1], 'Expected simulation QA account B2 for securitypoolx2-auction')
	const readClient = createReadClient()
	const writeClient = createWriteClient(primaryAccount)
	const x2Pools = await getScenarioProtocol().loadAllSecurityPools(readClient)
	const parentPool = x2Pools.find(pool => pool.marketDetails.title === SECURITY_POOL_X2_FIRST_QUESTION_TITLE)
	if (parentPool === undefined) throw new Error('Expected the first securitypoolx2 parent pool for auction scenario seeding')

	await reportBootstrapProgress(onProgress, 'Preparing fork-auction seed pool', 0.985)
	await getScenarioProtocol().approveErc20(writeClient, profile.genesisRepTokenAddress, parentPool.securityPoolAddress, SECURITY_POOL_X2_AUCTION_EXTRA_REP_DEPOSIT, 'approveRep')
	await getScenarioProtocol().depositRepToVaultToSecurityPool(writeClient, parentPool.securityPoolAddress, SECURITY_POOL_X2_AUCTION_EXTRA_REP_DEPOSIT, STATOBLAST_SECURITY_MULTIPLIER_BPS)
	const secondaryWriteClient = createWriteClient(secondaryAccount)
	await getScenarioProtocol().approveErc20(secondaryWriteClient, profile.genesisRepTokenAddress, parentPool.securityPoolAddress, SECURITY_POOL_X2_AUCTION_UNMIGRATED_REP_DEPOSIT, 'approveRep')
	await getScenarioProtocol().depositRepToVaultToSecurityPool(secondaryWriteClient, parentPool.securityPoolAddress, SECURITY_POOL_X2_AUCTION_UNMIGRATED_REP_DEPOSIT, STATOBLAST_SECURITY_MULTIPLIER_BPS)
	await getScenarioProtocol().createCompleteSetInSecurityPool(createWriteClient(secondaryAccount), parentPool.securityPoolAddress, 20n * 10n ** 18n)

	await forkSecurityPoolUniverseWithOwnEscalation({
		accountAddress: primaryAccount,
		createWriteClient,
		memoryClient,
		onProgress,
		parentPool,
		profile,
		readClient,
	})
	await advanceSimulationTime(memoryClient, FORK_MIGRATION_DURATION_SECONDS + DAY_IN_SECONDS)

	const yesChildPool = await loadRequiredChildSecurityPool(readClient, parentPool.securityPoolAddress, 'yes')
	const yesForkDetailsBeforeAuction = await getScenarioProtocol().loadForkAuctionDetails(readClient, yesChildPool.securityPoolAddress)
	await reportBootstrapProgress(onProgress, 'Starting seeded truth auction', 0.992)
	await getScenarioProtocol().startTruthAuctionForSecurityPool(writeClient, yesChildPool.securityPoolAddress, yesForkDetailsBeforeAuction.universeId)

	const yesForkDetails = await getScenarioProtocol().loadForkAuctionDetails(readClient, yesChildPool.securityPoolAddress)
	if (yesForkDetails.truthAuctionAddress === undefined || yesForkDetails.truthAuctionAddress === '0x0000000000000000000000000000000000000000') {
		throw new Error('Expected a seeded truth auction address for the Yes child pool')
	}
	const seededAuction = { universeId: yesForkDetails.universeId, yesChildPool }
	if (yesForkDetails.truthAuction?.finalized) {
		await reportBootstrapProgress(onProgress, readyLabel, 0.995)
		return seededAuction
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
		await getScenarioProtocol().submitTruthAuctionBid(createWriteClient(bidderAccount), yesChildPool.securityPoolAddress, yesForkDetails.universeId, yesForkDetails.truthAuctionAddress, bidTick, bidAmount)
	}

	await reportBootstrapProgress(onProgress, readyLabel, 0.995)
	return seededAuction
}

/** The securitypoolx2-auction setup with the Yes child's truth auction run past its end and finalized. */
async function seedFinalizedTruthAuctionScenario(parameters: ScenarioSeedParameters) {
	const { accounts, createReadClient, createWriteClient, memoryClient, onProgress } = parameters
	const { universeId, yesChildPool } = await seedSecurityPoolX2AuctionScenario(parameters, 'Seeded the Yes child truth auction')
	const primaryAccount = requireQaAccount(accounts[0], 'Expected simulation QA account A1 for finalized-truth-auction')
	const readClient = createReadClient()

	await reportBootstrapProgress(onProgress, 'Ending the seeded truth auction', 0.996)
	await advanceSimulationTime(memoryClient, TRUTH_AUCTION_TIME_LENGTH + DAY_IN_SECONDS)
	await getScenarioProtocol().finalizeSecurityPoolTruthAuction(createWriteClient(primaryAccount), yesChildPool.securityPoolAddress, universeId)
	const finalizedDetails = await getScenarioProtocol().loadForkAuctionDetails(readClient, yesChildPool.securityPoolAddress)
	if (finalizedDetails.truthAuction?.finalized !== true) throw new Error('Expected the seeded truth auction to be finalized')
	await reportBootstrapProgress(onProgress, 'Seeded finalized-truth-auction scenario is ready', 0.998)
}

// Every scenario deploys the app contracts from 0.32 to `deployEnd` on the progress bar, then seeds from there.
const STATOBLAST_SCENARIO_SEEDING: Record<StatoblastScenario, { deployEnd: number; seed: (parameters: ScenarioSeedParameters) => Promise<unknown> }> = {
	'security-pool': { deployEnd: 0.78, seed: seedSecurityPoolScenario },
	securitypoolx2: { deployEnd: 0.7, seed: seedSecurityPoolX2Scenario },
	'securitypoolx2-auction': { deployEnd: 0.7, seed: parameters => seedSecurityPoolX2AuctionScenario(parameters, 'Seeded securitypoolx2-auction scenario is ready') },
	'finalized-truth-auction': { deployEnd: 0.7, seed: seedFinalizedTruthAuctionScenario },
	'ended-pool-commitment': { deployEnd: 0.78, seed: seedEndedPoolCommitmentScenario },
	'escalation-in-progress': { deployEnd: 0.78, seed: seedEscalationInProgressScenario },
	'liquidation-distance': { deployEnd: 0.78, seed: seedLiquidationDistanceScenario },
	'near-minimum-vault': { deployEnd: 0.78, seed: seedNearMinimumVaultScenario },
}

function isStatoblastScenario(scenario: string): scenario is StatoblastScenario {
	return STATOBLAST_SCENARIOS.some(candidate => candidate === scenario)
}

export async function applyStatoblastScenario({ scenario, ...parameters }: BootstrapScenarioApplyParameters): Promise<boolean> {
	const primaryAccount = requireQaAccount(parameters.accounts[0], 'Expected seeded simulation QA account A1')
	if (!isStatoblastScenario(scenario)) return false

	const { deployEnd, seed } = STATOBLAST_SCENARIO_SEEDING[scenario]
	await deploySimulationAppContracts(parameters.createWriteClient(primaryAccount), parameters.memoryClient, parameters.onProgress, parameters.profile, { start: 0.32, end: deployEnd }, getScenarioProtocol().getDeploymentSteps)
	await seed(parameters)
	return true
}
