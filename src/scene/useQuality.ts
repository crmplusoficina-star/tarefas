import { dataStore } from '../state/dataStore'
import { uiStore, type Quality } from '../state/uiStore'
import { useStore } from '../state/store'
import { resolveQuality } from './quality'

/** The graphics tier currently in effect (user setting, or the automatic one). */
export function useQualityTier(): Quality {
  const effects = useStore(dataStore, (s) => s.data.settings.effects)
  const auto = useStore(uiStore, (s) => s.autoQuality)
  return resolveQuality(effects, auto)
}
