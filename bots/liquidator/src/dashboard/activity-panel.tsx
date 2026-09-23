import { Fragment, h, render } from 'preact'
import type { Activity } from './api-validation.ts'
import { activityBadgeClass } from './status-badges.ts'
import { element } from '@zoltar/bot-shared/dashboard/dom'

export function renderActivities(activities: Activity[], explorerBase?: string) {
	const filter = element('activity-filter', HTMLSelectElement).value
	const visible = (filter === 'all' ? activities : activities.filter(activity => activity.status === filter)).slice(0, 50)
	const explorerUrl = explorerBase !== undefined && URL.canParse(explorerBase) ? explorerBase.replace(/\/+$/, '') : undefined
	const rows = visible.map(activity =>
		h(
			'li',
			{ class: 'activity', key: `${activity.at}:${activity.hash ?? activity.message}` },
			h('span', { class: `badge ${activityBadgeClass(activity.status)}` }, activity.status),
			h(
				'div',
				null,
				h('p', null, activity.message),
				h('time', { dateTime: activity.at }, new Date(activity.at).toLocaleString()),
				activity.details === undefined ? null : h('p', { class: 'muted mono' }, activity.details),
				activity.hash === undefined || explorerUrl === undefined ? null : h('a', { href: `${explorerUrl}/tx/${activity.hash}`, target: '_blank', rel: 'noreferrer' }, 'View transaction in explorer'),
			),
		),
	)
	render(h(Fragment, null, ...(rows.length === 0 ? [h('li', { class: 'empty' }, activities.length === 0 ? 'No activity yet' : 'No activity matches this filter.')] : rows)), element('activity-list', HTMLOListElement))
}
