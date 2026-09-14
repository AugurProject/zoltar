import { useEffect, useState } from 'preact/hooks'
import { NoticeStack } from '../../components/NoticeStack.js'
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
		<div className='mainnet-disabled-notice'>
			<NoticeStack items={[{ id: 'mainnet-disabled', tone: 'warning', title: appCopy.mainnetDisabled, detail: appCopy.mainnetDisabledDetail }]} />
		</div>
	)
}
