import type { CopyTemplateValue } from '@zoltar/ui-core-shared/copy/types.js'

export const depositNumber = 'Deposit #'
export const entryDepthLead = 'Entry depth: '
export const escalationAuctionHaircutDetail =
	'A repair auction can sell from both pool-held REP available to the repair auction and paused dispute-staked REP. Purchased REP is floor-allocated to the game; claims already present share that game-specific retention ratio. This prioritizes restoring settlement collateral that backs open interest over preserving escalation rewards, and the game resumes from reduced effective balances with a fresh response period.'
export const forkDepositSettlementAvailabilityDetail = 'Winning parent deposits can be settled after this child pool finalizes.'
export const formatDepositSelectionRequired = (outcomeLabel: CopyTemplateValue) => `Select at least one ${outcomeLabel} parent deposit to settle.`
export const formatEscalationDepositPageSummary = (startIndex: CopyTemplateValue, endIndex: CopyTemplateValue, totalCount: CopyTemplateValue, paginationSummary: CopyTemplateValue) => `Showing deposits ${startIndex}-${endIndex} of ${totalCount}. ${paginationSummary}`
export const formatImportedForkDepositPageSummary = (startIndex: CopyTemplateValue, endIndex: CopyTemplateValue, totalCount: CopyTemplateValue, paginationSummary: CopyTemplateValue) => `Showing parent deposits ${startIndex}-${endIndex} of ${totalCount}. ${paginationSummary}`
export const importedDepositSettlementDetail = 'These deposits were carried from the parent universe. After finalization, only winning deposits can be settled; losing deposits need no transaction.'
export const importedEntryDepthLead = 'Parent entry depth: '
export const importedFromParentUniverse = 'Carried from the parent universe'
export const initiallyDepositedLead = 'Initially deposited: '
export const leading = 'Leading'
export const nextDeposits = 'Next deposits'
export const nextParentDeposits = 'Next parent deposits'
export const parentDepositNumber = 'Parent deposit #'
export const previousDeposits = 'Previous deposits'
export const previousParentDeposits = 'Previous parent deposits'
export const settleForkCarriedEscalationDeposits = 'Settle parent deposits'
export const worthNowLead = 'Worth now: '
export const worthNowPendingFinalSettlement = 'Worth now: Pending final settlement'

export const winner = 'Winner'
export const you = 'You:'
