import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { encodeFunctionData, formatEther, formatUnits, type Address } from '@zoltar/core-shared/evm/ethereum'
import {
	buildPortfolioCapitalDepositRequest,
	buildPortfolioCapitalWithdrawPrincipalRequest,
	buildPortfolioCapitalSetHealthRequest,
	buildPortfolioCapitalDepositAndSetHealthRequest,
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
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import * as capitalCopy from '../../../copy/portfolioCapital.js'
import { portfolioAmountOrUndefined, portfolioUnsignedId } from '../lib/draft.js'
import { portfolioBasisPointsOrUndefined } from '../lib/creation.js'
import { capitalAuthorizationReason, capitalExecutionWithdrawalReason, capitalWithdrawalReason, requiredPortfolioCollateral, requiredPortfolioExecutionReserve, maximumPortfolioCommitment, capitalHealthReason, capitalCancelRetirementReason, capitalRetirementReason } from '../lib/capital.js'
import type { usePortfolio } from './usePortfolio.js'
import type { usePortfolioActions } from './usePortfolioActions.js'

const proofAbi = [
	{
		type: 'function',
		name: 'reportAuthorization',
		stateMutability: 'view',
		inputs: [
			{ name: 'reportId', type: 'uint256' },
			{ name: 'newExposure', type: 'uint256' },
		],
		outputs: [
			{ name: 'conservativeReportPrice', type: 'uint256' },
			{ name: 'epoch', type: 'uint256' },
		],
	},
] as const

async function readAuthorizationProof(snapshot: PortfolioCapitalSnapshot, reportId: bigint, commitment: bigint) {
	const client = createConnectedReadClient()
	const totalCommitment = snapshot.totalCommitmentAttoEth - snapshot.ownerCommitmentAttoEth + commitment
	const exposure = totalCommitment > snapshot.demandAttoEth ? totalCommitment : snapshot.demandAttoEth
	const [price] = await client.readContract({ address: snapshot.priceFeed, abi: proofAbi, functionName: 'reportAuthorization', args: [reportId, exposure], blockNumber: snapshot.blockNumber })
	return price
}

export function usePortfolioAggregate(
	model: Pick<ReturnType<typeof usePortfolio>, 'snapshot' | 'loading' | 'error' | 'refresh'> & Partial<Pick<ReturnType<typeof usePortfolio>, 'presentationSnapshot'>>,
	actions: Pick<ReturnType<typeof usePortfolioActions>, 'ownerReason' | 'runPortfolioAction'>,
	accountAddress: Address | undefined,
) {
	const depositAmount = useSignal('')
	const withdrawalAmount = useSignal('')
	const reserveAmount = useSignal('')
	const reserveWithdrawal = useSignal('')
	const healthPercent = useSignal('100')
	const commitmentAmount = useSignal('')
	const healthDepositAmount = useSignal('')
	const remainingCommitmentAmount = useSignal('0')
	const reportInput = useSignal('')
	const draftContext = useRef<{ key: string; savedHealth: bigint }>()
	const proof = useSignal<{ context: string; key: string; price?: bigint | undefined; error?: string; pending?: boolean }>()
	const snapshot = model.snapshot ?? model.presentationSnapshot
	const showingPreviousSnapshot = model.snapshot === undefined && snapshot !== undefined
	const stateReason = (model.loading ? 'Refreshing portfolio balances.' : undefined) ?? (showingPreviousSnapshot ? capitalCopy.readUnavailable : undefined) ?? (snapshot === undefined ? 'Load a portfolio account first.' : model.error)
	const ownerReason = actions.ownerReason ?? stateReason
	const inactiveReason = snapshot !== undefined && (snapshot.forkTime > 0n || snapshot.frozen || snapshot.importing) ? 'This universe is closed to new commitments.' : undefined
	const admissionReason = snapshot?.admission.mode === 'custom' ? 'This interface supports open or fixed question policies.' : undefined
	const depositAttoRep = portfolioAmountOrUndefined(depositAmount.value)
	const withdrawAttoRep = portfolioAmountOrUndefined(withdrawalAmount.value)
	const fundAttoEth = portfolioAmountOrUndefined(reserveAmount.value)
	const reserveWithdrawAttoEth = portfolioAmountOrUndefined(reserveWithdrawal.value)
	const healthBps = portfolioBasisPointsOrUndefined(healthPercent.value)
	const reportId = reportInput.value.trim() === '' ? undefined : portfolioUnsignedId(reportInput.value)
	const proofContext = `${snapshot?.chainId}:${snapshot?.portfolio}:${snapshot?.universeId}:${snapshot?.owner}:${snapshot?.blockHash}:${snapshot?.totalCommitmentAttoEth}:${snapshot?.ownerCommitmentAttoEth}:${snapshot?.demandAttoEth}:${reportId}`
	const sizingProofPrice = proof.value?.context === proofContext ? proof.value.price : undefined
	const targetCapacity = snapshot === undefined ? undefined : maximumPortfolioCommitment(snapshot, healthBps, sizingProofPrice)
	const pledgedRep = snapshot?.positions.find(position => position.commitment > 0n)?.rep ?? 0n
	const retirementTargetCapacity = snapshot === undefined ? undefined : maximumPortfolioCommitment({ ...snapshot, ownerPrincipalAttoRep: pledgedRep }, healthBps)
	const commitmentAttoEth = commitmentAmount.value.trim() === '' ? targetCapacity : portfolioAmountOrUndefined(commitmentAmount.value)
	const displayedCommitment = commitmentAmount.value.trim() === '' && targetCapacity !== undefined ? formatEther(targetCapacity) : commitmentAmount.value
	const remainingCommitment = portfolioAmountOrUndefined(remainingCommitmentAmount.value)
	const targetRequiredRep = snapshot !== undefined && healthBps !== undefined && healthBps >= 10_000n && healthBps < 1n << 256n && snapshot.ownerConservativePrice > 0n ? requiredPortfolioCollateral(snapshot, snapshot.ownerCommitmentAttoEth, undefined, healthBps) : undefined
	let targetShortfall: bigint | undefined
	if (targetRequiredRep !== undefined && snapshot !== undefined) targetShortfall = targetRequiredRep > pledgedRep ? targetRequiredRep - pledgedRep : 0n
	const healthDepositAttoRep = healthDepositAmount.value.trim() === '' ? targetShortfall : portfolioAmountOrUndefined(healthDepositAmount.value)
	const proofKey = `${proofContext}:${commitmentAttoEth}`
	useEffect(() => {
		let active = true
		if (model.snapshot !== undefined && !model.loading && reportId !== undefined && reportId > 0n && commitmentAttoEth !== undefined && commitmentAttoEth > 0n) {
			proof.value = { context: proofContext, key: proofKey, price: sizingProofPrice, pending: true }
			void readAuthorizationProof(model.snapshot, reportId, commitmentAttoEth)
				.then(price => {
					if (active) proof.value = { context: proofContext, key: proofKey, price }
				})
				.catch(error => {
					if (active) proof.value = { context: proofContext, key: proofKey, price: sizingProofPrice, error: getErrorMessage(error, capitalCopy.reportUnavailable) }
				})
		} else proof.value = undefined
		return () => {
			active = false
		}
	}, [proofKey, model.snapshot !== undefined, model.loading])
	const proofPrice = proof.value?.key === proofKey && !proof.value.pending && proof.value.error === undefined ? proof.value.price : undefined
	let proofReason: string | undefined
	if (reportInput.value.trim() !== '') {
		if (reportId === undefined || reportId === 0n) proofReason = capitalCopy.reportInvalid
		else proofReason = proof.value?.key === proofKey && !proof.value.pending ? proof.value.error : capitalCopy.reportChecking
	}
	useEffect(() => {
		if (snapshot === undefined) return
		const key = `${snapshot.chainId}:${snapshot.portfolio}:${snapshot.owner}:${snapshot.universeId}`
		const savedHealth = snapshot.ownerAccount.targetHealthFactorBps || 10_000n
		const previous = draftContext.current
		draftContext.current = { key, savedHealth }
		if (previous?.key === key) {
			if (previous.savedHealth !== savedHealth) healthPercent.value = formatUnits(savedHealth, 2)
			return
		}
		healthPercent.value = formatUnits(savedHealth, 2)
		depositAmount.value = ''
		withdrawalAmount.value = ''
		reserveAmount.value = ''
		reserveWithdrawal.value = ''
		commitmentAmount.value = ''
		healthDepositAmount.value = ''
		remainingCommitmentAmount.value = '0'
		reportInput.value = ''
	}, [snapshot?.chainId, snapshot?.portfolio, snapshot?.owner, snapshot?.universeId, snapshot?.ownerAccount.targetHealthFactorBps])
	const positive = (value: bigint | undefined) => (value === undefined || value === 0n ? 'Enter a positive amount.' : undefined)
	const fundingReason = ownerReason ?? inactiveReason ?? admissionReason ?? positive(depositAttoRep) ?? (snapshot !== undefined && depositAttoRep !== undefined && depositAttoRep > snapshot.walletAttoRep ? 'Insufficient wallet REP.' : undefined)
	const depositReason = fundingReason ?? (snapshot !== undefined && depositAttoRep !== undefined && depositAttoRep > snapshot.allowanceAttoRep ? 'Approve REP before depositing.' : undefined)
	const withdrawReason = ownerReason ?? (snapshot === undefined ? undefined : capitalWithdrawalReason(snapshot, withdrawAttoRep))
	const fundReserveReason = ownerReason ?? (snapshot?.exported ? 'The reserve follows your fork choice.' : undefined) ?? positive(fundAttoEth) ?? (snapshot !== undefined && fundAttoEth !== undefined && fundAttoEth > snapshot.walletAttoEth ? 'Insufficient wallet ETH; gas is additional.' : undefined)
	const withdrawReserveReason = ownerReason ?? (snapshot === undefined ? undefined : capitalExecutionWithdrawalReason(snapshot, reserveWithdrawAttoEth))
	const healthReason = ownerReason ?? (snapshot === undefined ? undefined : capitalHealthReason(snapshot, healthBps))
	const healthFundingReason =
		ownerReason ??
		inactiveReason ??
		admissionReason ??
		positive(healthDepositAttoRep) ??
		(snapshot !== undefined && healthDepositAttoRep !== undefined && healthDepositAttoRep > snapshot.walletAttoRep ? 'Insufficient wallet REP.' : undefined) ??
		(snapshot === undefined ? undefined : capitalHealthReason(snapshot, healthBps, healthDepositAttoRep))
	const healthDepositReason = healthFundingReason ?? (snapshot !== undefined && healthDepositAttoRep !== undefined && healthDepositAttoRep > snapshot.allowanceAttoRep ? 'Approve REP before depositing.' : undefined)
	const unsavedTargetReason = snapshot !== undefined && healthBps !== (snapshot.ownerAccount.targetHealthFactorBps || 10_000n) ? 'Save your health target before authorizing this commitment.' : undefined
	const authorizeReason = ownerReason ?? admissionReason ?? unsavedTargetReason ?? proofReason ?? (snapshot === undefined ? undefined : capitalAuthorizationReason(snapshot, commitmentAttoEth, proofPrice))
	const livePositions = snapshot?.positions.filter(position => position.commitment > 0n) ?? []
	const pendingRetirement = livePositions.find(position => position.batch !== 0n)
	const claimReason = ownerReason
	const serveReason = ownerReason ?? inactiveReason ?? (snapshot?.priceValid === false ? 'Refresh the shared REP price first.' : undefined)
	const requireSnapshot = () => {
		const current = model.snapshot
		if (current === undefined || accountAddress === undefined || accountAddress.toLowerCase() !== current.owner.toLowerCase()) throw new Error('Connect the selected owner account.')
		return current
	}
	const run = (action: string, title: string, reason: string | undefined, build: (selected: NonNullable<typeof snapshot>) => PortfolioTransaction, validate?: (latest: PortfolioCapitalSnapshot) => void | Promise<void>) =>
		actions.runPortfolioAction(action, title, () => {
			if (reason !== undefined) throw new Error(reason)
			const selected = requireSnapshot()
			const request = build(selected)
			return {
				...request,
				validateBeforeSubmit: async () => {
					const latest = await loadPortfolioCapitalSnapshot({ client: portfolioReadClient(createConnectedReadClient()), portfolio: selected.portfolio, owner: selected.owner, universeId: selected.universeId })
					if (latest.chainId !== selected.chainId || latest.capitalLedger !== selected.capitalLedger) throw new Error('Portfolio context changed. Review the transaction again.')
					await validate?.(latest)
					await request.validateBeforeSubmit?.()
				},
			}
		})
	const base = (selected: NonNullable<typeof snapshot>) => ({ owner: selected.owner, capitalLedger: selected.capitalLedger })
	return {
		snapshot,
		showingPreviousSnapshot,
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
		commitmentAmount: displayedCommitment,
		setCommitmentAmount: (value: string) => {
			commitmentAmount.value = value
		},
		useTargetCapacity: () => {
			commitmentAmount.value = ''
		},
		targetCapacity,
		retirementTargetCapacity,
		targetShortfall,
		healthDepositAmount: healthDepositAmount.value.trim() === '' && targetShortfall !== undefined ? formatEther(targetShortfall) : healthDepositAmount.value,
		setHealthDepositAmount: (value: string) => {
			healthDepositAmount.value = value
		},
		healthDepositAttoRep,
		healthFundingReason,
		healthDepositReason,
		remainingCommitmentAmount: remainingCommitmentAmount.value,
		setRemainingCommitmentAmount: (value: string) => {
			remainingCommitmentAmount.value = value
		},
		retireToTarget: () => {
			if (retirementTargetCapacity === undefined || snapshot === undefined || retirementTargetCapacity >= snapshot.ownerCommitmentAttoEth) return
			const maximumResidual = snapshot.ownerCommitmentAttoEth > snapshot.economics.minimumCommitmentAttoEth ? snapshot.ownerCommitmentAttoEth - snapshot.economics.minimumCommitmentAttoEth : 0n
			const residual = retirementTargetCapacity < maximumResidual ? retirementTargetCapacity : maximumResidual
			remainingCommitmentAmount.value = formatEther(residual < snapshot.economics.minimumCommitmentAttoEth ? 0n : residual)
		},
		reportInput: reportInput.value,
		setReportInput: (value: string) => {
			reportInput.value = value
		},
		proofPrice,
		authorizeReason,
		requiredCollateral: snapshot !== undefined && commitmentAttoEth !== undefined && snapshot.acceptedPrice > 0n ? requiredPortfolioCollateral(snapshot, commitmentAttoEth, proofPrice) : undefined,
		requiredExecutionReserve: snapshot !== undefined && commitmentAttoEth !== undefined ? requiredPortfolioExecutionReserve(snapshot, commitmentAttoEth) : undefined,
		livePositions,
		claimReason,
		serveReason,
		positionReasons: (id: bigint) => {
			const position = livePositions.find(item => item.id === id)
			const common = ownerReason ?? inactiveReason ?? (position === undefined ? 'Position is no longer live.' : undefined)
			return {
				retire: common ?? (snapshot === undefined ? undefined : capitalRetirementReason(snapshot, id, remainingCommitment)),
				cancel: common ?? (snapshot === undefined ? undefined : capitalCancelRetirementReason(snapshot, id)),
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
		approveHealthDeposit: (amount: bigint) =>
			run('approvePortfolioHealthRep', 'Approve REP for health target', healthFundingReason, selected => ({
				account: selected.owner,
				to: selected.repToken,
				value: 0n,
				data: encodeFunctionData({ abi: ABIS.mainnet.erc20, functionName: 'approve', args: [selected.capitalLedger, amount] }),
				reviewDescription: `Allow the capital ledger ${selected.capitalLedger} to transfer up to ${formatEther(amount)} REP. Depositing and saving your target is a separate transaction.`,
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
						reviewDescription: `Withdraw ${formatEther(withdrawAttoRep)} REP to ${selected.owner}. Any remaining commitment must retain your saved ${formatUnits(selected.ownerAccount.targetHealthFactorBps || 10_000n, 2)}% health target.`,
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
			run(
				'setPortfolioHealth',
				'Save health target',
				healthReason,
				selected => {
					if (healthBps === undefined) throw new Error('Enter your health target.')
					return {
						...buildPortfolioCapitalSetHealthRequest({ ...base(selected), targetHealthFactorBps: healthBps }),
						reviewDescription: `Save a ${formatUnits(healthBps, 2)}% target for withdrawals, authorizations and cancelling retirement. Raising the target requires enough REP now. This does not change your commitment or the protocol liquidation threshold.`,
					}
				},
				latest => {
					const reason = capitalHealthReason(latest, healthBps)
					if (reason !== undefined) throw new Error(reason)
				},
			),
		depositAndSetHealth: () =>
			run(
				'depositPortfolioHealthRep',
				'Deposit REP and save target',
				healthDepositReason,
				selected => {
					if (healthDepositAttoRep === undefined || healthBps === undefined) throw new Error('Enter a deposit and health target.')
					return {
						...buildPortfolioCapitalDepositAndSetHealthRequest({ ...base(selected), amountAttoRep: healthDepositAttoRep, targetHealthFactorBps: healthBps }),
						reviewDescription: `Deposit ${formatEther(healthDepositAttoRep)} REP and save a ${formatUnits(healthBps, 2)}% target together. Your commitment does not increase. Raising a live target requires sufficient backing; if that check fails, both changes revert.`,
					}
				},
				async latest => {
					const reason = capitalHealthReason(latest, healthBps, healthDepositAttoRep)
					if (reason !== undefined) throw new Error(reason)
					if (healthDepositAttoRep === undefined) throw new Error('Enter a REP deposit.')
					const client = createConnectedReadClient()
					const [balance, allowance] = await Promise.all([
						client.readContract({ address: latest.repToken, abi: ABIS.mainnet.erc20, functionName: 'balanceOf', args: [latest.owner] }),
						client.readContract({ address: latest.repToken, abi: ABIS.mainnet.erc20, functionName: 'allowance', args: [latest.owner, latest.capitalLedger] }),
					])
					if (balance < healthDepositAttoRep) throw new Error('Insufficient wallet REP.')
					if (allowance < healthDepositAttoRep) throw new Error('Approve REP before depositing.')
				},
			),
		authorize: () =>
			run(
				'authorizePortfolioCommitment',
				'Authorize commitment',
				authorizeReason,
				selected => {
					if (commitmentAttoEth === undefined) throw new Error('Enter a commitment.')
					return {
						...buildPortfolioCapitalAuthorizeRequest({ ...base(selected), commitment: commitmentAttoEth, ...(reportId === undefined ? {} : { reportId }) }),
						reviewDescription: `Authorize ${formatEther(commitmentAttoEth)} ETH commitment backed by all ${formatEther(selected.ownerPrincipalAttoRep)} REP in your account at your saved ${formatUnits(selected.ownerAccount.targetHealthFactorBps || 10_000n, 2)}% health target. All eligible questions share this capacity. Your account bears its own liquidation losses; retirement waits for spare capacity.${reportId === undefined ? '' : ` Report ${reportId} sets a collateral price floor until a later canonical report covers the full pool commitment.`}`,
					}
				},
				async latest => {
					if (latest.ownerAccount.targetHealthFactorBps !== snapshot?.ownerAccount.targetHealthFactorBps) throw new Error('Your health target changed. Review the commitment again.')
					if (latest.ownerPrincipalAttoRep !== snapshot?.ownerPrincipalAttoRep) throw new Error('Your principal changed. Review the commitment again.')
					const freshProofPrice = reportId !== undefined && commitmentAttoEth !== undefined ? await readAuthorizationProof(latest, reportId, commitmentAttoEth) : undefined
					if (freshProofPrice !== proofPrice) throw new Error(capitalCopy.reportChanged)
					const reason = capitalAuthorizationReason(latest, commitmentAttoEth, freshProofPrice)
					if (reason !== undefined) throw new Error(reason)
				},
			),
		claim: () => run('claimPortfolioEarnings', 'Claim earnings', claimReason, selected => ({ ...buildPortfolioCapitalClaimEarningsRequest(base(selected)), reviewDescription: 'Checkpoint and collect your earned ETH and REP. Future vesting rewards stay in the pool. This does not withdraw your principal.' })),
		serve: () =>
			run(
				'servePortfolioRetirement',
				'Release available retirement',
				serveReason,
				selected => ({
					...buildPortfolioCapitalServeRetirementRequest({ ...base(selected), positionId: pendingRetirement?.id ?? 0n }),
					reviewDescription:
						pendingRetirement === undefined
							? 'Release commitments from the current retirement cohort using spare healthy capacity. Partial progress is possible; no fixed completion date is promised.'
							: `Attempt to finish your request at ${formatEther(pendingRetirement.remainingCommitment)} ETH commitment. ${pendingRetirement.retirementPreview === undefined ? capitalCopy.retirementPreviewUnavailable : capitalCopy.retirementPreviewStatus[pendingRetirement.retirementPreview.status]}. It completes only when spare healthy capacity covers earlier reserved reductions and your entire remaining reduction. Otherwise your commitment remains unchanged. ${capitalCopy.retirementPreviewHint} Ordinary pool activity can still make partial progress.`,
				}),
				latest => {
					if (!latest.priceValid) throw new Error('Refresh the shared REP price first.')
					if (latest.forkTime > 0n || latest.frozen || latest.importing) throw new Error('This universe is closed to retirement.')
					if (pendingRetirement === undefined) return
					const current = latest.positions.find(position => position.id === pendingRetirement.id && position.commitment > 0n && position.batch !== 0n)
					if (current === undefined || current.remainingCommitment !== pendingRetirement.remainingCommitment) throw new Error('Retirement request changed. Review the transaction again.')
					if (pendingRetirement.retirementPreview?.status === 'ready' && current.retirementPreview?.status !== 'ready') throw new Error('Retirement capacity changed. Refresh the preview and review the transaction again.')
				},
			),
		retire: (id: bigint) =>
			run(
				`retirePortfolio-${id}`,
				'Request retirement',
				ownerReason ?? inactiveReason,
				selected => {
					const reason = capitalRetirementReason(selected, id, remainingCommitment)
					if (reason !== undefined || remainingCommitment === undefined) throw new Error(reason ?? 'Enter a remaining commitment.')
					return {
						...buildPortfolioCapitalRequestRetirementRequest({ ...base(selected), positionId: id, remainingCommitment }),
						reviewDescription: `Queue position ${id} to reduce its commitment to ${formatEther(remainingCommitment)} ETH. ${remainingCommitment === 0n ? 'Full retirement releases its REP.' : 'The reduction stops at this amount and keeps its REP backing the remaining commitment.'} Existing demand and earlier retirement requests may delay completion. The saved health target stays unchanged.`,
					}
				},
				latest => {
					const reason = capitalRetirementReason(latest, id, remainingCommitment)
					if (reason !== undefined) throw new Error(reason)
				},
			),
		cancelRetirement: (id: bigint) =>
			run(
				`cancelRetirementPortfolio-${id}`,
				'Cancel retirement',
				ownerReason ?? inactiveReason,
				selected => {
					const reason = capitalCancelRetirementReason(selected, id)
					if (reason !== undefined) throw new Error(reason)
					return { ...buildPortfolioCapitalCancelRetirementRequest({ ...base(selected), positionId: id }), reviewDescription: `Return position ${id} to active underwriting at its remaining commitment and give up its retirement priority. Your saved health target must be met at a fresh price.` }
				},
				latest => {
					const reason = capitalCancelRetirementReason(latest, id)
					if (reason !== undefined) throw new Error(reason)
				},
			),
	}
}
