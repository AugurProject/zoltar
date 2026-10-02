import { TokenApprovalControl } from './TokenApprovalControl.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import * as commonCopy from '../copy/common.js'
import * as transactionCopy from '../copy/transactionSteps.js'

/** Reserve the funding controls while their read-only requirements are being prepared. */
export function TransactionFundingActionsPlaceholder({ actionLabel, loading, resetKey }: { actionLabel: string; loading: boolean; resetKey: string }) {
	return (
		<>
			<div className='transaction-plan-action transaction-plan-action-wide'>
				<TransactionActionButton idleLabel={transactionCopy.wrapEthIntoWeth} pendingLabel={commonCopy.loading} availability={{ disabled: true, reason: transactionCopy.prerequisitesRequired }} onClick={() => undefined} />
			</div>
			{['WETH', commonCopy.rep].map(tokenSymbol => (
				<div key={tokenSymbol} className='transaction-plan-action'>
					<TokenApprovalControl
						compact
						showRequirementNotice={false}
						actionLabel={actionLabel}
						allowanceError={undefined}
						allowanceLoading={loading}
						approvedAmount={undefined}
						guardMessage={undefined}
						disabled
						onApprove={() => undefined}
						pending={false}
						pendingLabel={commonCopy.formatApprovingToken(tokenSymbol)}
						requiredAmount={undefined}
						resetKey={resetKey}
						tokenSymbol={tokenSymbol}
						tokenUnits={18}
					/>
				</div>
			))}
		</>
	)
}
