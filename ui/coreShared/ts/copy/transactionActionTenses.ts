const actionTenses = [
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
]

export function formatActionTense(title: string, tense: 'pending' | 'completed') {
	const action = actionTenses.find(action => title === action.verb || title.startsWith(`${action.verb} `))
	if (action === undefined) return tense === 'completed' ? `Completed: ${title}` : title
	return `${action[tense]}${title.slice(action.verb.length)}`
}
