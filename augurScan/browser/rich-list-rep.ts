import type { RichListRecord } from './browser-types.ts'
import { exactUnit } from './format.ts'
import { shortIdentifier } from './identifier-format.ts'

export const richListLargestRep = (item: Pick<RichListRecord, 'largest_rep_token_address' | 'largest_rep_balance' | 'largest_rep_decimals' | 'largest_rep_symbol'>): string => {
	if (item.largest_rep_token_address === null || item.largest_rep_balance === null) return 'REP pending'
	return `${exactUnit(item.largest_rep_balance, item.largest_rep_decimals ?? 18, item.largest_rep_symbol ?? 'REP')} · ${shortIdentifier(item.largest_rep_token_address)}`
}
