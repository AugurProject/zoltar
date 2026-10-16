import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { encodeFunctionData, formatEther, type Address } from '@zoltar/core-shared/evm/ethereum'
import {
	buildPortfolioDepositRequest,
	buildPortfolioFundWithdrawalRequest,
	buildPortfolioClaimRecoveredRequest,
	buildPortfolioPositionClaimRequest,
	buildPortfolioPositionRebalanceRequest,
	buildPortfolioMintRequest,
	loadPortfolioAggregateSnapshot,
	loadPortfolioMintQuote,
	type PortfolioAggregateSnapshot,
} from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { useBlockRefresh } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { createActiveEnvironmentGuard, getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getErrorDetail, getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { portfolioReadClient, type PortfolioTransaction } from '../../../protocol/securityPoolPortfolio.js'
import { loadPortfolioMintQuestion } from '../../../protocol/securityPoolPortfolioMint.js'
import { parsePortfolioAmount } from '../lib/draft.js'
import type { usePortfolio } from './usePortfolio.js'
import type { usePortfolioActions } from './usePortfolioActions.js'
import * as copy from '../../../copy/portfolio.js'

function amount(value: string) {
	try {
		return parsePortfolioAmount(value)
	} catch (error) {
		if (!(error instanceof Error) || error.message !== 'Enter a nonnegative amount with up to 18 decimal places.') throw error
		return undefined
	}
}

function question(value: string) {
	try {
		const result = BigInt(value)
		return value.trim() !== '' && result >= 0n && result < 1n << 256n ? result : undefined
	} catch (error) {
		if (!(error instanceof SyntaxError)) throw error
		return undefined
	}
}

export function usePortfolioAggregate(model: Pick<ReturnType<typeof usePortfolio>, 'selection' | 'refresh'>, actions: Pick<ReturnType<typeof usePortfolioActions>, 'runPortfolioAction'>, account: Address | undefined, enabled: boolean) {
	const backend = getActiveBackend()
	const selection = model.selection
	const loaded = useSignal<{ snapshot: PortfolioAggregateSnapshot; backend: typeof backend; account: Address | undefined; walletAttoEth: bigint | undefined } | undefined>(undefined)
	const readError = useSignal<string | undefined>(undefined)
	const loading = useSignal(false)
	const generation = useRef(0)
	const draftScope = useRef<{ backend: typeof backend; portfolio: Address; owner: Address } | undefined>(undefined)
	const page = useSignal(0n)
	const questionPage = useSignal(0n)
	const intervalPage = useSignal(0n)
	const depositAmount = useSignal('')
	const depositMinimum = useSignal('')
	const depositMinimumEdited = useSignal(false)
	const withdrawalShares = useSignal('')
	const withdrawalMinimum = useSignal('0')
	const questionInput = useSignal('')
	const mintAmount = useSignal('')
	const maximumFee = useSignal('')
	const maximumFeeEdited = useSignal(false)
	const minimumShares = useSignal('0')
	const retry = useSignal(0)
	const questionResult = useSignal<{ snapshot: PortfolioAggregateSnapshot; input: string; position?: Awaited<ReturnType<typeof loadPortfolioMintQuestion>>; error?: string } | undefined>(undefined)
	const quoteResult = useSignal<{ snapshot: PortfolioAggregateSnapshot; key: string; quote?: Awaited<ReturnType<typeof loadPortfolioMintQuote>>; error?: string } | undefined>(undefined)
	const snapshot = loaded.value?.backend === backend && loaded.value.account === account && loaded.value.snapshot.portfolio === selection?.portfolio && loaded.value.snapshot.owner === selection.owner ? loaded.value.snapshot : undefined
	const read = async () => {
		if (selection === undefined) throw new Error(copy.enterPortfolio)
		return loadPortfolioAggregateSnapshot({ client: portfolioReadClient(backend.createReadClient()), portfolio: selection.portfolio, owner: selection.owner, positionStart: page.value * 64n, questionStart: questionPage.value * 64n, intervalStart: intervalPage.value * 64n })
	}
	const refresh = async () => {
		if (!enabled || selection === undefined) return
		const requestId = ++generation.current
		const environment = createActiveEnvironmentGuard()
		const current = () => requestId === generation.current && environment.isCurrent()
		loading.value = true
		try {
			const next = await read()
			const walletAttoEth = account === undefined ? undefined : await backend.createReadClient().getBalance({ address: account, blockNumber: next.blockNumber })
			if (current()) {
				loaded.value = { snapshot: next, backend, account, walletAttoEth }
				readError.value = undefined
			}
		} catch (failure) {
			if (current()) {
				loaded.value = undefined
				readError.value = getErrorMessage(failure, copy.snapshotFailed)
			}
		} finally {
			if (current()) loading.value = false
		}
	}
	useEffect(() => {
		loaded.value = undefined
		readError.value = undefined
		void refresh()
		return () => {
			generation.current += 1
		}
	}, [backend, enabled, selection?.portfolio, selection?.owner, page.value, questionPage.value, intervalPage.value, account])
	useEffect(() => {
		if (selection === undefined) return
		const previous = draftScope.current
		draftScope.current = { backend, portfolio: selection.portfolio, owner: selection.owner }
		if (previous === undefined || (previous.backend === backend && previous.portfolio === selection.portfolio && previous.owner === selection.owner)) return
		page.value = 0n
		questionPage.value = 0n
		intervalPage.value = 0n
		depositAmount.value = ''
		depositMinimum.value = ''
		depositMinimumEdited.value = false
		withdrawalShares.value = ''
		maximumFee.value = ''
		maximumFeeEdited.value = false
	}, [backend, selection?.portfolio, selection?.owner])
	useBlockRefresh(
		() => {
			if (!loading.value) void refresh()
		},
		enabled && selection !== undefined,
	)
	const depositAttoRep = amount(depositAmount.value)
	let expectedDepositShares: bigint | undefined
	if (snapshot !== undefined && depositAttoRep !== undefined) expectedDepositShares = snapshot.totalShares === 0n || snapshot.assetsAttoRep === 0n ? depositAttoRep : (depositAttoRep * snapshot.totalShares) / snapshot.assetsAttoRep
	useEffect(() => {
		if (!depositMinimumEdited.value && expectedDepositShares !== undefined) depositMinimum.value = formatEther(expectedDepositShares)
	}, [expectedDepositShares, depositMinimumEdited.value])
	const questionId = question(questionInput.value)
	const mintAttoEth = amount(mintAmount.value)
	const quoteKey = `${questionInput.value}:${mintAmount.value}:${retry.value}`
	const questionObservation = questionResult.value
	const currentQuestion = questionObservation !== undefined && questionObservation.snapshot === snapshot && questionObservation.input === questionInput.value ? questionObservation : undefined
	const quoteObservation = quoteResult.value
	const currentQuote = quoteObservation !== undefined && quoteObservation.snapshot === snapshot && quoteObservation.key === quoteKey ? quoteObservation : undefined
	const position = currentQuestion?.position
	const universeCanMint = snapshot !== undefined && snapshot.forkTime === 0n
	const quoteEligible = enabled && universeCanMint && questionId !== undefined && mintAttoEth !== undefined && mintAttoEth > 0n && position !== undefined && !position.resolved && position.systemState === 0n && position.questionEndTime > snapshot.timestamp
	useEffect(() => {
		let current = true
		const environment = createActiveEnvironmentGuard()
		if (!enabled || snapshot === undefined || questionId === undefined) return
		const input = questionInput.value
		void loadPortfolioMintQuestion(backend.createReadClient(), snapshot, questionId)
			.then(position => {
				if (current && environment.isCurrent()) questionResult.value = { snapshot, input, position }
			})
			.catch(failure => {
				if (current && environment.isCurrent()) questionResult.value = { snapshot, input, error: getErrorMessage(failure, copy.mintQuestionFailed) }
			})
		return () => {
			current = false
		}
	}, [backend, enabled, snapshot, questionId, retry.value])
	useEffect(() => {
		let current = true
		const environment = createActiveEnvironmentGuard()
		if (!quoteEligible || snapshot === undefined || questionId === undefined || mintAttoEth === undefined) return
		void loadPortfolioMintQuote({ client: portfolioReadClient(backend.createReadClient()), snapshot, questionId, mintAttoEth })
			.then(quote => {
				if (current && environment.isCurrent()) quoteResult.value = { snapshot, key: quoteKey, quote }
			})
			.catch(failure => {
				if (current && environment.isCurrent()) quoteResult.value = { snapshot, key: quoteKey, error: getErrorDetail(failure)?.includes('No portfolio capital') ? copy.portfolioNeedsCapital : getErrorMessage(failure, copy.purchaseFeeFailed) }
			})
		return () => {
			current = false
		}
	}, [backend, enabled, snapshot, quoteKey, currentQuestion?.position])
	useEffect(() => {
		if (!maximumFeeEdited.value && currentQuote?.quote !== undefined) maximumFee.value = formatEther(currentQuote.quote.purchaseFeeAttoEth)
	}, [currentQuote?.quote, maximumFeeEdited.value])
	const walletReason = account === undefined ? copy.connect : undefined
	let stateReason = readError.value
	if (selection === undefined) stateReason = copy.enterPortfolio
	else if (stateReason === undefined && (snapshot === undefined || loading.value)) stateReason = copy.loading
	const ownerReason = walletReason ?? stateReason ?? (account?.toLowerCase() !== selection?.owner.toLowerCase() ? copy.ownerRequired : undefined)
	const depositFloor = amount(depositMinimum.value)
	const withdrawalAmount = amount(withdrawalShares.value)
	const idleMinimum = amount(withdrawalMinimum.value)
	const mintFloor = amount(minimumShares.value)
	const feeLimit = amount(maximumFee.value)
	const fundingReason =
		ownerReason ??
		(snapshot !== undefined && snapshot.forkTime > 0n ? copy.forkDeposit : undefined) ??
		(depositAttoRep === undefined || depositAttoRep === 0n ? copy.positiveAmount : undefined) ??
		(snapshot !== undefined && depositAttoRep !== undefined && depositAttoRep > snapshot.walletAttoRep ? copy.insufficient : undefined)
	const depositReason =
		fundingReason ??
		(depositFloor === undefined ? copy.fundMinimumInvalid : undefined) ??
		(expectedDepositShares === 0n ? copy.depositTooSmall : undefined) ??
		(depositFloor !== undefined && expectedDepositShares !== undefined && depositFloor > expectedDepositShares ? copy.fundMinimumTooHigh : undefined) ??
		(snapshot !== undefined && depositAttoRep !== undefined && snapshot.allowanceAttoRep < depositAttoRep ? copy.poolApprovalRequired : undefined)
	const withdrawalReason =
		ownerReason ??
		(withdrawalAmount === undefined || withdrawalAmount === 0n ? copy.positiveFundShares : undefined) ??
		(snapshot !== undefined && withdrawalAmount !== undefined && withdrawalAmount > snapshot.shares ? copy.insufficientFundShares : undefined) ??
		(idleMinimum === undefined ? copy.withdrawalMinimumInvalid : undefined) ??
		(snapshot !== undefined && withdrawalAmount !== undefined && idleMinimum !== undefined && snapshot.totalShares > 0n && idleMinimum > (snapshot.reserveAttoRep * withdrawalAmount) / snapshot.totalShares ? copy.withdrawalMinimumTooHigh : undefined)
	const quote = currentQuote?.quote
	let mintReason = walletReason ?? stateReason
	if (mintReason === undefined) {
		if (snapshot !== undefined && snapshot.forkTime > 0n) mintReason = copy.forkMint
		else if (questionId === undefined) mintReason = copy.registerDisabled
		else if (currentQuestion === undefined) mintReason = copy.mintQuestionLoading
		else if (currentQuestion.error !== undefined) mintReason = currentQuestion.error
		else if (position === undefined) mintReason = copy.registerMintFirst
		else if (position.resolved || position.systemState !== 0n) mintReason = copy.mintInactive
		else if (snapshot !== undefined && position.questionEndTime <= snapshot.timestamp) mintReason = copy.questionMatured
		else if (mintAttoEth === undefined || mintAttoEth === 0n || mintFloor === undefined) mintReason = copy.mintInvalid
		else if (currentQuote?.error !== undefined) mintReason = currentQuote.error
		else if (quote === undefined) mintReason = copy.purchaseFeeLoading
		else if (quote.depositAttoRep > quote.availableAttoRep) mintReason = copy.insufficientPoolCapacity
		else if (feeLimit === undefined || feeLimit < quote.purchaseFeeAttoEth) mintReason = copy.purchaseFeeBudgetLow
		else if (loaded.value?.walletAttoEth !== undefined && mintAttoEth + feeLimit > loaded.value.walletAttoEth) mintReason = copy.insufficientMintEth
	}
	const run = (action: string, label: string, build: () => Promise<PortfolioTransaction> | PortfolioTransaction) =>
		actions.runPortfolioAction(action, label, build, undefined, async () => {
			await refresh()
		})
	const requireSnapshot = () => {
		if (snapshot === undefined) throw new Error(copy.enterPortfolio)
		return snapshot
	}
	const assertOwner = () => {
		if (ownerReason !== undefined) throw new Error(ownerReason)
		return requireSnapshot()
	}
	const rebalanceReason = (allocation: PortfolioAggregateSnapshot['positions'][number]) => {
		if (allocation.remainingShares === 0n) return copy.positionClaimed
		if (allocation.recoveryComplete) return copy.recoveryComplete
		return undefined
	}
	const ownerInterval = (selected: PortfolioAggregateSnapshot, positionId: bigint) => selected.intervals.find(interval => interval.active && interval.startPosition <= positionId && (interval.open || interval.endPosition >= positionId))
	const allocationClaimReason = (selected: PortfolioAggregateSnapshot, allocation: PortfolioAggregateSnapshot['positions'][number]) => {
		if (account?.toLowerCase() !== selected.owner.toLowerCase()) return copy.livePositionOwnerRequired
		if (allocation.recoveryComplete) return copy.recoveryComplete
		if (allocation.ownerShares === 0n) return copy.noPositionClaim
		if (ownerInterval(selected, allocation.positionId) === undefined) return copy.intervalNotOnPage
		return undefined
	}

	return {
		snapshot,
		loading: loading.value,
		readError: readError.value,
		refresh,
		depositAmount: depositAmount.value,
		setDepositAmount: (value: string) => {
			depositAmount.value = value
		},
		depositMinimum: depositMinimum.value,
		setDepositMinimum: (value: string) => {
			depositMinimum.value = value
			depositMinimumEdited.value = true
		},
		expectedDepositShares,
		depositAttoRep,
		fundingReason,
		depositReason,
		approve: (requested?: bigint) =>
			run('approvePortfolioRep', copy.approvePoolRep, () => {
				const selected = assertOwner()
				if (requested === undefined || requested <= 0n) throw new Error(copy.positiveAmount)
				return { account: selected.owner, to: selected.repToken, value: 0n, data: encodeFunctionData({ abi: ABIS.mainnet.erc20, functionName: 'approve', args: [selected.portfolio, requested] }), reviewDescription: copy.approvalReview(formatEther(requested), selected.portfolio) }
			}),
		deposit: () =>
			run('depositPortfolioRep', copy.depositPoolRep, () => {
				const selected = assertOwner()
				if (depositReason !== undefined || depositAttoRep === undefined || depositFloor === undefined) throw new Error(depositReason ?? copy.positiveAmount)
				return {
					...buildPortfolioDepositRequest({ owner: selected.owner, portfolio: selected.portfolio, amountAttoRep: depositAttoRep, minimumShares: depositFloor }),
					reviewDescription: copy.depositReview(formatEther(depositAttoRep), formatEther(depositFloor)),
					validateBeforeSubmit: async () => {
						const latest = await read()
						if (latest.forkTime > 0n) throw new Error(copy.forkDeposit)
						if (latest.walletAttoRep < depositAttoRep) throw new Error(copy.insufficient)
						if (latest.allowanceAttoRep < depositAttoRep) throw new Error(copy.poolApprovalRequired)
						const shares = latest.totalShares === 0n || latest.assetsAttoRep === 0n ? depositAttoRep : (depositAttoRep * latest.totalShares) / latest.assetsAttoRep
						if (shares < depositFloor) throw new Error(copy.fundMinimumTooHigh)
					},
				}
			}),
		withdrawalShares: withdrawalShares.value,
		setWithdrawalShares: (value: string) => {
			withdrawalShares.value = value
		},
		withdrawalMinimum: withdrawalMinimum.value,
		setWithdrawalMinimum: (value: string) => {
			withdrawalMinimum.value = value
		},
		withdrawalReason,
		withdraw: () =>
			run('withdrawPortfolioFund', copy.withdrawFund, () => {
				const selected = assertOwner()
				if (withdrawalReason !== undefined || withdrawalAmount === undefined || idleMinimum === undefined) throw new Error(withdrawalReason ?? copy.positiveFundShares)
				return {
					...buildPortfolioFundWithdrawalRequest({ owner: selected.owner, portfolio: selected.portfolio, shares: withdrawalAmount, minimumIdleAttoRep: idleMinimum }),
					reviewDescription: copy.withdrawFundReview(formatEther(withdrawalAmount), formatEther(idleMinimum)),
					validateBeforeSubmit: async () => {
						const latest = await read()
						if (latest.shares < withdrawalAmount) throw new Error(copy.insufficientFundShares)
						if (latest.totalShares === 0n || (latest.reserveAttoRep * withdrawalAmount) / latest.totalShares < idleMinimum) throw new Error(copy.withdrawalMinimumTooHigh)
					},
				}
			}),
		collectReason: ownerReason ?? (snapshot?.recoverableRepAttoRep === 0n && snapshot.recoverableFeesAttoEth === 0n ? copy.noRecoveredProceeds : undefined),
		collectRecovered: () =>
			run('collectPortfolioRecovery', copy.collectRecovered, () => {
				const selected = assertOwner()
				const intervalIds = selected.intervals.filter(interval => interval.active).map(interval => interval.intervalId)
				if (selected.recoverableRepAttoRep === 0n && selected.recoverableFeesAttoEth === 0n) throw new Error(copy.noRecoveredProceeds)
				return {
					...buildPortfolioClaimRecoveredRequest({ owner: selected.owner, portfolio: selected.portfolio, intervalIds }),
					reviewDescription: copy.collectRecoveredReview(formatEther(selected.recoverableRepAttoRep), formatEther(selected.recoverableFeesAttoEth), selected.intervalCount > 64n),
					validateBeforeSubmit: async () => {
						const latest = await read()
						if (intervalIds.some(id => !latest.intervals.some(interval => interval.intervalId === id && interval.active))) throw new Error(copy.recoveryHistoryChanged)
						if (latest.recoverableRepAttoRep === 0n && latest.recoverableFeesAttoEth === 0n) throw new Error(copy.noRecoveredProceeds)
					},
				}
			}),
		previousIntervalPage: () => {
			if (intervalPage.value > 0n) intervalPage.value -= 1n
		},
		nextIntervalPage: () => {
			if (snapshot !== undefined && (intervalPage.value + 1n) * 64n < snapshot.intervalCount) intervalPage.value += 1n
		},

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
			maximumFeeEdited.value = true
		},
		minimumShares: minimumShares.value,
		setMinimumShares: (value: string) => {
			minimumShares.value = value
		},
		position,
		quote,
		mintReason,
		quoteError: currentQuote?.error ?? currentQuestion?.error,
		quoteLoading: enabled && universeCanMint && questionId !== undefined && (currentQuestion === undefined || (quoteEligible && currentQuote === undefined)),
		retryQuote: () => {
			retry.value += 1
		},
		mint: () =>
			run('mintPortfolioCompleteSet', copy.mint, () => {
				const selected = requireSnapshot()
				if (mintReason !== undefined || account === undefined || questionId === undefined || mintAttoEth === undefined || mintFloor === undefined || feeLimit === undefined) throw new Error(mintReason ?? copy.mintInvalid)
				return {
					...buildPortfolioMintRequest({ trader: account, portfolio: selected.portfolio, questionId, recipient: account, minimumShares: mintFloor, mintAttoEth, maximumPurchaseFeeAttoEth: feeLimit }),
					reviewDescription: copy.aggregateMintReview(formatEther(mintAttoEth), formatEther(feeLimit), formatEther(mintFloor)),
					validateBeforeSubmit: async () => {
						const latest = await read()
						const nextQuote = await loadPortfolioMintQuote({ client: portfolioReadClient(backend.createReadClient()), snapshot: latest, questionId, mintAttoEth })
						if (nextQuote.purchaseFeeAttoEth > feeLimit) throw new Error(copy.purchaseFeeBudgetLow)
						if (nextQuote.depositAttoRep > nextQuote.availableAttoRep) throw new Error(copy.insufficientPoolCapacity)
						if ((await backend.createReadClient().getBalance({ address: account })) < mintAttoEth + feeLimit) throw new Error(copy.insufficientMintEth)
					},
				}
			}),
		allocations: snapshot?.positions.map(allocation => ({ ...allocation, claimReason: walletReason ?? stateReason ?? allocationClaimReason(snapshot, allocation), rebalanceReason: walletReason ?? stateReason ?? rebalanceReason(allocation) })) ?? [],
		claimReason: ownerReason,
		rebalancePosition: (positionId: bigint) =>
			run(`rebalancePortfolioPosition:${positionId}`, copy.rebalancePosition, () => {
				const selected = requireSnapshot()
				if (account === undefined) throw new Error(copy.connect)
				const allocation = selected.positions.find(item => item.positionId === positionId)
				if (allocation === undefined) throw new Error(copy.positionUnavailable)
				const reason = rebalanceReason(allocation)
				if (reason !== undefined) throw new Error(reason)
				return {
					...buildPortfolioPositionRebalanceRequest({ processor: account, portfolio: selected.portfolio, positionId }),
					reviewDescription: copy.rebalancePositionReview,
					validateBeforeSubmit: async () => {
						const latest = await read()
						const current = latest.positions.find(item => item.positionId === positionId)
						if (current === undefined) throw new Error(copy.positionUnavailable)
						const unavailable = rebalanceReason(current)
						if (unavailable !== undefined) throw new Error(unavailable)
					},
				}
			}),
		claimPosition: (positionId: bigint) =>
			run(`claimPortfolioPosition:${positionId}`, copy.claimQuestion, () => {
				const selected = requireSnapshot()
				if (account === undefined) throw new Error(copy.connect)
				const allocation = selected.positions.find(item => item.positionId === positionId)
				if (allocation === undefined) throw new Error(copy.positionUnavailable)
				const reason = allocationClaimReason(selected, allocation)
				if (reason !== undefined) throw new Error(reason)
				const interval = ownerInterval(selected, positionId)
				if (interval === undefined) throw new Error(copy.intervalNotOnPage)
				return {
					...buildPortfolioPositionClaimRequest({ owner: selected.owner, portfolio: selected.portfolio, positionId, intervalId: interval.intervalId }),
					reviewDescription: copy.claimQuestionReview(selected.owner),
					validateBeforeSubmit: async () => {
						const latest = await read()
						const current = latest.positions.find(item => item.positionId === positionId)
						if (current === undefined) throw new Error(copy.positionUnavailable)
						const unavailable = allocationClaimReason(latest, current)
						if (unavailable !== undefined) throw new Error(unavailable)
						if (ownerInterval(latest, positionId)?.intervalId !== interval.intervalId) throw new Error(copy.recoveryHistoryChanged)
					},
				}
			}),
		previousPage: () => {
			if (page.value > 0n) page.value -= 1n
		},
		nextPage: () => {
			if (snapshot !== undefined && (page.value + 1n) * 64n < snapshot.positionCount) page.value += 1n
		},
		previousQuestionPage: () => {
			if (questionPage.value > 0n) questionPage.value -= 1n
		},
		nextQuestionPage: () => {
			if (snapshot !== undefined && (questionPage.value + 1n) * 64n < snapshot.questionCount) questionPage.value += 1n
		},
	}
}
