import { useEffect } from 'react'
import { cameraControl } from '../scene/cameraControl'
import {
  cycleLocationPlanet,
  goBack,
  goPlanet,
  goUniverse,
  openGroupDialog,
  openLab,
  openNewTask,
  recenter,
  runUndo,
} from '../state/commands'
import { dataStore } from '../state/dataStore'
import { sortedPlanets } from '../domain/stats'
import { levelOf, uiStore } from '../state/uiStore'

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = uiStore.get()
      const mod = e.ctrlKey || e.metaKey
      const k = e.key

      if (mod && k.toLowerCase() === 'k') {
        e.preventDefault()
        uiStore.set({ searchOpen: !s.searchOpen })
        return
      }
      if (isTyping(e.target)) {
        if (k === 'Escape') (e.target as HTMLElement).blur()
        return
      }
      if (mod && k.toLowerCase() === 'z') {
        e.preventDefault()
        runUndo()
        return
      }
      if (k === 'Escape') {
        goBack()
        return
      }
      if (mod || e.altKey) return
      const overlay = s.searchOpen || s.outlineOpen || s.settingsOpen || s.helpOpen || s.groupDialog || s.groupManager || s.confirm || s.lab
      if (overlay) return

      const data = dataStore.get().data
      const level = levelOf(s)
      const lower = k.toLowerCase()
      const step = e.shiftKey ? 180 : 60

      switch (true) {
        case lower === 'n':
          e.preventDefault()
          openLab()
          break
        case lower === 't':
          e.preventDefault()
          openNewTask()
          break
        case lower === 'g' && !!s.planetId:
          e.preventDefault()
          openGroupDialog({ mode: 'new', planetId: s.planetId! })
          break
        case lower === 'e':
          if (level === 'planet' && s.planetId) openLab(s.planetId)
          else if (level === 'group' && s.groupId) openGroupDialog({ mode: 'edit', id: s.groupId })
          break
        case lower === 'r' && level === 'universe':
          uiStore.set({ mode: s.mode === 'arrange' ? 'explore' : 'arrange' })
          break
        case lower === 'c' || k === 'Home':
          cameraControl.reset()
          recenter()
          break
        case lower === 'o':
          uiStore.set({ outlineOpen: true })
          break
        case k === '?':
          uiStore.set({ helpOpen: true })
          break
        case k === '/':
          e.preventDefault()
          uiStore.set({ searchOpen: true })
          break
        case k === '0':
          goUniverse()
          break
        case k === '[':
          cycleLocationPlanet(-1)
          break
        case k === ']':
          cycleLocationPlanet(1)
          break
        case /^[1-9]$/.test(k): {
          const p = sortedPlanets(data.planets)[Number(k) - 1]
          if (p) goPlanet(p.id)
          break
        }
        case k === '+' || k === '=':
          cameraControl.zoomBy(0.84)
          break
        case k === '-' || k === '_':
          cameraControl.zoomBy(1.19)
          break
        case k === 'ArrowLeft':
          e.preventDefault()
          cameraControl.panBy(step, 0)
          break
        case k === 'ArrowRight':
          e.preventDefault()
          cameraControl.panBy(-step, 0)
          break
        case k === 'ArrowUp':
          e.preventDefault()
          cameraControl.panBy(0, step)
          break
        case k === 'ArrowDown':
          e.preventDefault()
          cameraControl.panBy(0, -step)
          break
        default:
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
