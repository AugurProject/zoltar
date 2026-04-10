import { useSignal } from '@preact/signals'
import { loadErc20Allowance, loadErc20Balance } from '../contracts.js'
import { createConnectedReadClient } from '../lib/clients.js'
import { useRequestGuard } from '../lib/requestGuard.js'
import type { ReadClient } from '../types/contracts.js'

function useErc20Loader<TArgs extends unknown[]>(loadFn: (client: ReadClient, ...args: TArgs) => Promise<bigint>) {
	const signal = useSignal<bigint | undefined>(undefined)
	const nextLoad = useRequestGuard()
	const reload = async (...args: TArgs) => {
		const isCurrent = nextLoad()
		try {
			const value = await loadFn(createConnectedReadClient(), ...args)
			if (!isCurrent()) return
			signal.value = value
		} catch {
			if (!isCurrent()) return
			signal.value = undefined
		}
	}
	return { signal, reload }
}

export function useErc20BalanceLoader() {
	return useErc20Loader(loadErc20Balance)
}

export function useErc20AllowanceLoader() {
	return useErc20Loader(loadErc20Allowance)
}
