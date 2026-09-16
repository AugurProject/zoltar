import * as appCopy from '../copy/app.js'
import * as commonCopy from '../copy/common.js'
import * as simulationCopy from '../copy/simulation.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { AddressValue } from './AddressValue.js'
import type { SimulationWalletMode } from '../simulation/simulationWallet.js'
import type { BadgeTone } from '../types/components.js'
import { Badge } from './Badge.js'

// Only the disconnected mode explains a consequence the header cannot show; the other modes are evident from the wallet chip and badge.
const SIMULATION_WALLET_MODE_OPTIONS: ReadonlyArray<{ detail?: string; label: string; mode: SimulationWalletMode }> = [
	{ label: appCopy.qaWalletConnected, mode: 'connected' },
	{ detail: appCopy.qaWalletDisconnectedDetail, label: appCopy.qaWalletDisconnected, mode: 'disconnected' },
	{ label: appCopy.qaWalletWrongNetwork, mode: 'wrong-chain' },
]

function parseSimulationWalletModeOption(value: string) {
	return SIMULATION_WALLET_MODE_OPTIONS.find(option => option.mode === value)?.mode
}

function getSimulationWalletModeOption(mode: SimulationWalletMode) {
	const option = SIMULATION_WALLET_MODE_OPTIONS.find(candidate => candidate.mode === mode)
	if (option === undefined) throw new Error(`Unknown simulation wallet mode: ${mode}`)
	return option
}

type SimulationWalletControlsProps = {
	disabled: boolean
	mode: SimulationWalletMode
	onModeChange: (mode: SimulationWalletMode) => void
}

/** QA selector for the simulated wallet: connected, disconnected, or on the wrong network. */
export function SimulationWalletControls({ disabled, mode, onModeChange }: SimulationWalletControlsProps) {
	const option = getSimulationWalletModeOption(mode)
	const tone: BadgeTone = mode === 'connected' ? 'ok' : 'blocked'
	return (
		<div className='contract-row simulation-banner-row'>
			<div className='contract-copy'>
				<div className='contract-topline'>
					<Badge tone={tone}>{option.label}</Badge>
					<h3>{appCopy.qaWallet}</h3>
				</div>
				{option.detail === undefined ? undefined : <p className='detail'>{option.detail}</p>}
			</div>
			<select
				className='simulation-control-select'
				aria-label={appCopy.simulationQaWallet}
				value={mode}
				disabled={disabled}
				onChange={event => {
					const nextMode = parseSimulationWalletModeOption(event.currentTarget.value)
					if (nextMode === undefined || nextMode === mode) return
					onModeChange(nextMode)
				}}
			>
				{SIMULATION_WALLET_MODE_OPTIONS.map(candidate => (
					<option key={candidate.mode} value={candidate.mode}>
						{candidate.label}
					</option>
				))}
			</select>
		</div>
	)
}

export function getSimulationAccountOptionLabel(accountIndex: number) {
	return simulationCopy.formatQaAccountNumber((accountIndex + 1).toString())
}

type SimulationAccountControlsProps = {
	accounts: readonly Address[]
	disabled: boolean
	onAccountChange: (account: Address) => void
	selectedAccount: Address
}

/** QA selector for the simulated account that signs transactions. */
export function SimulationAccountControls({ accounts, disabled, onAccountChange, selectedAccount }: SimulationAccountControlsProps) {
	return (
		<div className='contract-row simulation-banner-row'>
			<div className='contract-copy'>
				<div className='contract-topline'>
					<Badge tone='ok'>{commonCopy.active}</Badge>
					<h3>{simulationCopy.qaAccount}</h3>
				</div>
				<AddressValue address={selectedAccount} />
			</div>
			<select
				className='simulation-control-select'
				aria-label={simulationCopy.simulationQaAccount}
				value={selectedAccount}
				disabled={disabled}
				onChange={event => {
					const nextAccount = accounts.find(account => account === event.currentTarget.value)
					if (nextAccount === undefined) return
					onAccountChange(nextAccount)
				}}
			>
				{accounts.map((account, accountIndex) => (
					<option key={account} value={account}>
						{getSimulationAccountOptionLabel(accountIndex)}
					</option>
				))}
			</select>
		</div>
	)
}
