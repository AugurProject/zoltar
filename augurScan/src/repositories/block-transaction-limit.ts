export const blockTransactionLimit = 250

export const boundBlockTransactions = <T>(records: readonly T[]): { transactions: T[]; hasMore: boolean; sampleLimit: number } => ({
	transactions: records.slice(0, blockTransactionLimit),
	hasMore: records.length > blockTransactionLimit,
	sampleLimit: blockTransactionLimit,
})
