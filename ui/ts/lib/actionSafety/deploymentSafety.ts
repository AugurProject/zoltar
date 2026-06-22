import { DEPLOYMENT_STEP_SAFETY_IDS } from './ids.js'
import { createReasonedActionSafetyEntry, createReasonedActionSafetyFixtures } from './reasoned.js'

export const DEPLOYMENT_ACTION_SAFETY_ENTRIES = [
	createReasonedActionSafetyEntry(DEPLOYMENT_STEP_SAFETY_IDS.proxyDeployer, 'Proxy Deployer', createReasonedActionSafetyFixtures('Proxy Deployer')),
	createReasonedActionSafetyEntry(DEPLOYMENT_STEP_SAFETY_IDS.deploymentStatusOracle, 'Deployment Status Oracle', createReasonedActionSafetyFixtures('Deployment Status Oracle')),
	createReasonedActionSafetyEntry(DEPLOYMENT_STEP_SAFETY_IDS.multicall3, 'Multicall3', createReasonedActionSafetyFixtures('Multicall3')),
	createReasonedActionSafetyEntry(DEPLOYMENT_STEP_SAFETY_IDS.uniformPriceDualCapBatchAuctionFactory, 'Uniform Price Dual Cap Batch Auction Factory', createReasonedActionSafetyFixtures('Uniform Price Dual Cap Batch Auction Factory')),
	createReasonedActionSafetyEntry(DEPLOYMENT_STEP_SAFETY_IDS.scalarOutcomes, 'Scalar Outcomes', createReasonedActionSafetyFixtures('Scalar Outcomes')),
	createReasonedActionSafetyEntry(DEPLOYMENT_STEP_SAFETY_IDS.securityPoolUtils, 'Security Pool Utils', createReasonedActionSafetyFixtures('Security Pool Utils')),
	createReasonedActionSafetyEntry(DEPLOYMENT_STEP_SAFETY_IDS.openOracle, 'Open Oracle', createReasonedActionSafetyFixtures('Open Oracle')),
	createReasonedActionSafetyEntry(DEPLOYMENT_STEP_SAFETY_IDS.zoltarQuestionData, 'Zoltar Question Data', createReasonedActionSafetyFixtures('Zoltar Question Data')),
	createReasonedActionSafetyEntry(DEPLOYMENT_STEP_SAFETY_IDS.zoltar, 'Zoltar', createReasonedActionSafetyFixtures('Zoltar')),
	createReasonedActionSafetyEntry(DEPLOYMENT_STEP_SAFETY_IDS.shareTokenFactory, 'Share Token Factory', createReasonedActionSafetyFixtures('Share Token Factory')),
	createReasonedActionSafetyEntry(DEPLOYMENT_STEP_SAFETY_IDS.priceOracleManagerAndOperatorQueuerFactory, 'Price Oracle Manager And Operator Queuer Factory', createReasonedActionSafetyFixtures('Price Oracle Manager And Operator Queuer Factory')),
	createReasonedActionSafetyEntry(DEPLOYMENT_STEP_SAFETY_IDS.securityPoolForker, 'Security Pool Forker', createReasonedActionSafetyFixtures('Security Pool Forker')),
	createReasonedActionSafetyEntry(DEPLOYMENT_STEP_SAFETY_IDS.escalationGameFactory, 'Escalation Game Factory', createReasonedActionSafetyFixtures('Escalation Game Factory')),
	createReasonedActionSafetyEntry(DEPLOYMENT_STEP_SAFETY_IDS.securityPoolFactory, 'Security Pool Factory', createReasonedActionSafetyFixtures('Security Pool Factory')),
	createReasonedActionSafetyEntry('deployment.deployNextMissing', 'Deploy Next Missing', createReasonedActionSafetyFixtures('Deploy Next Missing')),
] as const
