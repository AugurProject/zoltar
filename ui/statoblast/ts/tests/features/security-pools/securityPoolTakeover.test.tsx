import { expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { decodeFunctionData, getAddress } from '@zoltar/core-shared/evm/ethereum'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { SecurityPoolTakeover } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SecurityPoolTakeover.js'
import { statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import type { SecurityPoolAccountSnapshot, SecurityPoolTransaction } from '@zoltar/ui-statoblast-shared/protocol/securityPool.js'
import { capitalSnapshot, index, capital, unit } from './capitalFixture.js'
import { capitalClient } from './capitalClient.js'

const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
const idleActions = { ownerReason: undefined, scope: [], busy: undefined, runSecurityPoolAction: async () => undefined }

/** Installs a capital reader whose position 2 is a liquidating 15 REP / 10 ETH account at accepted price epoch 4. */
function installTakeoverReader(snapshot: SecurityPoolAccountSnapshot) {
	const reader = capitalClient(snapshot)
	reader.setRead('accountOf', { owner: getAddress('0x0000000000000000000000000000000000000099'), batch: 0n, rep: 15n * unit, commitment: 10n * unit, maxHealthyPrice: unit, releasedRep: 0n, ethFees: 0n, repFees: 0n, remainingCommitment: 0n }, index)
	reader.setRead('liquidationStarted', 1n, capital)
	reader.setRead('acceptedPriceEpoch', 4n, capital)
	reader.setRead('liquidationPenaltyPaid', 0n, capital)
	reader.setRead('liquidationElapsed', 0n, capital)
	reader.install()
	return reader
}

async function renderTakeover(snapshot: SecurityPoolAccountSnapshot, actions: Parameters<typeof SecurityPoolTakeover>[0]['actions']) {
	const view = await renderIntoDocument(<SecurityPoolTakeover model={{ snapshot }} actions={actions} />)
	lifecycle.trackRendered(view)
	return view
}

async function fill(field: HTMLInputElement | undefined, value: string) {
	if (field === undefined) throw new Error('Missing takeover field')
	await act(() => {
		field.value = value
		field.dispatchEvent(new Event('input', { bubbles: true }))
	})
}

test('keeps a saved target readable while the pool is loading and makes no reads from saved addresses', async () => {
	const snapshot = capitalSnapshot({ totalCommitmentAttoEth: 20n * unit, demandAttoEth: 10n * unit })
	const reader = installTakeoverReader(snapshot)
	const live = await renderIntoDocument(<SecurityPoolTakeover redesigned model={{ snapshot }} wallet={snapshot.owner} actions={idleActions} />)
	lifecycle.trackRendered(live)
	const positions = () => live.container.querySelector('table')
	expect(positions()?.textContent).toContain('Position #1')
	expect(positions()?.textContent).toContain('140%')
	await fill(live.container.querySelector('input') ?? undefined, '2')
	expect(reader.reads).toHaveLength(0)
	const openPosition = [...live.container.querySelectorAll('button')].find(button => button.textContent === 'Open position')
	if (openPosition === undefined) throw new Error('Missing position lookup button')
	await act(() => openPosition.click())
	await waitFor(() => expect(positions()?.textContent).toContain('15.00 REP'))
	expect(positions()?.textContent).toContain('Position #2')
	expect(positions()?.textContent).toContain('50%')
	const liveCure = [...live.container.querySelectorAll('button')].find(button => button.textContent === 'Cure position')
	expect(liveCure?.disabled).toBe(false)
	const requests = reader.reads.length
	await fill(live.container.querySelector('input') ?? undefined, '3')
	expect(liveCure?.disabled).toBe(true)
	expect(live.container.textContent).toContain('Open the entered position before continuing.')
	expect(reader.reads).toHaveLength(requests)
	const newerPool = { ...snapshot, blockHash: '0x1111111111111111111111111111111111111111111111111111111111111111' as const, conservativePrice: 4n * unit }
	const saved = await renderIntoDocument(<SecurityPoolTakeover redesigned positionId={2n} model={{ snapshot: undefined, presentationSnapshot: newerPool }} actions={idleActions} />)
	lifecycle.trackRendered(saved)
	await waitFor(() => expect(saved.container.querySelector('table')?.textContent).toContain('15.00 REP'))
	expect(saved.container.querySelector('table')?.textContent).toContain('50%')
	expect(saved.container.querySelector('.freshness-indicator')?.textContent).toContain('Updated')
	const transactionButtons = [...saved.container.querySelectorAll('button')].filter(button => /^(Cure|Take over) position$/.test(button.textContent ?? ''))
	expect(transactionButtons).toHaveLength(2)
	expect(transactionButtons.every(button => button.disabled)).toBe(true)
	expect(reader.reads).toHaveLength(requests)
})

test.each([true, false])('an existing auction permits manual takeover with consent bounds after price expiry (fresh=%s)', async priceValid => {
	const snapshot = capitalSnapshot({ totalCommitmentAttoEth: 20n * unit, demandAttoEth: 20n * unit, priceValid, ...(priceValid ? {} : { priceValidUntil: 1n }) })
	snapshot.ownerPrincipalAttoRep = 40n * unit
	snapshot.positions = snapshot.positions.map(position => ({ ...position, rep: 40n * unit }))
	const reader = installTakeoverReader(snapshot)
	const requests: SecurityPoolTransaction[] = []
	const actions = {
		ownerReason: undefined,
		scope: [],
		busy: undefined,
		runSecurityPoolAction: async (_action: string, _label: string, build: () => SecurityPoolTransaction | Promise<SecurityPoolTransaction>) => {
			requests.push(await build())
		},
	}
	const view = await renderTakeover(snapshot, actions)
	const button = view.container.querySelector('button')
	if (button === null) throw new Error('Missing takeover button')
	expect(button.disabled).toBe(true)
	const fields = Array.from(view.container.querySelectorAll('input'))
	for (const [offset, value] of ['2', '10', '20', '200', '100'].entries()) await fill(fields[offset], value)
	await waitFor(() => expect(button.disabled).toBe(false))
	await act(() => {
		button.click()
	})
	const request = requests[0]
	if (request === undefined) throw new Error('Missing takeover transaction')
	const decoded = decodeFunctionData({ abi: capitalArtifact.abi, data: request.data })
	expect(decoded.functionName).toBe('takeOverWithBounds')
	if (decoded.functionName !== 'takeOverWithBounds') throw new Error('Wrong takeover entry point')
	expect(decoded.args).toEqual([2n, 10n * unit, 0n, 20n * unit, { maximumOwnerPrincipal: 200n * unit, maximumOwnerCommitment: 100n * unit, expectedTargetHealthFactorBps: snapshot.ownerAccount.targetHealthFactorBps, expectedAcceptedPriceEpoch: 4n, expectedSourceBatch: 0n }])
	await request.validateBeforeSubmit?.()
	reader.setRead('acceptedPriceEpoch', 5n, capital)
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('changed')
	reader.setRead('liquidationStarted', 0n, capital)
	await fill(fields[0], '3')
	await waitFor(() => expect(view.container.textContent).toContain('Not started'))
	expect(button.disabled).toBe(true)
})

test('a position that unused pool commitment restores is offered as an unpaid cure, never as a paid takeover', async () => {
	// Half of the pool commitment is unused, which covers this position's deficit.
	const snapshot = capitalSnapshot({ totalCommitmentAttoEth: 20n * unit, demandAttoEth: 10n * unit })
	const reader = capitalClient(snapshot)
	reader.setRead('accountOf', { owner: getAddress('0x0000000000000000000000000000000000000099'), batch: 0n, rep: 15n * unit, commitment: 10n * unit, maxHealthyPrice: unit, releasedRep: 0n, ethFees: 0n, repFees: 0n, remainingCommitment: 0n }, index)
	reader.setRead('liquidationStarted', 1n, capital)
	reader.setRead('acceptedPriceEpoch', 4n, capital)
	reader.setRead('liquidationPenaltyPaid', 0n, capital)
	reader.setRead('liquidationElapsed', 0n, capital)
	reader.install()
	const requests: SecurityPoolTransaction[] = []
	const actions = {
		ownerReason: undefined,
		scope: [],
		busy: undefined,
		runSecurityPoolAction: async (_action: string, _label: string, build: () => SecurityPoolTransaction | Promise<SecurityPoolTransaction>) => {
			requests.push(await build())
		},
	}
	const view = await renderIntoDocument(<SecurityPoolTakeover model={{ snapshot }} actions={actions} />)
	lifecycle.trackRendered(view)
	const [takeOverButton, cureButton] = Array.from(view.container.querySelectorAll('button'))
	if (takeOverButton === undefined || cureButton === undefined) throw new Error('Missing takeover or cure button')
	expect(cureButton.disabled).toBe(true)
	const fields = view.container.querySelectorAll('input')
	// Every takeover bound is filled in, the takeover still stays unavailable.
	for (const [offset, value] of ['2', '10', '20', '200', '100'].entries()) {
		const field = fields[offset]
		if (field === undefined) throw new Error('Missing takeover field')
		await act(() => {
			field.value = value
			field.dispatchEvent(new Event('input', { bubbles: true }))
		})
	}
	await waitFor(() => expect(cureButton.disabled).toBe(false))
	expect(takeOverButton.disabled).toBe(true)
	expect(view.container.textContent).toContain('Free capacity can restore this position. Curing it pays no takeover reward.')
	await act(() => {
		cureButton.click()
	})
	const request = requests[0]
	if (request === undefined) throw new Error('Missing cure transaction')
	const decoded = decodeFunctionData({ abi: capitalArtifact.abi, data: request.data })
	if (decoded.functionName !== 'takeOverWithBounds') throw new Error('Wrong cure entry point')
	// No takeover reward is requested, and zero consent keeps the call from acquiring anything if the cure stops being enough.
	expect(decoded.args).toEqual([2n, 10n * unit, 0n, 0n, { maximumOwnerPrincipal: 0n, maximumOwnerCommitment: 0n, expectedTargetHealthFactorBps: 10_000n, expectedAcceptedPriceEpoch: 4n, expectedSourceBatch: 0n }])
	await request.validateBeforeSubmit?.()
	reader.setRead('acceptedPriceEpoch', 5n, capital)
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('changed')
})

test('#1570 a partial takeover that would leave the source between the two prices stays disabled', async () => {
	// Position 2 backs 10 with 15 REP: about 6.49 at the conservative 2.2 and 8.93 at the liquidation 1.6.
	const snapshot = { ...capitalSnapshot({ totalCommitmentAttoEth: 20n * unit, demandAttoEth: 20n * unit }), conservativePrice: (22n * unit) / 10n, liquidationPrice: (16n * unit) / 10n }
	snapshot.ownerPrincipalAttoRep = 40n * unit
	snapshot.positions = snapshot.positions.map(position => ({ ...position, rep: 40n * unit }))
	installTakeoverReader(snapshot)
	const view = await renderTakeover(snapshot, idleActions)
	const button = view.container.querySelector('button')
	if (button === null) throw new Error('Missing takeover button')
	const fields = Array.from(view.container.querySelectorAll('input'))
	for (const [offset, value] of ['2', '2', '20', '200', '100'].entries()) await fill(fields[offset], value)
	await waitFor(() => expect(view.container.textContent).toContain('Take over the full repair, or little enough that the position stays below the liquidation price.'))
	expect(button.disabled).toBe(true)
	await fill(fields[1], '1')
	await waitFor(() => expect(button.disabled).toBe(false))
	await fill(fields[1], '10')
	await waitFor(() => expect(button.disabled).toBe(false))
})

test('a position the unused commitment cannot restore keeps the takeover and disables the cure', async () => {
	const snapshot = capitalSnapshot({ totalCommitmentAttoEth: 20n * unit, demandAttoEth: 20n * unit })
	const reader = capitalClient(snapshot)
	reader.setRead('accountOf', { owner: getAddress('0x0000000000000000000000000000000000000099'), batch: 0n, rep: 15n * unit, commitment: 10n * unit, maxHealthyPrice: unit, releasedRep: 0n, ethFees: 0n, repFees: 0n, remainingCommitment: 0n }, index)
	reader.setRead('liquidationStarted', 1n, capital)
	reader.setRead('acceptedPriceEpoch', 4n, capital)
	reader.setRead('liquidationPenaltyPaid', 0n, capital)
	reader.setRead('liquidationElapsed', 0n, capital)
	reader.install()
	const actions = { ownerReason: undefined, scope: [], busy: undefined, runSecurityPoolAction: async () => undefined }
	const view = await renderIntoDocument(<SecurityPoolTakeover model={{ snapshot }} actions={actions} />)
	lifecycle.trackRendered(view)
	const field = view.container.querySelector('input')
	if (field === null) throw new Error('Missing takeover target field')
	await act(() => {
		field.value = '2'
		field.dispatchEvent(new Event('input', { bubbles: true }))
	})
	await waitFor(() => expect(view.container.textContent).toContain('There is too little free capacity to cure this position.'))
	expect(view.container.querySelectorAll('button')[1]?.disabled).toBe(true)
})

test('entering another target clears the bounds typed for the previous position but a new block keeps them', async () => {
	const snapshot = capitalSnapshot({ totalCommitmentAttoEth: 20n * unit, demandAttoEth: 20n * unit })
	snapshot.ownerPrincipalAttoRep = 40n * unit
	snapshot.positions = snapshot.positions.map(position => ({ ...position, rep: 40n * unit }))
	installTakeoverReader(snapshot)
	const view = await renderTakeover(snapshot, idleActions)
	const button = view.container.querySelector('button')
	if (button === null) throw new Error('Missing takeover button')
	const fields = Array.from(view.container.querySelectorAll('input'))
	for (const [offset, value] of ['2', '10', '20', '200', '100'].entries()) await fill(fields[offset], value)
	await waitFor(() => expect(button.disabled).toBe(false))
	await act(() => {
		render(<SecurityPoolTakeover model={{ snapshot: { ...snapshot, blockHash: `0x${'ab'.repeat(32)}` } }} actions={idleActions} />, view.container)
	})
	expect(fields.slice(1).map(field => field.value)).toEqual(['10', '20', '200', '100'])
	await fill(fields[0], '3')
	await waitFor(() => expect(fields.slice(1).map(field => field.value)).toEqual(['', '', '', '']))
	await waitFor(() => expect(button.disabled).toBe(true))
	for (const [offset, value] of ['10', '20', '200', '100'].entries()) await fill(fields[offset + 1], value)
	await act(() => {
		render(<SecurityPoolTakeover model={{ snapshot: { ...snapshot, capitalLedger: getAddress('0x0000000000000000000000000000000000000abc') } }} actions={idleActions} />, view.container)
	})
	await waitFor(() => expect(fields.slice(1).map(field => field.value)).toEqual(['', '', '', '']))
	expect(fields[0]?.value).toBe('3')
})

test('bounds outlive a snapshot reload and a first target, and clear when an ID is retyped as another', async () => {
	const snapshot = capitalSnapshot({ totalCommitmentAttoEth: 20n * unit, demandAttoEth: 20n * unit })
	installTakeoverReader(snapshot)
	const view = await renderTakeover(snapshot, idleActions)
	const fields = Array.from(view.container.querySelectorAll('input'))
	const bounds = () => fields.slice(1).map(field => field.value)
	const typed = ['10', '20', '200', '100']
	for (const [offset, value] of typed.entries()) await fill(fields[offset + 1], value)
	await fill(fields[0], '5')
	expect(bounds()).toEqual(typed)
	await act(() => {
		render(<SecurityPoolTakeover model={{ snapshot: undefined }} actions={idleActions} />, view.container)
	})
	await act(() => {
		render(<SecurityPoolTakeover model={{ snapshot }} actions={idleActions} />, view.container)
	})
	expect(bounds()).toEqual(typed)
	await fill(fields[0], '')
	expect(bounds()).toEqual(typed)
	await fill(fields[0], '6')
	await waitFor(() => expect(bounds()).toEqual(['', '', '', '']))
})

test('a forked universe cannot take over at all', async () => {
	const snapshot = capitalSnapshot({ priceValid: false, forkTime: 1n })
	installTakeoverReader(snapshot)
	const view = await renderTakeover(snapshot, idleActions)
	await fill(view.container.querySelector('input') ?? undefined, '2')
	await waitFor(() => expect(view.container.textContent).toContain('Takeovers require an active universe.'))
	expect(view.container.querySelector('button')?.disabled).toBe(true)
})

test('a disabled reason both actions share renders once and describes both buttons', async () => {
	const snapshot = capitalSnapshot()
	capitalClient(snapshot).install()
	const actions = { ownerReason: undefined, scope: [], busy: undefined, runSecurityPoolAction: async () => undefined }
	const view = await renderIntoDocument(<SecurityPoolTakeover model={{ snapshot }} actions={actions} />)
	lifecycle.trackRendered(view)
	const reason = 'Enter a positive position ID.'
	expect(view.container.textContent?.split(reason)).toHaveLength(2)
	const described = [...view.container.querySelectorAll('button')].map(button => button.getAttribute('aria-describedby'))
	expect(described).toHaveLength(2)
	expect(described[0]).toBeTruthy()
	expect(described[1]).toBe(described[0])
})

test.each([
	['cohort', 'Your position and the target have different commitment reduction queues.'],
	['consent', 'Your idle REP exceeds the maximum own REP you consented to pledge.'],
	['collateral', 'Deposit more REP before taking over this commitment.'],
	['principal', 'The resulting pledged REP exceeds your limit.'],
	['commitment', 'Your resulting commitment exceeds the maximum total commitment.'],
] as const)('blocks an ineligible takeover receiver: %s', async (condition, reason) => {
	const base = capitalSnapshot({ totalCommitmentAttoEth: 20n * unit, demandAttoEth: 20n * unit })
	const snapshot = {
		...base,
		ownerPrincipalAttoRep: { collateral: 1n, consent: 45n, cohort: 40n, principal: 40n, commitment: 40n }[condition] * unit,
		ownerAccount: { ...base.ownerAccount, freeAttoRep: condition === 'consent' ? 5n * unit : 0n },
		positions: base.positions.map(position => ({ ...position, rep: (condition === 'collateral' ? 1n : 40n) * unit, batch: condition === 'cohort' ? 2n : 0n })),
	}
	installTakeoverReader(snapshot)
	const view = await renderTakeover(snapshot, idleActions)
	const fields = [...view.container.querySelectorAll('input')]
	for (const [index, value] of ['2', '10', condition === 'consent' ? '4' : '20', condition === 'principal' ? '39' : '200', condition === 'commitment' ? '12' : '100'].entries()) await fill(fields[index], value)
	await waitFor(() => expect(view.container.textContent).toContain(reason))
	expect(view.container.querySelector('button')?.disabled).toBe(true)
})
