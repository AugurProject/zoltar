import { useState } from 'preact/hooks'
import type { Address } from '@zoltar/shared/ethereum'
import * as commonCopy from '../../../copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { AddressValue } from '../../../components/AddressValue.js'
import { Badge } from '../../../components/Badge.js'
import { CurrencyValue } from '../../../components/CurrencyValue.js'
import { ErrorNotice } from '../../../components/ErrorNotice.js'
import { FormInput } from '../../../components/FormInput.js'
import { MetricField } from '../../../components/MetricField.js'
import { MetricGrid } from '../../../components/MetricGrid.js'
import { SectionBlock } from '../../../components/SectionBlock.js'
import { StateHint } from '../../../components/StateHint.js'
import { TransactionActionButton } from '../../../components/TransactionActionButton.js'
import { formatTimestamp } from '../../../lib/formatters.js'
import { sameAddress } from '../../../lib/address.js'
import { tryParseAddressInput } from '../../../lib/inputs.js'
import { tryParseBigIntInput, tryParseRepAmountInput } from '../../markets/lib/marketForm.js'
import type { OpenOracleActionResult, OracleManagerDetails, OracleOperationBounty, OracleOperationBountyInput, OracleQueueOperation } from '../../../types/contracts.js'

type OperationBountyBoardProps = {
	accountAddress: Address | undefined
	activeAction: OpenOracleActionResult['action'] | undefined
	activeBountyId: bigint | undefined
	currentTimestamp: bigint | undefined
	isMainnet: boolean
	loadingBounty: boolean
	lookupError: string | undefined
	managerDetails: OracleManagerDetails
	onAccept: (managerAddress: Address, bountyId: bigint) => void
	onClaim: (managerAddress: Address, bountyId: bigint) => void
	onClearLookupError: () => void
	onLoad: (managerAddress: Address, bountyId: bigint) => void
	onPost: (managerAddress: Address, bounty: OracleOperationBountyInput) => void
	onRefund: (managerAddress: Address, bountyId: bigint) => void
}

function getOperationLabel(operation: OracleQueueOperation) {
	if (operation === 'liquidation') return securityPoolCopy.liquidation
	if (operation === 'withdrawRep') return securityPoolCopy.withdrawRep
	return securityPoolCopy.setBondAllowance
}

function getOperationUnit(operation: OracleQueueOperation) {
	return operation === 'withdrawRep' ? commonCopy.rep : commonCopy.eth
}

function getBountyStateLabel(bounty: OracleOperationBounty) {
	if (bounty.state === 'paid') return securityPoolCopy.bountyPaid
	if (bounty.state === 'refunded') return securityPoolCopy.bountyRefunded
	if (bounty.state === 'open') return securityPoolCopy.bountyOpen
	if (bounty.executionStatus === 'succeeded') return securityPoolCopy.bountyReadyToClaim
	if (bounty.executionStatus === 'failed') return securityPoolCopy.bountyFailed
	return securityPoolCopy.bountyInProgress
}

function getBountyTone(bounty: OracleOperationBounty) {
	if (bounty.state === 'paid' || bounty.executionStatus === 'succeeded') return 'ok' as const
	if (bounty.state === 'refunded') return 'muted' as const
	if (bounty.executionStatus === 'failed') return 'blocked' as const
	return 'warning' as const
}

function resolveBountyTargetVault(operation: OracleQueueOperation, targetVault: string, accountAddress: Address | undefined) {
	if (operation !== 'liquidation') return accountAddress
	return tryParseAddressInput(targetVault)
}

function getAcceptGuardMessage(accountAddress: Address | undefined, isMainnet: boolean, acceptanceExpired: boolean) {
	if (accountAddress === undefined) return securityPoolCopy.acceptBountyWalletReason
	if (!isMainnet) return commonCopy.mainnetRequiredReason
	if (acceptanceExpired) return securityPoolCopy.bountyAcceptanceExpired
	return undefined
}

function getClaimGuardMessage(isMainnet: boolean, executionStatus: OracleOperationBounty['executionStatus']) {
	if (!isMainnet) return commonCopy.mainnetRequiredReason
	if (executionStatus === 'failed') return securityPoolCopy.failedBountyCannotBeClaimed
	if (executionStatus !== 'succeeded') return securityPoolCopy.waitForBountyExecution
	return undefined
}

function getRefundGuardMessage(isMainnet: boolean, refundEnabled: boolean, refundAvailableAt: bigint | undefined) {
	if (!isMainnet) return commonCopy.mainnetRequiredReason
	if (refundEnabled) return undefined
	if (refundAvailableAt === undefined) return securityPoolCopy.waitForBountyFailure
	return securityPoolCopy.formatRefundAvailableAt(formatTimestamp(refundAvailableAt))
}

export function OperationBountyBoard({ accountAddress, activeAction, activeBountyId, currentTimestamp, isMainnet, loadingBounty, lookupError, managerDetails, onAccept, onClaim, onClearLookupError, onLoad, onPost, onRefund }: OperationBountyBoardProps) {
	const [operation, setOperation] = useState<OracleQueueOperation>('setSecurityBondsAllowance')
	const [targetVault, setTargetVault] = useState('')
	const [amount, setAmount] = useState('0')
	const [validForMinutes, setValidForMinutes] = useState('5')
	const [rewardToken, setRewardToken] = useState<'rep' | 'weth'>('weth')
	const [rewardAmount, setRewardAmount] = useState('0')
	const [acceptanceMinutes, setAcceptanceMinutes] = useState('60')
	const [minimumInitialWeth, setMinimumInitialWeth] = useState('')
	const [maximumInitialWeth, setMaximumInitialWeth] = useState('')
	const [bountyIdInput, setBountyIdInput] = useState('')
	const resolvedAmount = tryParseRepAmountInput(amount)
	const resolvedRewardAmount = tryParseRepAmountInput(rewardAmount)
	const resolvedValidForMinutes = tryParseBigIntInput(validForMinutes)
	const resolvedAcceptanceMinutes = tryParseBigIntInput(acceptanceMinutes)
	const resolvedMinimumInitialWeth = minimumInitialWeth.trim() === '' ? 0n : tryParseRepAmountInput(minimumInitialWeth)
	const resolvedMaximumInitialWeth = maximumInitialWeth.trim() === '' ? 0n : tryParseRepAmountInput(maximumInitialWeth)
	const resolvedBountyId = tryParseBigIntInput(bountyIdInput)
	const resolvedTargetVault = resolveBountyTargetVault(operation, targetVault, accountAddress)
	const resolvedRewardToken = rewardToken === 'rep' ? managerDetails.reputationTokenAddress : managerDetails.wethAddress
	const operationUnit = getOperationUnit(operation)
	const postGuardMessage = (() => {
		if (accountAddress === undefined) return securityPoolCopy.connectWalletForBounty
		if (!isMainnet) return commonCopy.mainnetRequiredReason
		if (currentTimestamp === undefined) return securityPoolCopy.waitForChainTime
		if (resolvedRewardToken === undefined) return securityPoolCopy.refreshBountyTokens
		if (resolvedTargetVault === undefined) return securityPoolCopy.enterValidBountyTarget
		if (resolvedAmount === undefined || (operation !== 'setSecurityBondsAllowance' && resolvedAmount <= 0n)) return securityPoolCopy.enterValidBountyAmount
		if (resolvedRewardAmount === undefined || resolvedRewardAmount <= 0n) return securityPoolCopy.enterValidBountyReward
		if (resolvedValidForMinutes === undefined || resolvedValidForMinutes < 1n || resolvedValidForMinutes > 5n) return securityPoolCopy.enterValidBountyTimeout
		if (resolvedAcceptanceMinutes === undefined || resolvedAcceptanceMinutes <= 0n) return securityPoolCopy.enterValidBountyDeadline
		if (resolvedMinimumInitialWeth === undefined || resolvedMaximumInitialWeth === undefined) return securityPoolCopy.enterValidInitialWethBounds
		if (resolvedMaximumInitialWeth > 0n && resolvedMinimumInitialWeth > resolvedMaximumInitialWeth) return securityPoolCopy.enterOrderedInitialWethBounds
		return undefined
	})()
	const postBounty = () => {
		if (
			accountAddress === undefined ||
			currentTimestamp === undefined ||
			resolvedRewardToken === undefined ||
			resolvedTargetVault === undefined ||
			resolvedAmount === undefined ||
			resolvedRewardAmount === undefined ||
			resolvedValidForMinutes === undefined ||
			resolvedAcceptanceMinutes === undefined ||
			resolvedMinimumInitialWeth === undefined ||
			resolvedMaximumInitialWeth === undefined ||
			postGuardMessage !== undefined
		)
			return
		onPost(managerDetails.managerAddress, {
			acceptanceDeadline: currentTimestamp + resolvedAcceptanceMinutes * 60n,
			amount: resolvedAmount,
			maximumInitialReportAmount2: resolvedMaximumInitialWeth,
			minimumInitialReportAmount2: resolvedMinimumInitialWeth,
			operation,
			rewardAmount: resolvedRewardAmount,
			rewardToken: resolvedRewardToken,
			targetVault: resolvedTargetVault,
			validForSeconds: resolvedValidForMinutes * 60n,
		})
	}
	const operationBounties = managerDetails.operationBounties ?? []
	const bountyLookupGuardMessage = resolvedBountyId === undefined || resolvedBountyId <= 0n ? securityPoolCopy.enterValidBountyId : undefined
	const loadBounty = () => {
		if (resolvedBountyId === undefined || resolvedBountyId <= 0n) return
		onLoad(managerDetails.managerAddress, resolvedBountyId)
	}

	return (
		<SectionBlock density='compact' headingLevel={3} title={securityPoolCopy.operationBounties} variant='embedded'>
			<p className='detail'>{securityPoolCopy.operationBountiesDetail}</p>
			<p className='detail'>{securityPoolCopy.operationBountyAcceptanceDetail}</p>
			<SectionBlock density='compact' headingLevel={4} title={securityPoolCopy.postOperationBounty} variant='embedded'>
				<div className='form-grid'>
					<div className='field-row'>
						<label className='field'>
							<span>{securityPoolCopy.operation}</span>
							<select value={operation} onChange={event => setOperation(event.currentTarget.value as OracleQueueOperation)}>
								<option value='setSecurityBondsAllowance'>{securityPoolCopy.setBondAllowance}</option>
								<option value='withdrawRep'>{securityPoolCopy.withdrawRep}</option>
								<option value='liquidation'>{securityPoolCopy.liquidation}</option>
							</select>
						</label>
						<label className='field'>
							<span>{securityPoolCopy.formatOperationAmountLabel(operationUnit)}</span>
							<FormInput value={amount} onInput={event => setAmount(event.currentTarget.value)} inputMode='decimal' />
						</label>
					</div>
					{operation === 'liquidation' ? (
						<label className='field'>
							<span>{commonCopy.targetVault}</span>
							<FormInput value={targetVault} onInput={event => setTargetVault(event.currentTarget.value)} placeholder={commonCopy.hexValuePlaceholder} />
						</label>
					) : (
						<p className='field-help'>{securityPoolCopy.selfTargetedBountyDetail}</p>
					)}
					<div className='field-row'>
						<label className='field'>
							<span>{securityPoolCopy.executionWindow}</span>
							<div className='field-inline'>
								<FormInput className='field-inline-input' value={validForMinutes} onInput={event => setValidForMinutes(event.currentTarget.value)} inputMode='numeric' min='1' max='5' />
								<span className='field-inline-action'>{commonCopy.minutes}</span>
							</div>
						</label>
						<label className='field'>
							<span>{securityPoolCopy.acceptanceWindow}</span>
							<div className='field-inline'>
								<FormInput className='field-inline-input' value={acceptanceMinutes} onInput={event => setAcceptanceMinutes(event.currentTarget.value)} inputMode='numeric' min='1' />
								<span className='field-inline-action'>{commonCopy.minutes}</span>
							</div>
						</label>
					</div>
					<p className='field-help'>{securityPoolCopy.executionWindowDetail}</p>
					<div className='field-row'>
						<label className='field'>
							<span>{securityPoolCopy.rewardToken}</span>
							<select value={rewardToken} onChange={event => setRewardToken(event.currentTarget.value as 'rep' | 'weth')}>
								<option value='weth'>{commonCopy.weth}</option>
								<option value='rep'>{commonCopy.rep}</option>
							</select>
						</label>
						<label className='field'>
							<span>{securityPoolCopy.rewardAmount}</span>
							<FormInput value={rewardAmount} onInput={event => setRewardAmount(event.currentTarget.value)} inputMode='decimal' />
						</label>
					</div>
					<div className='field-row'>
						<label className='field'>
							<span>{securityPoolCopy.minimumInitialWeth}</span>
							<FormInput value={minimumInitialWeth} onInput={event => setMinimumInitialWeth(event.currentTarget.value)} inputMode='decimal' placeholder={securityPoolCopy.noMinimum} />
						</label>
						<label className='field'>
							<span>{securityPoolCopy.maximumInitialWeth}</span>
							<FormInput value={maximumInitialWeth} onInput={event => setMaximumInitialWeth(event.currentTarget.value)} inputMode='decimal' placeholder={securityPoolCopy.noMaximum} />
						</label>
					</div>
					<p className='field-help'>{securityPoolCopy.initialWethBoundsDetail}</p>
					<div className='actions'>
						<TransactionActionButton idleLabel={securityPoolCopy.postBounty} pendingLabel={securityPoolCopy.postingBounty} onClick={postBounty} pending={activeAction === 'postOperationBounty'} availability={{ disabled: postGuardMessage !== undefined, reason: postGuardMessage }} />
					</div>
				</div>
			</SectionBlock>

			<SectionBlock density='compact' headingLevel={4} title={securityPoolCopy.availableOperationBounties} variant='embedded'>
				<p className='detail'>{securityPoolCopy.operationBountyLookupDetail}</p>
				<div className='form-grid'>
					<label className='field'>
						<span>{securityPoolCopy.bountyId}</span>
						<FormInput
							value={bountyIdInput}
							onInput={event => {
								setBountyIdInput(event.currentTarget.value)
								onClearLookupError()
							}}
							inputMode='numeric'
							min='1'
						/>
					</label>
					<div className='actions'>
						<TransactionActionButton idleLabel={securityPoolCopy.loadBounty} pendingLabel={securityPoolCopy.loadingBounty} onClick={loadBounty} pending={loadingBounty} tone='secondary' availability={{ disabled: bountyLookupGuardMessage !== undefined, reason: bountyLookupGuardMessage }} />
					</div>
					<ErrorNotice message={lookupError} />
				</div>
				<div className='entity-card-list'>
					{operationBounties.map(bounty => {
						const isCreator = sameAddress(accountAddress, bounty.creator)
						const isOperator = sameAddress(accountAddress, bounty.operator)
						const acceptanceExpired = currentTimestamp !== undefined && currentTimestamp > bounty.acceptanceDeadline
						const refundExpired = currentTimestamp !== undefined && bounty.refundAvailableAt !== undefined && currentTimestamp > bounty.refundAvailableAt
						const refundEnabled = bounty.state === 'open' || bounty.executionStatus === 'failed' || refundExpired
						const acceptGuardMessage = getAcceptGuardMessage(accountAddress, isMainnet, acceptanceExpired)
						const claimGuardMessage = getClaimGuardMessage(isMainnet, bounty.executionStatus)
						const refundGuardMessage = getRefundGuardMessage(isMainnet, refundEnabled, bounty.refundAvailableAt)
						const rewardSymbol = sameAddress(bounty.rewardToken, managerDetails.reputationTokenAddress) ? commonCopy.rep : commonCopy.weth
						const bountyOperationUnit = getOperationUnit(bounty.operation)
						return (
							<article className='entity-card compact' key={bounty.bountyId.toString()}>
								<div className='entity-card-header'>
									<div className='entity-card-copy'>
										<h5 className='entity-card-title'>{securityPoolCopy.formatOperationBountyLabel(bounty.bountyId.toString(), getOperationLabel(bounty.operation))}</h5>
										<p className='detail'>{securityPoolCopy.formatExecutionWindowDetail((bounty.validForSeconds / 60n).toString())}</p>
									</div>
									<Badge tone={getBountyTone(bounty)}>{getBountyStateLabel(bounty)}</Badge>
								</div>
								<MetricGrid className='entity-card-body'>
									<MetricField label={securityPoolCopy.creator}>
										<AddressValue address={bounty.creator} />
									</MetricField>
									<MetricField label={commonCopy.targetVault}>
										<AddressValue address={bounty.targetVault} />
									</MetricField>
									<MetricField label={securityPoolCopy.formatOperationAmountLabel(bountyOperationUnit)}>
										<CurrencyValue value={bounty.amount} suffix={bountyOperationUnit} />
									</MetricField>
									<MetricField label={securityPoolCopy.reward}>
										<CurrencyValue value={bounty.rewardAmount} suffix={rewardSymbol} />
									</MetricField>
									<MetricField label={securityPoolCopy.acceptBy}>{formatTimestamp(bounty.acceptanceDeadline)}</MetricField>
									{bounty.operator === '0x0000000000000000000000000000000000000000' ? null : (
										<MetricField label={securityPoolCopy.operator}>
											<AddressValue address={bounty.operator} />
										</MetricField>
									)}
									{bounty.reportId === 0n ? null : <MetricField label={securityPoolCopy.report}>{commonCopy.formatReportNumberLabel(bounty.reportId.toString())}</MetricField>}
								</MetricGrid>
								{bounty.executionErrorMessage === undefined ? null : <p className='detail'>{securityPoolCopy.formatBountyFailureDetail(bounty.executionErrorMessage)}</p>}
								<div className='entity-card-actions'>
									{bounty.state === 'open' ? (
										<TransactionActionButton
											idleLabel={securityPoolCopy.acceptAndFund}
											pendingLabel={securityPoolCopy.acceptingBounty}
											onClick={() => onAccept(managerDetails.managerAddress, bounty.bountyId)}
											pending={activeAction === 'acceptOperationBounty' && activeBountyId === bounty.bountyId}
											tone='secondary'
											availability={{
												disabled: acceptGuardMessage !== undefined,
												reason: acceptGuardMessage,
											}}
										/>
									) : null}
									{isOperator && bounty.state === 'assigned' ? (
										<TransactionActionButton
											idleLabel={securityPoolCopy.claimBounty}
											pendingLabel={securityPoolCopy.claimingBounty}
											onClick={() => onClaim(managerDetails.managerAddress, bounty.bountyId)}
											pending={activeAction === 'claimOperationBounty' && activeBountyId === bounty.bountyId}
											availability={{ disabled: claimGuardMessage !== undefined, reason: claimGuardMessage }}
										/>
									) : null}
									{isCreator && (bounty.state === 'open' || bounty.state === 'assigned') ? (
										<TransactionActionButton
											idleLabel={bounty.state === 'open' ? securityPoolCopy.refundBounty : securityPoolCopy.cancelAndRefundBounty}
											pendingLabel={securityPoolCopy.refundingBounty}
											onClick={() => onRefund(managerDetails.managerAddress, bounty.bountyId)}
											pending={activeAction === 'refundOperationBounty' && activeBountyId === bounty.bountyId}
											tone='secondary'
											availability={{ disabled: refundGuardMessage !== undefined, reason: refundGuardMessage }}
										/>
									) : null}
								</div>
							</article>
						)
					})}
				</div>
				{operationBounties.length === 0 ? <StateHint presentation={{ key: 'empty', badgeLabel: securityPoolCopy.noBounties, badgeTone: 'muted', detail: securityPoolCopy.noBountiesDetail }} /> : null}
			</SectionBlock>
		</SectionBlock>
	)
}
