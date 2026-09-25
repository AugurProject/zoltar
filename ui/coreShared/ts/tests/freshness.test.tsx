/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { formatUpdatedAgo, updatedAgoTickMilliseconds } from '../lib/freshness.js'
import { UpdatedAgo } from '../components/UpdatedAgo.js'
import { SkeletonList } from '../components/Skeleton.js'
import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('freshness label', () => {
	test('reads as current for the first seconds, then counts seconds, minutes, and hours', () => {
		const updatedAt = 1_000_000
		expect(formatUpdatedAgo(updatedAt, updatedAt)).toBe('Updated just now')
		expect(formatUpdatedAgo(updatedAt, updatedAt + 4_999)).toBe('Updated just now')
		expect(formatUpdatedAgo(updatedAt, updatedAt + 12_000)).toBe('Updated 12s ago')
		expect(formatUpdatedAgo(updatedAt, updatedAt + 59_999)).toBe('Updated 59s ago')
		expect(formatUpdatedAgo(updatedAt, updatedAt + 60_000)).toBe('Updated 1m ago')
		expect(formatUpdatedAgo(updatedAt, updatedAt + 3_599_000)).toBe('Updated 59m ago')
		expect(formatUpdatedAgo(updatedAt, updatedAt + 7_200_000)).toBe('Updated 2h ago')
	})

	test('never counts a future read as negative age', () => {
		expect(formatUpdatedAgo(10_000, 5_000)).toBe('Updated just now')
	})

	test('re-renders every second during the first minute and less often afterwards', () => {
		expect(updatedAgoTickMilliseconds(0, 59_000)).toBe(1_000)
		expect(updatedAgoTickMilliseconds(0, 60_000)).toBe(30_000)
	})
})

describe('freshness and skeleton components', () => {
	let cleanup: (() => Promise<void>) | undefined
	installDomTestLifecycle({
		afterTest: async () => {
			await cleanup?.()
			cleanup = undefined
		},
	})

	test('reserves an empty line before the first read and marks an in-place refresh without replacing the age', async () => {
		const empty = await renderIntoDocument(<UpdatedAgo updatedAt={undefined} />)
		expect(empty.container.textContent).toBe('')
		expect(empty.container.querySelector('.freshness-indicator[aria-hidden="true"]')).not.toBeNull()
		await empty.cleanup()

		const rendered = await renderIntoDocument(<UpdatedAgo updatedAt={Date.now() - 20_000} refreshing />)
		cleanup = rendered.cleanup
		const indicator = rendered.container.querySelector('.freshness-indicator')
		expect(indicator?.getAttribute('data-state')).toBe('refreshing')
		expect(indicator?.getAttribute('aria-busy')).toBe('true')
		expect(indicator?.textContent).toContain('Updated 20s ago')
		expect(indicator?.textContent).toContain('Refreshing…')
		expect(indicator?.getAttribute('role')).toBeNull()
	})

	test('skeleton rows are hidden from assistive technology behind one loading label', async () => {
		const rendered = await renderIntoDocument(<SkeletonList label='Loading questions…' rows={4} />)
		cleanup = rendered.cleanup
		const list = rendered.container.querySelector('.skeleton-list')
		expect(list?.getAttribute('role')).toBe('status')
		expect(list?.textContent).toBe('Loading questions…')
		expect(rendered.container.querySelectorAll('.skeleton-row[aria-hidden="true"]')).toHaveLength(4)
	})
})
