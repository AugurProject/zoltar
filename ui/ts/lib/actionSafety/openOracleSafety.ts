import { createReasonedActionSafetyEntry, createReasonedActionSafetyFixtures } from './reasoned.js'

export const OPEN_ORACLE_ACTION_SAFETY_ENTRIES = [
	createReasonedActionSafetyEntry('open-oracle.approveToken1', 'Approve Token1', createReasonedActionSafetyFixtures('Approve Token1')),
	createReasonedActionSafetyEntry('open-oracle.approveToken2', 'Approve Token2', createReasonedActionSafetyFixtures('Approve Token2')),
	createReasonedActionSafetyEntry('open-oracle.wrapWeth', 'Wrap Needed ETH', createReasonedActionSafetyFixtures('Wrap Needed ETH')),
	createReasonedActionSafetyEntry('open-oracle.submitInitialReport', 'Submit Initial Report', createReasonedActionSafetyFixtures('Submit Initial Report')),
	createReasonedActionSafetyEntry('open-oracle.dispute', 'Dispute Report', createReasonedActionSafetyFixtures('Dispute Report')),
	createReasonedActionSafetyEntry('open-oracle.settle', 'Settle Report', createReasonedActionSafetyFixtures('Settle Report')),
	createReasonedActionSafetyEntry('open-oracle.createReportInstance', 'Create Standalone Oracle Game', createReasonedActionSafetyFixtures('Create Standalone Oracle Game')),
	createReasonedActionSafetyEntry('open-oracle.executeStagedOperation', 'Execute Staged Operation', createReasonedActionSafetyFixtures('Execute Staged Operation')),
	createReasonedActionSafetyEntry('open-oracle.queueOperation', 'Queue Operation', createReasonedActionSafetyFixtures('Queue Operation')),
	createReasonedActionSafetyEntry('open-oracle.requestPrice', 'Request Price', createReasonedActionSafetyFixtures('Request Price')),
	createReasonedActionSafetyEntry('open-oracle.readOnly', 'Read Only', createReasonedActionSafetyFixtures('Read Only')),
] as const
