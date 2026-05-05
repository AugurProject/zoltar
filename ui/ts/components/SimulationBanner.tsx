import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import type { SimulationController } from '../simulation/controller.js'
import { getSimulationScenarioLabel, SIMULATION_SCENARIOS } from '../simulation/scenarios.js'
import { TimestampValue } from './TimestampValue.js'

type SimulationBannerProps = {
	controller: SimulationController
	onRefresh: () => Promise<void>
}

export function SimulationBanner({ controller, onRefresh }: SimulationBannerProps) {
	const busy = useSignal(false)
	const blockCountSinceReset = useSignal(controller.blockCountSinceReset)
	const currentTimestamp = useSignal(controller.currentTimestamp)
	const currentScenario = useSignal(controller.currentScenario)
	const queryDelayMilliseconds = useSignal(controller.queryDelayMilliseconds.toString())
	const selectedAccount = useSignal(controller.selectedAccount)
	const transactionCountSinceReset = useSignal(controller.transactionCountSinceReset)
	const transactionDelayMilliseconds = useSignal(controller.transactionDelayMilliseconds.toString())

	useEffect(
		() =>
			controller.subscribe(() => {
				blockCountSinceReset.value = controller.blockCountSinceReset
				currentTimestamp.value = controller.currentTimestamp
				currentScenario.value = controller.currentScenario
				queryDelayMilliseconds.value = controller.queryDelayMilliseconds.toString()
				selectedAccount.value = controller.selectedAccount
				transactionCountSinceReset.value = controller.transactionCountSinceReset
				transactionDelayMilliseconds.value = controller.transactionDelayMilliseconds.toString()
			}),
		[controller],
	)

	const runControl = async (work: () => Promise<void>) => {
		if (busy.value) return
		busy.value = true
		try {
			await work()
			await onRefresh()
		} finally {
			busy.value = false
		}
	}

	return (
		<section className='panel contract-panel simulation-banner'>
			<div className='contract-panel-header simulation-banner-header'>
				<div>
					<h2>Simulation Mode</h2>
					<p className='detail'>Browser Simulation</p>
				</div>
			</div>
			<div className='simulation-banner-warning'>
				<strong>Developer controls only.</strong> These tools are part of the browser simulation harness, not the application itself.
			</div>
			<div className='contract-list simulation-banner-list'>
				<div className='contract-row simulation-banner-row'>
					<div className='contract-copy'>
						<div className='contract-topline'>
							<span className='badge ok'>Active</span>
							<h3>Scenario</h3>
						</div>
						<p className='detail'>Switch scenarios to reload the browser simulation into a different seeded state.</p>
					</div>
					<select
						className='simulation-control-select'
						value={currentScenario.value}
						disabled={busy.value}
						onChange={event => {
							const nextScenario = event.currentTarget.value
							const nextUrl = new URL(window.location.href)
							nextUrl.searchParams.set('simulate', '1')
							nextUrl.searchParams.set('simScenario', nextScenario)
							window.location.assign(nextUrl.toString())
						}}
					>
						{SIMULATION_SCENARIOS.map(scenario => (
							<option key={scenario} value={scenario}>
								{getSimulationScenarioLabel(scenario)}
							</option>
						))}
					</select>
				</div>
				<div className='contract-row simulation-banner-row'>
					<div className='contract-copy'>
						<div className='contract-topline'>
							<span className='badge ok'>Active</span>
							<h3>QA account</h3>
						</div>
						<p className='address'>{selectedAccount.value}</p>
						<p className='detail'>Switch between seeded accounts, reset the scenario, or move chain time forward.</p>
					</div>
					<select
						className='simulation-control-select'
						value={selectedAccount.value}
						disabled={busy.value}
						onChange={event => {
							const nextAccount = controller.accounts.find(account => account === event.currentTarget.value)
							if (nextAccount === undefined) return
							void runControl(async () => {
								await controller.selectAccount(nextAccount)
							})
						}}
					>
						{controller.accounts.map(account => (
							<option key={account} value={account}>
								{account}
							</option>
						))}
					</select>
				</div>
				<div className='simulation-banner-stats'>
					<div className='simulation-stat-card'>
						<span className='simulation-stat-label'>Blocks since reset</span>
						<strong>{blockCountSinceReset.value.toString()}</strong>
					</div>
					<div className='simulation-stat-card'>
						<span className='simulation-stat-label'>Transactions since reset</span>
						<strong>{transactionCountSinceReset.value.toString()}</strong>
					</div>
					<div className='simulation-stat-card simulation-stat-card-wide'>
						<span className='simulation-stat-label'>Blockchain time</span>
						<strong>
							<TimestampValue currentTimestamp={currentTimestamp.value} timestamp={currentTimestamp.value} />
						</strong>
					</div>
				</div>
				<div className='simulation-banner-controls'>
					<div className='contract-copy'>
						<h3>Controls</h3>
						<p className='detail'>Use these controls for repeatable manual UI QA without a wallet extension.</p>
						<div className='simulation-delay-grid'>
							<label className='simulation-delay-field'>
								<span className='simulation-delay-label'>Query delay (ms)</span>
								<input
									className='simulation-control-input'
									type='number'
									min='0'
									step='100'
									inputMode='numeric'
									value={queryDelayMilliseconds.value}
									disabled={busy.value}
									onInput={event => {
										queryDelayMilliseconds.value = event.currentTarget.value
									}}
									onChange={event => {
										controller.setQueryDelayMilliseconds(Number(event.currentTarget.value))
									}}
								/>
							</label>
							<label className='simulation-delay-field'>
								<span className='simulation-delay-label'>Transaction receipt delay (ms)</span>
								<input
									className='simulation-control-input'
									type='number'
									min='0'
									step='100'
									inputMode='numeric'
									value={transactionDelayMilliseconds.value}
									disabled={busy.value}
									onInput={event => {
										transactionDelayMilliseconds.value = event.currentTarget.value
									}}
									onChange={event => {
										controller.setTransactionDelayMilliseconds(Number(event.currentTarget.value))
									}}
								/>
							</label>
						</div>
						<p className='detail'>Query delay slows simulation reads. Transaction delay slows receipt confirmation so loading states stay visible.</p>
					</div>
					<div className='button-row'>
						<button className='secondary' onClick={() => void runControl(async () => await controller.reset())} disabled={busy.value}>
							Reset scenario
						</button>
						<button className='secondary' onClick={() => void runControl(async () => await controller.mineBlock())} disabled={busy.value}>
							Mine block
						</button>
						<button className='secondary' onClick={() => void runControl(async () => await controller.advanceTime(60n * 60n))} disabled={busy.value}>
							+1 hour
						</button>
						<button className='secondary' onClick={() => void runControl(async () => await controller.advanceTime(24n * 60n * 60n))} disabled={busy.value}>
							+1 day
						</button>
					</div>
				</div>
			</div>
		</section>
	)
}
