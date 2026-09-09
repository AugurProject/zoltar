type OperatorHeaderOptions = {
	title: string
	eyebrow: string
	blockStatus: string
	safety: string
	navigation: string
}

// All inputs are repository-owned markup, never request or runtime data.
export function renderOperatorHeader({ title, eyebrow, blockStatus, safety, navigation }: OperatorHeaderOptions) {
	return `<header class="operator-shell">
		<div class="operator-primary">
			<div class="operator-identity">
				<p class="eyebrow">${eyebrow}</p>
				<h1>${title}</h1>
				<p id="header-block-status" class="header-block-status">${blockStatus}</p>
			</div>
			<div class="operator-safety" aria-label="Bot safety status">${safety}</div>
		</div>
		<nav class="section-nav" aria-label="Dashboard sections">${navigation}</nav>
	</header>`
}
