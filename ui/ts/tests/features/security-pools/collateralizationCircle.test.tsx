/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from '../../testUtils/queries'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { CollateralizationCircle } from '../../../features/security-pools/components/CollateralizationCircle.js'
import { installDomEnvironment } from '../../testUtils/domEnvironment.js'
import { renderIntoDocument } from '../../testUtils/renderIntoDocument.js'

type GaugeFitResult = {
	clientWidth: number
	ringLeft: number
	ringRight: number
	scrollWidth: number
	text: string
	valueLeft: number
	valueRight: number
}

function getChromiumPath() {
	for (const commandName of ['chromium', 'chromium-browser', 'google-chrome']) {
		const result = spawnSync('sh', ['-lc', `command -v ${commandName}`], { encoding: 'utf8' })
		const commandPath = result.stdout.trim()
		if (result.status === 0 && commandPath !== '') return commandPath
	}
	return undefined
}

function isGaugeFitResult(value: unknown): value is GaugeFitResult {
	if (typeof value !== 'object' || value === null) return false
	const result = value as Partial<Record<keyof GaugeFitResult, unknown>>
	return typeof result.clientWidth === 'number' && typeof result.ringLeft === 'number' && typeof result.ringRight === 'number' && typeof result.scrollWidth === 'number' && typeof result.text === 'string' && typeof result.valueLeft === 'number' && typeof result.valueRight === 'number'
}

const chromiumPath = getChromiumPath()
const browserFitTest = chromiumPath === undefined ? test.skip : test

describe('CollateralizationCircle', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('renders the collateralization percentage inside the ring', async () => {
		const renderedComponent = await renderIntoDocument(<CollateralizationCircle collateralizationPercent={140n * 10n ** 18n} targetCollateralizationPercent={150n * 10n ** 18n} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const gauge = document.querySelector('.collateralization-gauge')
		const gaugeValue = documentQueries.getByText('140%')

		expect(gauge?.className).not.toContain('has-external-value')
		expect(gauge?.getAttribute('title')).toBe('Collateralization: 140%')
		expect(gaugeValue).not.toBeNull()
		expect(gaugeValue.className).toBe('collateralization-gauge-value')
	})

	test('caps oversized collateralization percentages inside the ring with an exact tooltip', async () => {
		const renderedComponent = await renderIntoDocument(<CollateralizationCircle collateralizationPercent={3667n * 10n ** 18n} targetCollateralizationPercent={150n * 10n ** 18n} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const gauge = document.querySelector('.collateralization-gauge')
		const gaugeValue = within(document.body).getByText('999%+')

		expect(gauge?.className).not.toContain('has-external-value')
		expect(gauge?.getAttribute('title')).toBe('Collateralization: 3 667%')
		expect(gaugeValue.className).toBe('collateralization-gauge-value')
	})

	test('keeps the largest displayed collateralization label inside the ring', async () => {
		const renderedComponent = await renderIntoDocument(<CollateralizationCircle collateralizationPercent={1000n * 10n ** 18n} targetCollateralizationPercent={150n * 10n ** 18n} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const gauge = document.querySelector('.collateralization-gauge')
		const gaugeValue = within(document.body).getByText('999%+')

		expect(gauge?.className).not.toContain('has-external-value')
		expect(gauge?.getAttribute('title')).toBe('Collateralization: 1 000%')
		expect(gaugeValue.className).toBe('collateralization-gauge-value')
		expect(gaugeValue.parentElement?.className).toContain('collateralization-gauge')
	})

	browserFitTest('renders the largest displayed collateralization label without clipping in the smallest ring', () => {
		if (chromiumPath === undefined) throw new Error('Chromium is required for the browser fit test')
		const temporaryDirectory = mkdtempSync(join(tmpdir(), 'zoltar-collateralization-circle-'))
		try {
			const cssSource = readFileSync('ui/css/index.css', 'utf8')
			const htmlPath = join(temporaryDirectory, 'gauge-fit.html')
			writeFileSync(
				htmlPath,
				`<!doctype html>
<html>
<head>
	<meta charset='utf-8'>
	<style>${cssSource}</style>
</head>
<body>
	<div class='collateralization-gauge collateralization-gauge-size-small tone-success'>
		<span class='collateralization-gauge-ring'>
			<svg class='collateralization-gauge-svg' viewBox='0 0 100 100' aria-hidden='true'>
				<circle class='collateralization-gauge-track' cx='50' cy='50' r='36.8'></circle>
				<circle class='collateralization-gauge-progress' cx='50' cy='50' r='36.8'></circle>
			</svg>
		</span>
		<strong class='collateralization-gauge-value'>999%+</strong>
		<span class='collateralization-gauge-label'>Collateralization</span>
	</div>
	<pre id='fit-result'></pre>
	<script>
		const ring = document.querySelector('.collateralization-gauge-ring')
		const value = document.querySelector('.collateralization-gauge-value')
		const ringRect = ring.getBoundingClientRect()
		const valueRect = value.getBoundingClientRect()
		document.getElementById('fit-result').textContent = JSON.stringify({
			clientWidth: value.clientWidth,
			ringLeft: ringRect.left,
			ringRight: ringRect.right,
			scrollWidth: value.scrollWidth,
			text: value.textContent,
			valueLeft: valueRect.left,
			valueRight: valueRect.right
		})
	</script>
</body>
</html>`,
			)

			const browserResult = spawnSync(chromiumPath, ['--headless', '--disable-gpu', '--no-sandbox', '--dump-dom', `file://${htmlPath}`], { encoding: 'utf8' })
			expect(browserResult.status).toBe(0)
			const resultMatch = browserResult.stdout.match(/<pre id="fit-result">([^<]+)<\/pre>/)
			expect(resultMatch).not.toBeNull()
			const resultText = resultMatch?.[1]
			if (resultText === undefined) throw new Error('Chromium did not return gauge fit measurements')
			const parsedResult: unknown = JSON.parse(resultText)
			if (!isGaugeFitResult(parsedResult)) throw new Error(`Unexpected gauge fit result: ${resultText}`)

			expect(parsedResult.text).toBe('999%+')
			expect(parsedResult.scrollWidth).toBeLessThanOrEqual(parsedResult.clientWidth)
			expect(parsedResult.valueLeft).toBeGreaterThanOrEqual(parsedResult.ringLeft)
			expect(parsedResult.valueRight).toBeLessThanOrEqual(parsedResult.ringRight)
		} finally {
			rmSync(temporaryDirectory, { recursive: true, force: true })
		}
	})

	test('applies tone-derived success coloring classes', async () => {
		const renderedComponent = await renderIntoDocument(<CollateralizationCircle collateralizationPercent={150n * 10n ** 18n} targetCollateralizationPercent={150n * 10n ** 18n} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const gauge = document.querySelector('.collateralization-gauge')
		expect(gauge?.className).toContain('tone-success')
	})
})
