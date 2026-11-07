export type RequiredElementRole = 'anchor' | 'button' | 'dialog' | 'element' | 'form' | 'input' | 'select'

const inputSelectors = new Set(['#event-filter', '#address-filter', '#entity-search'])
const selectSelectors = new Set(['#global-network-filter', '#operations-route-select', '#rich-sort'])
const formSelectors = new Set(['#filters', '#global-network-form', '#operations-route-form'])
const anchorSelectors = new Set(['#address-back', '.skip-link'])
const buttonSelectors = new Set(['#more', '#clear-filters', '#close-detail', '#richlist-more', '#filters button[type="submit"]'])

export const requiredElementRole = (selector: string): RequiredElementRole => {
	if (selector === '#detail-dialog') return 'dialog'
	if (inputSelectors.has(selector)) return 'input'
	if (selectSelectors.has(selector)) return 'select'
	if (formSelectors.has(selector)) return 'form'
	if (anchorSelectors.has(selector)) return 'anchor'
	if (buttonSelectors.has(selector)) return 'button'
	return 'element'
}
