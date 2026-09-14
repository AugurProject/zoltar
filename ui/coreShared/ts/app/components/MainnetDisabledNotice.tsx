import { useEffect, useState } from 'preact/hooks'
import { WarningSurface } from '../../components/WarningSurface.js'
import * as appCopy from '../../copy/app.js'
import { getActiveBackend } from '../../lib/activeEnvironment.js'
import { isMainnetDisabled } from '../../wallet/networkAvailability.js'

export function MainnetDisabledNotice() {
	const backend = getActiveBackend()
	const [visible, setVisible] = useState(false)
	useEffect(() => {
		let generation = 0
		let disposed = false
		setVisible(false)
		if (backend.id === 'simulation') return
		const refresh = async () => {
			const request = ++generation
			try {
				const [accounts, chainId] = await Promise.all([backend.getAccounts(), backend.getChainId()])
				if (!disposed && request === generation) setVisible(accounts.length > 0 && isMainnetDisabled(chainId))
			} catch (error) {
				void error
				if (!disposed && request === generation) setVisible(false)
			}
		}
		const unsubscribeAccounts = backend.subscribeAccountsChanged(() => void refresh())
		const unsubscribeChain = backend.subscribeChainChanged(() => void refresh())
		void refresh()
		return () => {
			disposed = true
			unsubscribeAccounts()
			unsubscribeChain()
		}
	}, [backend])
	if (!visible || backend.id === 'simulation') return undefined
	return (
		<WarningSurface role='alert' surface='flat' variant='prominent' className='mainnet-disabled-notice'>
			<strong className='notice-title'>{appCopy.mainnetDisabled}</strong>
			<p>{appCopy.mainnetDisabledDetail}</p>
		</WarningSurface>
	)
}
