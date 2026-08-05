export type DiagramPoint = {
	x: number
	y: number
}

export type DiagramRectangle = DiagramPoint & {
	height: number
	width: number
}

export function layerDiagramRectangles<Rectangle extends DiagramRectangle>(rectangles: Rectangle[]): { background: Rectangle[]; foreground: Rectangle[] } {
	const background: Rectangle[] = []
	const foreground: Rectangle[] = []
	for (const rectangle of rectangles) {
		const containsAnotherRectangle = rectangles.some(candidate => candidate !== rectangle && candidate.x >= rectangle.x && candidate.y >= rectangle.y && candidate.x + candidate.width <= rectangle.x + rectangle.width && candidate.y + candidate.height <= rectangle.y + rectangle.height)
		if (containsAnotherRectangle) background.push(rectangle)
		else foreground.push(rectangle)
	}
	return { background, foreground }
}

function containsPoint(rectangle: DiagramRectangle, point: DiagramPoint): boolean {
	return point.x >= rectangle.x && point.x <= rectangle.x + rectangle.width && point.y >= rectangle.y && point.y <= rectangle.y + rectangle.height
}

function segmentEntry(start: DiagramPoint, end: DiagramPoint, rectangle: DiagramRectangle): number | undefined {
	let entry = 0
	let exit = 1
	for (const [startValue, delta, minimum, maximum] of [
		[start.x, end.x - start.x, rectangle.x, rectangle.x + rectangle.width],
		[start.y, end.y - start.y, rectangle.y, rectangle.y + rectangle.height],
	] as const) {
		if (delta === 0) {
			if (startValue < minimum || startValue > maximum) return undefined
			continue
		}
		const first = (minimum - startValue) / delta
		const second = (maximum - startValue) / delta
		entry = Math.max(entry, Math.min(first, second))
		exit = Math.min(exit, Math.max(first, second))
		if (entry > exit) return undefined
	}
	return entry
}

export function fitArrowEndpointOutsideRectangles(points: DiagramPoint[], rectangles: DiagramRectangle[], clearance: number): DiagramPoint[] {
	if (points.length < 2 || clearance <= 0) return points
	const start = points[points.length - 2]
	const end = points[points.length - 1]
	if (start === undefined || end === undefined) return points
	let destinationEntry: number | undefined
	for (const rectangle of rectangles) {
		if (containsPoint(rectangle, start) || !containsPoint(rectangle, end)) continue
		const entry = segmentEntry(start, end, rectangle)
		if (entry !== undefined && (destinationEntry === undefined || entry > destinationEntry)) destinationEntry = entry
	}
	if (destinationEntry === undefined) return points
	const deltaX = end.x - start.x
	const deltaY = end.y - start.y
	const segmentLength = Math.hypot(deltaX, deltaY)
	if (segmentLength === 0) return points
	const exposedDistance = Math.min(clearance, segmentLength / 2)
	const boundary = { x: start.x + deltaX * destinationEntry, y: start.y + deltaY * destinationEntry }
	return [...points.slice(0, -1), { x: boundary.x - (deltaX / segmentLength) * exposedDistance, y: boundary.y - (deltaY / segmentLength) * exposedDistance }]
}
