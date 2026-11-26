export const claimYourRep = 'Claim your REP'
export const deposit = 'Deposit'
export const selectDeposits = 'Select deposits'
export const deposited = 'Deposited'
export const youReceive = 'You receive'
export const lostNoActionNeeded = 'Lost · no action needed'
export const selectDepositToClaim = 'Select a deposit to claim.'
export const claimRep = (amount: string) => `Claim ${amount}`
export const claimingRep = (amount: string) => `Claiming ${amount}`
export const depositLabel = (index: bigint, outcome: string) => `#${index} · ${outcome}`
export const depositCheckboxLabel = (index: bigint, outcome: string) => `${deposit} ${depositLabel(index, outcome)}`
