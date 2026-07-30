import diagramSpecs from './diagram-specs.json'

const svgNamespace = 'http://www.w3.org/2000/svg'

type DiagramNode = {
	attributes?: Record<string, string>
	children?: DiagramNode[]
	tag?: string
	text?: string
}

type DiagramSpec = {
	ariaDescription: string
	ariaLabel: string
	height: number
	nodes: DiagramNode[]
	width: number
}

const specs: Record<string, DiagramSpec> = diagramSpecs

function renderNode(node: DiagramNode): Node {
	if (node.text !== undefined) return document.createTextNode(node.text)
	if (node.tag === undefined) throw new Error('Diagram node is missing its tag')
	const element = document.createElementNS(svgNamespace, node.tag)
	for (const [name, value] of Object.entries(node.attributes ?? {})) element.setAttribute(name, value)
	for (const child of node.children ?? []) element.append(renderNode(child))
	return element
}

function renderDiagram(mount: HTMLElement, spec: DiagramSpec) {
	const svg = document.createElementNS(svgNamespace, 'svg')
	svg.setAttribute('aria-label', spec.ariaLabel)
	svg.setAttribute('role', 'img')
	svg.setAttribute('viewBox', `0 0 ${spec.width.toString()} ${spec.height.toString()}`)
	svg.setAttribute('width', '100%')
	svg.setAttribute('height', 'auto')
	const description = document.createElementNS(svgNamespace, 'desc')
	description.textContent = spec.ariaDescription
	svg.append(description)
	for (const node of spec.nodes) svg.append(renderNode(node))
	mount.replaceChildren(svg)
	mount.classList.add('plot-chart-ready')
}

for (const mount of document.querySelectorAll<HTMLElement>('[data-plot-chart]')) {
	const chartId = mount.dataset['plotChart']
	if (chartId === undefined) throw new Error('Diagram mount is missing data-plot-chart')
	const spec = specs[chartId]
	if (spec === undefined) throw new Error(`Missing diagram specification ${chartId}`)
	renderDiagram(mount, spec)
}
