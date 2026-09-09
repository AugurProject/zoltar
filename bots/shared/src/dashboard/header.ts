type OperatorHeaderOptions = {
	title: string
	eyebrow: string
	blockStatus: string
	safety: string
	navigation: string
	notices: string
}

// All inputs are repository-owned markup, never request or runtime data.
export function renderOperatorHeader({ title, eyebrow, blockStatus, safety, navigation, notices }: OperatorHeaderOptions) {
	return `<header class="operator-shell">
		<div class="operator-primary">
			<div class="operator-identity">
				<p class="eyebrow">${eyebrow}</p>
				<h1>${title}</h1>
				<p id="header-block-status" class="header-block-status">${blockStatus}</p>
			</div>
			<div class="operator-safety" aria-label="Bot safety status">${safety}</div>
		</div>
		<details id="header-notices" class="header-notices">
			<summary id="header-notices-toggle" aria-label="Bot notices">
				<span class="header-notices-icon" aria-hidden="true">!</span>
				<span id="header-notices-count" aria-hidden="true">0</span>
			</summary>
			<div class="header-notices-panel" role="region" aria-labelledby="header-notices-title">
				<div class="header-notices-heading">
					<strong id="header-notices-title">Bot notices</strong>
					<button id="header-notices-close" type="button" aria-label="Close bot notices">×</button>
				</div>
				<div class="operator-notices">${notices}</div>
				<p id="header-notices-empty" hidden>No errors or warnings.</p>
			</div>
		</details>
		<span id="header-notices-status" class="header-notices-status" role="status" aria-live="polite"></span>
		<script type="module" src="/header-notices.js"></script>
		<nav class="section-nav" aria-label="Dashboard sections">${navigation}</nav>
	</header>`
}
