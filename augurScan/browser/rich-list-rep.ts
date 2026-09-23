import type { RichListRecord } from './browser-types.ts'
import { exactUnit } from './format.ts'

export const richListRepTotal = (item: Pick<RichListRecord, 'rep_balance'>): string => exactUnit(item.rep_balance, 18, 'REP')
