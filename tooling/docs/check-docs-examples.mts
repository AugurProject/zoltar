import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { checkEscalationResponseExamples, checkMmrConformanceVector } from './check-docs-worked-examples.mts'
import { Window } from 'happy-dom'
import { computeCanonicalEscalationBindingCapital, computeCanonicalEscalationDeadlineDays, calculateEscalationDepositModel, calculateForkThresholdSeries, calculateResolutionModel, ESCALATION_TIME_LENGTH_SECONDS } from '../../docs/charts/chartModels'
import { getWinningEscalationDepositClaimAmount } from '../../shared/statoblast/ts/escalationGame/escalationMath'
import { centeredDiagramScrollLeft, updateDiagramControl } from '../../docs/charts/diagramControl'

async function checkMmrProofPlannerStates(): Promise<void> {
	const html = await readFile('docs/reference/merkle-mountain-range.html', 'utf8')
	const source = await readFile('docs/assets/js/mmrProofPlanner.js', 'utf8')
	const window = new Window({
		url: 'https://docs.example/merkle-mountain-range.html',
	})
	try {
		window.document.write(html)
		window.document.close()
		const runScript = new Function('document', 'HTMLDetailsElement', 'HTMLInputElement', 'HTMLOutputElement', 'HTMLSelectElement', source)
		runScript(window.document, window.HTMLDetailsElement, window.HTMLInputElement, window.HTMLOutputElement, window.HTMLSelectElement)

		const planner = window.document.querySelector('#mmr-proof-planner')
		const leafCount = planner?.querySelector('[data-tool-input="leafCount"]')
		const peakHeight = planner?.querySelector('[data-tool-input="peakHeight"]')
		const leafIndex = planner?.querySelector('[data-tool-input="leafIndex"]')
		if (!(planner instanceof window.HTMLDetailsElement) || !(leafCount instanceof window.HTMLInputElement) || !(peakHeight instanceof window.HTMLSelectElement) || !(leafIndex instanceof window.HTMLInputElement)) {
			throw new Error('MMR proof planner test controls are incomplete')
		}
		const output = (name: string) => {
			const element = planner.querySelector(`[data-mmr-output="${name}"]`)
			if (!(element instanceof window.HTMLOutputElement)) throw new Error(`Missing MMR planner output: ${name}`)
			return element.value
		}
		const meter = (name: string) => {
			const card = planner.querySelector(`[data-mmr-output="${name}"]`)?.parentElement
			if (!(card instanceof window.HTMLElement)) throw new Error(`Missing MMR planner meter: ${name}`)
			return card
		}
		const setInput = (input: typeof leafCount | typeof leafIndex, value: string) => {
			input.value = value
			input.dispatchEvent(new window.Event('input', { bubbles: true }))
		}
		const selectPeak = (height: number) => {
			peakHeight.value = String(height)
			peakHeight.dispatchEvent(new window.Event('change', { bubbles: true }))
		}

		assert.deepEqual(
			{
				binary: output('binary'),
				capacity: output('capacity'),
				mmrSiblings: output('mmrSiblings'),
				nullifierSiblings: output('nullifierSiblings'),
				peaks: output('peaks'),
				selection: output('selection'),
			},
			{
				binary: '1101₂',
				capacity: '4 leaves; leafIndex 8…11',
				mmrSiblings: '4',
				nullifierSiblings: '64',
				peaks: '0, 2, 3',
				selection: 'Valid in-peak offset',
			},
			'MMR planner runtime defaults must match the static fallback',
		)

		setInput(leafCount, '1')
		setInput(leafIndex, '0')
		assert.deepEqual(
			{
				mmrSiblings: output('mmrSiblings'),
				options: Array.from(peakHeight.options, option => option.value),
				peaks: output('peaks'),
				selection: output('selection'),
			},
			{
				mmrSiblings: '0',
				options: ['0'],
				peaks: '0',
				selection: 'Valid in-peak offset',
			},
			'a one-leaf MMR must have one height-zero peak and no sibling hashes',
		)
		setInput(leafIndex, '1')
		assert.equal(leafIndex.value, '1', 'MMR test harness must update the local leaf index')
		assert.equal(output('selection'), 'Offset must be between 0 and 0', 'a local index equal to peak capacity must be rejected')

		setInput(leafCount, '21')
		selectPeak(4)
		setInput(leafIndex, '15')
		assert.deepEqual(
			{
				mmrSiblings: output('mmrSiblings'),
				options: Array.from(peakHeight.options, option => option.value),
				peaks: output('peaks'),
				selection: output('selection'),
			},
			{
				mmrSiblings: '6',
				options: ['0', '2', '4'],
				peaks: '0, 2, 4',
				selection: 'Valid in-peak offset',
			},
			'a 21-leaf MMR must expose the height-four peak and six total MMR siblings',
		)
		setInput(leafIndex, '16')
		assert.equal(output('selection'), 'Offset must be between 0 and 15', 'the height-four capacity equality boundary must be rejected')

		setInput(leafCount, String((1n << 64n) - 1n))
		selectPeak(63)
		setInput(leafIndex, String((1n << 63n) - 1n))
		assert.equal(peakHeight.options.length, 64, 'the maximum uint64 leaf count must occupy all 64 peaks')
		assert.equal(output('mmrSiblings'), '126', 'the maximum uint64 leaf count at height 63 must require 126 MMR siblings')
		assert.equal(output('peaks'), '0–63', 'consecutive occupied peak heights must stay compact at the uint64 maximum')
		assert.equal(output('selection'), 'Valid in-peak offset', 'the maximum local index below a height-63 peak capacity must be valid')
		assert.equal(peakHeight.classList.contains('visually-hidden-control'), false, 'large occupied-peak sets must use the compact native select')
		assert.equal(peakHeight.tabIndex, 0, 'the large occupied-peak select must remain keyboard accessible')
		assert.equal(window.document.querySelectorAll('.peak-choice-control button').length, 0, 'large occupied-peak sets must not render a button for every height')
		assert.equal(meter('mmrSiblings').style.getPropertyValue('--widget-meter'), '100%', 'the longer 126-sibling MMR proof must fill its comparison meter')
		assert.ok(Math.abs(Number.parseFloat(meter('nullifierSiblings').style.getPropertyValue('--widget-meter')) - (64 / 126) * 100) < 1e-9, 'the fixed 64-sibling nullifier proof must stay proportional to a longer MMR proof')

		for (const invalidLeafCount of ['0', String(1n << 64n)]) {
			setInput(leafCount, invalidLeafCount)
			assert.equal(output('binary'), '—', `${invalidLeafCount} must mark calculated output unavailable without repeating the validation message`)
			assert.equal(output('selection'), '—', `${invalidLeafCount} must clear the prior selection result`)
			assert.equal(output('nullifierSiblings'), '64', 'invalid MMR input must not change the protocol-fixed nullifier depth')
			assert.equal(meter('mmrSiblings').style.getPropertyValue('--widget-meter'), '', `${invalidLeafCount} must clear the stale MMR proof meter`)
			assert.equal(meter('nullifierSiblings').style.getPropertyValue('--widget-meter'), '', `${invalidLeafCount} must clear the comparison meter when the MMR proof is unavailable`)
			assert.equal(leafCount.getAttribute('aria-invalid'), 'true', `${invalidLeafCount} must expose the invalid leaf-count state`)
			assert.equal(peakHeight.disabled, true, `${invalidLeafCount} must disable the occupied-peak selector`)
			assert.equal(peakHeight.options.length, 64, `${invalidLeafCount} must retain the dependent peak choices for layout stability`)
			assert.equal(
				Array.from(window.document.querySelectorAll('.peak-choice-control button')).every(button => button instanceof window.HTMLButtonElement && button.disabled),
				true,
				`${invalidLeafCount} must visibly disable every dependent peak choice`,
			)
		}
		setInput(leafCount, '13')
		assert.equal(leafCount.getAttribute('aria-invalid'), null, 'a valid leaf count must clear the invalid state')
		assert.equal(peakHeight.disabled, false, 'a valid leaf count must re-enable occupied-peak selection')
		assert.deepEqual(
			Array.from(peakHeight.options, option => option.value),
			['0', '2', '3'],
			'a valid leaf count must restore only its occupied peaks after invalid input',
		)
		setInput(leafIndex, '0')
		assert.equal(output('selection'), 'Valid in-peak offset', 'MMR planning must recover after invalid leaf-count input')
	} finally {
		window.close()
	}
}

function checkDiagramControlStates(): void {
	const window = new Window()
	try {
		assert.equal(centeredDiagramScrollLeft(330, 1120), 395, 'wide diagrams must open at their horizontal center')
		assert.equal(centeredDiagramScrollLeft(1120, 1120), 0, 'fitted diagrams must keep their initial horizontal position')
		assert.equal(centeredDiagramScrollLeft(1120, 900), 0, 'narrow diagrams must not produce a negative scroll position')
		const button = window.document.createElement('button')
		const cue = window.document.createElement('span')
		button.setAttribute('aria-pressed', 'true')

		updateDiagramControl(button, cue, true)
		assert.equal(button.textContent, 'Exit full screen', 'expanded mode must name the action that returns to the document')
		assert.equal(button.getAttribute('aria-pressed'), null, 'an action-labeled diagram control must not announce a contradictory pressed state')
		assert.equal(button.getAttribute('aria-expanded'), 'true', 'expanded mode must expose its relationship to the full-screen diagram')
		assert.equal(button.getAttribute('aria-label'), 'Exit full-screen diagram', 'expanded mode must expose a complete accessible action name')
		assert.equal(button.getAttribute('title'), 'Exit full-screen diagram', 'expanded mode must expose its action on hover')
		assert.equal(cue.textContent, 'Scroll to inspect detailed labels. Press Escape to close.', 'expanded mode must explain diagram inspection and keyboard exit')

		updateDiagramControl(button, cue, false)
		assert.equal(button.textContent, 'Full screen', 'document mode must keep the visible action concise')
		assert.equal(button.getAttribute('aria-pressed'), null, 'document mode must remain an action button rather than a stateful toggle')
		assert.equal(button.getAttribute('aria-expanded'), 'false', 'document mode must expose that the full-screen diagram is closed')
		assert.equal(button.getAttribute('aria-label'), 'View diagram full screen', 'document mode must expose a complete accessible action name')
		assert.equal(button.getAttribute('title'), 'View diagram full screen', 'document mode must expose its action on hover')
		assert.equal(cue.textContent, 'Use full screen to inspect detailed labels.', 'document mode must explain the available detail control')
	} finally {
		window.close()
	}
}

function blockWithId(html: string, id: string): string {
	const start = html.indexOf(`id="${id}"`)
	assert.notEqual(start, -1, `Missing documentation block #${id}`)
	const end = html.indexOf('</div>', start)
	assert.notEqual(end, -1, `Documentation block #${id} has no closing div`)
	return html.slice(start, end)
}

await checkMmrProofPlannerStates()
await checkMmrConformanceVector()
checkDiagramControlStates()

const openOracleHtml = await readFile('docs/reference/open-oracle.html', 'utf8')
assert.doesNotMatch(blockWithId(openOracleHtml, 'eq-openoracle-initial-report-size'), /<mi>(?:R|P|e|E|Q|N|D|T|H|m|u|F)<\/mi>/, 'dynamic report equation should use descriptive domain names instead of one-letter identifiers')

const chartRuntimeSource = await readFile('docs/charts/chartRuntime.ts', 'utf8')
assert.doesNotMatch(chartRuntimeSource, /normalizedEscalationCost|escalationCostChart|requiredRepFraction/i, 'escalation chart runtime should use cumulative binding-capital terminology')
assert.match(chartRuntimeSource, /ESCALATION_ACTIVATION_DELAY_DAYS \+ ESCALATION_TIME_LENGTH_DAYS \+ 1/, 'escalation Plot should sample every day from game start through day 52')
assert.match(chartRuntimeSource, /ticks: spec\.width < 720 \? \[0, 52\] : \[0, 3, 52\]/, 'whitepaper escalation Plot should preserve all milestone ticks on wide screens without colliding day 0 and day 3 on narrow screens')
assert.equal(computeCanonicalEscalationBindingCapital(1, 10, 3), 1, 'canonical escalation fixture should start at the configured start bond on activation')
assert.equal(computeCanonicalEscalationBindingCapital(1, 10, 52), 10, 'canonical escalation fixture should end at the configured threshold after seven weeks')
const oneThirdPowerOfTwoTimeDays = Number.parseInt((ESCALATION_TIME_LENGTH_SECONDS / 3n).toString(), 10) / 86_400
assert.equal(computeCanonicalEscalationBindingCapital(1, 8, 3 + oneThirdPowerOfTwoTimeDays), 2, 'canonical escalation fixture should match the contract one-third-time power-of-two ratio')
assert.equal(computeCanonicalEscalationDeadlineDays(1, 8, 2), 3 + oneThirdPowerOfTwoTimeDays + 2 / 86_400, 'canonical deadline includes the two-second forward-curve plateau at 2 REP')
const payoutFixture = 10n ** 18n
assert.equal(
	getWinningEscalationDepositClaimAmount({
		bindingCapitalAttoRep: 10n * payoutFixture,
		cumulativeAmountAttoRep: 15n * payoutFixture,
		depositAmountAttoRep: 5n * payoutFixture,
		forkThresholdAttoRep: 10n * payoutFixture,
		nonDecisionThresholdAttoRep: 10n * payoutFixture,
		winningOutcomeBalanceAttoRep: 15n * payoutFixture,
	}),
	7n * payoutFixture,
	'published payout example should match the shared contract fixture for principal plus escalation reward',
)
assert.equal(
	getWinningEscalationDepositClaimAmount({
		bindingCapitalAttoRep: 10n * payoutFixture,
		cumulativeAmountAttoRep: 20n * payoutFixture,
		depositAmountAttoRep: 5n * payoutFixture,
		forkThresholdAttoRep: 8n * payoutFixture,
		nonDecisionThresholdAttoRep: 10n * payoutFixture,
		winningOutcomeBalanceAttoRep: 20n * payoutFixture,
	}),
	4n * payoutFixture,
	'fork scaling should reduce even an above-cap principal-only withdrawal',
)
const forkThresholdSeries = calculateForkThresholdSeries(21)
assert.equal(forkThresholdSeries.length, 21, 'fork-threshold Plot should include genesis plus twenty descendants')
assert.deepEqual(forkThresholdSeries[0], { forkThresholdRep: 5, generation: 0, theoreticalSupply: 100 }, 'fork-threshold Plot should begin from the genesis theoretical supply and five-percent threshold')
assert.ok((forkThresholdSeries[20]?.theoreticalSupply ?? 0) < (forkThresholdSeries[19]?.theoreticalSupply ?? 0), 'fork-threshold Plot should decay monotonically by generation')
assert.equal(forkThresholdSeries[20]?.forkThresholdRep, (forkThresholdSeries[20]?.theoreticalSupply ?? 0) / 20, 'fork-threshold Plot should keep the threshold at five percent of theoretical supply')
const clippedDeposit = calculateEscalationDepositModel({
	invalidBalance: 1,
	noBalance: 7,
	nonDecisionThreshold: 10,
	proposedDeposit: 5,
	repeatDeposit: true,
	startBond: 2,
	yesBalance: 9,
})
assert.equal(clippedDeposit.accepted, 3, 'deposit chart should clip accepted REP to remaining threshold room')
const tieAdjustedDeposit = calculateEscalationDepositModel({
	invalidBalance: 1,
	noBalance: 7,
	nonDecisionThreshold: 20,
	proposedDeposit: 2,
	repeatDeposit: true,
	startBond: 1,
	yesBalance: 9,
})
assert.equal(tieAdjustedDeposit.acceptedAttoRep, 1_999_999_999_999_999_999n, 'deposit chart should preserve the one-attoREP tie adjustment')
assert.equal(tieAdjustedDeposit.noAfterAttoRep, 8_999_999_999_999_999_999n, 'deposit chart should preserve the tie-adjusted post-deposit balance')
const normalizedFirstDeposit = calculateEscalationDepositModel({
	invalidBalance: 0,
	noBalance: 0,
	nonDecisionThreshold: 5,
	proposedDeposit: 5,
	repeatDeposit: false,
	startBond: 10,
	yesBalance: 0,
})
assert.equal(normalizedFirstDeposit.effectiveStartBondAttoRep, 4_999_999_999_999_999_999n, 'first-deposit Plot should normalize an over-threshold configured bond down by one attoREP')
assert.equal(normalizedFirstDeposit.acceptedAttoRep, 5_000_000_000_000_000_000n, 'first-deposit Plot should accept a threshold-reaching deposit after bond normalization')
assert.equal(normalizedFirstDeposit.previewReverts, false, 'first-deposit Plot should not apply invalid stored-game parameter rules')
assert.equal(
	calculateEscalationDepositModel({
		invalidBalance: 10,
		noBalance: 0,
		nonDecisionThreshold: 10,
		proposedDeposit: 2,
		repeatDeposit: true,
		startBond: 2,
		yesBalance: 10,
	}).previewReverts,
	true,
	'repeat-deposit Plot should reject a game whose non-decision state was already reached',
)
checkEscalationResponseExamples()
assert.deepEqual(calculateResolutionModel({ invalidBalance: 4, noBalance: 7, runningCost: 5, yesBalance: 6 }), { atCost: 2, result: 'None' }, 'resolution chart should keep two outcomes at cost unresolved')
assert.deepEqual(calculateResolutionModel({ invalidBalance: 0, noBalance: 0, runningCost: 5, yesBalance: 0 }), { atCost: 0, result: 'Invalid' }, 'resolution chart should resolve an empty timed-out game to Invalid')
