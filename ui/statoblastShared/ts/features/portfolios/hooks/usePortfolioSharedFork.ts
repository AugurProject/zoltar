import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { encodeFunctionData, formatEther, getAddress, isAddress, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import {
	buildPortfolioForkChoiceRequest,
	buildPortfolioForkStartRequest,
	buildPortfolioForkFinalizeRequest,
	buildPortfolioForkRecoveryRequest,
	buildPortfolioRecoveryRightsTransferRequest,
	buildPortfolioRecapPurchaseRequest,
	loadPortfolioForkSnapshot,
	loadPortfolioRecapQuote,
	type PortfolioForkSnapshot,
	type PortfolioRecapQuote,
} from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { portfolioReadClient, type PortfolioAccountSnapshot, type PortfolioTransaction } from '../../../protocol/securityPoolPortfolio.js'
import { loadSharedForkOutcome, loadPortfolioRecapWallet, loadPortfolioSourceRecovery, buildPortfolioRecoveryPreparation } from '../../../protocol/securityPoolSharedFork.js'
import { portfolioAmountOrUndefined, portfolioUnsignedId } from '../lib/draft.js'
import { portfolioBasisPointsOrUndefined } from '../lib/creation.js'
import type { PortfolioActions } from '../components/PortfolioControls.js'

export type PortfolioSharedForkParameters = { snapshot: PortfolioAccountSnapshot | undefined; actions: Pick<PortfolioActions, 'scope' | 'busy' | 'ownerReason' | 'runPortfolioAction'>; openUniverse: (universeId: bigint) => void }
export function usePortfolioSharedFork({ snapshot: portfolio, actions, openUniverse }: PortfolioSharedForkParameters) {
	const backend = getActiveBackend()
	const sourceInput = useSignal('')
	const outcomeInput = useSignal('')
	const budgetInput = useSignal('')
	const maximumRepInput = useSignal('')
	const minimumRepInput = useSignal('')
	const maximumCommitmentInput = useSignal('')
	const maximumOwnRepInput = useSignal('0')
	const healthInput = useSignal('100')
	const questionInput = useSignal('')
	const sharesInput = useSignal('')
	const recipientInput = useSignal('')
	const invalidRightsInput = useSignal('0')
	const yesRightsInput = useSignal('0')
	const noRightsInput = useSignal('0')
	const loaded = useSignal<{ key: string; state?: PortfolioForkSnapshot; outcome?: Awaited<ReturnType<typeof loadSharedForkOutcome>>; error?: string } | undefined>(undefined)
	const quoted = useSignal<{ key: string; quote?: PortfolioRecapQuote; wallet?: Awaited<ReturnType<typeof loadPortfolioRecapWallet>>; error?: string } | undefined>(undefined)
	const recovered = useSignal<{ key: string; source?: Awaited<ReturnType<typeof loadPortfolioSourceRecovery>>; error?: string } | undefined>(undefined)
	useEffect(() => {
		sourceInput.value = portfolio?.universeId.toString() ?? ''
		outcomeInput.value = ''
		budgetInput.value = ''
		maximumRepInput.value = ''
		minimumRepInput.value = ''
		maximumCommitmentInput.value = ''
		maximumOwnRepInput.value = '0'
		questionInput.value = ''
		sharesInput.value = ''
		recipientInput.value = ''
		invalidRightsInput.value = '0'
		yesRightsInput.value = '0'
		noRightsInput.value = '0'
	}, [portfolio?.portfolio, portfolio?.owner, portfolio?.universeId])
	const universeId = portfolioUnsignedId(sourceInput.value, 248)
	const outcomeIndex = portfolioUnsignedId(outcomeInput.value)
	const questionId = portfolioUnsignedId(questionInput.value)
	const shares = portfolioAmountOrUndefined(sharesInput.value)
	const recipient = isAddress(recipientInput.value.trim()) ? getAddress(recipientInput.value.trim()) : undefined
	const invalidRights = portfolioAmountOrUndefined(invalidRightsInput.value)
	const yesRights = portfolioAmountOrUndefined(yesRightsInput.value)
	const noRights = portfolioAmountOrUndefined(noRightsInput.value)
	const transferAmounts = invalidRights === undefined || yesRights === undefined || noRights === undefined ? undefined : ([invalidRights, yesRights, noRights] satisfies readonly [bigint, bigint, bigint])
	const maximumCost = portfolioAmountOrUndefined(budgetInput.value)
	const maximumRep = portfolioAmountOrUndefined(maximumRepInput.value)
	const minimumRep = portfolioAmountOrUndefined(minimumRepInput.value)
	const maximumCommitment = portfolioAmountOrUndefined(maximumCommitmentInput.value)
	const maximumOwnRep = portfolioAmountOrUndefined(maximumOwnRepInput.value)
	const target = portfolioBasisPointsOrUndefined(healthInput.value)
	const key = `${backend}:${portfolio?.portfolio}:${portfolio?.owner}:${portfolio?.blockHash}:${universeId}:${outcomeIndex}`
	useEffect(() => {
		let current = true
		loaded.value = undefined
		if (portfolio !== undefined && universeId !== undefined) {
			const client = createConnectedReadClient()
			void (async () => {
				const state = await loadPortfolioForkSnapshot({ client: portfolioReadClient(client), portfolio: portfolio.portfolio, owner: portfolio.owner, universeId, ...(outcomeIndex === undefined ? {} : { outcomeIndex }) })
				const outcome = state.forkTime === 0n || state.branch === undefined ? undefined : await loadSharedForkOutcome(client, state, state.branch.outcomeIndex)
				if (current && getActiveBackend() === backend) loaded.value = { key, state, ...(outcome === undefined ? {} : { outcome }) }
			})().catch(error => {
				if (current && getActiveBackend() === backend) loaded.value = { key, error: getErrorMessage(error, 'Unable to load this fork.') }
			})
		}
		return () => {
			current = false
		}
	}, [key])
	const current = loaded.value?.key === key ? loaded.value : undefined
	const state = current?.state
	const quoteKey = `${key}:${state?.blockHash}:${maximumCost}:${maximumRep}:${target}`
	useEffect(() => {
		let current = true
		quoted.value = undefined
		if (state !== undefined && state.branch?.started && !state.branch.ready && state.branch.auction !== zeroAddress && maximumCost !== undefined && maximumCost > 0n && maximumRep !== undefined && maximumRep > 0n && target !== undefined && target >= 10_000n) {
			const client = createConnectedReadClient()
			void (async () => {
				const [quote, wallet] = await Promise.all([loadPortfolioRecapQuote({ client: portfolioReadClient(client), snapshot: state, maximumCostAttoEth: maximumCost, maximumRep, targetHealthFactorBps: target }), loadPortfolioRecapWallet(client, state)])
				if (current && getActiveBackend() === backend) quoted.value = { key: quoteKey, quote, ...(wallet === undefined ? {} : { wallet }) }
			})().catch(error => {
				if (current && getActiveBackend() === backend) quoted.value = { key: quoteKey, error: getErrorMessage(error, 'Unable to quote recap purchase.') }
			})
		}
		return () => {
			current = false
		}
	}, [quoteKey])
	const quoteState = quoted.value?.key === quoteKey ? quoted.value : undefined
	const quote = quoteState?.quote
	const wallet = quoteState?.wallet
	const recoveryKey = `${key}:${state?.blockHash}:${questionId}`
	useEffect(() => {
		let current = true
		recovered.value = undefined
		if (state !== undefined && state.forkTime > 0n && questionId !== undefined) {
			void loadPortfolioSourceRecovery(createConnectedReadClient(), state, questionId)
				.then(source => {
					if (current && getActiveBackend() === backend) recovered.value = { key: recoveryKey, source }
				})
				.catch(error => {
					if (current && getActiveBackend() === backend) recovered.value = { key: recoveryKey, error: getErrorMessage(error, 'Unable to read source recovery rights.') }
				})
		}
		return () => {
			current = false
		}
	}, [recoveryKey])
	const recoveryState = recovered.value?.key === recoveryKey ? recovered.value : undefined
	const recovery = recoveryState?.source
	const pendingReason = universeId === undefined ? 'Enter a valid source universe.' : 'Checking fork status…'
	const baseReason = actions.ownerReason ?? current?.error ?? (state === undefined ? pendingReason : undefined)
	const forkReason = baseReason ?? (state?.forkTime === 0n ? 'This source universe has not forked.' : undefined)
	const branchReason = forkReason ?? (state?.branch === undefined || current?.outcome?.outcomeLabel === undefined ? 'Enter a valid fork outcome.' : undefined)
	const chooseReason =
		branchReason ??
		(state?.choice.recorded ? 'Your irreversible branch choice is already recorded.' : undefined) ??
		(state !== undefined && state.timestamp >= state.choiceDeadline ? 'The fork choice window has closed.' : undefined) ??
		(portfolio !== undefined && universeId === portfolio.universeId && !portfolio.positions.some(position => position.rep > 0n && position.commitment > 0n) ? 'No pledged REP to move.' : undefined)
	const startReason = branchReason ?? (state !== undefined && state.timestamp < state.choiceDeadline ? 'Wait until the choice deadline.' : undefined) ?? (state?.branch?.started ? 'This branch is already prepared.' : undefined)
	const finalizeReason = branchReason ?? (state !== undefined && state.timestamp < state.recapitalizationDeadline ? 'Wait until the recap deadline.' : undefined) ?? (state?.branch?.ready ? 'This branch is already active.' : undefined)
	const recapReason =
		branchReason ??
		(state?.branch?.started !== true || state.branch.ready || state.branch.auction === zeroAddress ? 'This branch has no active recap sale.' : undefined) ??
		(state !== undefined && state.timestamp >= state.recapitalizationDeadline ? 'The recap sale has closed.' : undefined) ??
		(maximumCost === undefined || maximumCost === 0n || maximumRep === undefined || maximumRep === 0n || target === undefined || target < 10_000n ? 'Enter a positive budget, REP limit and health target of at least 100%.' : undefined) ??
		quoteState?.error ??
		quote?.reason ??
		(quote === undefined || wallet === undefined ? 'Loading the recap quote.' : undefined)
	const buyReason =
		recapReason ??
		(minimumRep === undefined || minimumRep === 0n || maximumRep === undefined || minimumRep > maximumRep || minimumRep > (quote?.rep ?? 0n) ? 'Set a positive minimum REP within the quote.' : undefined) ??
		(maximumCommitment === undefined || maximumCommitment < (quote?.commitment ?? 0n) ? 'Maximum commitment is below the quote.' : undefined) ??
		(maximumOwnRep === undefined || maximumOwnRep < (quote?.ownRep ?? 0n) ? 'Maximum extra REP is below the quote.' : undefined) ??
		(wallet !== undefined && quote !== undefined && quote.ownRep > wallet.balance ? 'Insufficient wallet child REP.' : undefined) ??
		(wallet !== undefined && quote !== undefined && quote.ownRep > wallet.allowance ? 'Approve child REP before purchasing.' : undefined) ??
		(wallet !== undefined && quote !== undefined && maximumCost !== undefined && maximumCost + quote.executionReserve > wallet.eth ? 'Insufficient wallet ETH; gas is additional.' : undefined)
	const sourceReason =
		forkReason ??
		(questionId === undefined ? 'Enter a question ID.' : undefined) ??
		recoveryState?.error ??
		(recovery === undefined ? 'Loading source recovery rights.' : undefined) ??
		(recovery !== undefined && recovery.pool !== zeroAddress && !recovery.eligible ? 'No live source recovery rights. Redeem finalized shares through the source pool.' : undefined)
	const recoveryReason = sourceReason ?? (state !== undefined && state.timestamp < state.choiceDeadline ? 'Wait until the choice deadline.' : undefined)
	const prepareReason = recoveryReason ?? (recovery?.pool !== zeroAddress ? 'The source question is already prepared.' : undefined)
	const recoverReason =
		recoveryReason ??
		(recovery?.pool === zeroAddress ? 'Prepare the source question first.' : undefined) ??
		(shares === undefined || shares === 0n ? 'Enter a positive complete-set amount.' : undefined) ??
		(recovery !== undefined && shares !== undefined && shares > recovery.availableShares ? 'Insufficient complete-set recovery rights. Combine Invalid, Yes and No recovery rights from other holders if needed.' : undefined)
	const transferReason =
		sourceReason ??
		(recovery?.pool === zeroAddress ? 'Prepare the source question first.' : undefined) ??
		(recipient === undefined || recipient === zeroAddress || recipient === state?.owner ? 'Enter another nonzero recipient address.' : undefined) ??
		(transferAmounts === undefined || transferAmounts.every(amount => amount === 0n) || transferAmounts.some(amount => amount >= 1n << 256n) ? 'Enter nonnegative outcome amounts and transfer at least one recovery right.' : undefined) ??
		(recovery !== undefined && transferAmounts?.some((amount, index) => amount > (recovery.rights[index] ?? 0n)) ? 'Insufficient recovery rights for an outcome.' : undefined)

	const run = (action: string, title: string, reason: string | undefined, build: (selected: PortfolioForkSnapshot) => PortfolioTransaction, check?: (latest: PortfolioForkSnapshot) => Promise<void>) =>
		actions.runPortfolioAction(action, title, () => {
			if (reason !== undefined || state === undefined) throw new Error(reason ?? 'Fork state unavailable.')
			const selected = state
			const request = build(selected)
			return {
				...request,
				validateBeforeSubmit: async () => {
					if (getActiveBackend() !== backend) throw new Error('Wallet environment changed. Review again.')
					const latest = await loadPortfolioForkSnapshot({ client: portfolioReadClient(createConnectedReadClient()), portfolio: selected.portfolio, owner: selected.owner, universeId: selected.universeId, ...(selected.branch === undefined ? {} : { outcomeIndex: selected.branch.outcomeIndex }) })
					if (latest.chainId !== selected.chainId || latest.controller !== selected.controller) throw new Error('Fork context changed. Review again.')
					await check?.(latest)
				},
			}
		})
	const base = (selected: PortfolioForkSnapshot) => ({ owner: selected.owner, controller: selected.controller, universeId: selected.universeId })
	return {
		state,
		quote,
		wallet,
		recovery,
		outcome: current?.outcome,
		error: current?.error ?? quoteState?.error ?? recoveryState?.error,
		loading: current === undefined,
		sourceInput: sourceInput.value,
		setSource: (v: string) => {
			sourceInput.value = v
		},
		outcomeInput: outcomeInput.value,
		setOutcome: (v: string) => {
			outcomeInput.value = v
		},
		budgetInput: budgetInput.value,
		setBudget: (v: string) => {
			budgetInput.value = v
		},
		maximumRepInput: maximumRepInput.value,
		setMaximumRep: (v: string) => {
			maximumRepInput.value = v
		},
		minimumRepInput: minimumRepInput.value,
		setMinimumRep: (v: string) => {
			minimumRepInput.value = v
		},
		maximumCommitmentInput: maximumCommitmentInput.value,
		setMaximumCommitment: (v: string) => {
			maximumCommitmentInput.value = v
		},
		maximumOwnRepInput: maximumOwnRepInput.value,
		setMaximumOwnRep: (v: string) => {
			maximumOwnRepInput.value = v
		},
		healthInput: healthInput.value,
		setHealth: (v: string) => {
			healthInput.value = v
		},
		questionInput: questionInput.value,
		setQuestion: (v: string) => {
			questionInput.value = v
		},
		sharesInput: sharesInput.value,
		setShares: (v: string) => {
			sharesInput.value = v
		},
		recipientInput: recipientInput.value,
		setRecipient: (v: string) => {
			recipientInput.value = v
		},
		invalidRightsInput: invalidRightsInput.value,
		setInvalidRights: (v: string) => {
			invalidRightsInput.value = v
		},
		yesRightsInput: yesRightsInput.value,
		setYesRights: (v: string) => {
			yesRightsInput.value = v
		},
		noRightsInput: noRightsInput.value,
		setNoRights: (v: string) => {
			noRightsInput.value = v
		},
		transferReason,
		chooseReason,
		startReason,
		finalizeReason,
		recapReason,
		buyReason,
		prepareReason,
		recoverReason,
		openReason: state?.branch?.ready ? undefined : 'Activate the branch before opening its account.',
		open: () => {
			if (state?.branch?.ready) openUniverse(state.branch.universeId)
		},
		choose: () =>
			run(
				'choosePortfolioFork',
				'Commit fork branch',
				chooseReason,
				selected => {
					if (selected.branch === undefined) throw new Error('Select a branch.')
					return {
						...buildPortfolioForkChoiceRequest({ ...base(selected), outcomeIndex: selected.branch.outcomeIndex }),
						reviewDescription: `Irreversibly choose outcome ${selected.branch.outcomeIndex} for your committed principal in universe ${selected.universeId}. Idle REP and old fees remain in the source. There is no revoke action.`,
					}
				},
				async latest => {
					if (latest.choice.recorded || latest.timestamp >= latest.choiceDeadline) throw new Error('Fork choice is no longer available.')
				},
			),
		start: () =>
			run('startPortfolioFork', 'Prepare shared branch', startReason, selected => {
				if (selected.branch === undefined) throw new Error('Select a branch.')
				return { ...buildPortfolioForkStartRequest({ ...base(selected), outcomeIndex: selected.branch.outcomeIndex }), reviewDescription: 'Prepare this branch for all owners. This does not choose anyone’s branch or require processing each question.' }
			}),
		finalize: () =>
			run('finalizePortfolioFork', 'Activate fork branch', finalizeReason, selected => {
				if (selected.branch === undefined) throw new Error('Select a branch.')
				return { ...buildPortfolioForkFinalizeRequest({ ...base(selected), universeId: selected.branch.universeId }), reviewDescription: 'Close this branch’s fixed recap window and activate its funded cash and personal collateral positions.' }
			}),
		approve: (amount: bigint) =>
			run('approvePortfolioRecap', 'Approve child REP', recapReason, selected => {
				if (selected.branch === undefined || quote === undefined || amount < quote.ownRep) throw new Error('Approval is below the required wallet REP.')
				return {
					account: selected.owner,
					to: selected.branch.repToken,
					value: 0n,
					data: encodeFunctionData({ abi: ABIS.mainnet.erc20, functionName: 'approve', args: [selected.controller, amount] }),
					reviewDescription: `Allow the portfolio fork coordinator to transfer up to ${formatEther(amount)} child REP for your atomic recap purchase.`,
				}
			}),
		buy: () =>
			run(
				'buyPortfolioRecap',
				'Buy REP',
				buyReason,
				selected => {
					if (selected.branch === undefined || maximumRep === undefined || minimumRep === undefined || maximumCommitment === undefined || maximumOwnRep === undefined || maximumCost === undefined || target === undefined || quote === undefined) throw new Error('Review recap limits first.')
					return {
						...buildPortfolioRecapPurchaseRequest({ ...base(selected), universeId: selected.branch.universeId, maximumRep, minimumRep, maximumCommitment, maximumOwnRep, targetHealthFactorBps: target, executionReserveAttoEth: quote.executionReserve, maximumCostAttoEth: maximumCost }),
						reviewDescription: `Spend at most ${formatEther(maximumCost)} ETH plus ${formatEther(quote.executionReserve)} ETH execution reserve. Receive ${formatEther(minimumRep)}–${formatEther(maximumRep)} REP and accept at most ${formatEther(maximumCommitment)} ETH commitment. Extra wallet REP is capped at ${formatEther(maximumOwnRep)}. Your health target is ${healthInput.value}%. Unused sale cash is refunded.`,
					}
				},
				async latest => {
					if (maximumCost === undefined || maximumRep === undefined || target === undefined || quote === undefined) throw new Error('Recap quote unavailable.')
					const client = createConnectedReadClient()
					const [fresh, funds] = await Promise.all([loadPortfolioRecapQuote({ client: portfolioReadClient(client), snapshot: latest, maximumCostAttoEth: maximumCost, maximumRep, targetHealthFactorBps: target }), loadPortfolioRecapWallet(client, latest)])
					if (
						funds === undefined ||
						fresh.reason !== undefined ||
						fresh.rep < (minimumRep ?? 0n) ||
						fresh.commitment > (maximumCommitment ?? 0n) ||
						fresh.ownRep > (maximumOwnRep ?? 0n) ||
						fresh.executionReserve > quote.executionReserve ||
						fresh.ownRep > funds.allowance ||
						fresh.ownRep > funds.balance ||
						maximumCost + quote.executionReserve > funds.eth
					)
						throw new Error('Recap prerequisites changed. Refresh and review again.')
				},
			),
		prepare: () =>
			run('preparePortfolioRecovery', 'Prepare source question', prepareReason, selected => {
				if (recovery === undefined) throw new Error('Source question unavailable.')
				return { ...buildPortfolioRecoveryPreparation(selected, recovery), reviewDescription: 'Prepare this question’s source share namespace for all holders. This does not claim or migrate vault principal.' }
			}),
		transfer: () =>
			run(
				'transferPortfolioRecoveryRights',
				'Transfer recovery rights',
				transferReason,
				selected => {
					if (questionId === undefined || recovery === undefined || recipient === undefined || transferAmounts === undefined) throw new Error('Enter the recipient and recovery rights to transfer.')
					return {
						...buildPortfolioRecoveryRightsTransferRequest({ owner: selected.owner, shareToken: recovery.shareToken, universeId: selected.universeId, recipient, amountsAttoShares: transferAmounts }),
						reviewDescription: `Transfer ${formatEther(transferAmounts[0])} Invalid, ${formatEther(transferAmounts[1])} Yes and ${formatEther(transferAmounts[2])} No recovery rights for question 0x${questionId.toString(16)} in source universe ${selected.universeId} to ${recipient}. The recipient receives these rights to source cash. Spending source-backed rights locks those original source shares. Your child migration rights remain yours.`,
					}
				},
				async latest => {
					if (questionId === undefined || recovery === undefined || transferAmounts === undefined) throw new Error('Recovery transfer unavailable.')
					const fresh = await loadPortfolioSourceRecovery(createConnectedReadClient(), latest, questionId)
					if (latest.forkTime === 0n || !fresh.eligible || fresh.pool === zeroAddress || fresh.shareToken !== recovery.shareToken || transferAmounts.some((amount, index) => amount > (fresh.rights[index] ?? 0n))) throw new Error('Recovery transfer prerequisites changed. Refresh and review again.')
				},
			),

		recover: () =>
			run(
				'recoverPortfolioSource',
				'Recover source cash',
				recoverReason,
				selected => {
					if (questionId === undefined || shares === undefined) throw new Error('Enter recovery complete sets.')
					return {
						...buildPortfolioForkRecoveryRequest({ ...base(selected), questionId, shares }),
						reviewDescription: `Use ${formatEther(shares)} complete-set recovery rights for question 0x${questionId.toString(16)}. Spending source-backed rights locks those original source shares. Received recovery rights are consumed first; all child migration rights remain available.`,
					}
				},
				async latest => {
					if (questionId === undefined || shares === undefined) throw new Error('Recovery amount unavailable.')
					const fresh = await loadPortfolioSourceRecovery(createConnectedReadClient(), latest, questionId)
					if (!fresh.eligible || fresh.availableShares < shares || fresh.pool === zeroAddress) throw new Error('Source recovery prerequisites changed.')
				},
			),
	}
}
