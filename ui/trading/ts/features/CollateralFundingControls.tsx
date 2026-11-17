import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import * as common from '@zoltar/ui-core-shared/copy/common.js'
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import type { useCollateralFunding } from './live/useCollateralFunding.js'

export function CollateralFundingControls({ funding, required, disabled, reason, actionLabel }: { actionLabel: string; funding: ReturnType<typeof useCollateralFunding>; required: bigint | undefined; disabled: boolean; reason: string | undefined }) {
	if (!funding.applicable) return undefined
	const { asset } = funding
	return (
		<div className='collateral-funding'>
			{funding.readError === undefined ? undefined : <RetryableNotice message={funding.readError} retryLabel={common.retry} onRetry={funding.retry} disabled={disabled} />}
			<TokenApprovalControl
				actionLabel={actionLabel}
				allowanceError={funding.readError === undefined ? funding.error : undefined}
				allowanceLoading={funding.loading}
				approvedAmount={funding.allowance}
				disabled={disabled}
				guardMessage={reason}
				onApprove={amount => {
					if (amount !== undefined) void funding.approve(amount)
				}}
				pending={funding.pending}
				pendingLabel={common.formatApprovingToken(asset.symbol)}
				requiredAmount={required}
				resetKey={`${asset.token}:${required}`}
				tokenSymbol={asset.symbol}
				tokenUnits={asset.decimals}
			/>
		</div>
	)
}
