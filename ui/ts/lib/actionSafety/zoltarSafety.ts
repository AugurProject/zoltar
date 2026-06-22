import { createReasonedActionSafetyEntry, createReasonedActionSafetyFixtures } from './reasoned.js'

export const ZOLTAR_ACTION_SAFETY_ENTRIES = [createReasonedActionSafetyEntry('zoltar.approveForkRep', 'Approve Fork REP', createReasonedActionSafetyFixtures('Approve Fork REP')), createReasonedActionSafetyEntry('zoltar.forkZoltar', 'Fork Zoltar', createReasonedActionSafetyFixtures('Fork Zoltar'))] as const
