import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import * as common from '@zoltar/ui-core-shared/copy/common.js'
import * as oracleCopy from '@zoltar/ui-statoblast-shared/copy/openOracle.js'
import * as copy from '../copy/funding.js'
import { getWethAddress } from '@zoltar/ui-zoltar-shared/protocol/uniswapQuoter.js'
import type { useCreateFunding } from '../hooks/useCreateFunding.js'

export function CreateFundingControls({
	funding,
	units,
	symbols,
	disabled,
	wrapGuard,
	approvalGuard,
	activeAction,
	approve,
	wrap,
}: {
	funding: ReturnType<typeof useCreateFunding>
	units: readonly (number | undefined)[]
	symbols: readonly (string | undefined)[]
	disabled: boolean
	wrapGuard: string | undefined
	approvalGuard: string | undefined
	activeAction: string | undefined
	approve: ((token: 'token1' | 'token2', amount: bigint) => void) | undefined
	wrap: (() => void) | undefined
}) {
	let wrapReason = wrapGuard
	if (wrapReason === undefined && funding.loading) wrapReason = copy.loading
	else if (wrapReason === undefined && funding.wrap === 0n) wrapReason = common.notNeeded
	const tokens = funding.tokens
	if (tokens.length === 0) return undefined
	return (
		<div className='workflow-stack'>
			{funding.error === undefined ? undefined : <RetryableNotice message={funding.error} retryLabel={common.retry} onRetry={funding.retry} disabled={disabled} />}
			{funding.tokens.some(token => token.token === getWethAddress()) ? (
				<TransactionActionButton idleLabel={oracleCopy.wrapEth} pendingLabel={oracleCopy.wrappingEth} availability={{ disabled: disabled || wrapReason !== undefined || wrap === undefined, reason: wrapReason }} pending={activeAction === 'wrapWeth'} onClick={() => wrap?.()} tone='secondary' />
			) : undefined}
			{tokens.map((token, index) => {
				const symbol = symbols[index] ?? copy.funding
				const approvalActionPending = activeAction === `approveToken${index + 1}`
				return (
					<div key={token.key}>
						<TokenApprovalControl
							actionLabel={oracleCopy.createStandaloneReport}
							allowanceError={undefined}
							allowanceLoading={funding.loading}
							approvedAmount={token.access?.allowance}
							disabled={disabled || approve === undefined}
							guardMessage={approvalGuard}
							onApprove={amount => {
								if (amount !== undefined) approve?.(token.key, amount)
							}}
							pending={approvalActionPending}
							pendingLabel={common.formatApprovingToken(symbol)}
							requiredAmount={token.required}
							resetKey={`${token.token}:${token.required}`}
							tokenSymbol={symbol}
							tokenUnits={units[index] ?? 18}
						/>
					</div>
				)
			})}
		</div>
	)
}
