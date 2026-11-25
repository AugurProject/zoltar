import { newPriceRequired, poolChanged, purchase as copy, refreshingBalances } from '../../../copy/securityPoolTransactions.js'
import { loadRecoveryMintFunding } from '../../../protocol/recoveryMintFunding.js'
import * as collateralCopy from '../../../copy/collateral.js'
import { enterSecurityPool, mintReview, unsupportedAdmission } from '../../../copy/securityPool.js'
import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { encodeFunctionData, formatUnits, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { buildSecurityPoolMintRequest, loadSecurityPoolMintQuote, type SecurityPoolMintQuote } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { loadSecurityPoolAccount, securityPoolReadClient } from '../../../protocol/securityPool.js'
import { loadSecurityPoolMintQuestion } from '../../../protocol/securityPoolMint.js'
import { securityPoolAmountOrUndefined, securityPoolUnsignedId } from '../lib/draft.js'
import { reviewBalance, type ReviewRow } from '../lib/reviewRows.js'
import { withStatoblastRequestTimeout } from '../../../protocol/requestTimeout.js'
import { currentStateCheckFailed } from '@zoltar/ui-core-shared/copy/transaction.js'
import type { useSecurityPool } from './useSecurityPool.js'
import type { useSecurityPoolActions } from './useSecurityPoolActions.js'

export function useSecurityPoolPurchase(model: Pick<ReturnType<typeof useSecurityPool>, 'snapshot' | 'loading'>, actions: Pick<ReturnType<typeof useSecurityPoolActions>, 'ownerReason' | 'runSecurityPoolAction'>) {
	const questionInput = useSignal('')
	const mintAmount = useSignal('')
	const maximumFee = useSignal('')
	const maximumRecoveryRep = useSignal('')
	const minimumShares = useSignal('0')
	const recoveryKnowledge = useSignal<{ selection: string; applicable: boolean }>()
	const loaded = useSignal<{ key: string; quote?: SecurityPoolMintQuote; readAt?: number; recovery?: Awaited<ReturnType<typeof loadRecoveryMintFunding>>; question?: Awaited<ReturnType<typeof loadSecurityPoolMintQuestion>>; error?: string } | undefined>(undefined)
	const snapshot = model.snapshot
	const questionId = securityPoolUnsignedId(questionInput.value)
	const decimals = snapshot?.collateral.decimals ?? 18
	const amount = securityPoolAmountOrUndefined(mintAmount.value, decimals)
	const fee = securityPoolAmountOrUndefined(maximumFee.value, decimals)
	const parsedRecoveryBudget = maximumRecoveryRep.value.trim() === '' ? 0n : securityPoolAmountOrUndefined(maximumRecoveryRep.value, 18)
	const minimum = securityPoolAmountOrUndefined(minimumShares.value, decimals)
	const selection = `${snapshot?.securityPool}:${snapshot?.universeId}:${snapshot?.owner}:${questionId}:${amount}`
	useEffect(() => {
		recoveryKnowledge.value = undefined
	}, [selection])
	const key = `${snapshot?.securityPool}:${snapshot?.universeId}:${snapshot?.owner}:${snapshot?.blockHash}:${questionId}:${amount}`
	useEffect(() => {
		let current = true
		loaded.value = undefined
		if (snapshot !== undefined && questionId !== undefined && amount !== undefined && amount > 0n) {
			const client = createConnectedReadClient()
			void (async () => {
				const question = await loadSecurityPoolMintQuestion(client, snapshot, questionId)
				const quote = await loadSecurityPoolMintQuote({ client: securityPoolReadClient(client), securityPool: snapshot.securityPool, universeId: snapshot.universeId, questionId, mintAttoEth: amount, blockNumber: snapshot.blockNumber })
				if (current) {
					recoveryKnowledge.value = { selection, applicable: quote.recoveryAttoRep > 0n }
					if (maximumRecoveryRep.value.trim() === '' && quote.maximumRecoveryAttoRep > 0n) maximumRecoveryRep.value = formatUnits(quote.maximumRecoveryAttoRep, 18)
				}
				const recovery = await loadRecoveryMintFunding(client, snapshot.securityPool, snapshot.universeId, snapshot.auctionVault?.bidder ?? snapshot.owner, quote.recoveryAttoRep, snapshot.blockNumber)
				if (current) {
					loaded.value = { key, quote, question, recovery, readAt: Date.now() }
				}
			})().catch(failure => {
				if (current) loaded.value = { key, error: getErrorMessage(failure, copy.quoteFailed) }
			})
		}
		return () => {
			current = false
		}
	}, [key])
	useEffect(() => {
		loaded.value = undefined
		maximumFee.value = ''
		maximumRecoveryRep.value = ''
		minimumShares.value = '0'
	}, [snapshot?.securityPool, snapshot?.universeId, snapshot?.owner])
	const current = loaded.value?.key === key ? loaded.value : undefined
	const quote = current?.quote
	const recoveryBudget = quote?.recoveryAttoRep === 0n ? 0n : parsedRecoveryBudget
	// The contract pulls the collateral plus the fee it computes, never the unused part of the fee cap.
	const requiredCollateral = amount === undefined || quote === undefined ? undefined : amount + quote.purchaseFeeAttoEth
	let reason = actions.ownerReason ?? (model.loading ? refreshingBalances : undefined)
	if (reason === undefined) {
		if (snapshot === undefined) reason = enterSecurityPool
		else if (snapshot.admission.mode === 'custom') reason = unsupportedAdmission
		else if (snapshot.forkTime > 0n || snapshot.frozen || snapshot.importing) reason = copy.closed
		else if (!snapshot.priceValid) reason = newPriceRequired
		else if (questionId === undefined || amount === undefined || amount === 0n || minimum === undefined) reason = copy.detailsRequired
		else if (current?.error !== undefined) reason = current.error
		else if (quote === undefined || current?.question === undefined) reason = copy.loadingQuote
		else if (current.question.escalationGame !== zeroAddress || current.question.systemState !== 0n || snapshot.timestamp >= current.question.questionEndTime) reason = copy.mintingClosed
		else if (amount > quote.availableCommitmentAttoEth) reason = copy.insufficientBacking
		else if (fee === undefined || fee < quote.purchaseFeeAttoEth) reason = copy.feeBelowQuote
		else if (minimum > quote.shares) reason = copy.minimumSharesAboveQuote
		else if (amount + quote.purchaseFeeAttoEth > snapshot.walletCollateral) reason = collateralCopy.formatInsufficientBalance(snapshot.collateral.symbol)
		else if (snapshot.collateralAllowance < amount + quote.purchaseFeeAttoEth) reason = collateralCopy.approvalRequired
		else if (recoveryBudget === undefined || recoveryBudget < quote.recoveryAttoRep) reason = collateralCopy.recoveryBudgetRequired
		else if (current.recovery === undefined) reason = collateralCopy.recoveryFundingLoading
		else if (current.recovery.balance < recoveryBudget) reason = collateralCopy.insufficientRecoveryRep
		else if (current.recovery.allowance < recoveryBudget) reason = collateralCopy.recoveryApprovalRequired
	}
	return {
		requiredCollateral,
		approve: (approvalAmount: bigint) =>
			actions.runSecurityPoolAction('approvePurchaseCollateral', copy.approveCollateral, () => {
				if (snapshot === undefined) throw new Error(enterSecurityPool)
				const account = snapshot.auctionVault?.bidder ?? snapshot.owner
				return {
					account,
					to: snapshot.collateralToken,
					value: 0n,
					data: encodeFunctionData({ abi: ABIS.mainnet.erc20, functionName: 'approve', args: [snapshot.services, approvalAmount] }),
				}
			}),
		recoveryApplicable: recoveryKnowledge.value?.selection === selection && recoveryKnowledge.value.applicable,
		recoveryError: current?.error,
		recovery: current?.recovery,
		requiredRecoveryRep: recoveryBudget,
		maximumRecoveryRep: quote?.recoveryAttoRep === 0n ? '0' : maximumRecoveryRep.value,
		setMaximumRecoveryRep: (value: string) => {
			maximumRecoveryRep.value = value
		},
		approveRecoveryRep: (approvalAmount: bigint) =>
			actions.runSecurityPoolAction('approvePurchaseRecoveryRep', copy.approveRecoveryRep, () => {
				if (snapshot === undefined || current?.recovery?.token === undefined || current.recovery.spender === undefined) throw new Error(copy.recoveryFundingUnavailable)
				return { account: snapshot.auctionVault?.bidder ?? snapshot.owner, to: current.recovery.token, value: 0n, data: encodeFunctionData({ abi: ABIS.mainnet.erc20, functionName: 'approve', args: [current.recovery.spender, approvalAmount] }) }
			}),
		questionInput: questionInput.value,
		setQuestionInput: (value: string) => {
			questionInput.value = value
		},
		mintAmount: mintAmount.value,
		setMintAmount: (value: string) => {
			mintAmount.value = value
		},
		maximumFee: maximumFee.value,
		setMaximumFee: (value: string) => {
			maximumFee.value = value
		},
		minimumShares: minimumShares.value,
		setMinimumShares: (value: string) => {
			minimumShares.value = value
		},
		quote,
		quoteReadAt: current?.readAt,
		position: current?.question,
		quoteLoading: current === undefined && amount !== undefined && amount > 0n,
		reason,
		buy: () =>
			actions.runSecurityPoolAction('mintSecurityPoolCompleteSets', copy.buyCompleteSets, () => {
				if (reason !== undefined || snapshot === undefined || questionId === undefined || amount === undefined || fee === undefined || minimum === undefined || quote === undefined || recoveryBudget === undefined) throw new Error(reason ?? copy.quoteUnavailable)
				const selected = snapshot
				const buyer = selected.auctionVault?.bidder ?? selected.owner
				const captured = { questionId, mintAttoEth: amount, maximumPurchaseFeeAttoEth: fee, minimumShares: minimum, maximumRecoveryAttoRep: recoveryBudget }
				const collateral = (value: bigint) => `${formatUnits(value, decimals)} ${selected.collateral.symbol}`
				let reviewRows: readonly ReviewRow[] = []
				return {
					...buildSecurityPoolMintRequest({ trader: buyer, securityPool: selected.securityPool, universeId: selected.universeId, recipient: buyer, ...captured }),
					readReviewRows: () => reviewRows,
					reviewDescription: mintReview({
						amount: collateral(amount),
						purchaseFee: collateral(quote.purchaseFeeAttoEth),
						feeCap: collateral(fee),
						minimum: formatUnits(minimum, decimals),
						recovery: quote.recoveryAttoRep === 0n ? undefined : { amount: formatUnits(quote.recoveryAttoRep, 18), cap: formatUnits(recoveryBudget, 18) },
					}),
					validateBeforeSubmit: async () => {
						const client = withStatoblastRequestTimeout(createConnectedReadClient(), currentStateCheckFailed)
						const latest = await loadSecurityPoolAccount(client, selected.securityPool, selected.owner, selected.universeId)
						if (latest.chainId !== selected.chainId || latest.capitalLedger !== selected.capitalLedger) throw new Error(poolChanged)
						const question = await loadSecurityPoolMintQuestion(client, latest, captured.questionId)
						if (question === undefined || question.escalationGame !== zeroAddress || question.systemState !== 0n || latest.timestamp >= question.questionEndTime) throw new Error(copy.mintingClosed)
						const fresh = await loadSecurityPoolMintQuote({ client: securityPoolReadClient(client), securityPool: selected.securityPool, universeId: selected.universeId, questionId: captured.questionId, mintAttoEth: captured.mintAttoEth, blockNumber: latest.blockNumber })
						const funding = await loadRecoveryMintFunding(client, selected.securityPool, selected.universeId, buyer, fresh.recoveryAttoRep, latest.blockNumber)
						if (
							fresh.recoveryAttoRep > captured.maximumRecoveryAttoRep ||
							funding.balance < fresh.recoveryAttoRep ||
							funding.allowance < fresh.recoveryAttoRep ||
							!fresh.priceValid ||
							fresh.availableCommitmentAttoEth < captured.mintAttoEth ||
							fresh.purchaseFeeAttoEth > captured.maximumPurchaseFeeAttoEth ||
							fresh.shares < captured.minimumShares ||
							latest.walletCollateral < captured.mintAttoEth + fresh.purchaseFeeAttoEth ||
							latest.collateralAllowance < captured.mintAttoEth + fresh.purchaseFeeAttoEth
						)
							throw new Error(copy.prerequisitesChanged)
						const { symbol } = latest.collateral
						reviewRows = [
							reviewBalance(collateralCopy.walletBalance(symbol), latest.walletCollateral, latest.walletCollateral - captured.mintAttoEth - fresh.purchaseFeeAttoEth, decimals, symbol),
							...(fresh.recoveryAttoRep === 0n ? [] : [reviewBalance(collateralCopy.walletBalance('REP'), funding.balance, funding.balance - fresh.recoveryAttoRep, 18, 'REP')]),
						]
					},
				}
			}),
	}
}
