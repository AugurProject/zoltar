import * as copy from '../../../copy/reporting.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { getImportedEscalationDepositClaimAmount } from '../lib/reportingDomain.js'
import { useEffect, useRef } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { buildWriteActionConfig, runWriteAction } from '@zoltar/ui-core-shared/transactions/writeAction.js'
import { getWalletActiveAppChainGuardState } from '@zoltar/ui-core-shared/transactions/actionGuards.js'
import { isActiveAppChain } from '@zoltar/ui-core-shared/wallet/network.js'
import { createConnectedReadClient, createWalletWriteClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { buildForkCarriedEscalationProofs, prepareForkClaimCheckpoint, withdrawForkedEscalationDeposits } from '../../../protocol/reportingCarryState.js'
import { loadReportingDetails } from '../../../protocol/reporting.js'
import type { AuthenticatedForkClaim, ReportingDetails } from '../../../types/contracts.js'
import type { AccountState, WriteOperationsParameters } from '../../../types/app.js'

type Props = {
	parameters: WriteOperationsParameters
	accountState: AccountState
	details: ReportingDetails | undefined
	onRefresh: () => Promise<unknown>
}

/** Inherited reporter claims are question claims, independent of underwriting ownership. */
export function InheritedReporterClaims({ parameters, accountState, details, onRefresh }: Props) {
	const error = useSignal<string | undefined>(undefined)
	const pending = useSignal<string | undefined>(undefined)
	const selection = `${details?.securityPoolAddress ?? ''}:${accountState.address ?? ''}:${accountState.chainId ?? ''}`
	const current = useRef(selection)
	current.current = selection
	useEffect(
		() => () => {
			current.current = ''
		},
		[],
	)
	const active = details?.status === 'active' ? details : undefined
	const claims = active?.sides.flatMap(side => side.importedUserDeposits.map(deposit => ({ side, deposit }))) ?? []
	if (claims.length === 0) return undefined
	const walletReason = getWalletActiveAppChainGuardState({ accountAddress: accountState.address, isOnActiveAppChain: isActiveAppChain(accountState.chainId) })?.reason
	const run = async (identity: AuthenticatedForkClaim, settle: boolean) => {
		if (pending.value !== undefined || active === undefined) return
		const pool = active.securityPoolAddress
		const key = `${identity.outcome}:${identity.parentDepositIndex}:${settle}`
		pending.value = key
		error.value = undefined
		const assertSelection = () => {
			if (current.current !== selection) throw new Error('Question or wallet changed. Reopen the claim and retry.')
		}
		try {
			await runWriteAction(
				buildWriteActionConfig({ ...parameters, onTransactionCanceled: parameters.onTransactionCanceled, onTransactionFailed: parameters.onTransactionFailed, onTransactionPrepared: parameters.onTransactionPrepared }, error, commonCopy.formatConnectWalletBefore('recovering reporter REP'), {
					action: settle ? 'settleForkedEscalation' : 'prepareForkClaim',
					source: copy.recoverySource,
					submittedTitle: settle ? copy.settleInheritedClaim : copy.prepareInheritedClaim,
					universeId: active.universeId,
				}),
				async (account, context) => {
					assertSelection()
					const read = createConnectedReadClient()
					const latest = await loadReportingDetails(read, pool, account)
					context.assertActive()
					assertSelection()
					const deposit = latest.status === 'active' ? latest.sides.find(side => side.key === identity.outcome)?.importedUserDeposits.find(candidate => candidate.parentDepositIndex === identity.parentDepositIndex) : undefined
					if (deposit?.claimIdentity === undefined || deposit.claimIdentity.snapshotRoot !== identity.snapshotRoot || deposit.depositor.toLowerCase() !== account.toLowerCase()) throw new Error('Inherited claim changed. Refresh and retry.')
					if (settle && (latest.settlementState !== 'resolved' || latest.questionOutcome !== identity.outcome || deposit.claimCheckpoint?.ready === false)) throw new Error('The winning claim must be finalized and prepared before settlement.')
					const client = createWalletWriteClient(account, { reviewSignal: context.reviewSignal, onTransactionPrepared: parameters.onTransactionPrepared, onTransactionSubmitted: parameters.onTransactionSubmitted })
					if (!settle) return await prepareForkClaimCheckpoint(client, pool, deposit.claimIdentity)
					const proofs = await buildForkCarriedEscalationProofs(read, pool, identity.outcome, [identity.parentDepositIndex])
					context.assertActive()
					assertSelection()
					return await withdrawForkedEscalationDeposits(client, pool, identity.outcome, proofs)
				},
				'Unable to recover the inherited reporter claim.',
				async result => {
					parameters.onTransactionPresented({ hash: result.hash, title: settle ? copy.claimSettled : copy.claimPrepared, tone: 'success', showStatusDialog: false, universeId: active.universeId })
					if (current.current === selection) await onRefresh()
				},
			)
		} finally {
			pending.value = undefined
		}
	}
	return (
		<SectionBlock title={copy.inheritedClaims} description={copy.inheritedClaimsDescription}>
			<ErrorNotice message={error.value} />
			{claims.map(({ side, deposit }) => {
				const identity = deposit.claimIdentity
				const baseReason = walletReason ?? (pending.value === undefined ? undefined : copy.claimPending) ?? (identity === undefined ? copy.claimAuthenticationRequired : undefined)
				const prepared = deposit.claimCheckpoint?.ready === true
				let settlementReason: string | undefined
				if (!prepared) settlementReason = copy.claimPreparationRequired
				else if (active?.settlementState !== 'resolved') settlementReason = copy.claimResolutionRequired
				else if (active.questionOutcome !== side.key) settlementReason = copy.claimWinningOutcomeRequired
				const settleReason = baseReason ?? settlementReason
				return (
					<div key={`${side.key}:${deposit.parentDepositIndex}`} className='workflow-subsection'>
						<p>
							{copy.inheritedClaimIdentity(side.label, deposit.parentDepositIndex.toString())} <CurrencyValue value={getImportedEscalationDepositClaimAmount(active, side.key, deposit)} suffix={copy.repUnit} />
						</p>
						<div className='actions'>
							<TransactionActionButton
								idleLabel={copy.prepareClaim}
								pendingLabel={copy.preparingClaim}
								pending={pending.value === `${side.key}:${deposit.parentDepositIndex}:false`}
								availability={{ disabled: baseReason !== undefined || prepared, reason: baseReason ?? (prepared ? copy.claimAlreadyPrepared : undefined) }}
								onClick={() => {
									if (identity !== undefined) void run(identity, false)
								}}
							/>
							<TransactionActionButton
								idleLabel={copy.settleClaim}
								pendingLabel={copy.settlingClaim}
								pending={pending.value === `${side.key}:${deposit.parentDepositIndex}:true`}
								availability={{ disabled: settleReason !== undefined, reason: settleReason }}
								onClick={() => {
									if (identity !== undefined) void run(identity, true)
								}}
							/>
						</div>
					</div>
				)
			})}
		</SectionBlock>
	)
}
