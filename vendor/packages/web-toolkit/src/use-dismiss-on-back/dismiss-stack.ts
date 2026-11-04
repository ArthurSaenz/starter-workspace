type DismissLayer = () => void

type OpenLayersListener = (hasOpenLayers: boolean) => void

const layers: DismissLayer[] = []

const listeners = new Set<OpenLayersListener>()

const notifyListeners = (hasOpenLayers: boolean) => {
  for (const listener of listeners) {
    listener(hasOpenLayers)
  }
}

export const pushDismissLayer = (layer: DismissLayer) => {
  layers.push(layer)

  if (layers.length === 1) {
    notifyListeners(true)
  }

  return () => {
    const index = layers.lastIndexOf(layer)

    if (index === -1) {
      return
    }

    layers.splice(index, 1)

    if (layers.length === 0) {
      notifyListeners(false)
    }
  }
}

/**
 * @description - Closes the most recently opened layer; false when nothing is open, so the caller navigates back instead.
 */
export const dismissTopLayer = () => {
  const topLayer = layers[layers.length - 1]

  if (!topLayer) {
    return false
  }

  topLayer()

  return true
}

/**
 * @description - Fires when the first layer opens and when the last one closes, plus once right away with the current state.
 * For back gestures the web layer cannot cancel, e.g. switching off the iOS WKWebView edge-swipe while a modal is open.
 */
export const subscribeHasOpenLayers = (listener: OpenLayersListener) => {
  listeners.add(listener)
  listener(layers.length > 0)

  return () => {
    listeners.delete(listener)
  }
}
