/// <reference types="bun-types" />

import { expect, test } from 'bun:test'
import { readCoreSharedCssSource } from '@zoltar/ui-core-shared/tests/testUtils/coreSharedCss.js'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { getChromiumPath, withChromiumTestLock } from '../../../../../coreShared/build/chromiumPath.js'

type GaugeFitResult = {
	clientWidth: number
	ringLeft: number
	ringRight: number
	scrollWidth: number
	text: string
	valueLeft: number
	valueRight: number
}

function isGaugeFitResult(value: unknown): value is GaugeFitResult {
	if (typeof value !== 'object' || value === null) return false
	const result = value as Partial<Record<keyof GaugeFitResult, unknown>>
	return typeof result.clientWidth === 'number' && typeof result.ringLeft === 'number' && typeof result.ringRight === 'number' && typeof result.scrollWidth === 'number' && typeof result.text === 'string' && typeof result.valueLeft === 'number' && typeof result.valueRight === 'number'
}

const chromiumPath = getChromiumPath()
const browserFitTest = chromiumPath === undefined ? test.skip : test
const CHROMIUM_GAUGE_FIT_TIMEOUT_MS = 60_000

browserFitTest(
	'renders the largest displayed collateralization label without clipping in the smallest ring',
	async () =>
		await withChromiumTestLock(async () => {
			if (chromiumPath === undefined) throw new Error('Chromium is required for the browser fit test')
			const temporaryDirectory = mkdtempSync(join(tmpdir(), 'zoltar#collateralization-circle-'))
			try {
				const tokensSource = readFileSync('ui/coreShared/css/tokens.css', 'utf8')
				const cssSource = readCoreSharedCssSource()
				const htmlPath = join(temporaryDirectory, 'gauge-fit.html')
				writeFileSync(
					htmlPath,
					`<!doctype html>
<html>
<head>
	<meta charset='utf-8'>
	<style>${tokensSource}\n${cssSource}</style>
</head>
<body>
	<div class='collateralization-gauge collateralization-gauge-size-small tone-success'>
		<span class='collateralization-gauge-ring'>
			<svg class='collateralization-gauge-svg' viewBox='0 0 100 100' aria-hidden='true'>
				<circle class='collateralization-gauge-track' cx='50' cy='50' r='36.8'></circle>
				<circle class='collateralization-gauge-progress' cx='50' cy='50' r='36.8'></circle>
			</svg>
		</span>
		<strong class='collateralization-gauge-value'>>999%</strong>
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

				const browser = Bun.spawn([chromiumPath, '--headless', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--dump-dom', pathToFileURL(htmlPath).href], { stderr: 'pipe', stdout: 'pipe', windowsHide: true })
				let timedOut = false
				const timeoutId = setTimeout(() => {
					timedOut = true
					browser.kill()
				}, CHROMIUM_GAUGE_FIT_TIMEOUT_MS)
				const [exitCode, browserStderr, browserStdout] = await Promise.all([browser.exited, new Response(browser.stderr).text(), new Response(browser.stdout).text()])
				clearTimeout(timeoutId)
				if (timedOut) throw new Error(`Chromium gauge fit process timed out after ${CHROMIUM_GAUGE_FIT_TIMEOUT_MS.toString()}ms`)
				if (exitCode !== 0) throw new Error(`Chromium gauge fit process exited with status ${exitCode.toString()}: ${browserStderr}`)
				const resultMatch = browserStdout.match(/<pre id="fit-result">([^<]+)<\/pre>/)
				expect(resultMatch).not.toBeNull()
				const resultText = resultMatch?.[1]
				if (resultText === undefined) throw new Error('Chromium did not return gauge fit measurements')
				const parsedResult: unknown = JSON.parse(resultText)
				if (!isGaugeFitResult(parsedResult)) throw new Error(`Unexpected gauge fit result: ${resultText}`)

				expect(parsedResult.text).toBe('&gt;999%')
				expect(parsedResult.scrollWidth).toBeLessThanOrEqual(parsedResult.clientWidth)
				expect(parsedResult.valueLeft).toBeGreaterThanOrEqual(parsedResult.ringLeft)
				expect(parsedResult.valueRight).toBeLessThanOrEqual(parsedResult.ringRight)
			} finally {
				rmSync(temporaryDirectory, { recursive: true, force: true })
			}
		}),
)
