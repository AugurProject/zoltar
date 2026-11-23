export const QUESTION_LEDGER_QUESTION_OUTCOME_ABI = [
	{
		inputs: [{ name: 'questionLedger', type: 'address' }],
		name: 'getQuestionOutcome',
		outputs: [{ name: 'outcome', type: 'uint8' }],
		stateMutability: 'view',
		type: 'function',
	},
] as const
