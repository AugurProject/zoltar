import { UserMessage } from '../../components/UserMessage.js'
import { MAINNET_ENABLED } from '../../wallet/networkAvailability.js'
import { useEffect, useRef, useState } from 'preact/hooks'
import { useDisclosurePopover } from '../../hooks/useDisclosurePopover.js'
import { getActiveNetworkProfile } from '../../lib/activeEnvironment.js'
import { MAINNET_NETWORK_PROFILE, SEPOLIA_NETWORK_PROFILE } from '../../wallet/networkProfile.js'
import { parseRpcNetworkId, readNetworkRpcUrls, saveNetworkRpcUrl, type RpcNetworkId } from '../../wallet/rpcConfig.js'
import * as appCopy from '../../copy/app.js'
import type { ComponentChildren } from 'preact'
import { ThemeSetting } from './ThemeSetting.js'

export function AppSettingsMenu({ onEnvironmentChanged, settingsContent }: { onEnvironmentChanged: () => Promise<void>; settingsContent?: ComponentChildren }) {
	const { containerRef, open, toggle, triggerRef } = useDisclosurePopover({ closeOnFocusOutside: false })
	const [selectedNetwork, setSelectedNetwork] = useState<RpcNetworkId>(getActiveNetworkProfile().id)
	const [rpcUrls, setRpcUrls] = useState(() => readNetworkRpcUrls())
	const [error, setError] = useState<string | undefined>(undefined)
	const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
	const firstControlRef = useRef<HTMLSelectElement>(null)
	const defaults: Record<RpcNetworkId, string> = {
		mainnet: MAINNET_NETWORK_PROFILE.chain.rpcUrls.default.http[0] ?? '',
		sepolia: SEPOLIA_NETWORK_PROFILE.chain.rpcUrls.default.http[0] ?? '',
		simulation: appCopy.browserLocalSimulator,
	}

	useEffect(() => {
		if (open) firstControlRef.current?.focus()
	}, [open])

	const saveRpc = async () => {
		try {
			setSaveState('saving')
			saveNetworkRpcUrl(selectedNetwork, rpcUrls[selectedNetwork])
			setError(undefined)
			if (selectedNetwork === getActiveNetworkProfile().id && selectedNetwork !== 'simulation') await onEnvironmentChanged()
			setSaveState('saved')
		} catch (caughtError) {
			setError(caughtError instanceof Error ? caughtError.message : appCopy.rpcSaveFailed)
			setSaveState('idle')
		}
	}

	return (
		<div className='app-settings' ref={containerRef}>
			<button ref={triggerRef} className='app-settings-trigger' type='button' aria-expanded={open} aria-haspopup='dialog' onClick={toggle}>
				<svg className='app-settings-icon' viewBox='0 0 24 24' width='16' height='16' aria-hidden='true' focusable='false'>
					<path fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' d='M4 6h9M17 6h3M15 4v4M4 12h3M11 12h9M9 10v4M4 18h11M19 18h1M17 16v4' />
				</svg>
				<span className='app-settings-label'>{appCopy.settings}</span>
			</button>
			{open ? (
				<div className='app-settings-menu' role='dialog' aria-label={appCopy.applicationSettings}>
					<label>
						<span>{appCopy.rpcNetwork}</span>
						<select
							ref={firstControlRef}
							value={selectedNetwork}
							onChange={event => {
								const networkId = parseRpcNetworkId(event.currentTarget.value)
								if (networkId === undefined) return
								setSelectedNetwork(networkId)
								setError(undefined)
								setSaveState('idle')
							}}
						>
							{MAINNET_ENABLED ? <option value='mainnet'>{appCopy.ethereumMainnet}</option> : undefined}
							<option value='sepolia'>{appCopy.sepolia}</option>
							<option value='simulation'>{appCopy.browserSimulation}</option>
						</select>
					</label>
					<label>
						<span>{appCopy.fallbackRpcUrl}</span>
						<input
							id='fallback-rpc-url'
							disabled={selectedNetwork === 'simulation'}
							aria-invalid={error === undefined ? undefined : true}
							aria-describedby={[selectedNetwork === 'simulation' ? 'fallback-rpc-help' : undefined, error === undefined ? undefined : 'fallback-rpc-error'].filter(Boolean).join(' ') || undefined}
							value={rpcUrls[selectedNetwork] ?? ''}
							placeholder={defaults[selectedNetwork]}
							onInput={event => {
								setRpcUrls(current => ({ ...current, [selectedNetwork]: event.currentTarget.value }))
								setError(undefined)
								setSaveState('idle')
							}}
						/>
					</label>
					{selectedNetwork === 'simulation' ? <UserMessage placement='field' id='fallback-rpc-help' detail={appCopy.simulationRpcDetail} /> : undefined}
					{error === undefined ? undefined : <UserMessage placement='field' id='fallback-rpc-error' tone='error' announcement='assertive' detail={error} />}
					<button type='button' className='secondary-button' disabled={selectedNetwork === 'simulation' || saveState === 'saving'} aria-busy={saveState === 'saving'} onClick={() => void saveRpc()}>
						{saveState === 'saving' ? appCopy.savingRpc : appCopy.saveRpc}
					</button>
					{saveState === 'saved' ? <UserMessage placement='field' tone='success' announcement='polite' detail={appCopy.rpcSaved} /> : undefined}
					<ThemeSetting />
					{settingsContent}
				</div>
			) : undefined}
		</div>
	)
}
