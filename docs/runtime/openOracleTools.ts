type ExampleContext = {
	inputs: Record<string, HTMLInputElement>
	read: (name: string) => number
	root: HTMLElement
	writeOutput: (name: string, value: string) => void
	writeValue: (name: string, value: string) => void
}

type MinimumWethParameters = {
	blockBaseFeeGwei: number
	escalationHaltMultiplier: number
	gasUnitsForOneDispute: number
	initialReportPriorityFeeGwei: number
	openInterestWeth: number
	openOracleProtocolFee: number
	openOracleReporterFee: number
	openOracleSecurityMultiplier: number
	requestedInitialWeth: number
	targetPriceErrorForDispute: number
}

function collectElements<T extends HTMLElement>(root: HTMLElement, selector: string, key: string, expected: new () => T): Record<string, T> {
	const result: Record<string, T> = {}
	for (const element of root.querySelectorAll(selector)) {
		if (!(element instanceof expected)) continue
		const name = element.dataset[key]
		if (name !== undefined) result[name] = element
	}
	return result
}

function collectExample(exampleId: string): ExampleContext | undefined {
	const root = document.querySelector(exampleId)
	if (!(root instanceof HTMLElement)) return undefined
	const inputs = collectElements(root, '[data-example-input]', 'exampleInput', HTMLInputElement)
	const outputs = collectElements(root, '[data-example-output]', 'exampleOutput', HTMLOutputElement)
	const values = collectElements(root, '[data-example-value]', 'exampleValue', HTMLElement)
	return {
		inputs,
		read: name => {
			const value = Number(inputs[name]?.value)
			return Number.isFinite(value) ? value : 0
		},
		root,
		writeOutput: (name, value) => {
			const output = outputs[name]
			if (output !== undefined) output.value = value
		},
		writeValue: (name, value) => {
			const element = values[name]
			if (element !== undefined) element.textContent = value
		},
	}
}

function bindExample(exampleId: string, update: (context: ExampleContext) => void): void {
	const context = collectExample(exampleId)
	if (context === undefined) return
	for (const input of Object.values(context.inputs)) input.addEventListener('input', () => update(context))
	update(context)
}

function formatPercent(fractionValue: number): string {
	return `${(fractionValue * 100).toFixed(2)}%`
}

function formatEth(ethValue: number): string {
	return `${ethValue.toFixed(2)} ETH`
}

function formatExecutionThreshold(thresholdValue: number): string {
	return Number.isFinite(thresholdValue) ? formatPercent(thresholdValue) : 'no finite threshold'
}

function formatDuration(durationValue: number | undefined): string {
	if (durationValue === undefined) return 'not applicable without attacker payoff'
	if (!Number.isFinite(durationValue)) return 'unbounded when censorship rate is zero'
	return durationValue.toFixed(2)
}

function calculateMinimumWethEstimate(parameters: MinimumWethParameters) {
	const percentagePrecision = 10_000_000n
	const targetErrorUnits = BigInt(Math.round(parameters.targetPriceErrorForDispute * 100_000))
	const feeUnits = BigInt(Math.round((parameters.openOracleProtocolFee + parameters.openOracleReporterFee) * 100_000))
	const targetError = parameters.targetPriceErrorForDispute / 100
	const feeFraction = (parameters.openOracleProtocolFee + parameters.openOracleReporterFee) / 100
	const correctionProfitFraction = (targetError - feeFraction) / (1 + targetError)
	const disputeGasCostEth = parameters.gasUnitsForOneDispute * (parameters.blockBaseFeeGwei + parameters.initialReportPriorityFeeGwei) * 1e-9
	const bufferedGasCostEth = disputeGasCostEth * parameters.openOracleSecurityMultiplier
	const correctionProfitUnits = targetErrorUnits - feeUnits
	let minimumWethReportAttoEth: bigint | undefined
	if (correctionProfitUnits > 0n) {
		const denominator = 10_000n * correctionProfitUnits
		const calculateGasPriceReport = (gasPriceGwei: number): bigint => {
			const numerator = BigInt(Math.round(gasPriceGwei * 1e9)) * BigInt(Math.round(parameters.gasUnitsForOneDispute)) * BigInt(Math.round(parameters.openOracleSecurityMultiplier * 10_000)) * (percentagePrecision + targetErrorUnits)
			return (numerator + denominator - 1n) / denominator
		}
		const priorityFeeReportAttoEth = calculateGasPriceReport(parameters.initialReportPriorityFeeGwei)
		const baseFeeReportAttoEth = calculateGasPriceReport(parameters.blockBaseFeeGwei)
		const openInterestAttoWeth = BigInt(Math.round(parameters.openInterestWeth)) * 10n ** 18n
		const openInterestReportAttoEth = (openInterestAttoWeth + 99n) / 100n
		minimumWethReportAttoEth = priorityFeeReportAttoEth + (baseFeeReportAttoEth > openInterestReportAttoEth ? baseFeeReportAttoEth : openInterestReportAttoEth)
	}
	const openInterestAttoWeth = BigInt(Math.round(parameters.openInterestWeth)) * 10n ** 18n
	const openInterestEscalationHaltAttoEth = (openInterestAttoWeth + 99n) / 100n
	const requestedInitialAttoWeth = BigInt(Math.round(parameters.requestedInitialWeth * 1e18))
	let selectedInitialWethReportAttoEth: bigint | undefined
	if (minimumWethReportAttoEth !== undefined) selectedInitialWethReportAttoEth = requestedInitialAttoWeth > minimumWethReportAttoEth ? requestedInitialAttoWeth : minimumWethReportAttoEth
	const initialReportEscalationHaltAttoEth = selectedInitialWethReportAttoEth === undefined ? undefined : (selectedInitialWethReportAttoEth * BigInt(Math.round(parameters.escalationHaltMultiplier * 10_000))) / 10_000n
	let selectedEscalationHaltAttoEth: bigint | undefined
	if (initialReportEscalationHaltAttoEth !== undefined) selectedEscalationHaltAttoEth = initialReportEscalationHaltAttoEth > openInterestEscalationHaltAttoEth ? initialReportEscalationHaltAttoEth : openInterestEscalationHaltAttoEth
	return {
		bufferedGasCostEth,
		correctionProfitFraction,
		disputeGasCostEth,
		initialReportEscalationHaltAttoEth,
		minimumWethReportAttoEth,
		openInterestEscalationHaltAttoEth,
		selectedEscalationHaltAttoEth,
		selectedInitialWethReportAttoEth,
	}
}

function formatWethFromAttoEth(attoWeth: bigint): string {
	const atomicWethPerWeth = 10n ** 18n
	const whole = attoWeth / atomicWethPerWeth
	const fraction = attoWeth % atomicWethPerWeth
	return `${whole.toString()}.${fraction.toString().padStart(18, '0')} WETH`
}

function setMeter(context: ExampleContext, name: string, value: number, maximum: number): void {
	const output = context.root.querySelector<HTMLOutputElement>(`[data-example-output="${name}"]`)
	const card = output?.parentElement
	if (card === null || card === undefined) return
	const progress = maximum <= 0 ? 0 : Math.min(1, Math.max(0, value / maximum))
	card.style.setProperty('--widget-meter', `${progress * 100}%`)
	card.dataset['widgetMeter'] = 'true'
}

bindExample('#initial-report-estimator-example', context => {
	const parameters: MinimumWethParameters = {
		blockBaseFeeGwei: context.read('blockBaseFeeGwei'),
		escalationHaltMultiplier: context.read('escalationHaltMultiplier'),
		gasUnitsForOneDispute: context.read('gasUnitsForOneDispute'),
		initialReportPriorityFeeGwei: context.read('initialReportPriorityFeeGwei'),
		openInterestWeth: context.read('openInterestWeth'),
		openOracleProtocolFee: context.read('openOracleProtocolFee'),
		openOracleReporterFee: context.read('openOracleReporterFee'),
		openOracleSecurityMultiplier: context.read('openOracleSecurityMultiplier'),
		requestedInitialWeth: context.read('requestedInitialWeth'),
		targetPriceErrorForDispute: context.read('targetPriceErrorForDispute'),
	}
	const estimate = calculateMinimumWethEstimate(parameters)
	context.writeValue('blockBaseFeeGwei', `${parameters.blockBaseFeeGwei.toFixed(0)} gwei`)
	context.writeValue('initialReportPriorityFeeGwei', `${parameters.initialReportPriorityFeeGwei.toFixed(0)} gwei`)
	context.writeValue('openInterestWeth', `${parameters.openInterestWeth.toFixed(0)} WETH`)
	context.writeValue('gasUnitsForOneDispute', `${parameters.gasUnitsForOneDispute.toLocaleString()} gas`)
	context.writeValue('openOracleSecurityMultiplier', `${parameters.openOracleSecurityMultiplier.toFixed(1)}x`)
	context.writeValue('targetPriceErrorForDispute', `${parameters.targetPriceErrorForDispute.toFixed(1)}%`)
	context.writeValue('openOracleProtocolFee', `${parameters.openOracleProtocolFee.toFixed(1)}%`)
	context.writeValue('openOracleReporterFee', `${parameters.openOracleReporterFee.toFixed(1)}%`)
	context.writeValue('requestedInitialWeth', `${parameters.requestedInitialWeth.toFixed(2)} WETH`)
	context.writeValue('escalationHaltMultiplier', `${parameters.escalationHaltMultiplier.toFixed(0)}x`)
	const unsafeText = 'unsafe: fees meet or exceed target error'
	context.writeOutput('initialReportEscalationHalt', estimate.initialReportEscalationHaltAttoEth === undefined ? unsafeText : formatWethFromAttoEth(estimate.initialReportEscalationHaltAttoEth))
	context.writeOutput('openInterestEscalationHalt', formatWethFromAttoEth(estimate.openInterestEscalationHaltAttoEth))
	context.writeOutput('estimatedMinimumWethReport', estimate.minimumWethReportAttoEth === undefined ? unsafeText : formatWethFromAttoEth(estimate.minimumWethReportAttoEth))
	context.writeOutput('selectedInitialWethReport', estimate.selectedInitialWethReportAttoEth === undefined ? unsafeText : formatWethFromAttoEth(estimate.selectedInitialWethReportAttoEth))
	context.writeOutput('selectedEscalationHalt', estimate.selectedEscalationHaltAttoEth === undefined ? unsafeText : formatWethFromAttoEth(estimate.selectedEscalationHaltAttoEth))
	context.writeOutput('disputeGasCost', `${estimate.disputeGasCostEth.toFixed(6)} ETH`)
	context.writeOutput('bufferedGasCost', `${estimate.bufferedGasCostEth.toFixed(6)} ETH`)
	context.writeOutput('correctionProfitFraction', estimate.correctionProfitFraction > 0 ? `${(estimate.correctionProfitFraction * 100).toFixed(4)}%` : 'not positive')
	context.writeOutput('estimatorSafetyState', estimate.correctionProfitFraction > 0 ? 'fees below target error' : unsafeText)
	context.root.dataset['widgetState'] = estimate.correctionProfitFraction > 0 ? 'safe' : 'unsafe'
	const meterValues = [
		['estimatedMinimumWethReport', estimate.minimumWethReportAttoEth],
		['selectedInitialWethReport', estimate.selectedInitialWethReportAttoEth],
		['selectedEscalationHalt', estimate.selectedEscalationHaltAttoEth],
	] as const
	const maximum = Math.max(...meterValues.map(([, value]) => Number(value ?? 0n)), 1)
	for (const [name, value] of meterValues) setMeter(context, name, Number(value ?? 0n), maximum)
})

bindExample('#binary-censorship-example', context => {
	const honestPrice = Math.max(context.read('honestPrice'), 0.0001)
	const manipulatedPrice = Math.max(context.read('manipulatedPrice'), 0.0001)
	const liquidationThresholdPrice = Math.max(context.read('liquidationThresholdPrice'), 0.0001)
	const boundedLiquidationDistanceBps = Math.min(Math.max(context.read('minLiquidationPriceDistanceBps'), 0), 10_000)
	const externalPayoff = Math.max(context.read('externalPayoff'), 0.0001)
	const oracleReportLiquidity = Math.max(context.read('oracleReportLiquidity'), 0.0001)
	const honestDisputeBarrierFraction = Math.max(context.read('honestDisputeBarrierFraction'), 0)
	const censorshipDuration = Math.max(context.read('censorshipDuration'), 0)
	const targetGriefRatio = Math.max(context.read('targetGriefRatio'), 0)
	const discountedHonestPrice = honestPrice * (1 - boundedLiquidationDistanceBps / 10_000)
	const executionErrorThreshold = discountedHonestPrice === 0 ? Number.POSITIVE_INFINITY : Math.max(0, liquidationThresholdPrice / discountedHonestPrice - 1)
	const manipulatedPriceError = Math.max(0, (manipulatedPrice - honestPrice) / honestPrice)
	const liquidationExecutable = manipulatedPrice > liquidationThresholdPrice && manipulatedPriceError >= executionErrorThreshold
	const attackerPayoff = liquidationExecutable ? externalPayoff : 0
	const censorshipRate = Math.max(0, manipulatedPriceError - honestDisputeBarrierFraction)
	const censorshipCost = censorshipDuration * censorshipRate * oracleReportLiquidity
	const oracleLiquidityRatio = oracleReportLiquidity / externalPayoff
	let safeCensorshipDuration: number | undefined
	if (liquidationExecutable) safeCensorshipDuration = censorshipRate === 0 ? Number.POSITIVE_INFINITY : (targetGriefRatio + 1) / (censorshipRate * oracleLiquidityRatio)
	context.writeValue('honestPrice', honestPrice.toFixed(0))
	context.writeValue('manipulatedPrice', manipulatedPrice.toFixed(0))
	context.writeValue('liquidationThresholdPrice', liquidationThresholdPrice.toFixed(0))
	context.writeValue('minLiquidationPriceDistanceBps', `${boundedLiquidationDistanceBps.toFixed(0)} bps`)
	context.writeValue('externalPayoff', formatEth(externalPayoff))
	context.writeValue('oracleReportLiquidity', formatEth(oracleReportLiquidity))
	context.writeValue('honestDisputeBarrierFraction', formatPercent(honestDisputeBarrierFraction))
	context.writeValue('censorshipDuration', `${censorshipDuration.toFixed(0)} steps`)
	context.writeValue('targetGriefRatio', targetGriefRatio.toFixed(1))
	context.writeOutput('executionErrorThreshold', formatExecutionThreshold(executionErrorThreshold))
	context.writeOutput('manipulatedPriceError', formatPercent(manipulatedPriceError))
	context.writeOutput('liquidationExecutable', liquidationExecutable ? 'yes' : 'no')
	context.writeOutput('attackerPayoff', formatEth(attackerPayoff))
	context.writeOutput('censorshipCost', formatEth(censorshipCost))
	context.writeOutput('oracleLiquidityRatio', oracleLiquidityRatio.toFixed(2))
	context.writeOutput('safeCensorshipDuration', formatDuration(safeCensorshipDuration))
	context.root.dataset['widgetState'] = liquidationExecutable ? 'unsafe' : 'safe'
	const maximum = Math.max(attackerPayoff, censorshipCost, 1)
	setMeter(context, 'attackerPayoff', attackerPayoff, maximum)
	setMeter(context, 'censorshipCost', censorshipCost, maximum)
})
