import type { ThemeId } from '@/stores/settingsStore'
import './theme-picker.css'

export const THEME_OPTIONS: Array<{ key: ThemeId; label: string; description: string }> = [
  { key: 'warm', label: '暖色', description: '观墨经典暖色' },
  { key: 'light', label: '浅色', description: '清爽通用浅色' },
  { key: 'dark', label: '深色', description: '沉浸夜间写作' },
  { key: 'paper', label: 'Paper', description: '舒适长文阅读' },
  { key: 'github-light', label: 'GitHub Light', description: '技术文档与代码' },
]

export function ThemePicker({
  value,
  onChange,
}: {
  value: ThemeId
  onChange: (value: ThemeId) => void
}) {
  return (
    <div className="gm-theme-picker" role="radiogroup" aria-label="主题">
      {THEME_OPTIONS.map((option) => (
        <button
          key={option.key}
          type="button"
          className="gm-theme-card"
          data-preview-theme={option.key}
          data-active={value === option.key}
          role="radio"
          aria-checked={value === option.key}
          onClick={() => onChange(option.key)}
        >
          <span className="gm-theme-card__preview" aria-hidden="true">
            <span className="gm-theme-card__surface">
              <span className="gm-theme-card__heading" />
              <span className="gm-theme-card__line" />
              <span className="gm-theme-card__line gm-theme-card__line--short" />
              <span className="gm-theme-card__accent" />
            </span>
          </span>
          <span className="gm-theme-card__label">{option.label}</span>
          <span className="gm-theme-card__description">{option.description}</span>
        </button>
      ))}
    </div>
  )
}
