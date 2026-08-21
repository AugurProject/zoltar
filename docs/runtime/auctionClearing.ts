type BidKey = 'alice' | 'bob' | 'carol'
type AuctionBid = { eth: number; key: BidKey; price: number }

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
		const bids: AuctionBid[] = [
			{ eth: read('aliceEth'), key: 'alice', price: 5 },
			{ eth: read('bobEth'), key: 'bob', price: 4 },
			{ eth: read('carolEth'), key: 'carol', price: 3 },
		]
		const threshold = ethRaiseCap / repInventory
		const submittedBids = bids.filter(bid => bid.eth > 0)
		const activeBids = submittedBids.filter(bid => bid.price >= threshold)
		writeValue('ethRaiseCap', formatEth(ethRaiseCap))
		writeValue('repInventory', formatRep(repInventory))
		for (const bid of bids) writeValue(`${bid.key}Eth`, formatEth(bid.eth))
		let accumulatedBidEth = 0
		let clearingPrice = 0
		let ethFilledAtClearing = 0
		let funded = false
		let lastValidPrice = 0
		let lastValidEthAtTick = 0
		for (const bid of activeBids) {
			if (accumulatedBidEth > 0 && accumulatedBidEth / bid.price > repInventory) {
				funded = true
				clearingPrice = lastValidPrice
				ethFilledAtClearing = lastValidEthAtTick
				break
			}
			const ethToTake = Math.min(bid.eth, Math.max(0, ethRaiseCap - accumulatedBidEth))
			const newAccumulatedEth = accumulatedBidEth + ethToTake
			if (newAccumulatedEth / bid.price >= repInventory) {
				funded = true
				clearingPrice = bid.price
				ethFilledAtClearing = Math.max(0, Math.min(ethToTake, repInventory * bid.price - accumulatedBidEth))
				accumulatedBidEth += ethFilledAtClearing
				break
			}
			if (newAccumulatedEth >= ethRaiseCap) {
				funded = true
				clearingPrice = bid.price
				ethFilledAtClearing = ethToTake
				accumulatedBidEth = newAccumulatedEth
				break
			}
			accumulatedBidEth = newAccumulatedEth
			lastValidPrice = bid.price
			lastValidEthAtTick = ethToTake
		}
		let refunds = submittedBids.filter(bid => bid.price < threshold).reduce((sum, bid) => sum + bid.eth, 0)
		const repResults: Record<BidKey, number> = { alice: 0, bob: 0, carol: 0 }
		if (funded && clearingPrice > 0) {
			let clearingTickEthRemaining = ethFilledAtClearing
			for (const bid of activeBids) {
				if (bid.price > clearingPrice) repResults[bid.key] = bid.eth / clearingPrice
				else if (bid.price === clearingPrice) {
					const fillEth = Math.min(bid.eth, clearingTickEthRemaining)
					clearingTickEthRemaining -= fillEth
					repResults[bid.key] = fillEth / clearingPrice
					refunds += bid.eth - fillEth
				} else refunds += bid.eth
			}
			const repSold = repResults.alice + repResults.bob + repResults.carol
			const hitEthCap = Math.abs(accumulatedBidEth - ethRaiseCap) < 1e-9
			const hitRepCap = Math.abs(repSold - repInventory) < 1e-9
			let bindingCondition = 'REP cap'
			if (hitEthCap && hitRepCap) bindingCondition = 'both caps'
			else if (hitEthCap) bindingCondition = 'ETH cap'
			write('clearingMode', `uniform clearing near ${formatFixed(clearingPrice)} ETH/REP`)
			write('bindingCondition', bindingCondition)
			write('thresholdInputEth', 'not underfunded')
			write('underfundedThreshold', 'not underfunded')
			auctionExample.dataset['widgetState'] = 'safe'
		} else {
			const winningEthAmount = activeBids.reduce((sum, bid) => sum + bid.eth, 0)
			if (winningEthAmount > 0) {
				for (const bid of activeBids) repResults[bid.key] = (bid.eth * repInventory) / winningEthAmount
			}
			accumulatedBidEth = winningEthAmount
			write('clearingMode', 'underfunded qualification clearing')
			write('bindingCondition', 'underfunded')
			write('thresholdInputEth', formatEth(winningEthAmount))
			write('underfundedThreshold', `${formatFixed(threshold)} ETH/REP`)
			auctionExample.dataset['widgetState'] = winningEthAmount > 0 ? 'warning' : 'unsafe'
		}
		write('ethRaised', formatEth(accumulatedBidEth))
		for (const bid of bids) {
			const outputName = `${bid.key}Receives`
			write(outputName, formatRep(repResults[bid.key]))
			const card = outputs[outputName]?.parentElement
			if (card !== null && card !== undefined) {
				card.dataset['widgetMeter'] = 'true'
				card.style.setProperty('--widget-meter', `${Math.min(100, Math.max(0, (repResults[bid.key] / repInventory) * 100))}%`)
			}
		}
		write('totalRepAllocated', formatRep(repResults.alice + repResults.bob + repResults.carol))
		write('refunds', formatEth(refunds))
	}
	for (const input of Object.values(inputs)) input?.addEventListener('input', update)
	update()
}
