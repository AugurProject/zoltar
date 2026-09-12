import { approveErc20 } from '@zoltar/ui-zoltar-shared/protocol/tokenActions.js'
import { createChildUniverseFromSecurityPool, forkZoltarWithOwnEscalation, loadForkAuctionDetails, migrateRepToZoltarFromSecurityPool } from '../protocol/forks.js'
import { loadOpenOracleReportDetails, settleOracleReport } from '../protocol/openOracle.js'
import { loadOracleManagerDetails, requestOraclePrice } from '../protocol/oracleCoordinator.js'
import { loadReportingDetails, reportOutcomeInSecurityPool } from '../protocol/reporting.js'
import { createMarket, loadZoltarUniverseSummary } from '@zoltar/ui-zoltar-shared/protocol/zoltar.js'
import { getDeploymentSteps } from '../protocol/deployment.js'
import { createSecurityPool, loadAllSecurityPools, loadSecurityVaultDetails } from '../protocol/securityPools.js'
import { depositRepToVaultToSecurityPool } from '../protocol/securityVault.js'
import { createCompleteSetInSecurityPool } from '../protocol/trading.js'
import { startTruthAuctionForSecurityPool, submitTruthAuctionBid } from '../protocol/truthAuctionActions.js'

const defaultScenarioProtocol = {
	approveErc20,
	createChildUniverseFromSecurityPool,
	createCompleteSetInSecurityPool,
	createMarket,
	createSecurityPool,
	depositRepToVaultToSecurityPool,
	forkZoltarWithOwnEscalation,
	getDeploymentSteps,
	loadAllSecurityPools,
	loadForkAuctionDetails,
	loadOpenOracleReportDetails,
	loadOracleManagerDetails,
	loadReportingDetails,
	loadSecurityVaultDetails,
	loadZoltarUniverseSummary,
	migrateRepToZoltarFromSecurityPool,
	reportOutcomeInSecurityPool,
	requestOraclePrice,
	settleOracleReport,
	startTruthAuctionForSecurityPool,
	submitTruthAuctionBid,
}

type StatoblastScenarioProtocol = typeof defaultScenarioProtocol

let scenarioProtocolOverride: StatoblastScenarioProtocol | undefined

/** @internal */
export function installStatoblastScenarioProtocolForTesting(override: StatoblastScenarioProtocol | undefined) {
	scenarioProtocolOverride = override
}

export function getStatoblastScenarioProtocol(): StatoblastScenarioProtocol {
	return scenarioProtocolOverride ?? defaultScenarioProtocol
}
