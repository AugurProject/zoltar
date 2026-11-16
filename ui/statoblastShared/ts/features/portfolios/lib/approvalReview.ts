import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as transactionCopy from '@zoltar/ui-core-shared/copy/transaction.js'

type PortfolioApprovalReview = { label: string; reviewDescription?: string | undefined }

/**
 * How a portfolio token approval is named and explained in its review and its activity row. Approving zero resets the
 * allowance instead of granting one, so it is named and described as a reset whichever token it is for. Portfolio
 * transactions are reviewed under their label, so the shared `approve` review cannot derive this for them.
 */
export function portfolioApprovalReview(amount: bigint, symbol: string | undefined, approval: PortfolioApprovalReview): PortfolioApprovalReview {
	if (amount !== 0n) return approval
	return { label: symbol === undefined ? transactionCopy.tokenApprovalReset.title : commonCopy.formatResetTokenApproval(symbol), reviewDescription: transactionCopy.tokenApprovalReset.description }
}
