import { requireQaAccount, reportBootstrapProgress, type TevmLikeClient } from '@zoltar/ui-core-shared/simulation/bootstrap.js'
import { advanceSimulationTime, getSimulationChainTimestamp } from '@zoltar/ui-core-shared/simulation/clock.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ReadClient, WriteClient } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { getStatoblastScenarioProtocol as getScenarioProtocol } from './statoblastScenarioProtocol.js'
import { CAPACITY_OWNERSHIP_ATTO_REP, DAY_IN_SECONDS, SECURITY_POOL_REP_DEPOSIT, loadRequiredSecurityVault, seedSecurityPool, settleOracleReportIfNeeded, type ScenarioSeedParameters, type SeededVaultSpec } from './statoblastScenarioSeeding.js'

const ENDED_POOL_COMMITMENT_QUESTION_TITLE = 'Will this resolve? (ended pool)'
const ESCALATION_IN_PROGRESS_QUESTION_TITLE = 'Will this resolve? (escalation in progress)'
const LIQUIDATION_DISTANCE_QUESTION_TITLE = 'Will this resolve? (liquidation distance)'
const NEAR_MINIMUM_VAULT_QUESTION_TITLE = 'Will this resolve? (near-minimum vault)'
const ORACLE_PRICE_VALIDITY_SECONDS = 5n * 60n
const LIQUIDATION_DISTANCE_TARGET_REP_DEPOSIT = 1_000n * 10n ** 18n
// At the seeded 3 REP/ETH price both targets are healthy. At the repriced 4 REP/ETH price both are
// undercollateralized: the near target's 3.906 REP/ETH threshold is only 2.3% below the price, inside
// the 10% minimum liquidation distance, while the far target's 3.125 REP/ETH threshold is 21.9% below it.
const LIQUIDATION_DISTANCE_NEAR_TARGET_COMMITMENT_ATTO_ETH = 128n * 10n ** 18n
const LIQUIDATION_DISTANCE_FAR_TARGET_COMMITMENT_ATTO_ETH = 160n * 10n ** 18n
const LIQUIDATION_DISTANCE_REPRICED_REP_ETH_PRICE = 4n * 10n ** 18n
// At the repriced 4 REP/ETH price the 820 REP vault's 100 ETH commitment needs 800 REP at the 2x multiplier, so the
// vault stays healthy at 2.05x backing: inside the 5% band above the multiplier that reads as near minimum.
const NEAR_MINIMUM_VAULT_REP_DEPOSIT = 820n * 10n ** 18n
const NEAR_MINIMUM_VAULT_COMMITMENT_ATTO_ETH = 100n * 10n ** 18n
const NEAR_MINIMUM_VAULT_REPRICED_REP_ETH_PRICE = 4n * 10n ** 18n

async function loadRequiredSeededPoolByTitle(readClient: ReadClient, questionTitle: string) {
	const seededPool = (await getScenarioProtocol().loadAllSecurityPools(readClient)).find(pool => pool.marketDetails.title === questionTitle)
	if (seededPool === undefined) throw new Error(`Expected a seeded security pool for ${questionTitle}`)
	return seededPool
}

/** Seeds the scenario's pool right after the app contracts deploy, leaving the progress bar above 0.94 for its follow-up steps. */
async function seedWorkflowPool({ createReadClient, createWriteClient, memoryClient, onProgress, profile }: ScenarioSeedParameters, poolSpec: { poolLabel: string; questionTitle: string; readyLabel: string; vaults: readonly SeededVaultSpec[] }) {
	await seedSecurityPool({
		createReadClient,
		createWriteClient,
		memoryClient,
		onProgress,
		poolSpec: { ...poolSpec, progressRange: { start: 0.78, end: 0.94 } },
		profile,
		seedTimestamp: await getSimulationChainTimestamp(memoryClient),
	})
	return await loadRequiredSeededPoolByTitle(createReadClient(), poolSpec.questionTitle)
}

/** Approves and files a wallet-funded report, so the stake comes from the reporter's wallet rather than its vault. */
async function reportFromWallet(writeClient: WriteClient, repTokenAddress: Address, securityPoolAddress: Address, outcome: ReportingOutcomeKey, amountAttoRep: bigint) {
	await getScenarioProtocol().approveErc20(writeClient, repTokenAddress, securityPoolAddress, amountAttoRep, 'approveRep')
	await getScenarioProtocol().reportOutcomeInSecurityPool(writeClient, securityPoolAddress, outcome, amountAttoRep, amountAttoRep, 'wallet')
}

/** Lets the seeding price expire, then settles a fresh REP/ETH price last so it stays valid when the app opens. */
async function repriceSeededPool({ managerAddress, memoryClient, price, readClient, writeClient }: { managerAddress: Address; memoryClient: TevmLikeClient; price: bigint; readClient: ReadClient; writeClient: WriteClient }) {
	await advanceSimulationTime(memoryClient, ORACLE_PRICE_VALIDITY_SECONDS + 60n)
	await getScenarioProtocol().requestOraclePrice(writeClient, managerAddress, price)
	const managerDetails = await getScenarioProtocol().loadOracleManagerDetails(readClient, managerAddress)
	if (managerDetails.pendingReportId === 0n) throw new Error(`Expected a pending repricing report for ${managerAddress}`)
	await settleOracleReportIfNeeded({ memoryClient, openOracleAddress: managerDetails.openOracleAddress, pendingReportId: managerDetails.pendingReportId, readClient, writeClient })
	const repricedManagerDetails = await getScenarioProtocol().loadOracleManagerDetails(readClient, managerAddress)
	if (!repricedManagerDetails.isPriceValid || repricedManagerDetails.lastPrice !== price) throw new Error(`Expected a valid ${price.toString()} REP/ETH price for ${managerAddress}`)
}

/** Ends the seeded pool's question so its escalation game can open. */
async function endSeededQuestion({ accountAddress, memoryClient, readClient, securityPoolAddress }: { accountAddress: Address; memoryClient: TevmLikeClient; readClient: ReadClient; securityPoolAddress: Address }) {
	const reportingBeforeEnd = await getScenarioProtocol().loadReportingDetails(readClient, securityPoolAddress, accountAddress)
	if (reportingBeforeEnd.marketDetails.endTime >= reportingBeforeEnd.currentTime) {
		await advanceSimulationTime(memoryClient, reportingBeforeEnd.marketDetails.endTime - reportingBeforeEnd.currentTime + DAY_IN_SECONDS)
	}
	return reportingBeforeEnd
}

export async function seedEndedPoolCommitmentScenario(parameters: ScenarioSeedParameters) {
	const { accounts, createReadClient, createWriteClient, memoryClient, onProgress, profile } = parameters
	const primaryAccount = requireQaAccount(accounts[0], 'Expected simulation QA account A1 for ended-pool-commitment')
	const reporterAccount = requireQaAccount(accounts[1], 'Expected simulation QA account B2 for ended-pool-commitment')
	const readClient = createReadClient()
	const pool = await seedWorkflowPool(parameters, {
		poolLabel: 'ended-pool-commitment pool',
		questionTitle: ENDED_POOL_COMMITMENT_QUESTION_TITLE,
		readyLabel: 'Seeded the committed vault',
		vaults: [{ accountAddress: primaryAccount, vaultRepBackingDepositAttoRep: SECURITY_POOL_REP_DEPOSIT, underwritingLimitAttoEth: CAPACITY_OWNERSHIP_ATTO_REP }],
	})

	await reportBootstrapProgress(onProgress, 'Ending the seeded question', 0.95)
	const reportingBeforeEnd = await endSeededQuestion({ accountAddress: reporterAccount, memoryClient, readClient, securityPoolAddress: pool.securityPoolAddress })
	// A wallet-funded report leaves the committed vault without dispute-staked REP, so only its commitment blocks redemption.
	await reportFromWallet(createWriteClient(reporterAccount), profile.genesisRepTokenAddress, pool.securityPoolAddress, 'yes', reportingBeforeEnd.startBondAttoRep)

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

export async function seedLiquidationDistanceScenario(parameters: ScenarioSeedParameters) {
	const { accounts, createReadClient, createWriteClient, memoryClient, onProgress } = parameters
	const receiverAccount = requireQaAccount(accounts[0], 'Expected simulation QA account A1 for liquidation-distance')
	const nearTargetAccount = requireQaAccount(accounts[1], 'Expected simulation QA account B2 for liquidation-distance')
	const farTargetAccount = requireQaAccount(accounts[2], 'Expected simulation QA account C3 for liquidation-distance')
	const readClient = createReadClient()
	const pool = await seedWorkflowPool(parameters, {
		poolLabel: 'liquidation-distance pool',
		questionTitle: LIQUIDATION_DISTANCE_QUESTION_TITLE,
		readyLabel: 'Seeded the liquidation targets',
		vaults: [
			{ accountAddress: receiverAccount, vaultRepBackingDepositAttoRep: SECURITY_POOL_REP_DEPOSIT, underwritingLimitAttoEth: CAPACITY_OWNERSHIP_ATTO_REP },
			{ accountAddress: nearTargetAccount, vaultRepBackingDepositAttoRep: LIQUIDATION_DISTANCE_TARGET_REP_DEPOSIT, underwritingLimitAttoEth: LIQUIDATION_DISTANCE_NEAR_TARGET_COMMITMENT_ATTO_ETH },
			{ accountAddress: farTargetAccount, vaultRepBackingDepositAttoRep: LIQUIDATION_DISTANCE_TARGET_REP_DEPOSIT, underwritingLimitAttoEth: LIQUIDATION_DISTANCE_FAR_TARGET_COMMITMENT_ATTO_ETH },
		],
	})

	await reportBootstrapProgress(onProgress, 'Repricing REP for the liquidation targets', 0.95)
	await repriceSeededPool({ managerAddress: pool.managerAddress, memoryClient, price: LIQUIDATION_DISTANCE_REPRICED_REP_ETH_PRICE, readClient, writeClient: createWriteClient(receiverAccount) })
	await reportBootstrapProgress(onProgress, 'Seeded liquidation-distance scenario is ready', 0.98)
}

/** One pool whose question ended, with your Yes report disputed by a larger No report, so the escalation game is running. */
export async function seedEscalationInProgressScenario(parameters: ScenarioSeedParameters) {
	const { accounts, createReadClient, createWriteClient, memoryClient, onProgress, profile } = parameters
	const primaryAccount = requireQaAccount(accounts[0], 'Expected simulation QA account A1 for escalation-in-progress')
	const challengerAccount = requireQaAccount(accounts[1], 'Expected simulation QA account B2 for escalation-in-progress')
	const readClient = createReadClient()
	const pool = await seedWorkflowPool(parameters, {
		poolLabel: 'escalation-in-progress pool',
		questionTitle: ESCALATION_IN_PROGRESS_QUESTION_TITLE,
		readyLabel: 'Seeded the reporting vault',
		vaults: [{ accountAddress: primaryAccount, vaultRepBackingDepositAttoRep: SECURITY_POOL_REP_DEPOSIT, underwritingLimitAttoEth: CAPACITY_OWNERSHIP_ATTO_REP }],
	})

	await reportBootstrapProgress(onProgress, 'Ending the seeded question', 0.95)
	const reportingBeforeEnd = await endSeededQuestion({ accountAddress: primaryAccount, memoryClient, readClient, securityPoolAddress: pool.securityPoolAddress })
	// Both reports are wallet-funded; the Yes report still counts as your vault's dispute stake.
	await reportFromWallet(createWriteClient(primaryAccount), profile.genesisRepTokenAddress, pool.securityPoolAddress, 'yes', reportingBeforeEnd.startBondAttoRep)

	await reportBootstrapProgress(onProgress, 'Disputing the initial report', 0.97)
	const openedReporting = await getScenarioProtocol().loadReportingDetails(readClient, pool.securityPoolAddress, challengerAccount)
	if (openedReporting.status !== 'active') throw new Error('Expected the escalation-in-progress game to be active')
	// The game trims a deposit that would tie the leading side, so the dispute doubles the bond and takes the lead outright.
	await reportFromWallet(createWriteClient(challengerAccount), profile.genesisRepTokenAddress, pool.securityPoolAddress, 'no', openedReporting.currentRequiredBond * 2n)

	const disputedReporting = await getScenarioProtocol().loadReportingDetails(readClient, pool.securityPoolAddress, primaryAccount)
	if (disputedReporting.status !== 'active' || disputedReporting.escalationEndTime <= disputedReporting.currentTime) throw new Error('Expected the disputed escalation game to stay open')
	if (disputedReporting.questionOutcome !== 'none') throw new Error(`Expected the disputed question to stay unresolved, got ${disputedReporting.questionOutcome}`)
	await reportBootstrapProgress(onProgress, 'Seeded escalation-in-progress scenario is ready', 0.98)
}

/** One pool repriced so your vault stays healthy but sits just above the security multiplier, beside a comfortably backed vault. */
export async function seedNearMinimumVaultScenario(parameters: ScenarioSeedParameters) {
	const { accounts, createReadClient, createWriteClient, memoryClient, onProgress } = parameters
	const primaryAccount = requireQaAccount(accounts[0], 'Expected simulation QA account A1 for near-minimum-vault')
	const secondaryAccount = requireQaAccount(accounts[1], 'Expected simulation QA account B2 for near-minimum-vault')
	const readClient = createReadClient()
	const pool = await seedWorkflowPool(parameters, {
		poolLabel: 'near-minimum-vault pool',
		questionTitle: NEAR_MINIMUM_VAULT_QUESTION_TITLE,
		readyLabel: 'Seeded the near-minimum vault',
		vaults: [
			{ accountAddress: primaryAccount, vaultRepBackingDepositAttoRep: NEAR_MINIMUM_VAULT_REP_DEPOSIT, underwritingLimitAttoEth: NEAR_MINIMUM_VAULT_COMMITMENT_ATTO_ETH },
			{ accountAddress: secondaryAccount, vaultRepBackingDepositAttoRep: SECURITY_POOL_REP_DEPOSIT, underwritingLimitAttoEth: CAPACITY_OWNERSHIP_ATTO_REP },
		],
	})

	await reportBootstrapProgress(onProgress, 'Repricing REP toward the vault minimum', 0.95)
	await repriceSeededPool({ managerAddress: pool.managerAddress, memoryClient, price: NEAR_MINIMUM_VAULT_REPRICED_REP_ETH_PRICE, readClient, writeClient: createWriteClient(secondaryAccount) })
	const vault = await loadRequiredSecurityVault(readClient, pool.securityPoolAddress, primaryAccount, primaryAccount)
	if (vault.vaultAttoRepBacking !== NEAR_MINIMUM_VAULT_REP_DEPOSIT || vault.underwritingLimitAttoEth !== NEAR_MINIMUM_VAULT_COMMITMENT_ATTO_ETH) throw new Error('Expected the near-minimum vault to keep its seeded REP backing and commitment')
	await reportBootstrapProgress(onProgress, 'Seeded near-minimum-vault scenario is ready', 0.98)
}
