import { createReasonedActionSafetyEntry, createReasonedActionSafetyFixtures } from './reasoned.js'

export const SECURITY_POOL_ACTION_SAFETY_ENTRIES = [
	createReasonedActionSafetyEntry('security-pool.createPool', 'Create Pool', createReasonedActionSafetyFixtures('Create Pool')),
	createReasonedActionSafetyEntry('security-pool.executeStagedOperation', 'Execute Staged Operation', createReasonedActionSafetyFixtures('Execute Staged Operation')),
	createReasonedActionSafetyEntry('security-pool.requestPrice', 'Request Price', createReasonedActionSafetyFixtures('Request Price')),
	createReasonedActionSafetyEntry('security-pool.queueLiquidation', 'Queue Liquidation', createReasonedActionSafetyFixtures('Queue Liquidation')),
] as const
