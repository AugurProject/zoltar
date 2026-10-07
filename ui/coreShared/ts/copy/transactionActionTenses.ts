const actionTenses = [
	{ verb: 'Batched transaction', pending: 'Executing batched transaction', completed: 'Completed batched transaction' },
	{ verb: 'Fund', pending: 'Funding', completed: 'Funded' },
	{ verb: 'Deploy', pending: 'Deploying', completed: 'Deployed' },
	{ verb: 'Transfer', pending: 'Transferring', completed: 'Transferred' },
	{ verb: 'Dispute', pending: 'Disputing', completed: 'Disputed' },
	{ verb: 'Report', pending: 'Reporting', completed: 'Reported' },
	{ verb: 'Settle', pending: 'Settling', completed: 'Settled' },
	{ verb: 'Approve', pending: 'Approving', completed: 'Approved' },
	{ verb: 'Deposit', pending: 'Depositing', completed: 'Deposited' },
	{ verb: 'Claim', pending: 'Claiming', completed: 'Claimed' },
	{ verb: 'Clear', pending: 'Clearing', completed: 'Cleared' },
	{ verb: 'Request', pending: 'Requesting', completed: 'Requested' },
	{ verb: 'Withdraw', pending: 'Withdrawing', completed: 'Withdrew' },
	{ verb: 'Create', pending: 'Creating', completed: 'Created' },
	{ verb: 'Wrap', pending: 'Wrapping', completed: 'Wrapped' },
	{ verb: 'Execute', pending: 'Executing', completed: 'Executed' },
	{ verb: 'Queue', pending: 'Queuing', completed: 'Queued' },
	{ verb: 'Fork', pending: 'Forking', completed: 'Forked' },
	{ verb: 'Initiate', pending: 'Initiating', completed: 'Initiated' },
	{ verb: 'Migrate', pending: 'Migrating', completed: 'Migrated' },
	{ verb: 'Start', pending: 'Starting', completed: 'Started' },
	{ verb: 'Submit', pending: 'Submitting', completed: 'Submitted' },
	{ verb: 'Refund', pending: 'Refunding', completed: 'Refunded' },
	{ verb: 'Finalize', pending: 'Finalizing', completed: 'Finalized' },
]

export function formatActionTense(title: string, tense: 'pending' | 'completed') {
	const action = actionTenses.find(action => title === action.verb || title.startsWith(`${action.verb} `))
	if (action === undefined) return tense === 'completed' ? `${title} – done` : title
	return `${action[tense]}${title.slice(action.verb.length)}`
}

/** Rewrites an in-progress title such as `Creating question` into its base or completed tense; other titles stay unchanged. */
export function retenseInProgressTitle(title: string, tense: 'base' | 'completed') {
	const action = actionTenses.find(action => title === action.pending || title.startsWith(`${action.pending} `))
	if (action === undefined) return title
	return `${tense === 'base' ? action.verb : action.completed}${title.slice(action.pending.length)}`
}
