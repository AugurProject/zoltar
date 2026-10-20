import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { getAddress } from '@zoltar/core-shared/evm/ethereum'
import { createActiveEnvironmentGuard } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { useBlockRefresh } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { getErrorDetail } from '@zoltar/ui-core-shared/lib/errors.js'
import { formatCurrencyInputBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { buildWriteActionConfig, runWriteAction } from '@zoltar/ui-core-shared/transactions/writeAction.js'
import { securityPoolTransactionScope } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import type { WriteOperationsParameters } from '../../../types/app.js'
import type { ListedSecurityPool, OracleManagerDetails, SecurityPoolVaultSummary, SecurityVaultDetails } from '../../../types/contracts.js'
import type { VaultOperationsApprovalKind, VaultOperationsPrerequisites, VaultOperationsQuote } from '../../../protocol/vaultOperations.js'
import { emptyVaultOperationsDraft, parseVaultOperationsDraft, getVaultOperationsReportPrice, type VaultOperationsDraft } from '../lib/draft.js'
import { previewVaultOperations } from '../lib/preview.js'
import { getVaultRedeemRepGuardMessage } from '../../security-pools/lib/securityVaultGuards.js'
import * as copy from '../../../copy/vaultOperations.js'
import * as priceRequestCopy from '../../../copy/priceRequest.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as transactionStepsCopy from '@zoltar/ui-core-shared/copy/transactionSteps.js'
import { getPoolExecutionFailureSentence } from '../../security-pools/lib/liquidation.js'

import { vaultOperationsDependencies, type VaultOperationsDependencies } from './dependencies.js'

import { getVaultOperationsSession, isTerminalVaultOperation } from './session.js'

// Pool revert reasons are terse contract strings, so they are translated like the liquidation dialog's failures.
const failureMessage = (failure: unknown, fallback: string) => getPoolExecutionFailureSentence(getErrorDetail(failure)) ?? fallback

export function useVaultOperations(pool: ListedSecurityPool, parameters: WriteOperationsParameters, contextKey: string, dependencies: VaultOperationsDependencies = vaultOperationsDependencies, onPoolChanged: (totalCommitment?: bigint) => void = () => {}) {
	const owner = parameters.accountAddress
	const session = getVaultOperationsSession(contextKey)
	const { draft, result, busy, revision, status, targets: extraTargets } = session
	const owned = useSignal<SecurityVaultDetails | undefined>(undefined)
	const resolved = useSignal<boolean | undefined>(undefined)
	const manager = useSignal<OracleManagerDetails | undefined>(undefined)
	const balance = useSignal<bigint | undefined>(undefined)
	const commitmentPending = useSignal(false)
	const loading = useSignal(true)
	const error = useSignal<string | undefined>(undefined)
	const readError = useSignal<string | undefined>(undefined)
	const quoteError = useSignal<string | undefined>(undefined)
	const lookupAddress = useSignal('')
	const lookupBusy = useSignal(false)
	const lookupError = useSignal<string | undefined>(undefined)
	const quote = useSignal<VaultOperationsQuote | undefined>(undefined)
	const prerequisites = useSignal<VaultOperationsPrerequisites | undefined>(undefined)
	const bounty = useSignal<bigint | undefined>(undefined)
	const quoting = useSignal(false)
	const fetchingPrice = useSignal(false)
	const priceFetchError = useSignal<string | undefined>(undefined)
	const active = useRef(true)
	const quoteGeneration = useRef(0)
	const refreshReads = useRef<() => void>(() => {})
	// The pool commitment is reported when it changes, not on every block, so the page does not reload the vault each block.
	const reportedCommitment = useRef<bigint | undefined>(undefined)
	const poolAddress = pool.securityPoolAddress
	const listedTargetAddresses = pool.vaults
		.map(target => target.vaultAddress.toLowerCase())
		.sort()
		.join(',')
	const setDraft = (update: Partial<VaultOperationsDraft>) => {
		if (busy.value) return
		draft.value = { ...draft.value, ...update }
		quote.value = undefined
		prerequisites.value = undefined
		error.value = undefined
		if (update.proposedPrice !== undefined) priceFetchError.value = undefined
	}
	const fetchPrice = async () => {
		if (busy.value || fetchingPrice.value || resolved.value) return
		const environment = createActiveEnvironmentGuard()
		const originalDraft = draft.value
		fetchingPrice.value = true
		priceFetchError.value = undefined
		try {
			const price = await dependencies.fetchPrice(pool.managerAddress)
			if (active.current && environment.isCurrent() && draft.value === originalDraft) setDraft({ proposedPrice: formatCurrencyInputBalance(price) })
		} catch (failure) {
			if (failure instanceof Error && failure.name === 'AbortError') return
			if (active.current && environment.isCurrent() && draft.value === originalDraft) priceFetchError.value = priceRequestCopy.uniswapPriceFailed
		} finally {
			if (active.current) fetchingPrice.value = false
		}
	}
	useEffect(
		() => () => {
			active.current = false
		},
		[],
	)
	useBlockRefresh(() => {
		revision.value += 1
	}, true)
	const refresh = () => {
		revision.value += 1
	}
	useEffect(() => {
		let current = true
		let running = false
		let requested = false
		const environment = createActiveEnvironmentGuard()
		reportedCommitment.current = undefined
		const read = async () => {
			if (running) {
				requested = true
				return
			}
			if (owner === undefined) {
				loading.value = false
				return
			}
			running = true
			do {
				requested = false
				try {
					const isCurrent = () => current && environment.isCurrent()
					const currentResult = result.value
					const addresses = new Set([...pool.vaults, ...extraTargets.value].map(target => target.vaultAddress))
					for (const selected of draft.value.liquidations) addresses.add(getAddress(selected.address))
					await Promise.all([
						(async () => {
							const nextResolved = await dependencies.loadResolved(poolAddress)
							if (isCurrent()) resolved.value = nextResolved
						})(),
						(async () => {
							const details = await dependencies.loadOwned(poolAddress, owner)
							if (details === undefined) throw new Error(copy.targetUnavailable)
							if (!isCurrent()) return
							owned.value = details
							if (reportedCommitment.current !== details.totalUnderwritingLimitAttoEth) {
								reportedCommitment.current = details.totalUnderwritingLimitAttoEth
								onPoolChanged(details.totalUnderwritingLimitAttoEth)
							}
							const walletBalance = await dependencies.loadBalance(details.repToken, owner)
							if (isCurrent()) balance.value = walletBalance
						})(),
						(async () => {
							const oracle = await dependencies.loadManager(pool.managerAddress)
							if (isCurrent()) manager.value = oracle
						})(),
						(async () => {
							const pendingCommitment = await dependencies.loadCommitmentPending(pool.managerAddress, owner)
							if (isCurrent()) commitmentPending.value = pendingCommitment
						})(),
						(async () => {
							const currentTargets = await Promise.all([...addresses].filter(address => address.toLowerCase() !== owner.toLowerCase()).map(address => dependencies.loadTarget(poolAddress, address)))
							if (isCurrent()) extraTargets.value = currentTargets
						})(),
						(async () => {
							if (currentResult?.queuedOperation === undefined || isTerminalVaultOperation(status.value)) return
							const state = await dependencies.loadStatus(pool.managerAddress, currentResult)
							if (!isCurrent() || result.value !== currentResult) return
							status.value = state
							if (!isTerminalVaultOperation(state) || session.presentedTerminal) return
							session.presentedTerminal = true
							onPoolChanged()
							if (state.status === 'executed') parameters.onTransactionPresented({ showStatusDialog: false, hash: currentResult.hash, title: copy.success, tone: 'success', universeId: pool.universeId })
							else parameters.onTransactionPresented({ showStatusDialog: false, hash: currentResult.hash, title: copy.failedTitle, detail: getPoolExecutionFailureSentence(state.execution?.errorMessage), tone: 'error', universeId: pool.universeId })
						})(),
					])
					if (isCurrent()) readError.value = undefined
				} catch (failure) {
					if (current && environment.isCurrent()) readError.value = failureMessage(failure, copy.failure)
				} finally {
					if (current) loading.value = false
				}
			} while (requested && current && environment.isCurrent())
			running = false
		}
		refreshReads.current = () => void read()
		void read()
		return () => {
			current = false
			refreshReads.current = () => {}
		}
	}, [owner, poolAddress, listedTargetAddresses])
	useEffect(() => refreshReads.current(), [revision.value])

	let input: ReturnType<typeof parseVaultOperationsDraft> | undefined
	let inputError: string | undefined
	if (owner !== undefined) {
		try {
			input = parseVaultOperationsDraft({ ...draft.value, timeoutMinutes: resolved.value || manager.value?.isPriceValid ? '5' : draft.value.timeoutMinutes }, owner)
		} catch (failure) {
			inputError = failureMessage(failure, copy.actionNeeded)
		}
	}
	const cachedPrice = manager.value?.lastPrice ?? pool.lastOraclePrice ?? 0n
	// `reportPrice` is what the bundle submits and the coverage checks use; previews fall back to the cached price as an estimate while it is unknown.
	let reportPrice = cachedPrice
	try {
		if (!resolved.value) reportPrice = getVaultOperationsReportPrice(draft.value.proposedPrice, cachedPrice, manager.value?.isPriceValid ?? false)
	} catch (failure) {
		reportPrice = 0n
		inputError = failureMessage(failure, copy.initialPriceNeeded)
	}
	const price = reportPrice > 0n ? reportPrice : cachedPrice
	const enforceCoverage = !resolved.value && reportPrice > 0n
	const pending = result.value?.queuedOperation !== undefined && !isTerminalVaultOperation(status.value)
	const targets = [...extraTargets.value, ...pool.vaults.filter(target => !extraTargets.value.some(existing => existing.vaultAddress.toLowerCase() === target.vaultAddress.toLowerCase()))].filter(
		target => target.vaultAddress.toLowerCase() !== owner?.toLowerCase() && ((target.underwritingLimitAttoEth > 0n && target.vaultAttoRepBacking > 0n) || draft.value.liquidations.some(selected => selected.address.toLowerCase() === target.vaultAddress.toLowerCase())),
	)
	if (!resolved.value && input?.changeCommitment && commitmentPending.value) inputError = copy.pendingCommitment
	if (resolved.value && input !== undefined && owned.value !== undefined) {
		if (!input.changeCommitment || input.depositAttoRep > 0n || input.liquidations.length > 0 || input.withdrawAttoRep > 0n) inputError = copy.resolvedActions
		else if (input.commitmentAttoEth > owned.value.underwritingLimitAttoEth) inputError = copy.resolvedIncrease
	}
	let preview: ReturnType<typeof previewVaultOperations> | undefined
	if (input !== undefined && owned.value !== undefined && (price > 0n || resolved.value)) {
		try {
			preview = previewVaultOperations(
				{ ...pool, totalUnderwritingLimitAttoEth: owned.value.totalUnderwritingLimitAttoEth, settlementCollateralAttoEth: owned.value.settlementCollateralAttoEth ?? pool.settlementCollateralAttoEth },
				owned.value,
				targets,
				input,
				price,
				manager.value?.minLiquidationPriceDistanceBps,
				enforceCoverage,
			)
		} catch (failure) {
			inputError = failureMessage(failure, copy.failure)
		}
	}
	let withdrawMaximum: bigint | undefined
	if (owned.value !== undefined && enforceCoverage) {
		try {
			const withdrawalInput = input ?? parseVaultOperationsDraft({ ...draft.value, withdraw: '1' }, owned.value.vaultAddress)
			withdrawMaximum = previewVaultOperations(
				{ ...pool, totalUnderwritingLimitAttoEth: owned.value.totalUnderwritingLimitAttoEth, settlementCollateralAttoEth: owned.value.settlementCollateralAttoEth ?? pool.settlementCollateralAttoEth },
				owned.value,
				targets,
				{ ...withdrawalInput, withdrawAttoRep: 0n },
				reportPrice,
				manager.value?.minLiquidationPriceDistanceBps,
			).withdrawable
		} catch (error) {
			inputError ??= failureMessage(error, copy.failure)
		}
	}
	useEffect(() => {
		const generation = ++quoteGeneration.current
		quoteError.value = undefined
		if (owner === undefined || input === undefined || inputError !== undefined) {
			quote.value = undefined
			prerequisites.value = undefined
			bounty.value = undefined
			quoting.value = false
			return
		}
		const snapshot = input
		quoting.value = true
		const environment = createActiveEnvironmentGuard()
		const timeout = setTimeout(() => {
			void (async () => {
				try {
					const next = await dependencies.quote(poolAddress, owner, snapshot, reportPrice)
					if (next.needsReport && reportPrice <= 0n) throw new Error(copy.initialPriceNeeded)
					const [fee, nextPrerequisites] = await Promise.all([next.needsReport ? dependencies.queueCost(owner, next.managerAddress) : 0n, dependencies.loadPrerequisites(poolAddress, owner, snapshot, next)])
					if (!active.current || generation !== quoteGeneration.current || !environment.isCurrent()) return
					quote.value = next
					bounty.value = fee
					prerequisites.value = nextPrerequisites
				} catch (failure) {
					if (active.current && generation === quoteGeneration.current && environment.isCurrent()) quoteError.value = failureMessage(failure, copy.failure)
				} finally {
					if (active.current && generation === quoteGeneration.current) quoting.value = false
				}
			})()
		}, 250)
		return () => {
			clearTimeout(timeout)
			quoteGeneration.current += 1
		}
	}, [draft.value, owner, poolAddress, revision.value, reportPrice, inputError, manager.value?.isPriceValid, resolved.value])

	// Review waits for each funding transaction the form offers and names the first missing one in plan order: deposit approval, wrap, then report approvals.
	const findMissingApproval = (kinds: readonly VaultOperationsApprovalKind[]) => prerequisites.value?.approvals.find(approval => kinds.includes(approval.kind) && approval.approvedAmount < approval.requiredAmount)
	let prerequisiteReason: string | undefined
	const missingReportApproval = findMissingApproval(['reportWeth', 'reportRep'])
	if (findMissingApproval(['deposit']) !== undefined) prerequisiteReason = copy.approvalRequired.deposit
	else if ((prerequisites.value?.wrapAttoEth ?? 0n) > 0n) prerequisiteReason = copy.wrapRequired
	else if (missingReportApproval !== undefined) prerequisiteReason = copy.approvalRequired[missingReportApproval.kind]
	const runPrerequisite = async (action: 'wrap' | VaultOperationsApprovalKind, amount?: bigint) => {
		const current = prerequisites.value
		if (busy.value || readError.value !== undefined || current === undefined) return
		const approval = action === 'wrap' ? undefined : current.approvals.find(candidate => candidate.kind === action)
		const wrapAttoEth = current.wrapAttoEth ?? 0n
		if (action === 'wrap' ? wrapAttoEth <= 0n : approval === undefined) return
		const approvedAmount = amount ?? approval?.recommendedAmount ?? approval?.requiredAmount
		const tokenSymbol = action === 'reportWeth' ? commonCopy.weth : commonCopy.rep
		busy.value = true
		session.busyAction.value = action
		try {
			await runWriteAction(
				{
					...buildWriteActionConfig({ ...parameters, onTransactionCanceled: parameters.onTransactionCanceled, onTransactionFailed: parameters.onTransactionFailed, onTransactionPrepared: parameters.onTransactionPrepared }, error, copy.noWallet, {
						action: action === 'wrap' ? 'wrapWeth' : 'approve',
						showStatusDialog: false,
						source: copy.title,
						submittedTitle: action === 'wrap' ? transactionStepsCopy.formatPendingAction(transactionStepsCopy.wrapEthIntoWeth) : commonCopy.formatApprovingToken(tokenSymbol),
						universeId: pool.universeId,
						scope: securityPoolTransactionScope(poolAddress),
					}),
					formatErrorMessage: failureMessage,
				},
				async (wallet, context) => {
					const callbacks = { reviewSignal: context.reviewSignal, onTransactionPrepared: parameters.onTransactionPrepared, onTransactionSubmitted: parameters.onTransactionSubmitted }
					if (approval === undefined || approvedAmount === undefined) return await dependencies.wrap(wallet, wrapAttoEth, callbacks)
					return await dependencies.approve(wallet, approval.tokenAddress, approval.spender, approvedAmount, callbacks)
				},
				copy.prerequisiteFailure,
				next => {
					// The confirmed write stays reflected until the refreshed reads arrive, so the same transaction is not offered twice.
					const latest = prerequisites.value
					if (latest !== undefined) {
						prerequisites.value = approval === undefined || approvedAmount === undefined ? { ...latest, wrapAttoEth: 0n } : { ...latest, approvals: latest.approvals.map(candidate => (candidate.kind === approval.kind ? { ...candidate, approvedAmount } : candidate)) }
					}
					refresh()
					parameters.onTransactionPresented({ showStatusDialog: false, hash: next.hash, title: action === 'wrap' ? transactionStepsCopy.ethWrapped : transactionStepsCopy.formatTokenApproved(tokenSymbol), tone: 'success', universeId: pool.universeId })
				},
			)
		} finally {
			busy.value = false
			session.busyAction.value = undefined
		}
	}
	const claimReason = (action: 'fees' | 'redeem') => {
		if (owned.value === undefined || resolved.value === undefined) return copy.loading
		if (action === 'fees') return owned.value.claimableFeesAttoEth > 0n ? undefined : securityPoolCopy.noClaimableFeesReason
		if (pool.questionOutcome === 'none') return copy.questionNotFinal
		return getVaultRedeemRepGuardMessage({ disputeStakedAttoRep: owned.value.disputeStakedAttoRep, redeemableRepAmountAttoRep: owned.value.vaultAttoRepBacking, underwritingLimitAttoEth: owned.value.underwritingLimitAttoEth })
	}
	const submit = async (claimAction?: 'fees' | 'redeem') => {
		if (busy.value || readError.value !== undefined) return
		if (claimAction !== undefined ? claimReason(claimAction) !== undefined : input === undefined || quote.value === undefined || inputError !== undefined || prerequisiteReason !== undefined) return
		let submittedTitle = resolved.value ? copy.reducingCommitment : copy.submitting
		if (claimAction === 'fees') submittedTitle = copy.claimingFees
		else if (claimAction === 'redeem') submittedTitle = copy.redeemingRep
		const snapshot = input
		busy.value = true
		session.busyAction.value = claimAction ?? 'bundle'
		if (claimAction !== undefined) session.claimError.value = undefined
		try {
			await runWriteAction(
				{
					...buildWriteActionConfig({ ...parameters, onTransactionCanceled: parameters.onTransactionCanceled, onTransactionFailed: parameters.onTransactionFailed, onTransactionPrepared: parameters.onTransactionPrepared }, claimAction === undefined ? error : session.claimError, copy.noWallet, {
						action: 'vaultOperations',
						showStatusDialog: false,
						source: copy.title,
						submittedTitle,
						universeId: pool.universeId,
						scope: securityPoolTransactionScope(poolAddress),
					}),
					formatErrorMessage: failureMessage,
				},
				async (wallet, context) => {
					if (claimAction !== undefined) {
						const latest = await dependencies.loadOwned(poolAddress, wallet)
						context.assertActive()
						if (latest === undefined) throw new Error(copy.loading)
						owned.value = latest
						const reason = claimReason(claimAction)
						if (reason !== undefined) throw new Error(reason)
						return await dependencies.claim(wallet, poolAddress, claimAction, { reviewSignal: context.reviewSignal, onTransactionPrepared: parameters.onTransactionPrepared, onTransactionSubmitted: parameters.onTransactionSubmitted })
					}
					if (snapshot === undefined) throw new Error(copy.actionNeeded)
					return await dependencies.submit(wallet, poolAddress, snapshot, reportPrice, { reviewSignal: context.reviewSignal, onTransactionPrepared: parameters.onTransactionPrepared, onTransactionSubmitted: parameters.onTransactionSubmitted })
				},
				copy.failure,
				next => {
					if (claimAction === undefined) {
						result.value = next
						status.value = undefined
						session.presentedTerminal = false
					} else session.claimResult.value = next
					if (claimAction === undefined) draft.value = emptyVaultOperationsDraft()
					refresh()
					if (active.current) onPoolChanged()
					let title = copy.confirmedDeposit
					if (next.action === 'commitment') title = copy.confirmedCommitment
					else if (next.action === 'fees') title = copy.feesConfirmed
					else if (next.action === 'redeem') title = copy.repConfirmed
					else if (next.stagedExecution?.success === true) title = copy.success
					else if (next.queuedOperation !== undefined) title = copy.awaiting
					parameters.onTransactionPresented({ showStatusDialog: false, hash: next.hash, title, tone: next.queuedOperation === undefined ? 'success' : 'warning', universeId: pool.universeId })
				},
			)
		} finally {
			busy.value = false
			session.busyAction.value = undefined
		}
	}
	const toggle = (target: SecurityPoolVaultSummary) => {
		const existing = draft.value.liquidations.some(selected => selected.address.toLowerCase() === target.vaultAddress.toLowerCase())
		setDraft({ liquidations: existing ? draft.value.liquidations.filter(selected => selected.address.toLowerCase() !== target.vaultAddress.toLowerCase()) : [...draft.value.liquidations, { address: target.vaultAddress, amount: formatCurrencyInputBalance(target.underwritingLimitAttoEth) }] })
	}
	const lookup = async () => {
		if (lookupBusy.value || busy.value) return
		lookupBusy.value = true
		lookupError.value = undefined
		const environment = createActiveEnvironmentGuard()
		try {
			const address = getAddress(lookupAddress.value.trim())
			if (address.toLowerCase() === owner?.toLowerCase()) throw new Error(copy.anotherTarget)
			const target = await dependencies.loadTarget(poolAddress, address)
			if (!active.current || !environment.isCurrent()) return
			if (target.underwritingLimitAttoEth === 0n || target.vaultAttoRepBacking === 0n) throw new Error(copy.targetUnavailable)
			extraTargets.value = [...extraTargets.value.filter(existing => existing.vaultAddress !== target.vaultAddress), target]
			lookupAddress.value = ''
		} catch (failure) {
			if (active.current && environment.isCurrent()) lookupError.value = failureMessage(failure, copy.targetUnavailable)
		} finally {
			if (active.current) lookupBusy.value = false
		}
	}
	return {
		fetchPrice,
		fetchingPrice: fetchingPrice.value,
		priceFetchError: priceFetchError.value,
		draft: draft.value,
		setDraft,
		clearDraft: () => setDraft(emptyVaultOperationsDraft()),
		owned: owned.value,
		manager: manager.value,
		balance: balance.value,
		loading: loading.value,
		busy: busy.value,
		busyAction: session.busyAction.value,
		resolved: resolved.value,
		claimFees: () => submit('fees'),
		redeemRep: () => submit('redeem'),
		feeClaimReason: claimReason('fees'),
		repClaimReason: claimReason('redeem'),
		error: error.value,
		readError: readError.value,
		quoteError: quoteError.value,
		quoting: quoting.value,
		quote: quote.value,
		prerequisites: prerequisites.value,
		prerequisiteReason,
		approve: (kind: VaultOperationsApprovalKind, amount?: bigint) => runPrerequisite(kind, amount),
		wrapEth: () => runPrerequisite('wrap'),
		bounty: bounty.value,
		result: result.value,
		claimResult: session.claimResult.value,
		claimError: session.claimError.value,
		dismissClaimResult: () => {
			session.claimResult.value = undefined
		},
		status: status.value,
		pending,
		commitmentPending: commitmentPending.value,
		dismissResult: () => {
			if (pending) return
			result.value = undefined
			status.value = undefined
		},
		targets,
		toggle,
		input,
		inputError,
		preview,
		withdrawMaximum,
		price,
		reportPrice,
		lastPrice: cachedPrice,
		submit: () => submit(),
		refresh,
		lookupAddress: lookupAddress.value,
		setLookupAddress: (value: string) => {
			lookupAddress.value = value
		},
		lookupBusy: lookupBusy.value,
		lookupError: lookupError.value,
		lookup,
	}
}
