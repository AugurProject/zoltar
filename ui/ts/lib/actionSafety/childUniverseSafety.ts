import { createReasonedActionSafetyEntry, createReasonedActionSafetyFixtures } from './reasoned.js'

export const CHILD_UNIVERSE_ACTION_SAFETY_ENTRIES = [createReasonedActionSafetyEntry('child-universe.deploy', 'Create Child Universe', createReasonedActionSafetyFixtures('Create Child Universe'))] as const
