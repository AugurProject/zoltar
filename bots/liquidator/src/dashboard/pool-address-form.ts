import { publicFailure } from './pool-presentation.ts'
import { getAddress } from '@zoltar/bot-shared/ethereum'

type Context = { chainId: number | undefined; enabled: boolean; selected: ReadonlySet<string> }

export function createPoolAddressForm(form: HTMLFormElement, save: (address: string, supported: boolean, chainId: number) => Promise<void>) {
	const inputElement = form.querySelector('input')
	const buttonElement = form.querySelector('button')
	const statusElement = form.querySelector('[role="status"]')
	if (!(inputElement instanceof HTMLInputElement) || !(buttonElement instanceof HTMLButtonElement) || !(statusElement instanceof HTMLElement)) throw new Error('Pool address form is incomplete')
	const input = inputElement
	const button = buttonElement
	const status = statusElement
	let context: Context = { chainId: undefined, enabled: false, selected: new Set() }
	let pending = false

	function render() {
		const supported = context.selected.has(input.value.trim().toLowerCase())
		input.disabled = !context.enabled || pending
		button.disabled = !context.enabled || pending || supported || input.value.trim() === ''
		const actionLabel = supported ? 'Already supported' : 'Add to supported'
		button.textContent = pending ? 'Adding…' : actionLabel
		form.setAttribute('aria-busy', String(pending))
	}

	input.addEventListener('input', () => {
		status.textContent = ''
		input.removeAttribute('aria-invalid')
		render()
	})
	form.addEventListener('submit', async event => {
		event.preventDefault()
		const chainId = context.chainId
		if (!context.enabled || pending || chainId === undefined || context.selected.has(input.value.trim().toLowerCase())) return
		let address: string
		try {
			address = getAddress(input.value.trim())
			if (/^0x0{40}$/i.test(address)) throw new Error('Zero address')
		} catch (error) {
			status.textContent = publicFailure(error, 'Enter a valid, nonzero pool address.')
			input.setAttribute('aria-invalid', 'true')
			input.focus()
			return
		}
		pending = true
		status.textContent = ''
		render()
		try {
			await save(address, true, chainId)
			if (context.chainId === chainId) status.textContent = 'Added to supported pools.'
		} catch (error) {
			if (context.chainId === chainId) status.textContent = publicFailure(error, 'Could not add pool. Try again.')
		} finally {
			pending = false
			render()
		}
	})
	return {
		update(next: Context) {
			if (next.chainId !== context.chainId) {
				input.value = ''
				input.removeAttribute('aria-invalid')
				status.textContent = ''
			}
			context = next
			render()
		},
	}
}
