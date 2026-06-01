import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import type { SimulationController } from '../simulation/controller.js'
import { formatCurrencyInputBalance } from '../lib/formatters.js'
import { parseDecimalInput } from '../lib/decimal.js'
import { getSimulationScenarioDescription, getSimulationScenarioLabel, SIMULATION_SCENARIOS } from '../simulation/scenarios.js'
import { TimestampValue } from './TimestampValue.js'
const SIMULATION_TIME_PRESETS = [
	{ label: '+1 hour', seconds: 60n * 60n },
	{ label: '+1 day', seconds: 24n * 60n * 60n },
	{ label: '+1 week', seconds: 7n * 24n * 60n * 60n },
	{ label: '+1 month', seconds: 30n * 24n * 60n * 60n },
	{ label: '+1 year', seconds: 365n * 24n * 60n * 60n },
] as const
const SIMULATION_REP_MINT_AMOUNT = 1_000_000n * 10n ** 18n
type SimulationBannerProps = {
	controller: SimulationController
	onRefresh: () => Promise<void>
}
export function SimulationBanner({ controller, onRefresh }: SimulationBannerProps) {
	const busy = useSignal(false)
	const blockCountSinceReset = useSignal(controller.blockCountSinceReset)
	const currentTimestamp = useSignal(controller.currentTimestamp)
	const currentScenario = useSignal(controller.currentScenario)
	const isBootstrapped = useSignal(controller.isBootstrapped)
	const isBootstrapping = useSignal(controller.isBootstrapping)
	const queryDelayMilliseconds = useSignal(controller.queryDelayMilliseconds.toString())
	const repPerEthPrice = useSignal(formatCurrencyInputBalance(controller.repPerEthPrice))
	const repPerUsdcPrice = useSignal(formatCurrencyInputBalance(controller.repPerUsdcPrice, 6))
	const selectedAccount = useSignal(controller.selectedAccount)
	const bootstrapError = useSignal(controller.bootstrapError)
	const bootstrapLabel = useSignal(controller.bootstrapLabel)
	const bootstrapProgress = useSignal(controller.bootstrapProgress)
	const transactionCountSinceReset = useSignal(controller.transactionCountSinceReset)
	const transactionDelayMilliseconds = useSignal(controller.transactionDelayMilliseconds.toString())
	useEffect(
		() =>
			controller.subscribe(() => {
				blockCountSinceReset.value = controller.blockCountSinceReset
				bootstrapError.value = controller.bootstrapError
				bootstrapLabel.value = controller.bootstrapLabel
				bootstrapProgress.value = controller.bootstrapProgress
				currentTimestamp.value = controller.currentTimestamp
				currentScenario.value = controller.currentScenario
				isBootstrapped.value = controller.isBootstrapped
				isBootstrapping.value = controller.isBootstrapping
				queryDelayMilliseconds.value = controller.queryDelayMilliseconds.toString()
				repPerEthPrice.value = formatCurrencyInputBalance(controller.repPerEthPrice)
				repPerUsdcPrice.value = formatCurrencyInputBalance(controller.repPerUsdcPrice, 6)
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
			<div className='contract-list simulation-banner-list'>
				<div className='contract-row simulation-banner-row'>
					<div className='contract-copy'>
						<div className='contract-topline'>
							<span
								className={`badge ${(() => {
									if (bootstrapError.value === undefined) {
										if (isBootstrapped.value) return 'ok'

										return 'pending'
									}

									return 'error'
								})()}`}
							>
								{(() => {
									if (bootstrapError.value === undefined) {
										if (isBootstrapped.value) return 'Ready'

										return 'Bootstrapping'
									}

									return 'Error'
								})()}
							</span>
							<h3>Scenario</h3>
						</div>
						<p className='detail'>{bootstrapError.value ?? getSimulationScenarioDescription(currentScenario.value)}</p>
						{bootstrapError.value === undefined && isBootstrapping.value ? (
							<p className='detail'>
								<span className='spinner' aria-hidden='true' />
								{bootstrapLabel.value ?? 'Preparing the selected simulation scenario in the background.'}
							</p>
						) : undefined}
						{isBootstrapping.value ? (
							<div className='notice-progress-track simulation-progress-track' aria-hidden='true'>
								<div className='notice-progress-fill simulation-progress-fill' style={{ width: `${Math.round((bootstrapProgress.value ?? 0.08) * 100)}%` }} />
							</div>
						) : undefined}
					</div>
					<select
						className='simulation-control-select'
						value={currentScenario.value}
						disabled={busy.value || isBootstrapping.value}
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
					</div>
					<select
						className='simulation-control-select'
						value={selectedAccount.value}
						disabled={busy.value || !isBootstrapped.value}
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
						<span className='simulation-stat-label'>Blocks</span>
						<strong>{blockCountSinceReset.value.toString()}</strong>
					</div>
					<div className='simulation-stat-card'>
						<span className='simulation-stat-label'>Transactions</span>
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
								<span className='simulation-delay-label'>REP / ETH mock price</span>
								<input
									className='simulation-control-input'
									type='text'
									inputMode='decimal'
									value={repPerEthPrice.value}
									disabled={busy.value}
									onInput={event => {
										repPerEthPrice.value = event.currentTarget.value
									}}
									onChange={event => {
										try {
											void runControl(async () => {
												controller.setRepPerEthPrice(parseDecimalInput(event.currentTarget.value, 'REP / ETH mock price'))
											})
										} catch (_error) {
											repPerEthPrice.value = formatCurrencyInputBalance(controller.repPerEthPrice)
										}
									}}
								/>
							</label>
							<label className='simulation-delay-field'>
								<span className='simulation-delay-label'>REP / USDC mock price</span>
								<input
									className='simulation-control-input'
									type='text'
									inputMode='decimal'
									value={repPerUsdcPrice.value}
									disabled={busy.value}
									onInput={event => {
										repPerUsdcPrice.value = event.currentTarget.value
									}}
									onChange={event => {
										try {
											void runControl(async () => {
												controller.setRepPerUsdcPrice(parseDecimalInput(event.currentTarget.value, 'REP / USDC mock price', 6))
											})
										} catch (_error) {
											repPerUsdcPrice.value = formatCurrencyInputBalance(controller.repPerUsdcPrice, 6)
										}
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
						<p className='detail'>Query delay slows simulation reads. The REP / ETH and REP / USDC mocks apply to every REP token in simulation mode. Transaction delay slows receipt confirmation so loading states stay visible.</p>
					</div>
					<div className='simulation-control-groups'>
						<div className='simulation-control-group'>
							<span className='simulation-control-group-label'>Actions</span>
							<div className='button-row simulation-button-row'>
								<button className='secondary' onClick={() => void runControl(async () => await controller.reset())} disabled={busy.value || !isBootstrapped.value}>
									Reset scenario
								</button>
								<button className='secondary' onClick={() => void runControl(async () => await controller.mineBlock())} disabled={busy.value || !isBootstrapped.value}>
									Mine block
								</button>
								<button className='secondary' onClick={() => void runControl(async () => await controller.mintRep(SIMULATION_REP_MINT_AMOUNT))} disabled={busy.value || !isBootstrapped.value}>
									Mint 1 million REP
								</button>
							</div>
						</div>
						<div className='simulation-control-group'>
							<span className='simulation-control-group-label'>Time travel</span>
							<div className='button-row simulation-button-row'>
								{SIMULATION_TIME_PRESETS.map(preset => (
									<button key={preset.label} className='secondary' onClick={() => void runControl(async () => await controller.advanceTime(preset.seconds))} disabled={busy.value || !isBootstrapped.value}>
										{preset.label}
									</button>
								))}
							</div>
						</div>
					</div>
				</div>
			</div>
		</section>
	)
}
