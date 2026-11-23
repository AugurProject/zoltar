import type { ContractReference } from './contract-reference-metadata.mts'
export const questionForkerContractReference: ContractReference = {
	compiledAbiFingerprint: '023c77f6a56ea5ebdfaede6f10b790b6dbcdd155353bae4f8dd3b3fa73799297',
	name: 'QuestionForker',
	purpose: 'Routes shared-security-pool question forks and lazy child question preparation.',
	readAbiFingerprint: '7475fe46e1c2bea5d49502837b2be814dee961b5123cc54df72d8e172bd00691',
	readSurface: '`zoltar` identifies the protocol root. `getQuestionOutcome` returns the fixed or finalized question outcome, or None while unresolved; the shared security pool clock protects pre-fork final claims.',
	readDeclarations: [
		{
			name: 'getQuestionOutcome',
		},
	],
	readStorageDeclarations: [
		{
			name: 'zoltar',
		},
	],
	interactionNotes: 'Owner capital and reporter custody migrate through the shared security pool coordinator. Child question ledgers and their fixed-size reporter snapshots are prepared lazily. No owner migrates a vault for each question.',
	securityBoundaryHeading: 'Child-game trust boundary',
	securityBoundary: 'The immutable delegate is validated against Zoltar at deployment. Security pool paths authenticate the source question through its factory namespace and central books before changing capital or installing claims. Caller-supplied module addresses are never used as delegate targets.',
	sourcePath: 'solidity/contracts/statoblast/QuestionForker.sol',
	interactions: [
		{
			call: '`prepareSecurityPoolQuestion(source, targetUniverse)`',
			caller: 'Anyone',
			effect: 'Deploys and binds the canonical target question contract and share-token namespace separately from report-history installation. A forked target can be prepared for frozen share recovery without activating a game.',
			declarations: [
				{
					name: 'prepareSecurityPoolQuestion',
				},
			],
			preconditions: 'Canonical bound source; its universe has forked; the security pool recognizes a ready target branch and the source reporter identity. Factory and share-token bindings are verified.',
			signals: 'Canonical pool deployment and authorization events when the target is new.',
		},
		{
			call: '`materializeSecurityPoolQuestion(source, targetUniverse)`',
			caller: 'Anyone',
			effect:
				'Prepares the target if absent. With inherited reporting, installs one outcome of the fixed 64-peak snapshot per call; the third call activates the question and resumes reporting from the child branch activation timestamp. Without reporter history, activates immediately. Late installation does not postpone finality. An already-final game must agree with the inherited reporter and outstanding-share settlement deadlines, including the fixed-outcome response period, or activation reverts. Preparation may be a separate transaction to bound deployment gas.',
			declarations: [
				{
					name: 'materializeSecurityPoolQuestion',
				},
			],
			preconditions: 'The preparation guards apply. A target whose native universe has already forked can activate only a protected final reporter or trader claim owned by that universe. Already operational targets return without duplicate installation.',
			signals: 'Canonical deployment events when needed, then game continuation and carry checkpoint events when a reporter game is installed.',
		},
		{
			call: '`initiateQuestionLedgerFork(questionLedger)`',
			caller: 'Anyone',
			effect: 'Marks the unresolved question forked and freezes its shared books.',
			declarations: [
				{
					name: 'initiateQuestionLedgerFork',
				},
			],
			preconditions: 'The universe has forked and the question was not final before that fork.',
			signals: 'Shared fork, question deployment and reporting continuation events as applicable.',
		},
		{
			call: '`forkZoltarWithOwnEscalationGame(questionLedger)`',
			caller: 'Anyone',
			effect: 'Uses this question\u2019s reporter custody to pay native fork admission and freezes its security pool.',
			declarations: [
				{
					name: 'forkZoltarWithOwnEscalationGame',
				},
			],
			preconditions: 'Canonical reporter question has non-decision and sufficient admission REP; universe is not already forked.',
			signals: 'Shared fork, question deployment and reporting continuation events as applicable.',
		},
		{
			call: '`createChildUniverse(questionLedger, outcomeIndex)`',
			caller: 'Anyone',
			effect:
				'Deploys the native child universe when it does not exist yet, then materializes the immediate security pool child question using the shared branch and lazy carry installation. When the target universe has itself already forked and the question cannot activate there, the call stops after preparing the child ledger in fork mode, which is all that share migration through that universe needs.',
			declarations: [
				{
					name: 'createChildUniverse',
				},
			],
			preconditions: 'Canonical source in a forked universe; target universe and question identity must match; the security pool\u2019s shared branch for the target universe is ready (`Child settlement not ready`).',
			signals: 'Shared fork, question deployment and reporting continuation events as applicable.',
		},
	],
}
