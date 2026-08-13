export type ChartMetadata = {
	ariaDescription: string
	ariaLabel: string
	height: number
	width: number
}

export type DiagramNodeKind = 'amber' | 'blue' | 'gold' | 'green' | 'neutral' | 'red' | 'rose' | 'slate' | 'teal'

export type DiagramGraphNode = {
	details?: string[]
	id: string
	kind?: DiagramNodeKind
	title: string
	width?: number
}

export type DiagramGraphEdge = {
	dashed?: boolean
	id: string
	label?: string
	source: string
	target: string
}

export type DiagramDirection = 'DOWN' | 'RIGHT'

export type DiagramGraphSection = {
	description?: string
	direction?: DiagramDirection
	edges: DiagramGraphEdge[]
	id: string
	nodes: DiagramGraphNode[]
	title?: string
}

export type DiagramGraphSpec = ChartMetadata & {
	direction?: DiagramDirection
	sections: DiagramGraphSection[]
}

export type DiagramLayoutNode = {
	className: string
	details: string[]
	height: number
	id: string
	title: string
	width: number
	x: number
	y: number
}

export type DiagramLayoutEdge = {
	className: string
	dashed: boolean
	id: string
	label?: string
	labelX?: number
	labelY?: number
	points: { x: number; y: number }[]
}

export type DiagramLayoutPanel = {
	description?: string
	height: number
	id: string
	title?: string
	width: number
	x: number
	y: number
}

export type DiagramLayoutSpec = ChartMetadata & {
	edges: DiagramLayoutEdge[]
	nodes: DiagramLayoutNode[]
	panels: DiagramLayoutPanel[]
}
