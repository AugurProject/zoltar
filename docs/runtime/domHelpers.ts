export function requiredElementFinder(owner: string) {
	return <T extends Element>(root: ParentNode, selector: string, expected: new () => T): T => {
		const found = root.querySelector(selector)
		if (!(found instanceof expected)) throw new Error(`Required ${owner} element ${selector} is missing or has the wrong type`)
		return found
	}
}

export async function copyText(value: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(value)
		return true
	} catch (error) {
		if (!(error instanceof DOMException) && !(error instanceof TypeError)) throw error
		const input = document.createElement('textarea')
		input.value = value
		input.setAttribute('readonly', '')
		input.style.position = 'fixed'
		input.style.opacity = '0'
		document.body.append(input)
		input.select()
		const copied = document.execCommand('copy')
		input.remove()
		return copied
	}
}
