export const notChecked = 'Not checked'
export const wrongNetwork = 'Wrong network'
export const emptyPoolRegistryActionHint = 'Create a pool from an exact Yes / No question to enable shares, reporting, and vault workflows.'
export const emptyPoolRegistryDetail = 'No security pools are available in this universe.'
export const refreshingPoolRegistryDetail = 'Refreshing pools.'
export const uncheckedPoolRegistryDetail = 'Load security pools to check what is available in this universe.'
export const retrieving = 'retrieving…'
export const formatRefreshLookupAction = (kind: 'question' | 'report') => `Refresh ${kind === 'question' ? 'questions' : 'reports'}`
export const formatUncheckedLookupDetail = (kind: 'question' | 'report') => `${formatRefreshLookupAction(kind)} to check this ID.`
export const formatMissingLookupDetail = (kind: 'question' | 'report') => `${formatRefreshLookupAction(kind)} or try another ID.`
export const uncheckedUniverseDetail = 'Choose a universe to continue.'
export const missingUniverseDetail = 'Choose another universe.'
export const walletInstallationRequired = 'Install or enable a wallet to continue.'
