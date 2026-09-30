import { requireQaAccount, reportBootstrapProgress } from '@zoltar/ui-core-shared/simulation/bootstrap.js'
import { advanceSimulationTime, getSimulationChainTimestamp } from '@zoltar/ui-core-shared/simulation/clock.js'
import type { ReadClient } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { getStatoblastScenarioProtocol as getScenarioProtocol } from './statoblastScenarioProtocol.js'
import { CAPACITY_OWNERSHIP_ATTO_REP, DAY_IN_SECONDS, SECURITY_POOL_REP_DEPOSIT, loadRequiredSecurityVault, seedSecurityPool, settleOracleReportIfNeeded, type ScenarioSeedParameters } from './statoblastScenarioSeeding.js'

const ENDED_POOL_COMMITMENT_QUESTION_TITLE = 'Will this resolve? (ended pool)'
const LIQUIDATION_DISTANCE_QUESTION_TITLE = 'Will this resolve? (liquidation distance)'
const ORACLE_PRICE_VALIDITY_SECONDS = 5n * 60n
const LIQUIDATION_DISTANCE_TARGET_REP_DEPOSIT = 1_000n * 10n ** 18n
// At the seeded 3 REP/ETH price both targets are healthy. At the repriced 4 REP/ETH price both are
// undercollateralized: the near target's 3.906 REP/ETH threshold is only 2.3% below the price, inside
// the 10% minimum liquidation distance, while the far target's 3.125 REP/ETH threshold is 21.9% below it.
const LIQUIDATION_DISTANCE_NEAR_TARGET_COMMITMENT_ATTO_ETH = 128n * 10n ** 18n
const LIQUIDATION_DISTANCE_FAR_TARGET_COMMITMENT_ATTO_ETH = 160n * 10n ** 18n
const LIQUIDATION_DISTANCE_REPRICED_REP_ETH_PRICE = 4n * 10n ** 18n
async function loadRequiredSeededPoolByTitle(readClient: ReadClient, questionTitle: string) {
	const seededPool = (await getScenarioProtocol().loadAllSecurityPools(readClient)).find(pool => pool.marketDetails.title === questionTitle)
	if (seededPool === undefined) throw new Error(`Expected a seeded security pool for ${questionTitle}`)
	return seededPool
}

export async function seedEndedPoolCommitmentScenario({ accounts, createReadClient, createWriteClient, memoryClient, onProgress, profile }: ScenarioSeedParameters) {
	const primaryAccount = requireQaAccount(accounts[0], 'Expected simulation QA account A1 for ended-pool-commitment')
	const reporterAccount = requireQaAccount(accounts[1], 'Expected simulation QA account B2 for ended-pool-commitment')
	const readClient = createReadClient()
	await seedSecurityPool({
		createReadClient,
		createWriteClient,
		memoryClient,
		onProgress,
		poolSpec: {
			poolLabel: 'ended-pool-commitment pool',
			progressRange: { start: 0.78, end: 0.94 },
			questionTitle: ENDED_POOL_COMMITMENT_QUESTION_TITLE,
			readyLabel: 'Seeded the committed vault',
			vaults: [{ accountAddress: primaryAccount, vaultRepBackingDepositAttoRep: SECURITY_POOL_REP_DEPOSIT, underwritingLimitAttoEth: CAPACITY_OWNERSHIP_ATTO_REP }],
		},
		profile,
		seedTimestamp: await getSimulationChainTimestamp(memoryClient),
	})
	const pool = await loadRequiredSeededPoolByTitle(readClient, ENDED_POOL_COMMITMENT_QUESTION_TITLE)

	await reportBootstrapProgress(onProgress, 'Ending the seeded question', 0.95)
	const reportingBeforeEnd = await getScenarioProtocol().loadReportingDetails(readClient, pool.securityPoolAddress, reporterAccount)
	if (reportingBeforeEnd.marketDetails.endTime >= reportingBeforeEnd.currentTime) {
		await advanceSimulationTime(memoryClient, reportingBeforeEnd.marketDetails.endTime - reportingBeforeEnd.currentTime + DAY_IN_SECONDS)
	}
	// A wallet-funded report leaves the committed vault without dispute-staked REP, so only its commitment blocks redemption.
	const reporterWriteClient = createWriteClient(reporterAccount)
	await getScenarioProtocol().approveErc20(reporterWriteClient, profile.genesisRepTokenAddress, pool.securityPoolAddress, reportingBeforeEnd.startBondAttoRep, 'approveRep')
	await getScenarioProtocol().reportOutcomeInSecurityPool(reporterWriteClient, pool.securityPoolAddress, 'yes', reportingBeforeEnd.startBondAttoRep, reportingBeforeEnd.startBondAttoRep, 'wallet')

	await reportBootstrapProgress(onProgress, 'Resolving the seeded question', 0.97)
	const activeReporting = await getScenarioProtocol().loadReportingDetails(readClient, pool.securityPoolAddress, reporterAccount)
	if (activeReporting.status !== 'active') throw new Error('Expected the ended-pool escalation game to be active')
	if (activeReporting.escalationEndTime >= activeReporting.currentTime) {
		await advanceSimulationTime(memoryClient, activeReporting.escalationEndTime - activeReporting.currentTime + DAY_IN_SECONDS)
	}

	const resolvedReporting = await getScenarioProtocol().loadReportingDetails(readClient, pool.securityPoolAddress, primaryAccount)
	if (resolvedReporting.questionOutcome !== 'yes') throw new Error(`Expected the ended-pool question to resolve Yes, got ${resolvedReporting.questionOutcome}`)
	if (resolvedReporting.systemState !== 'operational') throw new Error(`Expected the ended pool to stay operational, got ${resolvedReporting.systemState}`)
	const committedVault = await loadRequiredSecurityVault(readClient, pool.securityPoolAddress, primaryAccount, primaryAccount)
	if (committedVault.vaultAttoRepBacking !== SECURITY_POOL_REP_DEPOSIT || committedVault.underwritingLimitAttoEth !== CAPACITY_OWNERSHIP_ATTO_REP) throw new Error('Expected the ended-pool vault to keep its REP backing and commitment')
	await reportBootstrapProgress(onProgress, 'Seeded ended-pool-commitment scenario is ready', 0.98)
}

export async function seedLiquidationDistanceScenario({ accounts, createReadClient, createWriteClient, memoryClient, onProgress, profile }: ScenarioSeedParameters) {
	const receiverAccount = requireQaAccount(accounts[0], 'Expected simulation QA account A1 for liquidation-distance')
	const nearTargetAccount = requireQaAccount(accounts[1], 'Expected simulation QA account B2 for liquidation-distance')
	const farTargetAccount = requireQaAccount(accounts[2], 'Expected simulation QA account C3 for liquidation-distance')
	const readClient = createReadClient()
	await seedSecurityPool({
		createReadClient,
		createWriteClient,
		memoryClient,
		onProgress,
		poolSpec: {
			poolLabel: 'liquidation-distance pool',
			progressRange: { start: 0.78, end: 0.94 },
			questionTitle: LIQUIDATION_DISTANCE_QUESTION_TITLE,
			readyLabel: 'Seeded the liquidation targets',
			vaults: [
				{ accountAddress: receiverAccount, vaultRepBackingDepositAttoRep: SECURITY_POOL_REP_DEPOSIT, underwritingLimitAttoEth: CAPACITY_OWNERSHIP_ATTO_REP },
				{ accountAddress: nearTargetAccount, vaultRepBackingDepositAttoRep: LIQUIDATION_DISTANCE_TARGET_REP_DEPOSIT, underwritingLimitAttoEth: LIQUIDATION_DISTANCE_NEAR_TARGET_COMMITMENT_ATTO_ETH },
				{ accountAddress: farTargetAccount, vaultRepBackingDepositAttoRep: LIQUIDATION_DISTANCE_TARGET_REP_DEPOSIT, underwritingLimitAttoEth: LIQUIDATION_DISTANCE_FAR_TARGET_COMMITMENT_ATTO_ETH },
			],
		},
		profile,
		seedTimestamp: await getSimulationChainTimestamp(memoryClient),
	})
	const pool = await loadRequiredSeededPoolByTitle(readClient, LIQUIDATION_DISTANCE_QUESTION_TITLE)

	// Let the seeding price expire, then settle a fresh higher REP/ETH price last so it stays valid when the app opens.
	await reportBootstrapProgress(onProgress, 'Repricing REP for the liquidation targets', 0.95)
	await advanceSimulationTime(memoryClient, ORACLE_PRICE_VALIDITY_SECONDS + 60n)
	const receiverWriteClient = createWriteClient(receiverAccount)
	await getScenarioProtocol().requestOraclePrice(receiverWriteClient, pool.managerAddress, LIQUIDATION_DISTANCE_REPRICED_REP_ETH_PRICE)
	const managerDetails = await getScenarioProtocol().loadOracleManagerDetails(readClient, pool.managerAddress)
	if (managerDetails.pendingReportId === 0n) throw new Error('Expected a pending repricing report for the liquidation-distance pool')
	await settleOracleReportIfNeeded({ memoryClient, openOracleAddress: managerDetails.openOracleAddress, pendingReportId: managerDetails.pendingReportId, readClient, writeClient: receiverWriteClient })
	const repricedManagerDetails = await getScenarioProtocol().loadOracleManagerDetails(readClient, pool.managerAddress)
	if (!repricedManagerDetails.isPriceValid || repricedManagerDetails.lastPrice !== LIQUIDATION_DISTANCE_REPRICED_REP_ETH_PRICE) throw new Error(`Expected a valid ${LIQUIDATION_DISTANCE_REPRICED_REP_ETH_PRICE.toString()} REP/ETH price for the liquidation-distance pool`)
	await reportBootstrapProgress(onProgress, 'Seeded liquidation-distance scenario is ready', 0.98)
}
