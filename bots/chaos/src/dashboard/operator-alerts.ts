export function renderOperatorAlerts(container: HTMLUListElement, alerts: readonly { actionHref?: string | undefined; actionLabel?: string | undefined; message?: string | undefined; severity?: string | undefined }[]) {
	const entries = alerts.flatMap(alert => {
		if (alert.message === undefined) return []
		const item = document.createElement('li')
		item.className = `notice ${alert.severity === 'info' || alert.severity === 'warning' ? alert.severity : 'error'}`
		item.textContent = alert.message
		if (alert.actionHref?.startsWith('/') && !alert.actionHref.startsWith('//') && alert.actionHref !== document.location.pathname && alert.actionLabel !== undefined) {
			const action = document.createElement('a')
			action.className = 'alert-action'
			action.href = alert.actionHref
			action.textContent = alert.actionLabel
			item.append(action)
		}
		return [item]
	})
	const urgent = alerts.some(alert => alert.message !== undefined && alert.severity !== 'info')
	container.setAttribute('role', urgent ? 'alert' : 'status')
	container.setAttribute('aria-live', urgent ? 'assertive' : 'polite')
	container.classList.toggle('hidden', entries.length === 0)
	container.replaceChildren(...entries)
}
