import { renderOperatorHeader } from '../../../shared/src/dashboard/header.ts'

export const operatorHeader = renderOperatorHeader({
	title: 'Statoblast liquidator',
	eyebrow: 'Statoblast operator',
	blockStatus: 'Block — · waiting for first observation',
	network: '<span id="network-badge" class="badge loading">Network loading</span>',
	safety: `<span id="mode-badge" class="badge loading">Starting</span>
					<span id="run-status-badge" class="badge loading">Loading</span>
					<span id="capability-badge" class="badge" hidden></span>
					<a id="attention-badge" class="badge attention-badge" hidden></a>
					<button id="refresh-button" class="secondary" type="button">Refresh</button>
					<button id="pause-button" class="secondary" type="button">Pause</button>
					<span id="pause-status" class="action-status" role="alert"></span>`,
	notices: `<div id="global-error" class="notice error hidden" role="alert"></div>
			<ul id="operator-alerts" class="operator-alerts hidden" aria-atomic="true" aria-label="Operator alerts" aria-live="assertive" role="alert"></ul>`,
	navigation: `<a href="/overview">Overview</a>
				<a href="/pools">Pool work</a>
				<a href="/markets">Market evidence</a>
				<a href="/operations">Activity &amp; recovery</a>
				<a href="/settings">Settings</a>`,
})
