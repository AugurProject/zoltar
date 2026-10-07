import { batch, type Signal } from '@preact/signals'
import { type MutableRef, useEffect, useRef } from 'preact/hooks'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { getActiveBackend } from '../../lib/activeEnvironment.js'
import { sameAddress } from '../../lib/address.js'
import { appBlockWatcher } from '../../lib/dataRefresh.js'
import { getErrorMessage, isRecoverableContractReadError } from '../../lib/errors.js'
import type { LoadController } from '../../lib/loadState.js'
import type { AccountState } from '../../types/app.js'
import { sameChainId } from '../../wallet/chainId.js'
import { createConnectedReadClient, type ReadClient } from '../../wallet/clients.js'
import { validateConfiguredReadBackend } from './readBackendValidation.js'

const READ_BACKEND_RETRY_BASE_MILLISECONDS = 5_000
const READ_BACKEND_RETRY_MAX_MILLISECONDS = 60_000

function getReadBackendRetryDelayMilliseconds(attempt: number) {
	return Math.min(READ_BACKEND_RETRY_BASE_MILLISECONDS * 2 ** attempt, READ_BACKEND_RETRY_MAX_MILLISECONDS)
}

/**
 * Probes an unreachable read RPC again with a growing delay while the tab is visible, so the application recovers without a
 * reload once it responds. A failed probe keeps the notice's reason current; a successful one runs the full refresh.
 */
export function useReadBackendRecovery({ activeEnvironmentNonce, onProbeFailed, refreshState, unreachable }: { activeEnvironmentNonce: number; onProbeFailed: (error: unknown) => void; refreshState: () => Promise<void>; unreachable: boolean }) {
	const callbacks = useRef({ onProbeFailed, refreshState })
	callbacks.current = { onProbeFailed, refreshState }
	useEffect(() => {
		if (!unreachable) return
		let cancelled = false
		let attempt = 0
		let cancelTimer: (() => void) | undefined
		const schedule = () => {
			const timer = setTimeout(() => void probe(), getReadBackendRetryDelayMilliseconds(attempt))
			cancelTimer = () => clearTimeout(timer)
			attempt += 1
		}
		const probe = async () => {
			if (cancelled) return
			if (typeof document === 'undefined' || !document.hidden) {
				try {
					await validateConfiguredReadBackend(getActiveBackend())
					if (cancelled) return
					await callbacks.current.refreshState()
				} catch (error) {
					if (!cancelled) callbacks.current.onProbeFailed(error)
				}
			}
			if (!cancelled) schedule()
		}
		schedule()
		return () => {
			cancelled = true
			cancelTimer?.()
		}
	}, [activeEnvironmentNonce, unreachable])
}

/** A fresh read clears the balance's error; a failed read keeps the last balance, and only an unexpected failure is reported. */
function balanceReadError(result: PromiseSettledResult<unknown>, currentError: string | undefined, fallbackMessage: string) {
	if (result.status === 'fulfilled') return undefined
	return isRecoverableContractReadError(result.reason) ? currentError : getErrorMessage(result.reason, fallbackMessage)
}

type WalletBalanceDependencies = {
	getWethAddress?: () => Address
	loadErc20Balance: (readClient: ReadClient, tokenAddress: Address, accountAddress: Address) => Promise<bigint>
}

/**
 * Balances follow the chain: every new block re-reads the wallet's ETH and WETH in place. A read that started before a newer
 * full refresh (`balanceReadGeneration`) never overwrites it. A failed read keeps the last balance until the next block, and an
 * unexpected failure is reported as that balance's error instead of escaping the block subscription.
 */
export function useWalletBalanceRefresh({
	accountState,
	activeEnvironmentNonce,
	balanceErrors,
	balanceReadGeneration,
	dependencies,
	walletStateLoad,
}: {
	accountState: Signal<AccountState>
	activeEnvironmentNonce: number
	balanceErrors: { eth: Signal<string | undefined>; weth: Signal<string | undefined> }
	balanceReadGeneration: MutableRef<number>
	dependencies: WalletBalanceDependencies
	walletStateLoad: LoadController
}) {
	const latestDependencies = useRef(dependencies)
	latestDependencies.current = dependencies
	useEffect(() => {
		const refreshWalletBalances = async () => {
			const backend = getActiveBackend()
			const { address, chainId } = accountState.peek()
			if (address === undefined || !sameChainId(chainId, backend.profile.chainIdHex) || walletStateLoad.isLoading.peek()) return
			const generation = balanceReadGeneration.current
			const readClient = createConnectedReadClient()
			const { getWethAddress, loadErc20Balance } = latestDependencies.current
			const [eth, weth] = await Promise.allSettled([readClient.getBalance({ address }), (async () => (getWethAddress === undefined ? undefined : await loadErc20Balance(readClient, getWethAddress(), address)))()])
			const current = accountState.peek()
			if (generation !== balanceReadGeneration.current || getActiveBackend() !== backend || !sameAddress(current.address, address)) return
			batch(() => {
				accountState.value = { ...current, ...(eth.status === 'fulfilled' ? { ethBalanceAttoEth: eth.value } : {}), ...(weth.status === 'fulfilled' && weth.value !== undefined ? { wethBalanceAttoEth: weth.value } : {}) }
				balanceErrors.eth.value = balanceReadError(eth, balanceErrors.eth.peek(), 'Failed to refresh ETH balance')
				if (getWethAddress !== undefined) balanceErrors.weth.value = balanceReadError(weth, balanceErrors.weth.peek(), 'Failed to refresh WETH balance')
			})
		}
		return appBlockWatcher.subscribe(() => void refreshWalletBalances())
	}, [activeEnvironmentNonce])
}
