/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { FavoriteToggle } from '../components/FavoriteToggle.js'
import { getLocalEntityScope } from '../hooks/useLocalEntities.js'
import { readFavoriteEntries, resetLocalEntityStoreForTesting, setEntityFavorite } from '../lib/localEntityStore.js'
import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { fireEvent, within } from './testUtils/queries.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

void describe('FavoriteToggle', () => {
	const lifecycle = installDomTestLifecycle({
		afterTest: () => {
			resetLocalEntityStoreForTesting()
		},
		beforeTest: () => {
			resetLocalEntityStoreForTesting()
		},
	})

	void test('toggles a dim star into a pressed favorite and keeps every star for the entity in sync', async () => {
		lifecycle.trackRendered(
			await renderIntoDocument(
				<>
					<FavoriteToggle app='statoblast' entityLabel='Pool A' id='0xAA' kind='pool' />
					<FavoriteToggle app='statoblast' entityLabel='Pool A header' id='0xaa' kind='pool' />
				</>,
			),
		)
		const queries = within(document.body)
		const rowStar = queries.getByRole('button', { name: 'Favorite: Pool A' })
		const headerStar = queries.getByRole('button', { name: 'Favorite: Pool A header' })
		expect(rowStar.getAttribute('aria-pressed')).toBe('false')
		expect(rowStar.getAttribute('title')).toBe('Add to favorites')

		await act(() => {
			fireEvent.click(rowStar)
		})
		expect(rowStar.getAttribute('aria-pressed')).toBe('true')
		expect(rowStar.classList.contains('is-favorite')).toBe(true)
		expect(headerStar.getAttribute('aria-pressed')).toBe('true')
		expect(headerStar.getAttribute('title')).toBe('Remove from favorites')
		expect(readFavoriteEntries(getLocalEntityScope('statoblast', 'pool')).map(entry => entry.id)).toEqual(['0xaa'])

		await act(() => {
			fireEvent.click(headerStar)
		})
		expect(rowStar.getAttribute('aria-pressed')).toBe('false')
		expect(readFavoriteEntries(getLocalEntityScope('statoblast', 'pool'))).toEqual([])
	})

	void test('reflects a favorite added elsewhere after it rendered', async () => {
		lifecycle.trackRendered(await renderIntoDocument(<FavoriteToggle app='zoltar' entityLabel='Question' id='0x01' kind='question' />))
		const star = within(document.body).getByRole('button', { name: 'Favorite: Question' })
		await act(() => {
			setEntityFavorite(getLocalEntityScope('zoltar', 'question'), '0x01', true)
		})
		expect(star.getAttribute('aria-pressed')).toBe('true')
		expect(readFavoriteEntries(getLocalEntityScope('statoblast', 'question'))).toEqual([])
	})
})
