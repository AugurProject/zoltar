import { useSignal } from '@preact/signals'
import { loadErc20Allowance, loadErc20Balance } from '../protocol/index.js'
import { createConnectedReadClient } from '../lib/clients.js'
import { getErrorMessage, isRecoverableContractReadError } from '../lib/errors.js'
import { useRequestGuard } from '../lib/requestGuard.js'
import type { TokenApprovalState } from '../lib/tokenApproval.js'
import type { ReadClient } from '../types/contracts.js'

function useErc20Loader<TArgs extends unknown[]>(loadFn: (client: ReadClient, ...args: TArgs) => Promise<bigint>) {
	const signal = useSignal<bigint | undefined>(undefined)
	const nextLoad = useRequestGuard()
	const invalidate = () => {
		void nextLoad()
	}
	const reload = async (...args: TArgs) => {
		const isCurrent = nextLoad()
		try {
			const value = await loadFn(createConnectedReadClient(), ...args)
			if (!isCurrent()) return
			signal.value = value
		} catch (error) {
			if (!isRecoverableContractReadError(error)) throw error
			if (!isCurrent()) return
			signal.value = undefined
		}
	}
	return { invalidate, signal, reload }
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
	const invalidate = () => {
		void nextLoad()
	}
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
			signal.value = {
				error: getErrorMessage(error, 'Failed to load token approval'),
				loading: false,
				value: undefined,
			}
		}
	}

	return { invalidate, signal, reload }
}
