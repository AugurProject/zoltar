import { getTokenApprovalResetReason, tokenRequiresAllowanceReset } from '@zoltar/ui-core-shared/transactions/tokenApproval.js'
import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { encodeFunctionData, formatUnits, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { buildPortfolioMintRequest, loadPortfolioMintQuote, type PortfolioMintQuote } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { loadPortfolioAccount, portfolioReadClient } from '../../../protocol/securityPoolPortfolio.js'
import { loadPortfolioMintQuestion } from '../../../protocol/securityPoolPortfolioMint.js'
import { portfolioAmountOrUndefined, portfolioUnsignedId } from '../lib/draft.js'
import type { usePortfolio } from './usePortfolio.js'
import type { usePortfolioActions } from './usePortfolioActions.js'

export function usePortfolioPurchase(model: Pick<ReturnType<typeof usePortfolio>, 'snapshot' | 'loading'>, actions: Pick<ReturnType<typeof usePortfolioActions>, 'ownerReason' | 'runPortfolioAction'>) {
	const questionInput = useSignal('')
	const mintAmount = useSignal('')
	const maximumFee = useSignal('')
	const minimumShares = useSignal('0')
	const loaded = useSignal<{ key: string; quote?: PortfolioMintQuote; question?: Awaited<ReturnType<typeof loadPortfolioMintQuestion>>; error?: string } | undefined>(undefined)
	const snapshot = model.snapshot
	const questionId = portfolioUnsignedId(questionInput.value)
	const decimals = snapshot?.collateral.decimals ?? 18
	const amount = portfolioAmountOrUndefined(mintAmount.value, decimals)
	const fee = portfolioAmountOrUndefined(maximumFee.value, decimals)
	const minimum = portfolioAmountOrUndefined(minimumShares.value, decimals)
	const key = `${snapshot?.portfolio}:${snapshot?.universeId}:${snapshot?.owner}:${snapshot?.blockHash}:${questionId}:${amount}`
	useEffect(() => {
		let current = true
		loaded.value = undefined
		if (snapshot !== undefined && questionId !== undefined && amount !== undefined && amount > 0n) {
			const client = createConnectedReadClient()
			void (async () => {
				const question = await loadPortfolioMintQuestion(client, snapshot, questionId)
				if (question === undefined) throw new Error('Register this question before purchasing.')
				const quote = await loadPortfolioMintQuote({ client: portfolioReadClient(client), portfolio: snapshot.portfolio, universeId: snapshot.universeId, questionId, mintAttoEth: amount, blockNumber: snapshot.blockNumber })
				if (current) loaded.value = { key, quote, question }
			})().catch(failure => {
				if (current) loaded.value = { key, error: getErrorMessage(failure, 'Unable to quote this purchase.') }
			})
		}
		return () => {
			current = false
		}
	}, [key])
	useEffect(() => {
		loaded.value = undefined
		maximumFee.value = ''
		minimumShares.value = '0'
	}, [snapshot?.portfolio, snapshot?.universeId, snapshot?.owner])
	const current = loaded.value?.key === key ? loaded.value : undefined
	const quote = current?.quote
	let reason = actions.ownerReason ?? (model.loading ? 'Refreshing portfolio balances.' : undefined)
	if (reason === undefined) {
		if (snapshot === undefined) reason = 'Load a portfolio first.'
		else if (snapshot.admission.mode === 'custom') reason = 'This interface supports open or fixed question policies.'
		else if (snapshot.forkTime > 0n || snapshot.frozen || snapshot.importing) reason = 'Purchases are closed in this universe.'
		else if (!snapshot.priceValid) reason = 'A new accepted REP price is required.'
		else if (questionId === undefined || amount === undefined || amount === 0n || minimum === undefined) reason = 'Enter a question, positive purchase amount and minimum shares.'
		else if (current?.error !== undefined) reason = current.error
		else if (quote === undefined || current?.question === undefined) reason = 'Loading the purchase quote.'
		else if (current.question.escalationGame !== zeroAddress || current.question.systemState !== 0n || snapshot.timestamp >= current.question.questionEndTime) reason = 'Question minting has closed.'
		else if (amount > quote.availableCommitmentAttoEth) reason = 'Insufficient available backing after queued retirement.'
		else if (fee === undefined || fee < quote.purchaseFeeAttoEth) reason = 'Set a maximum fee that covers the quote.'
		else if (minimum > quote.shares) reason = 'Minimum shares exceed the current quote.'
		else if (amount + fee > snapshot.walletCollateral) reason = 'Insufficient collateral balance.'
		else if (snapshot.collateralAllowance < amount + fee) reason = 'Collateral approval required.'
	}
	return {
		requiredCollateral: amount === undefined || fee === undefined ? undefined : amount + fee,
		approve: (approvalAmount: bigint) =>
			actions.runPortfolioAction(approvalAmount === 0n ? 'resetPurchaseCollateral' : 'approvePurchaseCollateral', 'Approve purchase collateral', () => {
				if (snapshot === undefined) throw new Error('Portfolio unavailable.')
				const account = snapshot.auctionVault?.bidder ?? snapshot.owner
				return {
					account,
					to: snapshot.collateralToken,
					value: 0n,
					data: encodeFunctionData({ abi: ABIS.mainnet.erc20, functionName: 'approve', args: [snapshot.services, approvalAmount] }),
					validateBeforeSubmit: async () => {
						const allowance = await createConnectedReadClient().readContract({ address: snapshot.collateralToken, abi: ABIS.mainnet.erc20, functionName: 'allowance', args: [account, snapshot.services] })
						if (typeof allowance !== 'bigint') throw new Error('Collateral allowance unavailable.')
						const reason = getTokenApprovalResetReason(allowance, approvalAmount, snapshot.collateral.symbol, tokenRequiresAllowanceReset(snapshot.collateralToken))
						if (reason !== undefined) throw new Error(reason)
					},
				}
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
		position: current?.question,
		quoteLoading: current === undefined && amount !== undefined && amount > 0n,
		reason,
		buy: () =>
			actions.runPortfolioAction('mintPortfolioCompleteSets', 'Buy complete sets', () => {
				if (reason !== undefined || snapshot === undefined || questionId === undefined || amount === undefined || fee === undefined || minimum === undefined || quote === undefined) throw new Error(reason ?? 'Purchase quote unavailable.')
				const selected = snapshot
				const buyer = selected.auctionVault?.bidder ?? selected.owner
				const captured = { questionId, mintAttoEth: amount, maximumPurchaseFeeAttoEth: fee, minimumShares: minimum }
				return {
					...buildPortfolioMintRequest({ trader: buyer, portfolio: selected.portfolio, universeId: selected.universeId, recipient: buyer, ...captured }),
					reviewDescription: `Buy complete sets for question 0x${questionId.toString(16)} with ${formatUnits(amount, decimals)} ${selected.collateral.symbol}. The total charge for backing and the resolution premium is ${formatUnits(quote.purchaseFeeAttoEth, decimals)} ${selected.collateral.symbol}, capped at ${formatUnits(fee, decimals)} ${selected.collateral.symbol}. Receive at least ${formatUnits(minimum, decimals)} of each outcome. Available backing is checked after retirement in the same transaction.`,
					validateBeforeSubmit: async () => {
						const client = createConnectedReadClient()
						const latest = await loadPortfolioAccount(client, selected.portfolio, selected.owner, selected.universeId)
						if (latest.chainId !== selected.chainId || latest.capitalLedger !== selected.capitalLedger) throw new Error('Portfolio context changed. Review again.')
						const question = await loadPortfolioMintQuestion(client, latest, captured.questionId)
						if (question === undefined || question.escalationGame !== zeroAddress || question.systemState !== 0n || latest.timestamp >= question.questionEndTime) throw new Error('Question minting has closed.')
						const fresh = await loadPortfolioMintQuote({ client: portfolioReadClient(client), portfolio: selected.portfolio, universeId: selected.universeId, questionId: captured.questionId, mintAttoEth: captured.mintAttoEth, blockNumber: latest.blockNumber })
						if (
							!fresh.priceValid ||
							fresh.availableCommitmentAttoEth < captured.mintAttoEth ||
							fresh.purchaseFeeAttoEth > captured.maximumPurchaseFeeAttoEth ||
							fresh.shares < captured.minimumShares ||
							latest.walletCollateral < captured.mintAttoEth + captured.maximumPurchaseFeeAttoEth ||
							latest.collateralAllowance < captured.mintAttoEth + captured.maximumPurchaseFeeAttoEth
						)
							throw new Error('Purchase prerequisites changed. Refresh and review again.')
					},
				}
			}),
	}
}
