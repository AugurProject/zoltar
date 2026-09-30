import { Fragment, isValidElement, type ComponentChildren, type ComponentType, type FunctionComponent } from 'preact'

/**
 * Server-side rendering for the dashboards' static page templates, which are written as Preact components. The bots ship
 * no `preact-render-to-string`, and these templates only need a small subset: host elements, function components,
 * fragments, and repository-owned raw markup. Text and attribute values are escaped; hooks, class components, and
 * event handlers are not supported because nothing hydrates this markup.
 */

const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])

/** Attributes whose `false` is meaningful, so booleans render as `"true"`/`"false"` instead of presence. */
function enumeratedBoolean(name: string) {
	return name.startsWith('aria-') || name === 'spellcheck' || name === 'draggable' || name === 'contenteditable'
}

/** Preact's camel-case property names for attributes that HTML spells differently. */
const ATTRIBUTE_NAMES: Readonly<Record<string, string>> = { className: 'class', htmlFor: 'for', readOnly: 'readonly', tabIndex: 'tabindex' }

function escapeText(value: string) {
	return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function escapeAttribute(value: string) {
	return escapeText(value).replaceAll('"', '&quot;')
}

/** Inserts repository-owned markup verbatim, for templates still composed from HTML strings. Never pass request or runtime data. */
export function RawMarkup(_props: { html: string }) {
	return null
}

function renderAttribute(name: string, value: unknown) {
	if (value === undefined || value === null) return ''
	if (typeof value === 'boolean') {
		if (enumeratedBoolean(name)) return ` ${name}="${value ? 'true' : 'false'}"`
		return value ? ` ${name}` : ''
	}
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') return ` ${name}="${escapeAttribute(String(value))}"`
	throw new Error(`Static markup attribute ${name} must be a string, number, or boolean`)
}

function renderElement(tag: string, props: Readonly<Record<string, unknown>>) {
	let attributes = ''
	for (const [name, value] of Object.entries(props)) {
		if (name === 'children' || name === 'key' || name === 'ref') continue
		attributes += renderAttribute(ATTRIBUTE_NAMES[name] ?? name, value)
	}
	if (VOID_ELEMENTS.has(tag)) return `<${tag}${attributes} />`
	return `<${tag}${attributes}>${renderStaticMarkup(childrenOf(props))}</${tag}>`
}

function childrenOf(props: Readonly<Record<string, unknown>>): ComponentChildren {
	const children = props['children']
	if (children === undefined || children === null || typeof children === 'string' || typeof children === 'number' || typeof children === 'boolean' || typeof children === 'bigint' || Array.isArray(children) || isValidElement(children)) return children
	throw new Error('Static markup children must be text, elements, or arrays of them')
}

function isFunctionComponent<Props>(type: ComponentType<Props>): type is FunctionComponent<Props> {
	return typeof type.prototype?.render !== 'function'
}

/** Renders a component tree to an HTML string for the dashboard page slots. */
export function renderStaticMarkup(node: ComponentChildren): string {
	if (node === undefined || node === null || typeof node === 'boolean') return ''
	if (typeof node === 'string') return escapeText(node)
	if (typeof node === 'number' || typeof node === 'bigint') return node.toString()
	if (Array.isArray(node)) return node.map(child => renderStaticMarkup(child)).join('')
	if (!isValidElement(node)) throw new Error('Static markup can only render text, elements, and arrays of them')
	const { props, type } = node
	if (type === Fragment) return renderStaticMarkup(childrenOf(props))
	if (type === RawMarkup) {
		const html: unknown = Reflect.get(props, 'html')
		if (typeof html !== 'string') throw new Error('RawMarkup requires an html string')
		return html
	}
	if (typeof type === 'string') return renderElement(type, props)
	if (!isFunctionComponent(type)) throw new Error('Static markup does not render class components')
	return renderStaticMarkup(type(props))
}
