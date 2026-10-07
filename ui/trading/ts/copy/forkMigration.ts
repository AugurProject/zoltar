export const childPoolMissing = 'Child security pool missing'
export const childPoolReady = 'Child security pool ready'
export const scalarForkQuestion = 'Scalar fork question'
export const categoricalForkQuestion = 'Categorical fork question'
/** A child universe that already holds this share's whole balance; migrating there again would move nothing. */
export const migrated = 'Migrated'
export const alreadyMigratedTargetReason = 'This share is already migrated to this child universe.'
export const migratedSharesTitle = 'Migrated shares'
export const migratedSharesDetail = 'Migrated shares live in each child universe’s security pool. Open one to trade, redeem, or check them there.'

export function childUniverseName(label: string) {
	return `${label} universe`
}

export function openChildUniverseMarket(label: string) {
	return `Open in ${childUniverseName(label)}`
}
