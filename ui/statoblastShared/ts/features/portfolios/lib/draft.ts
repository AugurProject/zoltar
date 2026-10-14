import { parseUnits } from '@zoltar/core-shared/evm/ethereum'

export type AllocationDraft = { selected: boolean; deposit: string; commitment: string }
export const emptyAllocationDraft = (): AllocationDraft => ({ selected: false, deposit: '', commitment: '' })

export function parsePortfolioAmount(value: string) {
	if (!/^(\d+)(\.\d{0,18})?$/.test(value.trim())) throw new Error('Enter a nonnegative amount with up to 18 decimal places.')
	return parseUnits(value.trim(), 18)
}

export function parseAllocationDrafts(drafts: Readonly<Record<string, AllocationDraft>>) {
	return Object.entries(drafts)
		.filter(([, draft]) => draft.selected)
		.map(([questionId, draft]) => ({ questionId: BigInt(questionId), depositAttoRep: parsePortfolioAmount(draft.deposit || '0'), commitmentAttoEth: parsePortfolioAmount(draft.commitment || '0') }))
}
