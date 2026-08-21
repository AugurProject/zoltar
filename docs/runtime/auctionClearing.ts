import { type AuctionBidInput, calculateAuctionModel } from '../charts/chartModels'

function formatFixed(value: number, digits = 2): string {
	if (!Number.isFinite(value)) return 'not available'
	return value.toFixed(digits).replace(/\.?0+$/, '')
}

function formatEth(value: number): string {
	return `${formatFixed(value)} ETH`
}

function formatRep(value: number): string {
	return `${formatFixed(value)} REP`
}

const auctionExample = document.querySelector('#simple-auction-example')
if (auctionExample instanceof HTMLElement) {
	const inputs: Partial<Record<string, HTMLInputElement>> = {}
	const outputs: Partial<Record<string, HTMLOutputElement>> = {}
	const values: Partial<Record<string, HTMLElement>> = {}
	for (const input of auctionExample.querySelectorAll('[data-example-input]')) {
		if (input instanceof HTMLInputElement && input.dataset['exampleInput'] !== undefined) inputs[input.dataset['exampleInput']] = input
	}
	for (const output of auctionExample.querySelectorAll('[data-example-output]')) {
		if (output instanceof HTMLOutputElement && output.dataset['exampleOutput'] !== undefined) outputs[output.dataset['exampleOutput']] = output
	}
	for (const value of auctionExample.querySelectorAll('[data-example-value]')) {
		if (value instanceof HTMLElement && value.dataset['exampleValue'] !== undefined) values[value.dataset['exampleValue']] = value
	}

	const read = (name: string): number => {
		const value = Number(inputs[name]?.value)
		return Number.isFinite(value) ? value : 0
	}
	const write = (name: string, value: string): void => {
		const output = outputs[name]
		if (output !== undefined) output.value = value
	}
	const writeValue = (name: string, value: string): void => {
		const element = values[name]
		if (element !== undefined) element.textContent = value
	}
	const update = (): void => {
		const ethRaiseCap = read('ethRaiseCap')
		const repInventory = Math.max(read('repInventory'), 1)
		const bids: AuctionBidInput[] = [
			{ eth: read('aliceEth'), key: 'alice', name: 'Alice', price: 5 },
			{ eth: read('bobEth'), key: 'bob', name: 'Bob', price: 4 },
			{ eth: read('carolEth'), key: 'carol', name: 'Carol', price: 3 },
		]
		const model = calculateAuctionModel(ethRaiseCap, repInventory, bids)
		writeValue('ethRaiseCap', formatEth(ethRaiseCap))
		writeValue('repInventory', formatRep(repInventory))
		for (const bid of bids) writeValue(`${bid.key}Eth`, formatEth(bid.eth))
		const repResults = Object.fromEntries(model.bids.map(bid => [bid.key, bid.rep]))
		const repSold = model.bids.reduce((sum, bid) => sum + bid.rep, 0)
		if (model.mode === 'uniform') {
			const hitEthCap = Math.abs(model.ethRaised - ethRaiseCap) < 1e-9
			const hitRepCap = Math.abs(repSold - repInventory) < 1e-9
			let bindingCondition = 'REP cap'
			if (hitEthCap && hitRepCap) bindingCondition = 'both caps'
			else if (hitEthCap) bindingCondition = 'ETH cap'
			write('clearingMode', `uniform clearing near ${formatFixed(model.clearingPrice)} ETH/REP`)
			write('bindingCondition', bindingCondition)
			write('thresholdInputEth', 'not underfunded')
			write('underfundedThreshold', 'not underfunded')
			auctionExample.dataset['widgetState'] = 'safe'
		} else {
			write('clearingMode', 'underfunded qualification clearing')
			write('bindingCondition', 'underfunded')
			write('thresholdInputEth', formatEth(model.ethRaised))
			write('underfundedThreshold', `${formatFixed(model.qualificationPrice)} ETH/REP`)
			auctionExample.dataset['widgetState'] = model.ethRaised > 0 ? 'warning' : 'unsafe'
		}
		write('ethRaised', formatEth(model.ethRaised))
		for (const bid of bids) {
			const outputName = `${bid.key}Receives`
			const allocation = repResults[bid.key] ?? 0
			write(outputName, formatRep(allocation))
			const card = outputs[outputName]?.parentElement
			if (card !== null && card !== undefined) {
				card.dataset['widgetMeter'] = 'true'
				card.style.setProperty('--widget-meter', `${Math.min(100, Math.max(0, (allocation / repInventory) * 100))}%`)
			}
		}
		write('totalRepAllocated', formatRep(repSold))
		write('refunds', formatEth(bids.reduce((sum, bid) => sum + bid.eth, 0) - model.ethRaised))
	}
	for (const input of Object.values(inputs)) input?.addEventListener('input', update)
	update()
}
