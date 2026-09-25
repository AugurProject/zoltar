import type { CopyTemplateValue } from './types.js'

export const transactionReview = 'Transaction Review'
export const risksAndConsequences = 'Risks and Consequences'
export const youPay = 'You Pay'
export const resultingEthBalance = 'Resulting ETH Balance'
export const amountUnavailable = 'Enter a valid amount to preview'
export const changeArrow = '→'
export const changeTo = 'to'
export const balanceInsufficient = 'Insufficient'
export const severityDanger = 'High risk'
export const severityCaution = 'Caution'
export const severityInfo = 'Note'
export const confirmationRequired = 'Confirm the irreversible burn first.'
export const typedAmountMismatch = 'The typed amount does not match.'
export const formatChangeExceedsBalance = (label: CopyTemplateValue) => `${label} is lower than this transaction needs.`
export const formatAcknowledgeBurn = (amountLabel: CopyTemplateValue) => `I understand this burns ${amountLabel} from my wallet and cannot be undone.`
export const formatTypeBurnAmount = (amountLabel: CopyTemplateValue) => `Type ${amountLabel} to confirm the irreversible burn`
