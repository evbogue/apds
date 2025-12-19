export const createGossip = (options = {}) => {
  const {
    getPeers = () => new Set(),
    has = async () => false,
    request = () => {},
    intervalMs = 10000,
  } = options

  const missing = new Set()
  let timer = null

  const enqueue = async (hash) => {
    if (!hash) return
    if (await has(hash)) return
    missing.add(hash)
  }

  const resolve = (hash) => {
    if (hash) missing.delete(hash)
  }

  const tick = async () => {
    if (!missing.size) return
    const peers = getPeers() || []
    const list = peers.size !== undefined ? peers : Array.from(peers)
    if (!list.length) return

    for (const hash of missing) {
      if (await has(hash)) {
        missing.delete(hash)
        continue
      }
      for (const peer of list) {
        try { request(peer, hash) } catch (_err) {}
      }
    }
  }

  const start = () => {
    if (timer) return
    timer = setInterval(() => {
      tick().catch(() => {})
    }, intervalMs)
  }

  const stop = () => {
    if (!timer) return
    clearInterval(timer)
    timer = null
  }

  return { enqueue, resolve, start, stop }
}
