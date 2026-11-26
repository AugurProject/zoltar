import { capital as transactionCopy, newPriceRequired, poolChanged, refreshingBalances } from '../../../copy/securityPoolTransactions.js'
import { unsupportedAdmission } from '../../../copy/securityPool.js'
import { formatCurrencyBalance, formatRoundedCurrencyBalance, formatUnitSuffix } from '@zoltar/ui-core-shared/lib/formatters.js'
import { useSignal } from '@preact/signals'
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks'
import { encodeFunctionData, formatUnits, type Address } from '@zoltar/core-shared/evm/ethereum'
import {
	buildSecurityPoolCapitalDepositRequest,
	buildSecurityPoolCapitalWithdrawPrincipalRequest,
	buildSecurityPoolCapitalSetHealthRequest,
	buildSecurityPoolCapitalDepositAndSetHealthRequest,
	buildSecurityPoolCapitalSetCommitmentRequest,
	buildSecurityPoolCapitalServeRetirementRequest,
	buildSecurityPoolCapitalClaimEarningsRequest,
	loadSecurityPoolCapitalSnapshot,
	buildSecurityPoolAuctionVaultDepositRequest,
	minimumSecurityPoolHealthFactorBps,
	type SecurityPoolCapitalSnapshot,
} from '@zoltar/statoblast-shared/statoblast/securityPool'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { securityPoolReadClient, type SecurityPoolTransaction } from '../../../protocol/securityPool.js'
import { withStatoblastRequestTimeout } from '../../../protocol/requestTimeout.js'
import { currentStateCheckFailed } from '@zoltar/ui-core-shared/copy/transaction.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import * as capitalCopy from '../../../copy/securityPoolCapital.js'
import { securityPoolAmountOrUndefined, securityPoolUnsignedId } from '../lib/draft.js'
import { securityPoolBasisPointsOrUndefined } from '../lib/creation.js'
import { capitalDepositReason, capitalAuthorizationReason, capitalWithdrawalReason, requiredSecurityPoolCollateral, maximumSecurityPoolCommitment, capitalHealthReason, capitalRetirementReason, coveredUnderwaterCommitment } from '../lib/capital.js'
import type { useSecurityPool } from './useSecurityPool.js'
import type { useSecurityPoolActions } from './useSecurityPoolActions.js'

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

/** Describe an eligible immediate cure and the portion that can still queue. */
function retirementQueueDescription(covered: bigint | undefined, remainingCommitment: bigint, collateral: Readonly<{ decimals: number; symbol: string }>) {
	if (covered === undefined) return capitalCopy.reductionWaits
	// Rounding down keeps "covers only" conservative.
	return capitalCopy.reductionWithCure(`${formatRoundedCurrencyBalance(covered, collateral.decimals, 4, 'down')} ${collateral.symbol}`, remainingCommitment >= covered)
}

async function readAuthorizationProof(snapshot: SecurityPoolCapitalSnapshot, reportId: bigint, commitment: bigint) {
	const client = withStatoblastRequestTimeout(createConnectedReadClient(), currentStateCheckFailed)
	const totalCommitment = snapshot.totalCommitmentAttoEth - snapshot.ownerCommitmentAttoEth + commitment
	const exposure = totalCommitment > snapshot.demandAttoEth ? totalCommitment : snapshot.demandAttoEth
	const [price] = await client.readContract({ address: snapshot.priceFeed, abi: proofAbi, functionName: 'reportAuthorization', args: [reportId, exposure], blockNumber: snapshot.blockNumber })
	return price
}

function capitalComparison(label: string, before: bigint, after: bigint, units: number, symbol: string) {
	const first = formatCurrencyBalance(before, units)
	const last = formatCurrencyBalance(after, units)
	return { label, value: `${first}${symbol === '%' ? '%' : ''} → ${last}${formatUnitSuffix(symbol)}` }
}

function commitmentComparison(collateral: { decimals: number; symbol: string }, label: string, before: bigint, after: bigint) {
	return capitalComparison(label, before, after, collateral.decimals, collateral.symbol)
}

export function useSecurityPoolAggregate(
	model: Pick<ReturnType<typeof useSecurityPool>, 'snapshot' | 'loading' | 'error' | 'refresh'> & Partial<Pick<ReturnType<typeof useSecurityPool>, 'presentationSnapshot' | 'displayedAt'>>,
	actions: Pick<ReturnType<typeof useSecurityPoolActions>, 'ownerReason' | 'runSecurityPoolAction'>,
	accountAddress: Address | undefined,
) {
	const depositAmount = useSignal('')
	const withdrawalAmount = useSignal('')
	const healthPercent = useSignal('100')
	const commitmentAmount = useSignal('')
	const healthDepositAmount = useSignal('')
	const remainingCommitmentAmount = useSignal('0')
	const reportInput = useSignal('')
	const draftContext = useRef<{ key: string; savedHealth: bigint }>()
	const proof = useSignal<{ context: string; key: string; price?: bigint | undefined; error?: string; pending?: boolean }>()
	const snapshot = model.snapshot ?? model.presentationSnapshot
	const showingPreviousSnapshot = model.snapshot === undefined && snapshot !== undefined
	let stateReason: string | undefined
	if (model.snapshot === undefined) {
		if (showingPreviousSnapshot) stateReason = capitalCopy.readUnavailable
		else stateReason = model.loading ? refreshingBalances : transactionCopy.positionRequired
	}
	const ownerReason = actions.ownerReason ?? stateReason
	const inactiveReason = snapshot !== undefined && (snapshot.forkTime > 0n || snapshot.frozen || snapshot.importing) ? transactionCopy.newCommitmentsClosed : undefined
	const admissionReason = snapshot?.admission.mode === 'custom' ? unsupportedAdmission : undefined
	const depositAttoRep = securityPoolAmountOrUndefined(depositAmount.value)
	const withdrawAttoRep = securityPoolAmountOrUndefined(withdrawalAmount.value)
	const healthBps = securityPoolBasisPointsOrUndefined(healthPercent.value)
	const reportId = reportInput.value.trim() === '' ? undefined : securityPoolUnsignedId(reportInput.value)
	const proofContext = `${snapshot?.chainId}:${snapshot?.securityPool}:${snapshot?.universeId}:${snapshot?.owner}:${snapshot?.blockHash}:${snapshot?.totalCommitmentAttoEth}:${snapshot?.ownerCommitmentAttoEth}:${snapshot?.demandAttoEth}:${reportId}`
	const sizingProofPrice = proof.value?.context === proofContext ? proof.value.price : undefined
	const pledgedRep = snapshot?.positions.find(position => position.commitment > 0n)?.rep ?? 0n
	const retirementTargetCapacity = snapshot === undefined ? undefined : maximumSecurityPoolCommitment({ ...snapshot, ownerPrincipalAttoRep: pledgedRep }, healthBps)
	const remainingCommitment = securityPoolAmountOrUndefined(remainingCommitmentAmount.value, snapshot?.collateral.decimals ?? 18)
	const targetRequiredRep = snapshot !== undefined && healthBps !== undefined && healthBps >= minimumSecurityPoolHealthFactorBps && healthBps < 1n << 256n && snapshot.ownerConservativePrice > 0n ? requiredSecurityPoolCollateral(snapshot, snapshot.ownerCommitmentAttoEth, undefined, healthBps) : undefined
	let targetShortfall: bigint | undefined
	if (targetRequiredRep !== undefined && snapshot !== undefined) targetShortfall = targetRequiredRep > pledgedRep ? targetRequiredRep - pledgedRep : 0n
	const healthDepositAttoRep = securityPoolAmountOrUndefined(healthDepositAmount.value)
	const sizingRep = (snapshot?.ownerPrincipalAttoRep ?? 0n) + (healthDepositAttoRep ?? 0n)
	const targetCapacity = snapshot === undefined ? undefined : maximumSecurityPoolCommitment({ ...snapshot, ownerPrincipalAttoRep: sizingRep }, healthBps, sizingProofPrice)
	const commitmentDefault = snapshot?.ownerCommitmentAttoEth
	const displayedCommitment = commitmentAmount.value.trim() === '' && commitmentDefault !== undefined ? formatUnits(commitmentDefault, snapshot?.collateral.decimals ?? 18) : commitmentAmount.value
	const commitmentAttoEth = securityPoolAmountOrUndefined(displayedCommitment, snapshot?.collateral.decimals ?? 18)
	const proofKey = `${proofContext}:${commitmentAttoEth}`
	useEffect(() => {
		let active = true
		if (model.snapshot !== undefined && reportId !== undefined && reportId > 0n && commitmentAttoEth !== undefined && commitmentAttoEth > 0n) {
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
	}, [proofKey, model.snapshot !== undefined])
	const proofPrice = proof.value?.key === proofKey && !proof.value.pending && proof.value.error === undefined ? proof.value.price : undefined
	let proofReason: string | undefined
	if (reportInput.value.trim() !== '') {
		if (reportId === undefined || reportId === 0n) proofReason = capitalCopy.reportInvalid
		else proofReason = proof.value?.key === proofKey && !proof.value.pending ? proof.value.error : capitalCopy.reportChecking
	}
	// Initialize drafts before an interactive render can accept input for the new identity.
	useLayoutEffect(() => {
		if (snapshot === undefined) return
		const key = `${snapshot.chainId}:${snapshot.securityPool}:${snapshot.owner}:${snapshot.universeId}`
		const savedHealth = snapshot.ownerAccount.targetHealthFactorBps || minimumSecurityPoolHealthFactorBps
		const previous = draftContext.current
		draftContext.current = { key, savedHealth }
		if (previous?.key === key) {
			if (previous.savedHealth !== savedHealth) healthPercent.value = formatUnits(savedHealth, 2)
			return
		}
		healthPercent.value = formatUnits(savedHealth, 2)
		depositAmount.value = ''
		withdrawalAmount.value = ''
		commitmentAmount.value = ''
		healthDepositAmount.value = ''
		remainingCommitmentAmount.value = '0'
		reportInput.value = ''
	}, [snapshot?.chainId, snapshot?.securityPool, snapshot?.owner, snapshot?.universeId, snapshot?.ownerAccount.targetHealthFactorBps])
	const positive = (value: bigint | undefined) => (value === undefined || value === 0n ? transactionCopy.positiveAmountRequired : undefined)
	const topUpReason = snapshot === undefined ? undefined : capitalDepositReason(snapshot)
	const fundingReason = ownerReason ?? inactiveReason ?? admissionReason ?? topUpReason ?? positive(depositAttoRep) ?? (snapshot !== undefined && depositAttoRep !== undefined && depositAttoRep > snapshot.walletAttoRep ? transactionCopy.insufficientRep : undefined)
	const depositReason = fundingReason ?? (snapshot !== undefined && depositAttoRep !== undefined && depositAttoRep > snapshot.allowanceAttoRep ? transactionCopy.approveBeforeDeposit : undefined)
	const withdrawReason = ownerReason ?? (snapshot === undefined ? undefined : capitalWithdrawalReason(snapshot, withdrawAttoRep))
	const healthReason = ownerReason ?? (snapshot === undefined ? undefined : capitalHealthReason(snapshot, healthBps))
	const healthFundingReason =
		ownerReason ??
		inactiveReason ??
		admissionReason ??
		topUpReason ??
		positive(healthDepositAttoRep) ??
		(snapshot !== undefined && healthDepositAttoRep !== undefined && healthDepositAttoRep > snapshot.walletAttoRep ? transactionCopy.insufficientRep : undefined) ??
		(snapshot === undefined ? undefined : capitalHealthReason(snapshot, healthBps, healthDepositAttoRep))
	const healthDepositReason = healthFundingReason ?? (snapshot !== undefined && healthDepositAttoRep !== undefined && healthDepositAttoRep > snapshot.allowanceAttoRep ? transactionCopy.approveBeforeDeposit : undefined)
	const unsavedTargetReason = snapshot !== undefined && healthBps !== (snapshot.ownerAccount.targetHealthFactorBps || minimumSecurityPoolHealthFactorBps) ? transactionCopy.saveTargetBeforeCommitment : undefined
	const authorizeReason = ownerReason ?? admissionReason ?? unsavedTargetReason ?? proofReason ?? (snapshot === undefined ? undefined : capitalAuthorizationReason(snapshot, commitmentAttoEth, proofPrice))
	const livePositions = snapshot?.positions.filter(position => position.commitment > 0n) ?? []
	const pendingRetirement = livePositions.find(position => position.batch !== 0n)
	const claimReason = ownerReason
	const retirementReadinessReason = () => {
		if (pendingRetirement === undefined) return transactionCopy.reductionRequired
		if (snapshot?.priceValid === false) return newPriceRequired
		const preview = pendingRetirement.retirementPreview
		if (preview !== undefined && preview.status !== 'ready') return capitalCopy.waitingForFreeCapacity
		return undefined
	}
	const serveReason = ownerReason ?? inactiveReason ?? retirementReadinessReason()
	const requireSnapshot = () => {
		const current = model.snapshot
		if (current === undefined || accountAddress === undefined || accountAddress.toLowerCase() !== (current.auctionVault?.bidder ?? current.owner).toLowerCase()) throw new Error(transactionCopy.connectPositionWallet)
		return current
	}
	const run = (
		action: string,
		title: string,
		reason: string | undefined,
		build: (selected: NonNullable<typeof snapshot>) => SecurityPoolTransaction,
		validate?: (latest: SecurityPoolCapitalSnapshot) => void | Promise<void>,
		compare?: (latest: SecurityPoolCapitalSnapshot, collateral: NonNullable<typeof snapshot>['collateral']) => readonly { label: string; value: string }[],
		onConfirmed?: () => Promise<void>,
	) =>
		actions.runSecurityPoolAction(
			action,
			title,
			() => {
				if (reason !== undefined) throw new Error(reason)
				const selected = requireSnapshot()
				const request = build(selected)
				let freshReviewSnapshot: SecurityPoolCapitalSnapshot | undefined
				return {
					...request,
					readReviewRows: () => {
						const latest = freshReviewSnapshot
						if (latest === undefined) return []
						if (compare !== undefined) return compare(latest, selected.collateral)
						if (action === 'depositSecurityPoolRep' && depositAttoRep !== undefined) return [capitalComparison(capitalCopy.principalRep, latest.ownerPrincipalAttoRep, latest.ownerPrincipalAttoRep + depositAttoRep, 18, 'REP')]
						if (action === 'withdrawSecurityPoolRep' && withdrawAttoRep !== undefined) return [capitalComparison(capitalCopy.principalRep, latest.ownerPrincipalAttoRep, latest.ownerPrincipalAttoRep - withdrawAttoRep, 18, 'REP')]
						if (action === 'authorizeSecurityPoolCommitment' && commitmentAttoEth !== undefined) return [commitmentComparison(selected.collateral, capitalCopy.commitment, latest.ownerCommitmentAttoEth, commitmentAttoEth)]
						if (action === 'setSecurityPoolHealth' && healthBps !== undefined) return [capitalComparison(capitalCopy.savedHealth, latest.ownerAccount.targetHealthFactorBps || minimumSecurityPoolHealthFactorBps, healthBps, 2, '%')]
						if (action === 'depositSecurityPoolHealthRep' && healthDepositAttoRep !== undefined && healthBps !== undefined) {
							return [capitalComparison(capitalCopy.principalRep, latest.ownerPrincipalAttoRep, latest.ownerPrincipalAttoRep + healthDepositAttoRep, 18, 'REP'), capitalComparison(capitalCopy.savedHealth, latest.ownerAccount.targetHealthFactorBps || minimumSecurityPoolHealthFactorBps, healthBps, 2, '%')]
						}
						return []
					},
					validateBeforeSubmit: async () => {
						const reader = withStatoblastRequestTimeout(createConnectedReadClient(), currentStateCheckFailed)
						const latest = await loadSecurityPoolCapitalSnapshot({ client: securityPoolReadClient(reader), securityPool: selected.securityPool, owner: selected.owner, universeId: selected.universeId })
						if (latest.chainId !== selected.chainId || latest.capitalLedger !== selected.capitalLedger) throw new Error(poolChanged)
						if (['depositSecurityPoolRep', 'depositSecurityPoolHealthRep', 'approveSecurityPoolRep', 'approveSecurityPoolHealthRep'].includes(action)) {
							const reason = capitalDepositReason(latest)
							if (reason !== undefined) throw new Error(reason)
						}
						await validate?.(latest)
						await request.validateBeforeSubmit?.()
						freshReviewSnapshot = latest
					},
				}
			},
			undefined,
			onConfirmed,
		)
	const base = (selected: NonNullable<typeof snapshot>) => ({ owner: selected.owner, capitalLedger: selected.capitalLedger })
	return {
		snapshot,
		showingPreviousSnapshot,
		loading: model.loading,
		readError: model.error,
		displayedAt: model.displayedAt,
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
		healthPercent: healthPercent.value,
		setHealthPercent: (value: string) => {
			healthPercent.value = value
		},
		healthReason,
		commitmentAmount: displayedCommitment,
		commitmentAttoEth,
		healthBps,
		setCommitmentAmount: (value: string) => {
			commitmentAmount.value = value
		},
		useTargetCapacity: () => {
			commitmentAmount.value = targetCapacity !== undefined ? formatUnits(targetCapacity, snapshot?.collateral.decimals ?? 18) : ''
		},
		targetCapacity,
		retirementTargetCapacity,
		targetShortfall,
		healthDepositAmount: healthDepositAmount.value,
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
			remainingCommitmentAmount.value = formatUnits(residual < snapshot.economics.minimumCommitmentAttoEth ? 0n : residual, snapshot.collateral.decimals)
		},
		reportInput: reportInput.value,
		setReportInput: (value: string) => {
			reportInput.value = value
		},
		proofPrice,
		authorizeReason,
		requiredCollateral: snapshot !== undefined && commitmentAttoEth !== undefined && snapshot.acceptedPrice > 0n ? requiredSecurityPoolCollateral(snapshot, commitmentAttoEth, proofPrice) : undefined,
		livePositions,
		claimReason,
		serveReason,
		positionReasons: (id: bigint, requestedCommitment = remainingCommitment) => {
			const position = livePositions.find(item => item.id === id)
			const common = ownerReason ?? inactiveReason ?? (position === undefined ? transactionCopy.positionInactive : undefined)
			return {
				retire: common ?? (snapshot === undefined ? undefined : capitalRetirementReason(snapshot, id, requestedCommitment)),
			}
		},
		approve: (amount: bigint) =>
			run('approveSecurityPoolRep', transactionCopy.approveDeposit, fundingReason, selected => ({
				account: selected.auctionVault?.bidder ?? selected.owner,
				to: selected.repToken,
				value: 0n,
				data: encodeFunctionData({ abi: ABIS.mainnet.erc20, functionName: 'approve', args: [selected.auctionVault?.vault ?? selected.capitalLedger, amount] }),
				reviewDescription: transactionCopy.reviewDepositApproval(selected.auctionVault?.vault ?? selected.capitalLedger, formatCurrencyBalance(amount)),
			})),
		approveHealthDeposit: (amount: bigint) =>
			run('approveSecurityPoolHealthRep', transactionCopy.approveHealthDeposit, healthFundingReason, selected => ({
				account: selected.auctionVault?.bidder ?? selected.owner,
				to: selected.repToken,
				value: 0n,
				data: encodeFunctionData({ abi: ABIS.mainnet.erc20, functionName: 'approve', args: [selected.auctionVault?.vault ?? selected.capitalLedger, amount] }),
				reviewDescription: transactionCopy.reviewDepositApproval(selected.auctionVault?.vault ?? selected.capitalLedger, formatCurrencyBalance(amount)),
			})),
		deposit: () =>
			run('depositSecurityPoolRep', capitalCopy.deposit, depositReason, selected => {
				if (depositAttoRep === undefined) throw new Error(transactionCopy.depositRequired)
				const request =
					selected.auctionVault === undefined
						? buildSecurityPoolCapitalDepositRequest({ ...base(selected), amountAttoRep: depositAttoRep })
						: buildSecurityPoolAuctionVaultDepositRequest({ bidder: selected.auctionVault.bidder, vault: selected.owner, capitalLedger: selected.capitalLedger, amountAttoRep: depositAttoRep, targetHealthFactorBps: selected.ownerAccount.targetHealthFactorBps || minimumSecurityPoolHealthFactorBps })
				return { ...request, reviewDescription: transactionCopy.reviewDeposit(formatCurrencyBalance(depositAttoRep)) }
			}),
		withdraw: () =>
			run(
				'withdrawSecurityPoolRep',
				capitalCopy.withdraw,
				withdrawReason,
				selected => {
					if (withdrawAttoRep === undefined) throw new Error(transactionCopy.withdrawalRequired)
					return {
						...buildSecurityPoolCapitalWithdrawPrincipalRequest({ ...base(selected), amountAttoRep: withdrawAttoRep }),
						reviewDescription: transactionCopy.reviewWithdrawal(formatCurrencyBalance(withdrawAttoRep), selected.owner, formatCurrencyBalance(selected.ownerAccount.targetHealthFactorBps || minimumSecurityPoolHealthFactorBps, 2)),
					}
				},
				latest => {
					const reason = capitalWithdrawalReason(latest, withdrawAttoRep)
					if (reason !== undefined) throw new Error(reason)
				},
			),
		setHealth: () =>
			run(
				'setSecurityPoolHealth',
				capitalCopy.saveHealth,
				healthReason,
				selected => {
					if (healthBps === undefined) throw new Error(transactionCopy.targetRequired)
					return {
						...buildSecurityPoolCapitalSetHealthRequest({ ...base(selected), targetHealthFactorBps: healthBps }),
						reviewDescription: transactionCopy.reviewTarget(formatCurrencyBalance(healthBps, 2)),
					}
				},
				latest => {
					const reason = capitalHealthReason(latest, healthBps)
					if (reason !== undefined) throw new Error(reason)
				},
			),
		depositAndSetHealth: () =>
			run(
				'depositSecurityPoolHealthRep',
				capitalCopy.depositHealth,
				healthDepositReason,
				selected => {
					if (healthDepositAttoRep === undefined || healthBps === undefined) throw new Error(transactionCopy.depositAndTargetRequired)
					return {
						...(selected.auctionVault === undefined
							? buildSecurityPoolCapitalDepositAndSetHealthRequest({ ...base(selected), amountAttoRep: healthDepositAttoRep, targetHealthFactorBps: healthBps })
							: buildSecurityPoolAuctionVaultDepositRequest({ bidder: selected.auctionVault.bidder, vault: selected.owner, capitalLedger: selected.capitalLedger, amountAttoRep: healthDepositAttoRep, targetHealthFactorBps: healthBps })),
						reviewDescription: capitalCopy.healthDepositReview,
					}
				},
				async latest => {
					const reason = capitalHealthReason(latest, healthBps, healthDepositAttoRep)
					if (reason !== undefined) throw new Error(reason)
					if (healthDepositAttoRep === undefined) throw new Error(transactionCopy.repDepositRequired)
					const client = withStatoblastRequestTimeout(createConnectedReadClient(), currentStateCheckFailed)
					const [balance, allowance] = await Promise.all([
						client.readContract({ address: latest.repToken, abi: ABIS.mainnet.erc20, functionName: 'balanceOf', args: [snapshot?.auctionVault?.bidder ?? latest.owner] }),
						client.readContract({ address: latest.repToken, abi: ABIS.mainnet.erc20, functionName: 'allowance', args: [snapshot?.auctionVault?.bidder ?? latest.owner, snapshot?.auctionVault?.vault ?? latest.capitalLedger] }),
					])
					if (balance < healthDepositAttoRep) throw new Error(transactionCopy.insufficientRep)
					if (allowance < healthDepositAttoRep) throw new Error(transactionCopy.approveBeforeDeposit)
				},
				undefined,
				async () => {
					healthDepositAmount.value = ''
				},
			),
		authorize: () =>
			run(
				'authorizeSecurityPoolCommitment',
				capitalCopy.authorize,
				authorizeReason,
				selected => {
					if (commitmentAttoEth === undefined) throw new Error(transactionCopy.commitmentRequired)
					return {
						...buildSecurityPoolCapitalSetCommitmentRequest({ ...base(selected), commitment: commitmentAttoEth, ...(reportId === undefined ? {} : { reportId }) }),
						reviewDescription: transactionCopy.reviewCommitment(
							`${formatCurrencyBalance(commitmentAttoEth, selected.collateral.decimals)} ${selected.collateral.symbol}`,
							formatCurrencyBalance(selected.ownerPrincipalAttoRep),
							formatCurrencyBalance(selected.ownerAccount.targetHealthFactorBps || minimumSecurityPoolHealthFactorBps, 2),
							reportId,
						),
					}
				},
				async latest => {
					if (latest.ownerAccount.targetHealthFactorBps !== snapshot?.ownerAccount.targetHealthFactorBps) throw new Error(transactionCopy.targetChanged)
					if (latest.ownerPrincipalAttoRep !== snapshot?.ownerPrincipalAttoRep) throw new Error(transactionCopy.pledgedRepChanged)
					const freshProofPrice = reportId !== undefined && commitmentAttoEth !== undefined ? await readAuthorizationProof(latest, reportId, commitmentAttoEth) : undefined
					if (freshProofPrice !== proofPrice) throw new Error(capitalCopy.reportChanged)
					const reason = capitalAuthorizationReason(latest, commitmentAttoEth, freshProofPrice)
					if (reason !== undefined) throw new Error(reason)
				},
			),
		claim: () =>
			run('claimSecurityPoolEarnings', capitalCopy.claim, claimReason, selected => ({
				...buildSecurityPoolCapitalClaimEarningsRequest(base(selected)),
				reviewDescription: transactionCopy.reviewClaim(selected.collateral.symbol),
			})),
		serve: () =>
			run(
				'serveSecurityPoolRetirement',
				capitalCopy.releaseReduction,
				serveReason,
				selected => {
					if (pendingRetirement === undefined) throw new Error(transactionCopy.reductionRequired)
					return {
						...buildSecurityPoolCapitalServeRetirementRequest({ ...base(selected), positionId: pendingRetirement.id }),
						reviewDescription: capitalCopy.releaseReductionReview,
					}
				},
				latest => {
					if (!latest.priceValid) throw new Error(newPriceRequired)
					if (latest.forkTime > 0n || latest.frozen || latest.importing) throw new Error(transactionCopy.reductionsClosed)
					if (pendingRetirement === undefined) throw new Error(transactionCopy.reductionRequired)
					const current = latest.positions.find(position => position.id === pendingRetirement.id && position.commitment > 0n && position.batch !== 0n)
					if (current === undefined || current.remainingCommitment !== pendingRetirement.remainingCommitment) throw new Error(transactionCopy.reductionChanged)
					if (pendingRetirement.retirementPreview?.status === 'ready' && current.retirementPreview?.status !== 'ready') throw new Error(transactionCopy.freeCapacityChanged)
				},
				(latest, collateral) => {
					const current = latest.positions.find(position => position.id === pendingRetirement?.id)
					return current === undefined ? [] : [commitmentComparison(collateral, capitalCopy.commitment, current.commitment, current.remainingCommitment)]
				},
			),
		retire: (id: bigint, requestedCommitment = remainingCommitment) =>
			run(
				`retireSecurityPool-${id}`,
				livePositions.some(position => position.id === id && position.batch !== 0n) ? capitalCopy.resubmitRetirement : capitalCopy.retire,
				ownerReason ?? inactiveReason,
				selected => {
					const reason = capitalRetirementReason(selected, id, requestedCommitment)
					if (reason !== undefined || requestedCommitment === undefined) throw new Error(reason ?? transactionCopy.remainingCommitmentRequired)
					const position = selected.positions.find(item => item.id === id && item.commitment > 0n)
					const covered = position === undefined ? undefined : coveredUnderwaterCommitment(selected, position)
					const queuesWithoutCure = position !== undefined && covered !== undefined && position.commitment - covered < selected.economics.minimumCommitmentAttoEth
					const queue = retirementQueueDescription(queuesWithoutCure ? undefined : covered, requestedCommitment, selected.collateral)
					return {
						...buildSecurityPoolCapitalSetCommitmentRequest({ ...base(selected), commitment: requestedCommitment }),
						reviewDescription: capitalCopy.requestReductionReview(id, requestedCommitment === 0n, queue),
					}
				},
				latest => {
					const reason = capitalRetirementReason(latest, id, requestedCommitment)
					if (reason !== undefined) throw new Error(reason)
				},
				(latest, collateral) => {
					const current = latest.positions.find(position => position.id === id)
					return current === undefined || requestedCommitment === undefined ? [] : [commitmentComparison(collateral, capitalCopy.completedReductionCommitment, current.commitment, requestedCommitment)]
				},
			),
	}
}
