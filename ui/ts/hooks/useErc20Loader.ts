import { useSignal } from '@preact/signals'
import { loadErc20Allowance, loadErc20Balance } from '../contracts.js'
import { createConnectedReadClient } from '../lib/clients.js'
import { getErrorDetail } from '../lib/errors.js'
import { useRequestGuard } from '../lib/requestGuard.js'
import type { TokenApprovalState } from '../lib/tokenApproval.js'
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
	const signal = useSignal<TokenApprovalState>({
		error: undefined,
		loading: false,
		value: undefined,
	})
	const nextLoad = useRequestGuard()
	const reload = async (...args: Parameters<typeof loadErc20Allowance> extends [ReadClient, ...infer TArgs] ? TArgs : never) => {
		const isCurrent = nextLoad()
		signal.value = {
			...signal.value,
			error: undefined,
			loading: true,
		}
		try {
			const value = await loadErc20Allowance(createConnectedReadClient(), ...args)
			if (!isCurrent()) return
			signal.value = {
				error: undefined,
				loading: false,
				value,
			}
		} catch (error) {
			if (!isCurrent()) return
			const errorDetail = getErrorDetail(error)
			signal.value = {
				error: errorDetail === undefined ? 'Failed to load token approval' : `Failed to load token approval: ${errorDetail}`,
				loading: false,
				value: undefined,
			}
		}
	}

	return { signal, reload }
}
