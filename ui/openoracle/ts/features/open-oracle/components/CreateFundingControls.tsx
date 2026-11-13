import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import * as common from '@zoltar/ui-core-shared/copy/common.js'
import * as oracleCopy from '@zoltar/ui-statoblast-shared/copy/openOracle.js'
import * as copy from '../copy/funding.js'
import { getActiveNetworkProfile } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getWethAddress } from '@zoltar/ui-zoltar-shared/protocol/uniswapQuoter.js'
import type { useCreateFunding } from '../hooks/useCreateFunding.js'

export function CreateFundingControls({
	funding,
	units,
	symbols,
	disabled,
	guard,
	activeAction,
	approve,
	wrap,
}: {
	funding: ReturnType<typeof useCreateFunding>
	units: readonly (number | undefined)[]
	symbols: readonly (string | undefined)[]
	disabled: boolean
	guard: string | undefined
	activeAction: string | undefined
	approve: ((token: 'token1' | 'token2', amount: bigint) => void) | undefined
	wrap: (() => void) | undefined
}) {
	let wrapReason = guard
	if (wrapReason === undefined && funding.loading) wrapReason = copy.loading
	else if (wrapReason === undefined && funding.wrap === 0n) wrapReason = copy.notNeeded
	const tokens = funding.tokens
	if (tokens.length === 0) return null
	return (
		<div className='workflow-stack'>
			{funding.error === undefined ? null : <RetryableNotice message={funding.error} retryLabel={common.retry} onRetry={funding.retry} disabled={disabled} />}
			{funding.tokens.some(token => token.token === getWethAddress()) ? (
				<TransactionActionButton idleLabel={oracleCopy.wrapEth} pendingLabel={oracleCopy.wrappingEth} availability={{ disabled: disabled || funding.loading || funding.wrap === 0n || wrap === undefined, reason: wrapReason }} pending={activeAction === 'wrapWeth'} onClick={() => wrap?.()} tone='secondary' />
			) : null}
			{tokens.map((token, index) => {
				const symbol = symbols[index] ?? copy.funding
				const usdt = token.token?.toLowerCase() === getActiveNetworkProfile().usdtAddress?.toLowerCase()
				let resetReason = guard ?? funding.error
				if (resetReason === undefined && token.access === undefined) resetReason = copy.loading
				else if (resetReason === undefined && token.access?.allowance === 0n) resetReason = copy.notNeeded
				return (
					<div key={token.key}>
						{usdt ? (
							<TransactionActionButton
								idleLabel={common.formatResetTokenApproval(symbol)}
								pendingLabel={common.formatApprovingToken(symbol)}
								pending={activeAction === `approveToken${index + 1}`}
								availability={{ disabled: disabled || token.access === undefined || token.access.allowance === 0n || approve === undefined, reason: resetReason }}
								onClick={() => approve?.(token.key, 0n)}
								tone='secondary'
							/>
						) : null}
						<TokenApprovalControl
							actionLabel={oracleCopy.createStandaloneReport}
							allowanceError={undefined}
							allowanceLoading={funding.loading}
							approvedAmount={token.access?.allowance}
							disabled={disabled || approve === undefined}
							guardMessage={guard}
							requiresAllowanceReset={usdt}
							onApprove={amount => {
								if (amount !== undefined) approve?.(token.key, amount)
							}}
							pending={activeAction === `approveToken${index + 1}`}
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
