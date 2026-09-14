/** Shares one pair of renderer lifecycle listeners across its coverage operations. */
function createCoverageOwnerLifecycle() {
  const owners = new WeakMap()
  return {
    subscribe(sender, onGone) {
      if (sender.isDestroyed?.() === true) {
        const error = new Error('Coverage renderer is already destroyed.')
        error.name = 'AbortError'
        throw error
      }
      let owner = owners.get(sender)
      if (owner === undefined) {
        const callbacks = new Set()
        const detach = () => {
          sender.removeListener('destroyed', gone)
          sender.removeListener('render-process-gone', gone)
          if (owners.get(sender) === owner) owners.delete(sender)
        }
        const gone = () => {
          detach()
          const pending = [...callbacks]
          callbacks.clear()
          for (const callback of pending) callback()
        }
        owner = { callbacks, detach }
        owners.set(sender, owner)
        sender.once('destroyed', gone)
        sender.once('render-process-gone', gone)
      }
      owner.callbacks.add(onGone)
      return () => {
        owner.callbacks.delete(onGone)
        if (owner.callbacks.size === 0) owner.detach()
      }
    },
  }
}

module.exports = { createCoverageOwnerLifecycle }
