import type { CopyTemplateValue } from '@zoltar/ui-core-shared/copy/types.js'

export const depositNumber = 'Deposit #'
export const escalationAuctionHaircutDetail =
	'A repair auction can sell from both pool-held REP available to the repair auction and paused dispute-staked REP. Purchased REP is floor-allocated to the game; claims already present share that game-specific retention ratio. This prioritizes restoring settlement collateral that backs open interest over preserving escalation rewards, and the game resumes from reduced effective balances with a fresh response period.'
export const forkDepositSettlementAvailabilityDetail = 'Winning fork-carried escalation deposits can be settled after this child pool finalizes.'
export const formatDepositSelectionRequired = (outcomeLabel: CopyTemplateValue) => `Select at least one ${outcomeLabel} fork-carried deposit to settle.`
export const formatEscalationDepositPageSummary = (startIndex: CopyTemplateValue, endIndex: CopyTemplateValue, totalCount: CopyTemplateValue, paginationSummary: CopyTemplateValue) => `Showing deposits ${startIndex}-${endIndex} of ${totalCount}. ${paginationSummary}`
export const formatImportedForkDepositPageSummary = (startIndex: CopyTemplateValue, endIndex: CopyTemplateValue, totalCount: CopyTemplateValue, paginationSummary: CopyTemplateValue) => `Showing parent deposits ${startIndex}-${endIndex} of ${totalCount}. ${paginationSummary}`
export const importedDepositSettlementDetail = 'Imported from the parent universe. After finalization, only winning positions can be settled; inherited losers require no transaction.'
export const importedEntryDepthLead = 'Imported entry depth: '
export const importedFromParentUniverse = 'Imported from parent universe'
export const initiallyDepositedLead = 'Initially deposited: '
export const leading = 'Leading'
export const nextDeposits = 'Next deposits'
export const nextParentDeposits = 'Next parent deposits'
export const parentDepositNumber = 'Parent deposit #'
export const previousDeposits = 'Previous deposits'
export const previousParentDeposits = 'Previous parent deposits'
export const settleForkCarriedEscalationDeposits = 'Settle Fork-Carried Escalation Deposits'
export const totalDisputeStakedRep = 'Total dispute-staked REP'
export const worthNowLead = 'Worth now: '
export const worthNowPendingFinalSettlement = 'Worth now: Pending final settlement'
export const yourDisputeStakedRep = 'Your dispute-staked REP'
