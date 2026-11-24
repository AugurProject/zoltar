/** Whether the child universe already has the question a migration batch lands in. */
export const childPoolMissing = 'Not registered yet'
export const branchNotActive = 'Branch not active'
export const childPoolReady = 'Question ready'
/** A child universe that already holds this share's whole balance; migrating there again would move nothing. */
export const migrated = 'Migrated'
export const alreadyMigratedTargetReason = 'This share is already migrated to this child universe.'
export const migratedSharesTitle = 'Migrated shares'
export const migratedSharesDetail = 'Migrated shares live in the same question in each child universe. Open one to trade, redeem, or check them there.'

export function childUniverseName(label: string) {
	return `${label} universe`
}

export function openChildUniverseMarket(label: string) {
	return `Open in ${childUniverseName(label)}`
}
