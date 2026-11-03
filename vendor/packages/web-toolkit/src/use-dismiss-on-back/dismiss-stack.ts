type DismissLayer = () => void

const layers: DismissLayer[] = []

export const pushDismissLayer = (layer: DismissLayer) => {
  layers.push(layer)

  return () => {
    const index = layers.lastIndexOf(layer)

    if (index !== -1) {
      layers.splice(index, 1)
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
