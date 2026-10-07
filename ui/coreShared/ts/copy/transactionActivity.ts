import type { CopyTemplateValue } from './types.js'

export const activity = 'Activity'
export const recentTransactions = 'Recent transactions'
export const noRecentTransactions = 'No transactions from this account yet.'
export const connectWalletForActivity = 'Connect a wallet to see its recent transactions.'
export const formatActivityTriggerLabel = (pendingCount: number, newResultCount = 0) => {
	if (pendingCount > 0) return `${activity}, ${pendingCount} pending`
	if (newResultCount === 1) return `${activity}, 1 new result`
	return newResultCount > 1 ? `${activity}, ${newResultCount} new results` : activity
}
export const formatSettledTransactionAnnouncement = (title: CopyTemplateValue, status: CopyTemplateValue) => `${title}: ${status}`
export const formatPendingTransactionCount = (pendingCount: number) => (pendingCount === 1 ? '1 transaction pending' : `${pendingCount} transactions pending`)
export const rejected = 'Rejected in wallet'
export const reverted = 'Reverted'
export const replaced = 'Replaced'
export const dropped = 'No longer tracked'
export const stopTracking = 'Stop tracking'
export const formatStopTracking = (title: CopyTemplateValue) => `Stop tracking ${title}`
export const stopTrackingConsequence = 'This transaction can still confirm. Stop tracking lets you send the action again.'
export const keepTracking = 'Keep tracking'
