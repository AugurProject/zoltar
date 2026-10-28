import { expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { createProductionBrowserActions } from './productionBrowserActions.ts'

test('a button disabled after readiness is retried and clicked exactly once after it recovers', async () => {
	const browser = new Window()
	try {
		const button = browser.document.createElement('button')
		button.textContent = 'Max'
		browser.document.body.append(button)
		let clicks = 0
		let elapsed = 0
		let attempts = 0
		button.addEventListener('click', () => {
			clicks += 1
		})
		expect(button.disabled).toBe(false)
		// A state refresh can disable the button between readiness and the action.
		button.disabled = true
		const driver = createProductionBrowserActions({
			evaluate: async expression => {
				attempts += 1
				return browser.eval(expression)
			},
			readBody: async () => browser.document.body.innerText,
			now: () => elapsed,
			wait: async milliseconds => {
				elapsed += milliseconds
				if (elapsed >= 100) button.disabled = false
			},
		})
		await driver.clickButton('Max')
		expect(clicks).toBe(1)
		expect(attempts).toBe(3)
		expect(elapsed).toBe(100)
	} finally {
		await browser.happyDOM.close()
	}
})

test('an unavailable button expires within the action budget with the current page state', async () => {
	const browser = new Window()
	try {
		browser.document.body.innerHTML = '<button disabled>Max</button><p>Loading reporting balances</p>'
		let elapsed = 0
		let attempts = 0
		const driver = createProductionBrowserActions({
			evaluate: async expression => {
				attempts += 1
				return browser.eval(expression)
			},
			readBody: async () => browser.document.body.innerText,
			timeoutMilliseconds: 125,
			now: () => elapsed,
			wait: async milliseconds => {
				elapsed += milliseconds
			},
		})
		await expect(driver.clickButton('Max')).rejects.toThrow('Loading reporting balances')
		expect(attempts).toBe(3)
		expect(elapsed).toBe(125)
	} finally {
		await browser.happyDOM.close()
	}
})

test('a synchronous focus handler that disables a button does not count as a successful click', async () => {
	const browser = new Window()
	try {
		const button = browser.document.createElement('button')
		button.textContent = 'Max'
		browser.document.body.append(button)
		let clicks = 0
		let elapsed = 0
		button.addEventListener(
			'focus',
			() => {
				button.disabled = true
			},
			{ once: true },
		)
		button.addEventListener('click', () => {
			clicks += 1
		})
		const driver = createProductionBrowserActions({
			evaluate: async expression => browser.eval(expression),
			readBody: async () => browser.document.body.innerText,
			now: () => elapsed,
			wait: async milliseconds => {
				elapsed += milliseconds
				button.disabled = false
			},
		})
		await driver.clickButton('Max')
		expect(clicks).toBe(1)
		expect(elapsed).toBe(50)
	} finally {
		await browser.happyDOM.close()
	}
})

test('button actions retain accessible names and select the requested enabled occurrence', async () => {
	const browser = new Window()
	try {
		browser.document.body.innerHTML = '<button disabled>Max</button><button>Max<span aria-hidden="true">→</span></button><button aria-label="Max">Other</button>'
		const clicked: number[] = []
		for (const [index, button] of browser.document.querySelectorAll('button').entries())
			button.addEventListener('click', () => {
				clicked.push(index)
			})
		const driver = createProductionBrowserActions({ evaluate: async expression => browser.eval(expression), readBody: async () => browser.document.body.innerText })
		await driver.clickButton('Max', 1)
		expect(clicked).toEqual([2])
	} finally {
		await browser.happyDOM.close()
	}
})
