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
import { type quoteVaultOperations } from '../../../protocol/vaultOperations.js'
import { emptyVaultOperationsDraft, parseVaultOperationsDraft, getVaultOperationsPrice, type VaultOperationsDraft } from '../lib/draft.js'
import { previewVaultOperations } from '../lib/preview.js'
import { getVaultRedeemRepGuardMessage } from '../../security-pools/lib/securityVaultGuards.js'
import * as copy from '../../../copy/vaultOperations.js'

import { vaultOperationsDependencies, type VaultOperationsDependencies } from './dependencies.js'

import { getVaultOperationsSession, isTerminalVaultOperation } from './session.js'

const failureMessage = (failure: unknown, fallback: string) => getErrorDetail(failure) ?? fallback

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
	const quote = useSignal<Awaited<ReturnType<typeof quoteVaultOperations>> | undefined>(undefined)
	const bounty = useSignal<bigint | undefined>(undefined)
	const quoting = useSignal(false)
	const active = useRef(true)
	const quoteGeneration = useRef(0)
	const refreshReads = useRef<() => void>(() => {})
	const poolAddress = pool.securityPoolAddress
	const listedTargetAddresses = pool.vaults
		.map(target => target.vaultAddress.toLowerCase())
		.sort()
		.join(',')
	const setDraft = (update: Partial<VaultOperationsDraft>) => {
		if (busy.value) return
		draft.value = { ...draft.value, ...update }
		quote.value = undefined
		error.value = undefined
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
							onPoolChanged(details.totalUnderwritingLimitAttoEth)
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
							else parameters.onTransactionPresented({ showStatusDialog: false, hash: currentResult.hash, title: state.execution?.errorMessage || copy.failure, tone: 'error', universeId: pool.universeId })
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
	let price = manager.value?.lastPrice ?? pool.lastOraclePrice ?? 0n
	try {
		if (!resolved.value) price = getVaultOperationsPrice(draft.value.proposedPrice, price, manager.value?.isPriceValid ?? false)
	} catch (failure) {
		inputError = failureMessage(failure, copy.initialPriceNeeded)
	}
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
				!resolved.value && (manager.value?.isPriceValid ?? false),
			)
		} catch (failure) {
			inputError = failureMessage(failure, copy.failure)
		}
	}
	let withdrawMaximum: bigint | undefined
	if (owned.value !== undefined && manager.value?.isPriceValid && !resolved.value) {
		try {
			const withdrawalInput = input ?? parseVaultOperationsDraft({ ...draft.value, withdraw: '1' }, owned.value.vaultAddress)
			withdrawMaximum = previewVaultOperations(
				{ ...pool, totalUnderwritingLimitAttoEth: owned.value.totalUnderwritingLimitAttoEth, settlementCollateralAttoEth: owned.value.settlementCollateralAttoEth ?? pool.settlementCollateralAttoEth },
				owned.value,
				targets,
				{ ...withdrawalInput, withdrawAttoRep: 0n },
				price,
				manager.value.minLiquidationPriceDistanceBps,
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
					const next = await dependencies.quote(poolAddress, owner, snapshot, price)
					if (next.needsReport && price <= 0n) throw new Error(copy.initialPriceNeeded)
					const fee = next.needsReport ? await dependencies.queueCost(owner, next.managerAddress) : 0n
					if (!active.current || generation !== quoteGeneration.current || !environment.isCurrent()) return
					quote.value = next
					bounty.value = fee
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
	}, [draft.value, owner, poolAddress, revision.value, price, inputError, manager.value?.isPriceValid, resolved.value])

	const claimReason = (action: 'fees' | 'redeem') => {
		if (owned.value === undefined || resolved.value === undefined) return copy.loading
		if (action === 'fees') return owned.value.claimableFeesAttoEth > 0n ? undefined : copy.noFees
		if (pool.questionOutcome === 'none') return copy.questionNotFinal
		return getVaultRedeemRepGuardMessage({ disputeStakedAttoRep: owned.value.disputeStakedAttoRep, redeemableRepAmountAttoRep: owned.value.vaultAttoRepBacking, underwritingLimitAttoEth: owned.value.underwritingLimitAttoEth })
	}
	const submit = async (claimAction?: 'fees' | 'redeem') => {
		if (busy.value || readError.value !== undefined) return
		if (claimAction !== undefined ? claimReason(claimAction) !== undefined : input === undefined || quote.value === undefined || inputError !== undefined) return
		let submittedTitle = resolved.value ? copy.confirmedCommitment : copy.submit
		if (claimAction === 'fees') submittedTitle = copy.claimFees
		else if (claimAction === 'redeem') submittedTitle = copy.redeemRep
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
					return await dependencies.submit(wallet, poolAddress, snapshot, price, { reviewSignal: context.reviewSignal, onTransactionPrepared: parameters.onTransactionPrepared, onTransactionSubmitted: parameters.onTransactionSubmitted })
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
