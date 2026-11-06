import type { CopyTemplateValue } from '@zoltar/ui-core-shared/copy/types.js'

export const depositNumber = 'Deposit #'
export const entryDepthLead = 'Entry depth: '
export const formatEscalationDepositPageSummary = (startIndex: CopyTemplateValue, endIndex: CopyTemplateValue, totalCount: CopyTemplateValue, paginationSummary: CopyTemplateValue) => `Showing deposits ${startIndex}-${endIndex} of ${totalCount}. ${paginationSummary}`
export const initiallyDepositedLead = 'Initially deposited: '
export const leading = 'Leading'
export const nextDeposits = 'Next deposits'
export const previousDeposits = 'Previous deposits'
export const worthNowLead = 'Worth now: '

export const winner = 'Winner'
export const you = 'You:'
