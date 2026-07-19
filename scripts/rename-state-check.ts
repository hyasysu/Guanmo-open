import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  INITIAL_RENAME_STATE,
  isRenameTargetActive,
  renameStateReducer,
  type RenameState,
} from '../src/services/renameState'

let state: RenameState = INITIAL_RENAME_STATE
state = renameStateReducer(state, { type: 'start', targetId: 'file-a', value: 'old.md' })
assert.equal(state.status, 'editing')
assert.equal(isRenameTargetActive(state, 'file-a'), true)

state = renameStateReducer(state, { type: 'change', value: 'new.md' })
assert.deepEqual(state, { status: 'editing', targetId: 'file-a', value: 'new.md' })

state = renameStateReducer(state, { type: 'submit' })
assert.equal(state.status, 'submitting')
assert.equal(renameStateReducer(state, { type: 'submit' }), state, 'duplicate submit must be ignored')
assert.equal(renameStateReducer(state, { type: 'cancel' }), state, 'submitting rename must not be cancelled')

state = renameStateReducer(state, { type: 'fail' })
assert.equal(state.status, 'failed')
assert.equal(isRenameTargetActive(state, 'file-a'), true)
state = renameStateReducer(state, { type: 'change', value: 'retry.md' })
assert.equal(state.status, 'editing')

state = renameStateReducer(state, { type: 'cancel' })
assert.equal(state.status, 'cancelled')
assert.equal(isRenameTargetActive(state, 'file-a'), false)

state = renameStateReducer(state, { type: 'start', targetId: 'file-b', value: 'before.md' })
state = renameStateReducer(state, { type: 'submit' })
state = renameStateReducer(state, { type: 'succeed' })
assert.equal(state.status, 'success')
assert.equal(isRenameTargetActive(state, 'file-b'), false)

for (const file of [
  'src/components/editor/TabBar.tsx',
  'src/components/editor/FullscreenControlBar.tsx',
  'src/components/file-tree/FileTree.tsx',
  'src/components/layout/Sidebar.tsx',
]) {
  const source = fs.readFileSync(file, 'utf8')
  assert.match(source, /useFileRename/)
  assert.doesNotMatch(source, /rename(?:Cancelled|Submitting)Ref/)
}

console.log('rename state checks passed')
