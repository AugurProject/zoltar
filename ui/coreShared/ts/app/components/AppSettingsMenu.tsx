import { useEffect, useRef, useState } from 'preact/hooks'
import { getActiveNetworkProfile } from '../../lib/activeEnvironment.js'
import { MAINNET_NETWORK_PROFILE, SEPOLIA_NETWORK_PROFILE } from '../../lib/networkProfile.js'
import { readNetworkRpcUrls, saveNetworkRpcUrl, type RpcNetworkId } from '../../lib/rpcConfig.js'
import * as appCopy from '../../copy/app.js'
import type { ComponentChildren } from 'preact'

export function AppSettingsMenu({ onEnvironmentChanged, settingsContent }: { onEnvironmentChanged: () => Promise<void>; settingsContent?: ComponentChildren }) {
	const [open, setOpen] = useState(false)
	const [selectedNetwork, setSelectedNetwork] = useState<RpcNetworkId>(getActiveNetworkProfile().id)
	const [rpcUrls, setRpcUrls] = useState(() => readNetworkRpcUrls())
	const [error, setError] = useState<string | undefined>(undefined)
	const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
	const menuRef = useRef<HTMLDivElement>(null)
	const triggerRef = useRef<HTMLButtonElement>(null)
	const firstControlRef = useRef<HTMLSelectElement>(null)
	const defaults: Record<RpcNetworkId, string> = {
		mainnet: MAINNET_NETWORK_PROFILE.chain.rpcUrls.default.http[0] ?? '',
		sepolia: SEPOLIA_NETWORK_PROFILE.chain.rpcUrls.default.http[0] ?? '',
		simulation: appCopy.browserLocalSimulator,
	}

	useEffect(() => {
		if (!open) return
		firstControlRef.current?.focus()
		const closeOnOutsideClick = (event: MouseEvent) => {
			if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setOpen(false)
		}
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return
			setOpen(false)
			triggerRef.current?.focus()
		}
		document.addEventListener('mousedown', closeOnOutsideClick)
		document.addEventListener('keydown', closeOnEscape)
		return () => {
			document.removeEventListener('mousedown', closeOnOutsideClick)
			document.removeEventListener('keydown', closeOnEscape)
		}
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
		<div className='app-settings' ref={menuRef}>
			<button ref={triggerRef} className='app-settings-trigger' type='button' aria-expanded={open} aria-haspopup='dialog' onClick={() => setOpen(value => !value)}>
				{appCopy.settings}
			</button>
			{open ? (
				<div className='app-settings-menu' role='dialog' aria-label={appCopy.applicationSettings}>
					<label>
						<span>{appCopy.rpcNetwork}</span>
						<select
							ref={firstControlRef}
							value={selectedNetwork}
							onChange={event => {
								setSelectedNetwork(event.currentTarget.value as RpcNetworkId)
								setError(undefined)
								setSaveState('idle')
							}}
						>
							<option value='mainnet'>{appCopy.ethereumMainnet}</option>
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
							aria-describedby={error === undefined ? 'fallback-rpc-help' : 'fallback-rpc-help fallback-rpc-error'}
							value={rpcUrls[selectedNetwork] ?? ''}
							placeholder={defaults[selectedNetwork]}
							onInput={event => {
								setRpcUrls(current => ({ ...current, [selectedNetwork]: event.currentTarget.value }))
								setError(undefined)
								setSaveState('idle')
							}}
						/>
					</label>
					<p id='fallback-rpc-help' className='field-help'>
						{selectedNetwork === 'simulation' ? appCopy.simulationRpcDetail : appCopy.formatFallbackRpcDetail(defaults[selectedNetwork])}
					</p>
					{error === undefined ? undefined : (
						<p id='fallback-rpc-error' className='field-error' role='alert'>
							{error}
						</p>
					)}
					<button type='button' className='secondary-button' disabled={selectedNetwork === 'simulation' || saveState === 'saving'} aria-busy={saveState === 'saving'} onClick={() => void saveRpc()}>
						{saveState === 'saving' ? appCopy.savingRpc : appCopy.saveRpc}
					</button>
					{saveState === 'saved' ? (
						<p className='field-help' role='status'>
							{appCopy.rpcSaved}
						</p>
					) : undefined}
					{settingsContent}
				</div>
			) : undefined}
		</div>
	)
}
