import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { getAddress } from '@zoltar/core-shared/evm/ethereum'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { createConnectedReadClient, createWalletWriteClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { createActiveEnvironmentGuard } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { useBlockRefresh } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { formatCurrencyInputBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { buildWriteActionConfig, runWriteAction } from '@zoltar/ui-core-shared/transactions/writeAction.js'
import { securityPoolTransactionScope } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import type { WriteOperationsParameters } from '../../../types/app.js'
import type { ListedSecurityPool, OracleManagerDetails, QueuedVaultOperationState, SecurityPoolVaultSummary, SecurityVaultDetails } from '../../../types/contracts.js'
import { loadSecurityVaultDetails, loadSecurityPoolVaultSummary } from '../../../protocol/securityPools.js'
import { loadOracleManagerDetails, loadQueuedVaultOperationState, loadOracleManagerQueueOperationEthValue } from '../../../protocol/oracleCoordinator.js'
import { quoteVaultOperations, submitVaultOperations, type VaultOperationsResult } from '../../../protocol/vaultOperations.js'
import { emptyVaultOperationsDraft, parseVaultOperationsDraft, getVaultOperationsPrice, type VaultOperationsDraft } from '../lib/draft.js'
import { previewVaultOperations } from '../lib/preview.js'
import * as copy from '../../../copy/vaultOperations.js'

const drafts = new Map<string, VaultOperationsDraft>()
const results = new Map<string, VaultOperationsResult>()

export function useVaultOperations(pool: ListedSecurityPool, parameters: WriteOperationsParameters, contextKey: string) {
	const owner = parameters.accountAddress
	const draft = useSignal(drafts.get(contextKey) ?? emptyVaultOperationsDraft())
	const result = useSignal(results.get(contextKey))
	const owned = useSignal<SecurityVaultDetails | undefined>(undefined)
	const manager = useSignal<OracleManagerDetails | undefined>(undefined)
	const balance = useSignal<bigint | undefined>(undefined)
	const extraTargets = useSignal<SecurityPoolVaultSummary[]>([])
	const loading = useSignal(true)
	const busy = useSignal(false)
	const error = useSignal<string | undefined>(undefined)
	const readError = useSignal<string | undefined>(undefined)
	const quoteError = useSignal<string | undefined>(undefined)
	const lookupAddress = useSignal('')
	const lookupBusy = useSignal(false)
	const lookupError = useSignal<string | undefined>(undefined)
	const revision = useSignal(0)
	const quote = useSignal<Awaited<ReturnType<typeof quoteVaultOperations>> | undefined>(undefined)
	const bounty = useSignal<bigint | undefined>(undefined)
	const quoting = useSignal(false)
	const status = useSignal<QueuedVaultOperationState | undefined>(undefined)
	const active = useRef(true)
	const quoteGeneration = useRef(0)
	const poolAddress = pool.securityPoolAddress
	const setDraft = (update: Partial<VaultOperationsDraft>) => {
		if (busy.value) return
		draft.value = { ...draft.value, ...update }
		drafts.set(contextKey, draft.value)
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
		const environment = createActiveEnvironmentGuard()
		const read = async () => {
			if (owner === undefined) {
				loading.value = false
				return
			}
			try {
				const client = createConnectedReadClient()
				const [details, oracle] = await Promise.all([loadSecurityVaultDetails(client, poolAddress, owner), loadOracleManagerDetails(client, pool.managerAddress)])
				if (details === undefined) throw new Error(copy.targetUnavailable)
				const walletBalance = await client.readContract({ address: details.repToken, abi: ABIS.mainnet.erc20, functionName: 'balanceOf', args: [owner] })
				const currentResult = result.value
				const state = currentResult?.queuedOperation === undefined ? undefined : await loadQueuedVaultOperationState(client, pool.managerAddress, currentResult)
				if (!current || !environment.isCurrent()) return
				owned.value = details
				manager.value = oracle
				balance.value = walletBalance
				if (state !== undefined && state.status !== status.value?.status && currentResult !== undefined) {
					if (state.status === 'executed') parameters.onTransactionPresented({ hash: currentResult.hash, title: copy.success, tone: 'success', universeId: pool.universeId })
					else if (state.status === 'failed' || state.status === 'expired' || state.status === 'superseded') parameters.onTransactionPresented({ hash: currentResult.hash, title: state.execution?.errorMessage || copy.failure, tone: 'error', universeId: pool.universeId })
				}
				status.value = state
				readError.value = undefined
			} catch (failure) {
				if (current && environment.isCurrent()) readError.value = getErrorMessage(failure, copy.failure)
			} finally {
				if (current) loading.value = false
			}
		}
		void read()
		return () => {
			current = false
		}
	}, [owner, poolAddress, revision.value])

	let input: ReturnType<typeof parseVaultOperationsDraft> | undefined
	let inputError: string | undefined
	if (owner !== undefined) {
		try {
			input = parseVaultOperationsDraft(draft.value, owner)
		} catch (failure) {
			inputError = getErrorMessage(failure, copy.actionNeeded)
		}
	}
	let price = manager.value?.lastPrice ?? pool.lastOraclePrice ?? 0n
	try {
		price = getVaultOperationsPrice(draft.value.proposedPrice, price, manager.value?.isPriceValid ?? false)
	} catch (failure) {
		inputError = getErrorMessage(failure, copy.initialPriceNeeded)
	}
	const pending =
		manager.value?.stagedOperations?.some(operation => operation.operation === 'vaultOperations' && operation.operator.toLowerCase() === owner?.toLowerCase()) === true ||
		(result.value?.queuedOperation !== undefined && (status.value === undefined || status.value.status === 'queued' || status.value.status === 'manual-queued' || status.value.status === 'missing'))
	const targets = [...pool.vaults, ...extraTargets.value.filter(target => !pool.vaults.some(existing => existing.vaultAddress.toLowerCase() === target.vaultAddress.toLowerCase()))].filter(target => target.underwritingLimitAttoEth > 0n && target.vaultAddress.toLowerCase() !== owner?.toLowerCase())
	let preview: ReturnType<typeof previewVaultOperations> | undefined
	if (input !== undefined && owned.value !== undefined && price > 0n) {
		try {
			preview = previewVaultOperations(pool, owned.value, targets, input, price)
		} catch (failure) {
			inputError = getErrorMessage(failure, copy.failure)
		}
	}
	useEffect(() => {
		const generation = ++quoteGeneration.current
		quote.value = undefined
		quoteError.value = undefined
		bounty.value = undefined
		if (owner === undefined || input === undefined || inputError !== undefined || pending) {
			quoting.value = false
			return
		}
		const snapshot = input
		quoting.value = true
		const environment = createActiveEnvironmentGuard()
		const timeout = setTimeout(() => {
			void (async () => {
				try {
					const client = createConnectedReadClient()
					const next = await quoteVaultOperations(client, poolAddress, owner, snapshot, price)
					if (next.needsReport && price <= 0n) throw new Error(copy.initialPriceNeeded)
					const fee = next.needsReport ? await loadOracleManagerQueueOperationEthValue(createWalletWriteClient(owner), next.managerAddress) : 0n
					if (!active.current || generation !== quoteGeneration.current || !environment.isCurrent()) return
					quote.value = next
					bounty.value = fee
				} catch (failure) {
					if (active.current && generation === quoteGeneration.current && environment.isCurrent()) quoteError.value = getErrorMessage(failure, copy.failure)
				} finally {
					if (active.current && generation === quoteGeneration.current) quoting.value = false
				}
			})()
		}, 250)
		return () => {
			clearTimeout(timeout)
			quoteGeneration.current += 1
		}
	}, [draft.value, owner, poolAddress, revision.value, price, pending, inputError, manager.value?.isPriceValid])

	const submit = async () => {
		if (busy.value || pending || input === undefined || quote.value === undefined || inputError !== undefined || readError.value !== undefined) return
		const snapshot = input
		busy.value = true
		try {
			await runWriteAction(
				buildWriteActionConfig({ ...parameters, onTransactionCanceled: parameters.onTransactionCanceled, onTransactionFailed: parameters.onTransactionFailed, onTransactionPrepared: parameters.onTransactionPrepared }, error, copy.noWallet, {
					action: 'vaultOperations',
					source: copy.title,
					submittedTitle: copy.submit,
					universeId: pool.universeId,
					scope: securityPoolTransactionScope(poolAddress),
				}),
				async (wallet, context) => {
					const client = createWalletWriteClient(wallet, { reviewSignal: context.reviewSignal, onTransactionPrepared: parameters.onTransactionPrepared, onTransactionSubmitted: parameters.onTransactionSubmitted })
					return await submitVaultOperations(client, poolAddress, snapshot, price)
				},
				copy.failure,
				next => {
					if (!active.current) return
					let title = copy.confirmedDeposit
					if (next.stagedExecution?.success === true) title = copy.success
					else if (next.queuedOperation !== undefined) title = copy.awaiting
					parameters.onTransactionPresented({ hash: next.hash, title, tone: next.queuedOperation === undefined ? 'success' : 'warning', universeId: pool.universeId })
					result.value = next
					results.set(contextKey, next)
					draft.value = emptyVaultOperationsDraft()
					drafts.set(contextKey, draft.value)
					refresh()
				},
			)
		} finally {
			if (active.current) busy.value = false
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
			if (address.toLowerCase() === owner?.toLowerCase()) throw new Error('Choose another vault to liquidate.')
			const target = await loadSecurityPoolVaultSummary(createConnectedReadClient(), poolAddress, address)
			if (!active.current || !environment.isCurrent()) return
			if (target.underwritingLimitAttoEth === 0n) throw new Error(copy.targetUnavailable)
			extraTargets.value = [...extraTargets.value.filter(existing => existing.vaultAddress !== target.vaultAddress), target]
			lookupAddress.value = ''
		} catch (failure) {
			if (active.current && environment.isCurrent()) lookupError.value = getErrorMessage(failure, copy.targetUnavailable)
		} finally {
			if (active.current) lookupBusy.value = false
		}
	}
	return {
		draft: draft.value,
		setDraft,
		owned: owned.value,
		manager: manager.value,
		balance: balance.value,
		loading: loading.value,
		busy: busy.value,
		error: error.value,
		readError: readError.value,
		quoteError: quoteError.value,
		quoting: quoting.value,
		quote: quote.value,
		bounty: bounty.value,
		result: result.value,
		status: status.value,
		pending,
		targets,
		toggle,
		input,
		inputError,
		preview,
		price,
		submit,
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
