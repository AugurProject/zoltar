import { mkdir } from 'node:fs/promises'
import { expect } from 'bun:test'
import { chromiumExecutable, startChromiumSession } from './chromium.ts'

export const activityHash = `0x${'78'.repeat(32)}`
export const walletAddress = `0x${'ab'.repeat(20)}`
export const explorerUrl = 'https://sepolia.etherscan.io'
export const explorerTransaction = (hash: string) => `${explorerUrl}/tx/${hash}`

export function state(overrides: Record<string, unknown>) {
	return {
		activities: [],
		evaluations: [],
		inventory: { rep: [] },
		obligations: [],
		paused: true,
		pendingTransactions: [],
		scheduler: { status: 'paused' },
		workflows: [],
		...overrides,
	}
}

export async function connectToChromium() {
	const session = await startChromiumSession(chromiumExecutable, { evaluationDefaults: { exceptions: 'ignore', intervalMilliseconds: 25 } })
	try {
		await session.send('Runtime.enable')
		await session.send('Page.enable')
		return { command: session.send, evaluate: session.evaluate, waitFor: session.waitFor, close: session.close, issues: session.issues }
	} catch (error) {
		await session.close()
		throw error
	}
}

type DashboardBrowser = Awaited<ReturnType<typeof connectToChromium>>

/** Reads the accessible name and role Chromium computes for the element matching `selector`. */
export async function readAccessibilityIdentity(cdp: DashboardBrowser, selector: string) {
	const documentResult = await cdp.command('DOM.getDocument', { depth: 0 })
	const rootNode = typeof documentResult === 'object' && documentResult !== null ? Reflect.get(documentResult, 'root') : undefined
	const rootNodeId = typeof rootNode === 'object' && rootNode !== null ? Reflect.get(rootNode, 'nodeId') : undefined
	if (typeof rootNodeId !== 'number') throw new Error('Chromium did not return the dashboard document node')
	const queryResult = await cdp.command('DOM.querySelector', { nodeId: rootNodeId, selector })
	const nodeId = typeof queryResult === 'object' && queryResult !== null ? Reflect.get(queryResult, 'nodeId') : undefined
	if (typeof nodeId !== 'number' || nodeId === 0) throw new Error(`Chromium did not find ${selector}`)
	const accessibilityResult = await cdp.command('Accessibility.getPartialAXTree', { fetchRelatives: false, nodeId })
	const nodes = typeof accessibilityResult === 'object' && accessibilityResult !== null ? Reflect.get(accessibilityResult, 'nodes') : undefined
	if (!Array.isArray(nodes) || nodes.length !== 1) throw new Error(`Chromium did not return one accessibility node for ${selector}`)
	const node = nodes[0]
	const name = typeof node === 'object' && node !== null ? Reflect.get(node, 'name') : undefined
	const role = typeof node === 'object' && node !== null ? Reflect.get(node, 'role') : undefined
	return {
		name: typeof name === 'object' && name !== null ? Reflect.get(name, 'value') : undefined,
		role: typeof role === 'object' && role !== null ? Reflect.get(role, 'value') : undefined,
	}
}

/** Asserts that every expected full identifier is visible, unclipped, and linked to its explorer page when one is expected. */
export async function expectVisibleIdentifiers(cdp: DashboardBrowser, expected: { explorerUrl?: string; type: string; value: string }[], minimumButtonHeight: number, selector = '.full-identifier') {
	const identifiers = await cdp.evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].flatMap(wrapper => {
		const bounds = wrapper.getBoundingClientRect()
		if (bounds.width === 0 || bounds.height === 0) return []
		const display = wrapper.querySelector('.identifier-value')
		const displayBounds = display?.getBoundingClientRect()
		const explorer = wrapper.querySelector('.identifier-explorer')
		const explorerBounds = explorer?.getBoundingClientRect()
		return [{
			display: display?.textContent,
			visible: (displayBounds?.width ?? 0) > 0 && (displayBounds?.height ?? 0) > 0,
			unclipped: display !== null && display.scrollWidth <= display.clientWidth,
			buttonCount: wrapper.querySelectorAll('button').length,
			explorerHeight: explorerBounds?.height,
			explorerHref: explorer?.getAttribute('href') ?? null,
			explorerName: explorer?.getAttribute('aria-label') ?? null,
			explorerRel: explorer?.getAttribute('rel') ?? null,
			explorerTarget: explorer?.getAttribute('target') ?? null,
			explorerText: explorer?.textContent ?? null,
			explorerTitle: explorer?.getAttribute('title') ?? null,
			explorerVisible: (explorerBounds?.width ?? 0) > 0 && (explorerBounds?.height ?? 0) > 0,
			right: bounds.right,
			type: wrapper.getAttribute('data-identifier-type'),
		}]
	})`)
	expect(identifiers).toHaveLength(expected.length)
	const viewportRight = await cdp.evaluate('document.documentElement.clientWidth + 1')
	if (typeof viewportRight !== 'number') throw new Error('Missing dashboard viewport width')
	for (const identifier of expected) {
		const rendered = Array.isArray(identifiers) ? identifiers.find(candidate => Reflect.get(candidate, 'type') === identifier.type && Reflect.get(candidate, 'display') === identifier.value) : undefined
		if (rendered === undefined) throw new Error(`Missing visible ${identifier.type}`)
		expect(Reflect.get(rendered, 'type')).toBe(identifier.type)
		expect(Reflect.get(rendered, 'display')).toBe(identifier.value)
		expect(Reflect.get(rendered, 'visible')).toBe(true)
		expect(Reflect.get(rendered, 'unclipped')).toBe(true)
		expect(Reflect.get(rendered, 'buttonCount')).toBe(0)
		if (identifier.explorerUrl === undefined) {
			expect(Reflect.get(rendered, 'explorerHref')).toBeNull()
		} else {
			expect(Reflect.get(rendered, 'explorerHref')).toBe(identifier.explorerUrl)
			expect(Reflect.get(rendered, 'explorerName')).toBe(`Open ${identifier.type} on ${new URL(identifier.explorerUrl).hostname}: ${identifier.value}`)
			expect(Reflect.get(rendered, 'explorerRel')).toBe('noreferrer')
			expect(Reflect.get(rendered, 'explorerTarget')).toBe('_blank')
			expect(Reflect.get(rendered, 'explorerText')).toBe('Explorer')
			expect(Reflect.get(rendered, 'explorerTitle')).toBe(`Open on ${new URL(identifier.explorerUrl).hostname}`)
			expect(Reflect.get(rendered, 'explorerVisible')).toBe(true)
			expect(Reflect.get(rendered, 'explorerHeight')).toBeGreaterThanOrEqual(minimumButtonHeight)
		}
		const right = Reflect.get(rendered, 'right')
		if (typeof right !== 'number') throw new Error(`Missing ${identifier.type} bounds`)
		expect(right).toBeLessThanOrEqual(viewportRight)
	}
	expect(await cdp.evaluate('document.body.scrollWidth === document.documentElement.clientWidth')).toBe(true)
	const screenshots = process.env['CHAOS_QA_SCREENSHOTS']
	if (screenshots !== undefined) {
		await mkdir(screenshots, { recursive: true })
		const targets = selector === '.full-identifier' ? ['[data-identifier-type="wallet address"]', '#current-workflow', '#activity-list'] : [selector]
		for (const [index, target] of targets.entries()) {
			await cdp.evaluate(`document.querySelector(${JSON.stringify(target)})?.scrollIntoView({ block: 'center' })`)
			const name = await cdp.evaluate(`location.pathname.slice(1) + '-' + innerWidth + '-' + ${JSON.stringify(selector.replace(/[^a-z0-9]/gi, '-'))}`)
			const capture = await cdp.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
			const data = typeof capture === 'object' && capture !== null ? Reflect.get(capture, 'data') : undefined
			if (typeof data !== 'string') throw new Error('Identifier screenshot unavailable')
			await Bun.write(`${screenshots}/${String(name)}-${index.toString()}.png`, Buffer.from(data, 'base64'))
		}
	}
	return identifiers
}
