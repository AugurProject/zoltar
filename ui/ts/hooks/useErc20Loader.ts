import { useSignal } from '@preact/signals'
import { loadErc20Allowance, loadErc20Balance } from '../contracts.js'
import { createReadClientForNetwork } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { useRequestGuard } from '../lib/requestGuard.js'
import type { TokenApprovalState } from '../lib/tokenApproval.js'
import type { SupportedNetworkKey } from '../shared/networkConfig.js'
import type { ReadClient } from '../types/contracts.js'

function useErc20Loader<TArgs extends unknown[]>(activeNetworkKey: SupportedNetworkKey, loadFn: (client: ReadClient, ...args: TArgs) => Promise<bigint>) {
	const signal = useSignal<bigint | undefined>(undefined)
	const nextLoad = useRequestGuard()
	const reload = async (...args: TArgs) => {
		const isCurrent = nextLoad()
		try {
			const value = await loadFn(createReadClientForNetwork(activeNetworkKey), ...args)
			if (!isCurrent()) return
			signal.value = value
		} catch {
			if (!isCurrent()) return
			signal.value = undefined
		}
	}
	return { signal, reload }
}

export function useErc20BalanceLoader(activeNetworkKey: SupportedNetworkKey) {
	return useErc20Loader(activeNetworkKey, loadErc20Balance)
}

export function useErc20AllowanceLoader(activeNetworkKey: SupportedNetworkKey) {
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
			const value = await loadErc20Allowance(createReadClientForNetwork(activeNetworkKey), ...args)
			if (!isCurrent()) return
			signal.value = {
				error: undefined,
				loading: false,
				value,
			}
		} catch (error) {
			if (!isCurrent()) return
			signal.value = {
				error: getErrorMessage(error, 'Failed to load token approval'),
				loading: false,
				value: undefined,
			}
		}
	}

	return { signal, reload }
}
