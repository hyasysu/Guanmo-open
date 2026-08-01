import { useSettingsStore } from '@/stores/settingsStore'
import { ContextMenuItem } from '@/components/common/ContextMenu'

export function AiShortcutMenuItems({ onAction }: { onAction: (prompt: string) => void }) {
  const actions = useSettingsStore((state) => state.aiShortcutActions)

  return actions.map((action) => action.enabled ? (
    <ContextMenuItem key={action.id} onClick={() => onAction(action.prompt)}>
      <span className="block truncate">{action.label}</span>
    </ContextMenuItem>
  ) : null)
}
