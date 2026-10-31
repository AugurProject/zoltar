import { assertActiveWallet } from '@zoltar/ui-core-shared/wallet/assertActiveWallet.js'
import { transactionErrorMessages } from '@zoltar/ui-core-shared/lib/errors.js'
import { useSignal } from '@preact/signals'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { WriteActionContext } from '@zoltar/ui-core-shared/transactions/writeAction.js'
import type { ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'
import type { buildForkCarriedEscalationProofs } from '../../../protocol/reportingCarryState.js'
import type { AuthenticatedForkClaim, ForkAuctionActionResult, ForkAuctionDetails } from '../../../types/contracts.js'

type ForkCarriedEscalationProofs = Awaited<ReturnType<typeof buildForkCarriedEscalationProofs>>

export type ForkClaimActionsDependencies<TWriteClient> = {
	prepareForkClaimCheckpoint: (client: TWriteClient, parent: Address, identity: AuthenticatedForkClaim) => Promise<ForkAuctionActionResult>
	prepareAndSettleForkClaim: (client: TWriteClient, parent: Address, identity: AuthenticatedForkClaim, proof: ForkCarriedEscalationProofs[number], rebuildProof: () => Promise<ForkCarriedEscalationProofs[number]>) => Promise<ForkAuctionActionResult>
	buildForkCarriedEscalationProofs: (securityPoolAddress: Address, outcome: ReportingOutcomeKey, parentDepositIndexes: readonly bigint[]) => Promise<ForkCarriedEscalationProofs>
	withdrawForkedEscalationDeposits: (client: TWriteClient, securityPoolAddress: Address, outcome: ReportingOutcomeKey, proofs: ForkCarriedEscalationProofs) => Promise<ForkAuctionActionResult>
}

type RunForkClaimAction = (
	actionName: 'prepareForkClaim' | 'settleForkedEscalation',
	action: (walletAddress: Address, details: ForkAuctionDetails, isCurrentSelection: () => boolean, context: WriteActionContext) => Promise<ForkAuctionActionResult | undefined>,
	errorFallback: string,
	securityPoolAddressOverride?: Address,
	universeIdOverride?: bigint,
	options?: { displayTitleOverride?: string },
) => Promise<void>

export function useForkClaimActions<TWriteClient>({
	createWriteClient,
	dependencies,
	isActionActive,
	runAction,
}: {
	createWriteClient: (walletAddress: Address, context: WriteActionContext, isCurrentSelection: () => boolean) => TWriteClient
	dependencies: ForkClaimActionsDependencies<TWriteClient>
	isActionActive: () => boolean
	runAction: RunForkClaimAction
}) {
	const forkClaimPreparation = useSignal<{ outcome: ReportingOutcomeKey; parentDepositIndex: bigint } | undefined>(undefined)

	const prepareForkClaim = async (identity: AuthenticatedForkClaim) => {
		const { outcome, parentDepositIndex } = identity
		if (isActionActive()) return
		forkClaimPreparation.value = { outcome, parentDepositIndex }
		try {
			await runAction(
				'prepareForkClaim',
				async (walletAddress, details, isCurrentSelection, context) => {
					if (!isCurrentSelection()) return undefined
					context.assertActive()
					return await dependencies.prepareForkClaimCheckpoint(createWriteClient(walletAddress, context, isCurrentSelection), details.securityPoolAddress, identity)
				},
				'Failed to prepare inherited claim',
			)
		} finally {
			forkClaimPreparation.value = undefined
		}
	}

	const prepareAndSettleForkDeposit = async (identity: AuthenticatedForkClaim) => {
		if (isActionActive()) return
		forkClaimPreparation.value = { outcome: identity.outcome, parentDepositIndex: identity.parentDepositIndex }
		try {
			await runAction(
				'settleForkedEscalation',
				async (walletAddress, details, isCurrentSelection, context) => {
					const rebuildProof = async () => {
						context.assertActive()
						if (!isCurrentSelection()) throw new Error(transactionErrorMessages.reviewCanceled)
						const [proof] = await dependencies.buildForkCarriedEscalationProofs(details.securityPoolAddress, identity.outcome, [identity.parentDepositIndex])
						context.assertActive()
						if (!isCurrentSelection()) throw new Error(transactionErrorMessages.reviewCanceled)
						await assertActiveWallet(walletAddress)
						context.assertActive()
						if (!isCurrentSelection()) throw new Error(transactionErrorMessages.reviewCanceled)
						if (proof === undefined) throw new Error('Inherited deposit is unavailable.')
						return proof
					}
					const proof = await rebuildProof()
					return await dependencies.prepareAndSettleForkClaim(createWriteClient(walletAddress, context, isCurrentSelection), details.securityPoolAddress, identity, proof, rebuildProof)
				},
				'Failed to prepare and settle inherited claim',
				undefined,
				undefined,
				{ displayTitleOverride: 'Prepare and settle inherited claim' },
			)
		} finally {
			forkClaimPreparation.value = undefined
		}
	}

	const settleForkedEscalation = async (outcome: ReportingOutcomeKey, parentDepositIndexes: bigint[]) =>
		await runAction(
			'settleForkedEscalation',
			async (walletAddress, details, isCurrentSelection, context) => {
				const proofs = await dependencies.buildForkCarriedEscalationProofs(details.securityPoolAddress, outcome, parentDepositIndexes)
				if (!isCurrentSelection()) return undefined
				context.assertActive()
				await assertActiveWallet(walletAddress)
				context.assertActive()
				if (!isCurrentSelection()) return undefined
				return await dependencies.withdrawForkedEscalationDeposits(createWriteClient(walletAddress, context, isCurrentSelection), details.securityPoolAddress, outcome, proofs)
			},
			'Failed to settle parent deposits',
		)

	return { forkClaimPreparation: forkClaimPreparation.value, prepareForkClaim, prepareAndSettleForkDeposit, settleForkedEscalation }
}
