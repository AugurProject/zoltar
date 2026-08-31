import type { RichListBalance } from './database.ts'
import { safeIndexerFailureReason } from './indexer-runtime.ts'

type BalanceReadIdentity = Pick<RichListBalance, 'owner' | 'assetAddress' | 'assetKind'>

export const readRichListBalance = async (identity: BalanceReadIdentity, read: () => Promise<unknown>): Promise<RichListBalance> => {
	try {
		const balance = await read()
		if (typeof balance !== 'bigint' || balance < 0n) throw new Error('Balance read returned an invalid value')
		return { ...identity, readStatus: 'success', balance }
	} catch (error) {
		return { ...identity, readStatus: 'failed', readFailureReason: safeIndexerFailureReason(error) }
	}
}
