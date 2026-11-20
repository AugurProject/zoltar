/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { getLocalEntityScope, useRememberOpenedEntity } from '../hooks/useLocalEntities.js'
import { clearSessionLocalEntities, createDownloadedEntityStore, getFavoritesStorageKey, readFavoriteEntries, resetLocalEntityStoreForTesting, setEntityFavorite } from '../lib/localEntityStore.js'
import { buildLocalBrowseEntries } from '../lib/localEntityBrowse.js'
import { decodeStoredValue } from '../lib/storedValueReader.js'
import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '../lib/activeEnvironment.js'
import { getGenesisNetworkProfile, SEPOLIA_NETWORK_PROFILE } from '../wallet/networkProfile.js'
import { createFakeBackend, createFakeSimulationProfile } from './testUtils/fakeBackend.js'

type Summary = { title: string }
const store = createDownloadedEntityStore((value: unknown) => decodeStoredValue(value, (read): Summary => ({ title: read.string('title') })))

function OpenedEntity({ data, id }: { data: Summary | undefined; id: string | undefined }) {
	useRememberOpenedEntity('statoblast', 'pool', store, id, data)
	return <p>{data?.title}</p>
}

void describe('useRememberOpenedEntity', () => {
	const lifecycle = installDomTestLifecycle({
		afterTest: () => {
			resetLocalEntityStoreForTesting()
			resetActiveEnvironmentForTesting()
		},
		beforeTest: () => {
			resetLocalEntityStoreForTesting()
		},
	})

	void test('keeps each genesis deployment favorite and download when switching roots on one chain', async () => {
		const yes = getGenesisNetworkProfile(SEPOLIA_NETWORK_PROFILE, 'yes')
		const no = getGenesisNetworkProfile(SEPOLIA_NETWORK_PROFILE, 'no')
		installActiveEnvironmentForTesting(createFakeBackend({ profile: yes }))
		const yesScope = getLocalEntityScope('statoblast', 'pool')
		const yesSummary = { title: 'Yes root pool' }
		const yesOpened = lifecycle.trackRendered(await renderIntoDocument(<OpenedEntity data={yesSummary} id='0xAA' />))

		installActiveEnvironmentForTesting(createFakeBackend({ profile: no }))
		const noScope = getLocalEntityScope('statoblast', 'pool')
		expect(readFavoriteEntries(noScope)).toEqual([])
		expect(store.read(noScope)).toEqual([])
		const noSummary = { title: 'No root pool' }
		await act(() => render(<OpenedEntity data={noSummary} id='0xAA' />, yesOpened.container))
		expect(readFavoriteEntries(noScope).map(entry => entry.id)).toEqual(['0xaa'])

		installActiveEnvironmentForTesting(createFakeBackend({ profile: yes }))
		expect(getLocalEntityScope('statoblast', 'pool')).toEqual(yesScope)
		expect(readFavoriteEntries(getLocalEntityScope('statoblast', 'pool')).map(entry => entry.id)).toEqual(['0xaa'])
		expect(store.read(getLocalEntityScope('statoblast', 'pool')).map(entry => entry.data)).toEqual([yesSummary])
		expect(store.read(noScope).map(entry => entry.data)).toEqual([noSummary])
	})

	void test('favorites once per visit, keeps an un-star across refreshes, and skips writes for unchanged data', async () => {
		const scope = getLocalEntityScope('statoblast', 'pool')
		const first = { title: 'First load' }
		const rendered = lifecycle.trackRendered(await renderIntoDocument(<OpenedEntity data={first} id='0xAA' />))
		expect(readFavoriteEntries(scope).map(entry => entry.id)).toEqual(['0xaa'])
		expect(store.read(scope).map(entry => entry.data)).toEqual([first])

		setEntityFavorite(scope, '0xaa', false)
		const refreshed = { title: 'Refreshed' }
		await act(() => {
			render(<OpenedEntity data={refreshed} id='0xAA' />, rendered.container)
		})
		expect(readFavoriteEntries(scope)).toEqual([])
		expect(store.read(scope).map(entry => entry.data)).toEqual([refreshed])

		const writes: string[] = []
		const originalSetItem = window.localStorage.setItem.bind(window.localStorage)
		window.localStorage.setItem = (key: string, value: string) => {
			writes.push(key)
			originalSetItem(key, value)
		}
		await act(() => {
			render(<OpenedEntity data={refreshed} id='0xAA' />, rendered.container)
		})
		expect(writes).toEqual([])

		await act(() => {
			render(<OpenedEntity data={undefined} id={undefined} />, rendered.container)
		})
		await act(() => {
			render(<OpenedEntity data={refreshed} id='0xAA' />, rendered.container)
		})
		expect(readFavoriteEntries(scope).map(entry => entry.id)).toEqual(['0xaa'])
	})

	void test('lists a newly opened favorite even when every cached summary already belongs to a favorite', async () => {
		const scope = getLocalEntityScope('statoblast', 'pool')
		const cached = Array.from({ length: 200 }, (_, index) => ({ id: `0x${index.toString(16)}`, data: { title: `Pool ${index}` } }))
		store.record(scope, cached, 1)
		for (const [index, item] of cached.entries()) setEntityFavorite(scope, item.id, true, index)

		const opened = { title: 'Pool 201' }
		lifecycle.trackRendered(await renderIntoDocument(<OpenedEntity data={opened} id='0xNEW' />))

		const directory = buildLocalBrowseEntries(store.read(scope), readFavoriteEntries(scope), 'favorites')
		expect(directory[0]?.id).toBe('0xnew')
		expect(directory[0]?.data).toEqual(opened)
	})

	void test('keeps simulation favorites with their chain instead of carrying them into the next simulation', async () => {
		installActiveEnvironmentForTesting(createFakeBackend({ profile: createFakeSimulationProfile() }))
		const scope = getLocalEntityScope('statoblast', 'pool')
		lifecycle.trackRendered(await renderIntoDocument(<OpenedEntity data={{ title: 'Simulated pool' }} id='0x1' />))
		expect(readFavoriteEntries(scope).map(entry => entry.id)).toEqual(['0x1'])
		expect(window.localStorage.getItem(getFavoritesStorageKey(scope))).toBeNull()

		clearSessionLocalEntities()

		expect(readFavoriteEntries(scope)).toEqual([])
		expect(store.read(scope)).toEqual([])
	})
})
