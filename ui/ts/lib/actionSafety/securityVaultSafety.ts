import { createReasonedActionSafetyEntry, createReasonedActionSafetyFixtures } from './reasoned.js'

export const SECURITY_VAULT_ACTION_SAFETY_ENTRIES = [
	createReasonedActionSafetyEntry('security-vault.approveRep', 'Approve REP', createReasonedActionSafetyFixtures('Approve REP')),
	createReasonedActionSafetyEntry('security-vault.depositRep', 'Deposit REP', createReasonedActionSafetyFixtures('Deposit REP')),
	createReasonedActionSafetyEntry('security-vault.queueWithdrawRep', 'Queue Withdraw REP', createReasonedActionSafetyFixtures('Queue Withdraw REP')),
	createReasonedActionSafetyEntry('security-vault.redeemRep', 'Redeem REP', createReasonedActionSafetyFixtures('Redeem REP')),
	createReasonedActionSafetyEntry('security-vault.queueSetSecurityBondAllowance', 'Queue Set Security Bond Allowance', createReasonedActionSafetyFixtures('Queue Set Security Bond Allowance')),
	createReasonedActionSafetyEntry('security-vault.redeemFees', 'Claim Fees', createReasonedActionSafetyFixtures('Claim Fees')),
	createReasonedActionSafetyEntry('security-vault.executeStagedOperation', 'Execute Staged Operation', createReasonedActionSafetyFixtures('Execute Staged Operation')),
	createReasonedActionSafetyEntry('security-vault.requestPrice', 'Request Price', createReasonedActionSafetyFixtures('Request Price')),
	createReasonedActionSafetyEntry('security-vault.readOnly', 'Read Only', createReasonedActionSafetyFixtures('Read Only')),
] as const
