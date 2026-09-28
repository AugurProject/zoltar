import type { CopyTemplateValue } from './types.js'

export const activity = 'Activity'
export const recentTransactions = 'Recent transactions'
export const noRecentTransactions = 'No transactions from this account yet.'
export const formatActivityTriggerLabel = (pendingCount: number) => (pendingCount === 0 ? activity : `${activity}, ${pendingCount} pending`)
export const formatPendingTransactionCount = (pendingCount: number) => (pendingCount === 1 ? '1 transaction pending' : `${pendingCount} transactions pending`)
export const pending = 'Pending'
export const confirmed = 'Confirmed'
export const failed = 'Failed'
export const rejected = 'Rejected in wallet'
export const reverted = 'Reverted'
export const replaced = 'Replaced'
export const dropped = 'No longer tracked'
export const stopTracking = 'Stop tracking'
export const formatStopTracking = (title: CopyTemplateValue) => `Stop tracking ${title}`
export const formatViewTransaction = (hash: CopyTemplateValue) => `View transaction ${hash}`
