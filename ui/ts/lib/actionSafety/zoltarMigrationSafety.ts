import { createReasonedActionSafetyEntry, createReasonedActionSafetyFixtures } from './reasoned.js'

export const ZOLTAR_MIGRATION_ACTION_SAFETY_ENTRIES = [createReasonedActionSafetyEntry('zoltar-migration.prepareRep', 'Prepare REP', createReasonedActionSafetyFixtures('Prepare REP')), createReasonedActionSafetyEntry('zoltar-migration.splitRep', 'Split REP', createReasonedActionSafetyFixtures('Split REP'))] as const
