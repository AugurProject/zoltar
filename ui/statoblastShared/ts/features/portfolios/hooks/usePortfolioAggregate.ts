import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { encodeFunctionData, formatEther, formatUnits, type Address } from '@zoltar/core-shared/evm/ethereum'
import {
	buildPortfolioCapitalDepositRequest,
	buildPortfolioCapitalWithdrawPrincipalRequest,
	buildPortfolioCapitalSetHealthRequest,
	buildPortfolioCapitalAuthorizeRequest,
	buildPortfolioCapitalFundExecutionReserveRequest,
	buildPortfolioCapitalWithdrawExecutionReserveRequest,
	buildPortfolioCapitalRequestRetirementRequest,
	buildPortfolioCapitalCancelRetirementRequest,
	buildPortfolioCapitalServeRetirementRequest,
	buildPortfolioCapitalClaimEarningsRequest,
	loadPortfolioCapitalSnapshot,
	type PortfolioCapitalSnapshot,
} from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { portfolioReadClient, type PortfolioTransaction } from '../../../protocol/securityPoolPortfolio.js'
import { executionFundingReview } from '../../../copy/portfolioCapital.js'
import { portfolioAmountOrUndefined } from '../lib/draft.js'
import { portfolioBasisPointsOrUndefined } from '../lib/creation.js'
import { capitalAuthorizationReason, capitalExecutionWithdrawalReason, capitalWithdrawalReason, requiredPortfolioCollateral, requiredPortfolioExecutionReserve } from '../lib/capital.js'
import type { usePortfolio } from './usePortfolio.js'
import type { usePortfolioActions } from './usePortfolioActions.js'

export function usePortfolioAggregate(model: Pick<ReturnType<typeof usePortfolio>, 'snapshot' | 'loading' | 'error' | 'refresh'>, actions: Pick<ReturnType<typeof usePortfolioActions>, 'ownerReason' | 'runPortfolioAction'>, accountAddress: Address | undefined) {
	const depositAmount = useSignal('')
	const withdrawalAmount = useSignal('')
	const reserveAmount = useSignal('')
	const reserveWithdrawal = useSignal('')
	const healthPercent = useSignal('100')
	const commitmentAmount = useSignal('')
	const snapshot = model.snapshot
	const stateReason = (model.loading ? 'Refreshing portfolio balances.' : undefined) ?? (snapshot === undefined ? 'Load a portfolio account first.' : model.error)
	const ownerReason = actions.ownerReason ?? stateReason
	const inactiveReason = snapshot !== undefined && (snapshot.forkTime > 0n || snapshot.frozen || snapshot.importing) ? 'This universe is closed to new commitments.' : undefined
	const admissionReason = snapshot?.admission.mode === 'custom' ? 'This interface supports open or fixed question policies.' : undefined
	const depositAttoRep = portfolioAmountOrUndefined(depositAmount.value)
	const withdrawAttoRep = portfolioAmountOrUndefined(withdrawalAmount.value)
	const fundAttoEth = portfolioAmountOrUndefined(reserveAmount.value)
	const reserveWithdrawAttoEth = portfolioAmountOrUndefined(reserveWithdrawal.value)
	const commitmentAttoEth = portfolioAmountOrUndefined(commitmentAmount.value)
	const healthBps = portfolioBasisPointsOrUndefined(healthPercent.value)
	useEffect(() => {
		if (snapshot === undefined) return
		healthPercent.value = formatUnits(snapshot.ownerAccount.targetHealthFactorBps || 10_000n, 2)
		depositAmount.value = ''
		withdrawalAmount.value = ''
		reserveAmount.value = ''
		reserveWithdrawal.value = ''
		commitmentAmount.value = ''
	}, [snapshot?.portfolio, snapshot?.owner, snapshot?.universeId])
	const positive = (value: bigint | undefined) => (value === undefined || value === 0n ? 'Enter a positive amount.' : undefined)
	const fundingReason = ownerReason ?? inactiveReason ?? admissionReason ?? positive(depositAttoRep) ?? (snapshot !== undefined && depositAttoRep !== undefined && depositAttoRep > snapshot.walletAttoRep ? 'Insufficient wallet REP.' : undefined)
	const depositReason = fundingReason ?? (snapshot !== undefined && depositAttoRep !== undefined && depositAttoRep > snapshot.allowanceAttoRep ? 'Approve REP before depositing.' : undefined)
	const withdrawReason = ownerReason ?? (snapshot === undefined ? undefined : capitalWithdrawalReason(snapshot, withdrawAttoRep))
	const fundReserveReason = ownerReason ?? (snapshot?.exported ? 'The reserve follows your fork choice.' : undefined) ?? positive(fundAttoEth) ?? (snapshot !== undefined && fundAttoEth !== undefined && fundAttoEth > snapshot.walletAttoEth ? 'Insufficient wallet ETH; gas is additional.' : undefined)
	const withdrawReserveReason = ownerReason ?? (snapshot === undefined ? undefined : capitalExecutionWithdrawalReason(snapshot, reserveWithdrawAttoEth))
	const healthReason = ownerReason ?? inactiveReason ?? (healthBps === undefined || healthBps < 10_000n ? 'Choose a health target of at least 100%.' : undefined)
	const authorizeReason = ownerReason ?? admissionReason ?? (snapshot === undefined ? undefined : capitalAuthorizationReason(snapshot, commitmentAttoEth))
	const livePositions = snapshot?.positions.filter(position => position.commitment > 0n) ?? []
	const claimReason = ownerReason
	const serveReason = ownerReason ?? inactiveReason ?? (snapshot?.priceValid === false ? 'Refresh the shared REP price first.' : undefined)
	const requireSnapshot = () => {
		if (snapshot === undefined || accountAddress === undefined || accountAddress.toLowerCase() !== snapshot.owner.toLowerCase()) throw new Error('Connect the selected owner account.')
		return snapshot
	}
	const run = (action: string, title: string, reason: string | undefined, build: (selected: NonNullable<typeof snapshot>) => PortfolioTransaction, validate?: (latest: PortfolioCapitalSnapshot) => void) =>
		actions.runPortfolioAction(action, title, () => {
			if (reason !== undefined) throw new Error(reason)
			const selected = requireSnapshot()
			const request = build(selected)
			return {
				...request,
				validateBeforeSubmit: async () => {
					const latest = await loadPortfolioCapitalSnapshot({ client: portfolioReadClient(createConnectedReadClient()), portfolio: selected.portfolio, owner: selected.owner, universeId: selected.universeId })
					if (latest.chainId !== selected.chainId || latest.capitalLedger !== selected.capitalLedger) throw new Error('Portfolio context changed. Review the transaction again.')
					validate?.(latest)
					await request.validateBeforeSubmit?.()
				},
			}
		})
	const base = (selected: NonNullable<typeof snapshot>) => ({ owner: selected.owner, capitalLedger: selected.capitalLedger })
	return {
		snapshot,
		loading: model.loading,
		readError: model.error,
		refresh: model.refresh,
		depositAmount: depositAmount.value,
		setDepositAmount: (value: string) => {
			depositAmount.value = value
		},
		depositAttoRep,
		fundingReason,
		depositReason,
		withdrawalAmount: withdrawalAmount.value,
		setWithdrawalAmount: (value: string) => {
			withdrawalAmount.value = value
		},
		withdrawReason,
		reserveAmount: reserveAmount.value,
		setReserveAmount: (value: string) => {
			reserveAmount.value = value
		},
		fundReserveReason,
		reserveWithdrawal: reserveWithdrawal.value,
		setReserveWithdrawal: (value: string) => {
			reserveWithdrawal.value = value
		},
		withdrawReserveReason,
		healthPercent: healthPercent.value,
		setHealthPercent: (value: string) => {
			healthPercent.value = value
		},
		healthReason,
		commitmentAmount: commitmentAmount.value,
		setCommitmentAmount: (value: string) => {
			commitmentAmount.value = value
		},
		authorizeReason,
		requiredCollateral: snapshot !== undefined && commitmentAttoEth !== undefined && snapshot.acceptedPrice > 0n ? requiredPortfolioCollateral(snapshot, commitmentAttoEth) : undefined,
		requiredExecutionReserve: snapshot !== undefined && commitmentAttoEth !== undefined ? requiredPortfolioExecutionReserve(snapshot, commitmentAttoEth) : undefined,
		livePositions,
		claimReason,
		serveReason,
		positionReasons: (id: bigint) => {
			const position = livePositions.find(item => item.id === id)
			const common = ownerReason ?? inactiveReason ?? (position === undefined ? 'Position is no longer live.' : undefined)
			return {
				retire: common ?? (position?.batch !== 0n ? 'Retirement already requested.' : undefined),
				cancel: common ?? (position?.batch === 0n ? 'Position is active.' : undefined),
			}
		},
		approve: (amount: bigint) =>
			run('approvePortfolioRep', 'Approve REP deposit', fundingReason, selected => ({
				account: selected.owner,
				to: selected.repToken,
				value: 0n,
				data: encodeFunctionData({ abi: ABIS.mainnet.erc20, functionName: 'approve', args: [selected.capitalLedger, amount] }),
				reviewDescription: `Allow the capital ledger ${selected.capitalLedger} to transfer up to ${formatEther(amount)} REP from your wallet. This does not deposit or pledge REP.`,
			})),
		deposit: () =>
			run('depositPortfolioRep', 'Deposit REP', depositReason, selected => {
				if (depositAttoRep === undefined) throw new Error('Enter a deposit amount.')
				return { ...buildPortfolioCapitalDepositRequest({ ...base(selected), amountAttoRep: depositAttoRep }), reviewDescription: `Deposit exactly ${formatEther(depositAttoRep)} REP into your account. It immediately backs any existing commitment without increasing it. Authorizing capacity is a separate transaction.` }
			}),
		withdraw: () =>
			run(
				'withdrawPortfolioRep',
				'Withdraw REP',
				withdrawReason,
				selected => {
					if (withdrawAttoRep === undefined) throw new Error('Enter a withdrawal amount.')
					return {
						...buildPortfolioCapitalWithdrawPrincipalRequest({ ...base(selected), amountAttoRep: withdrawAttoRep }),
						reviewDescription: `Withdraw ${formatEther(withdrawAttoRep)} REP to ${selected.owner}. Any remaining commitment must retain the protocol health floor; withdrawal may reduce your saved health buffer.`,
					}
				},
				latest => {
					const reason = capitalWithdrawalReason(latest, withdrawAttoRep)
					if (reason !== undefined) throw new Error(reason)
				},
			),
		fundReserve: () =>
			run(
				'fundPortfolioExecution',
				'Fund execution reserve',
				fundReserveReason,
				selected => {
					if (fundAttoEth === undefined) throw new Error('Enter reserve funding.')
					return {
						...buildPortfolioCapitalFundExecutionReserveRequest({ ...base(selected), amountAttoEth: fundAttoEth }),
						reviewDescription: executionFundingReview(formatEther(fundAttoEth), selected.ownerCommitmentAttoEth > 0n),
					}
				},
				latest => {
					if (latest.exported) throw new Error('The reserve follows your fork choice.')
					if (latest.ownerCommitmentAttoEth > 0n !== (snapshot !== undefined && snapshot.ownerCommitmentAttoEth > 0n)) throw new Error('Commitment status changed. Review reserve funding again.')
				},
			),
		withdrawReserve: () =>
			run(
				'withdrawPortfolioExecution',
				'Withdraw execution reserve',
				withdrawReserveReason,
				selected => {
					if (reserveWithdrawAttoEth === undefined) throw new Error('Enter reserve withdrawal.')
					return { ...buildPortfolioCapitalWithdrawExecutionReserveRequest({ ...base(selected), amountAttoEth: reserveWithdrawAttoEth }), reviewDescription: `Withdraw ${formatEther(reserveWithdrawAttoEth)} ETH of available execution reserve to ${selected.owner}.` }
				},
				latest => {
					const reason = capitalExecutionWithdrawalReason(latest, reserveWithdrawAttoEth)
					if (reason !== undefined) throw new Error(reason)
				},
			),
		setHealth: () =>
			run('setPortfolioHealth', 'Save health target', healthReason, selected => {
				if (healthBps === undefined) throw new Error('Enter your health target.')
				return { ...buildPortfolioCapitalSetHealthRequest({ ...base(selected), targetHealthFactorBps: healthBps }), reviewDescription: `Set your health target to ${formatUnits(healthBps, 2)}% for new authorizations. Saving a target does not deposit additional REP.` }
			}),
		authorize: () =>
			run(
				'authorizePortfolioCommitment',
				'Authorize commitment',
				authorizeReason,
				selected => {
					if (commitmentAttoEth === undefined) throw new Error('Enter a commitment.')
					return {
						...buildPortfolioCapitalAuthorizeRequest({ ...base(selected), commitment: commitmentAttoEth }),
						reviewDescription: `Authorize ${formatEther(commitmentAttoEth)} ETH commitment backed by all ${formatEther(selected.ownerPrincipalAttoRep)} REP in your account at your saved ${formatUnits(selected.ownerAccount.targetHealthFactorBps || 10_000n, 2)}% health target. All eligible questions share this capacity. Your account bears its own liquidation losses; retirement waits for spare capacity.`,
					}
				},
				latest => {
					if (latest.ownerAccount.targetHealthFactorBps !== snapshot?.ownerAccount.targetHealthFactorBps) throw new Error('Your health target changed. Review the commitment again.')
					if (latest.ownerPrincipalAttoRep !== snapshot?.ownerPrincipalAttoRep) throw new Error('Your principal changed. Review the commitment again.')
					const reason = capitalAuthorizationReason(latest, commitmentAttoEth)
					if (reason !== undefined) throw new Error(reason)
				},
			),
		claim: () => run('claimPortfolioEarnings', 'Claim earnings', claimReason, selected => ({ ...buildPortfolioCapitalClaimEarningsRequest(base(selected)), reviewDescription: 'Checkpoint and collect your earned ETH and REP. Future vesting rewards stay in the pool. This does not withdraw your principal.' })),
		serve: () =>
			run('servePortfolioRetirement', 'Release available retirement', serveReason, selected => ({
				...buildPortfolioCapitalServeRetirementRequest(base(selected)),
				reviewDescription: 'Release commitments from the current retirement cohort using spare healthy capacity. Partial progress is possible; no fixed completion date is promised.',
			})),
		retire: (id: bigint) =>
			run(`retirePortfolio-${id}`, 'Request retirement', ownerReason ?? inactiveReason, selected => ({
				...buildPortfolioCapitalRequestRetirementRequest({ ...base(selected), positionId: id }),
				reviewDescription: `Move position ${id} to the next retirement cohort. It remains exposed and earns eligible fees until released. Completion depends on spare capacity.`,
			})),
		cancelRetirement: (id: bigint) =>
			run(`cancelRetirementPortfolio-${id}`, 'Cancel retirement', ownerReason ?? inactiveReason, selected => ({ ...buildPortfolioCapitalCancelRetirementRequest({ ...base(selected), positionId: id }), reviewDescription: `Return position ${id} to active underwriting and give up its retirement priority.` })),
	}
}
