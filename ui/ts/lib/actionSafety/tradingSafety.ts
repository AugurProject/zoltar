import { createReasonedActionSafetyEntry, createReasonedActionSafetyFixtures } from './reasoned.js'

export const TRADING_ACTION_SAFETY_ENTRIES = [
	createReasonedActionSafetyEntry('trading.createCompleteSet', 'Mint Complete Sets', createReasonedActionSafetyFixtures('Mint Complete Sets')),
	createReasonedActionSafetyEntry('trading.redeemCompleteSet', 'Redeem Complete Sets', createReasonedActionSafetyFixtures('Redeem Complete Sets')),
	createReasonedActionSafetyEntry('trading.migrateShares', 'Migrate Shares', createReasonedActionSafetyFixtures('Migrate Shares')),
	createReasonedActionSafetyEntry('trading.redeemShares', 'Redeem Shares', createReasonedActionSafetyFixtures('Redeem Shares')),
] as const
