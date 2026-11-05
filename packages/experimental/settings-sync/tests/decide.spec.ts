/** One item moves toward the side that did not change, and a change on both sides follows the requested mode. */
import { expect, it } from 'vitest'
import { decide } from '../src/decide.ts'

const local = (sha256: string) => ({ item: 'local', sha256 })
const remote = (version: number, sha256: string, deleted = false) => ({ version, sha256, deleted })

it('uploads new and locally changed items', () => {
  expect(decide(local('a'), undefined, undefined, 'merge')).toEqual({ type: 'upload', local: local('a'), expectedVersion: 0 })
  expect(decide(local('b'), remote(3, 'a'), { version: 3, sha256: 'a' }, 'merge')).toMatchObject({ type: 'upload', expectedVersion: 3 })
  expect(decide(local('b'), remote(3, 'a', true), { version: 3, sha256: 'a' }, 'merge')).toMatchObject({ type: 'upload', expectedVersion: 3 })
})

it('downloads remote changes and adopts equal content', () => {
  expect(decide(undefined, remote(1, 'a'), undefined, 'merge')).toEqual({ type: 'download', remote: remote(1, 'a') })
  expect(decide(local('a'), remote(4, 'b'), { version: 3, sha256: 'a' }, 'merge')).toMatchObject({ type: 'download' })
  expect(decide(local('a'), remote(2, 'a'), undefined, 'merge')).toEqual({ type: 'adopt', remote: remote(2, 'a') })
})

it('resolves two-sided changes by mode and leaves unchanged items alone', () => {
  const seen = { version: 1, sha256: 'a' }
  expect(decide(local('b'), remote(2, 'c'), seen, 'merge')).toEqual({ type: 'conflict' })
  expect(decide(local('b'), remote(2, 'c'), seen, 'prefer-local')).toMatchObject({ type: 'upload', expectedVersion: 2 })
  expect(decide(local('b'), remote(2, 'c'), seen, 'prefer-remote')).toMatchObject({ type: 'download' })
  expect(decide(local('a'), remote(1, 'b'), seen, 'merge')).toEqual({ type: 'none' })
  expect(decide(undefined, remote(1, 'a', true), seen, 'merge')).toEqual({ type: 'none' })
  expect(decide(undefined, undefined, undefined, 'merge')).toEqual({ type: 'none' })
})
