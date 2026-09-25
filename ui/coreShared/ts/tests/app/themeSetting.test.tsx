import { afterEach, expect, test } from 'bun:test'
import { ThemeSetting } from '../../app/components/ThemeSetting.js'
import { installDomEnvironment } from '../testUtils/domEnvironment.js'
import { renderIntoDocument } from '../testUtils/renderIntoDocument.js'
import { fireEvent, within } from '../testUtils/queries.js'

let cleanup: () => Promise<void> = async () => undefined
afterEach(async () => await cleanup())

test('the theme setting offers system, light, and dark and pins the chosen palette', async () => {
	const dom = installDomEnvironment()
	window.localStorage.removeItem('zoltar.theme')
	document.documentElement.removeAttribute('data-theme')
	const rendered = await renderIntoDocument(<ThemeSetting />)
	cleanup = async () => {
		await rendered.cleanup()
		window.localStorage.removeItem('zoltar.theme')
		document.documentElement.removeAttribute('data-theme')
		dom.cleanup()
	}
	const select = rendered.container.querySelector<HTMLSelectElement>('select')
	if (select === null) throw new Error('Expected the theme control to render a select')
	expect(within(rendered.container).getByLabelText('Theme')).toBe(select)
	expect(Array.from(select.options).map(option => option.textContent)).toEqual(['System', 'Light', 'Dark'])
	expect(select.value).toBe('system')

	select.value = 'dark'
	fireEvent.change(select)
	expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
	expect(window.localStorage.getItem('zoltar.theme')).toBe('dark')

	select.value = 'system'
	fireEvent.change(select)
	expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
	expect(window.localStorage.getItem('zoltar.theme')).toBeNull()
})
