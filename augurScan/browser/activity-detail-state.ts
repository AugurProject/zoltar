import type { AccountReference, AccountTransactionState, ActivityRecord, DialogSnapshot } from './browser-types.ts'

export interface ActivityDetailState {
	detailRequestVersion: number
	detailContextVersion: number
	activeLog: ActivityRecord | undefined
	pendingCanonicalLog: ActivityRecord | undefined
	pendingCanonicalActivityCount: number | undefined
	activeAccount: AccountReference | undefined
	activeAccountTransactions: AccountTransactionState | undefined
	activeAccountLoadMore: (() => Promise<boolean | undefined>) | undefined
	pendingCanonicalAccount: AccountReference | undefined
	pendingAccountDialogSnapshot: DialogSnapshot | undefined
	preservePendingOnDialogClose: boolean
}

export const createActivityDetailState = (): ActivityDetailState => ({
	detailRequestVersion: 0,
	detailContextVersion: 0,
	activeLog: undefined,
	pendingCanonicalLog: undefined,
	pendingCanonicalActivityCount: undefined,
	activeAccount: undefined,
	activeAccountTransactions: undefined,
	activeAccountLoadMore: undefined,
	pendingCanonicalAccount: undefined,
	pendingAccountDialogSnapshot: undefined,
	preservePendingOnDialogClose: false,
})
