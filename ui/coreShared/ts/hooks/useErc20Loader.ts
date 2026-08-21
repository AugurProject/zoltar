import { useSignal } from '@preact/signals'
import { createConnectedReadClient } from '../lib/clients.js'
import { getErrorMessage, isRecoverableContractReadError } from '../lib/errors.js'
import { useRequestGuard } from '../lib/requestGuard.js'
import type { TokenApprovalState } from '../lib/tokenApproval.js'
import type { ReadClient } from '../types/contracts.js'

function useErc20Loader<TArgs extends unknown[]>(loadFn: (client: ReadClient, ...args: TArgs) => Promise<bigint>) {
	const signal = useSignal<{ error: string | undefined; loading: boolean; value: bigint | undefined }>({ error: undefined, loading: false, value: undefined })
	const nextLoad = useRequestGuard()
	const invalidate = () => {
		void nextLoad()
	}
	const reload = async (...args: TArgs) => {
		const isCurrent = nextLoad()
		signal.value = { ...signal.value, error: undefined, loading: true }
		try {
			const value = await loadFn(createConnectedReadClient(), ...args)
			if (!isCurrent()) return
			signal.value = { error: undefined, loading: false, value }
		} catch (error) {
			if (!isCurrent()) return
			if (!isRecoverableContractReadError(error)) {
				signal.value = { ...signal.value, loading: false }
				throw error
			}
			signal.value = { error: getErrorMessage(error, 'Failed to load token balance'), loading: false, value: undefined }
		}
	}
	return { invalidate, signal, reload }
}

export function useErc20BalanceLoader(loadErc20Balance: (client: ReadClient, tokenAddress: `0x${string}`, accountAddress: `0x${string}`) => Promise<bigint>) {
	return useErc20Loader(loadErc20Balance)
}

export function useErc20AllowanceLoader(loadErc20Allowance: (client: ReadClient, tokenAddress: `0x${string}`, ownerAddress: `0x${string}`, spenderAddress: `0x${string}`) => Promise<bigint>) {
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
