import { useRef } from 'preact/hooks'
import type { Address } from '@zoltar/core-shared/evm/ethereum'

/** Returns the settled-report callback that refreshes the pool oracle manager open when settlement completes. */
export function useSettledPoolOracleManagerRefresh(managerAddress: Address | undefined, loadPoolOracleManager: (managerAddress: Address) => Promise<unknown>) {
	// Settlement completes after a wallet round trip; the pool oracle manager open by then is read through a ref, not the render that started it.
	const managerAddressRef = useRef(managerAddress)
	managerAddressRef.current = managerAddress
	return async () => {
		const currentManagerAddress = managerAddressRef.current
		if (currentManagerAddress !== undefined) await loadPoolOracleManager(currentManagerAddress)
	}
}
