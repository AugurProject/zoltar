import { createReasonedActionSafetyEntry, createReasonedActionSafetyFixtures } from './reasoned.js'

export const MARKET_ACTION_SAFETY_ENTRIES = [createReasonedActionSafetyEntry('market.createQuestion', 'Create Question', createReasonedActionSafetyFixtures('Create Question'))] as const
