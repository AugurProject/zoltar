import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { retry } from '@zoltar/ui-core-shared/copy/common.js'
import { tokenRequiresAllowanceReset } from '@zoltar/ui-core-shared/transactions/tokenApproval.js'
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import * as copy from '../copy/collateral.js'
import type { useCollateralFunding } from './live/useCollateralFunding.js'

export function CollateralFundingControls({ funding, required, disabled, reason, actionLabel }: { actionLabel: string; funding: ReturnType<typeof useCollateralFunding>; required: bigint | undefined; disabled: boolean; reason: string | undefined }) {
	if (!funding.applicable) return null
	const { asset } = funding
	const requiresAllowanceReset = tokenRequiresAllowanceReset(asset.token)
	let resetReason = reason
	if (resetReason === undefined && funding.allowance === undefined) resetReason = copy.loading
	else if (resetReason === undefined && funding.allowance === 0n) resetReason = copy.notNeeded
	return (
		<div className='collateral-funding'>
			{funding.readError === undefined ? null : <RetryableNotice message={funding.readError} retryLabel={retry} onRetry={funding.retry} disabled={disabled} />}
			{requiresAllowanceReset ? (
				<TransactionActionButton
					idleLabel={copy.reset(asset.symbol)}
					pendingLabel={copy.resetting(asset.symbol)}
					pending={funding.resetting}
					availability={{ disabled: disabled || funding.allowance === undefined || funding.allowance === 0n, reason: resetReason }}
					onClick={() => void funding.approve(0n)}
					tone='secondary'
				/>
			) : null}
			<TokenApprovalControl
				actionLabel={actionLabel}
				allowanceError={funding.readError === undefined ? funding.error : undefined}
				allowanceLoading={funding.loading}
				approvedAmount={funding.allowance}
				disabled={disabled}
				guardMessage={reason}
				requiresAllowanceReset={requiresAllowanceReset}
				onApprove={amount => {
					if (amount !== undefined) void funding.approve(amount)
				}}
				pending={funding.pending && !funding.resetting}
				pendingLabel={copy.approving(asset.symbol)}
				requiredAmount={required}
				resetKey={`${asset.token}:${required}`}
				tokenSymbol={asset.symbol}
				tokenUnits={asset.decimals}
			/>
		</div>
	)
}
