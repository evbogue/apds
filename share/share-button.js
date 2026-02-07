const WIREDOVE_ORIGIN = 'http://localhost:8000'

const applyWiredoveStyles = () => {
  if (document.getElementById('anproto-wiredove-styles')) { return }
  const style = document.createElement('style')
  style.id = 'anproto-wiredove-styles'
  style.textContent = `
    .wiredove-share {
      --wiredove-purple: #ac8aff;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 0 0 0 5px;
      height: 22px;
      border-radius: 999px;
      border: 1px solid var(--wiredove-purple);
      color: #fff;
      background: var(--wiredove-purple);
      font-weight: 600;
      font-size: 12px;
      line-height: 1;
      letter-spacing: 0.02em;
      cursor: pointer;
    }
    .wiredove-share img {
      width: 18px;
      height: 18px;
      display: block;
    }
    .wiredove-share:hover {
      filter: brightness(0.95);
    }
    .wiredove-share-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      padding: 0;
      border-radius: 0;
      border: none;
      background: transparent;
      cursor: pointer;
    }
    .wiredove-share-icon img {
      width: 28px;
      height: 28px;
      display: block;
    }
    .wiredove-share-icon:hover {
      filter: brightness(0.9);
    }
  `
  document.head.appendChild(style)
}

const ensureWiredoveLogo = (button, { createIfMissing = false } = {}) => {
  let img = button.querySelector('img')
  if (!img && createIfMissing) {
    img = document.createElement('img')
    button.appendChild(img)
  }
  if (!img) { return }
  if (!img.getAttribute('alt')) { img.setAttribute('alt', 'Wiredove logo') }
  if (!img.getAttribute('src')) {
    img.src = new URL('./assets/dovepurple_sm.png', import.meta.url).href
  }
}

const resolveValue = (value) => {
  return typeof value === 'function' ? value() : value
}

const buildPayload = (value) => {
  const base = {
    title: document.title ? document.title.trim() : 'Shared link',
    url: window.location.href
  }
  if (!value) { return base }
  if (typeof value === 'string') {
    const text = value.trim()
    return text ? { ...base, text } : base
  }
  if (typeof value === 'object') {
    return { ...base, ...value }
  }
  return base
}

const openWiredoveShare = (payload) => {
  const encoded = encodeURIComponent(JSON.stringify(payload))
  const target = `${WIREDOVE_ORIGIN}/#share=${encoded}`
  window.open(target, '_blank', 'noopener')
}

export const attachShareButton = (button, payload) => {
  if (!button) { return }
  button.addEventListener('click', () => {
    const resolved = resolveValue(payload)
    openWiredoveShare(buildPayload(resolved))
  })
}

export const attachWiredoveShareButton = (button, payload) => {
  if (!button) { return }
  applyWiredoveStyles()
  button.classList.add('wiredove-share')
  if (!button.getAttribute('title')) {
    button.setAttribute('title', 'Share with ANProto')
  }
  ensureWiredoveLogo(button)
  attachShareButton(button, payload)
}

export const attachWiredoveIconShareButton = (button, payload) => {
  if (!button) { return }
  applyWiredoveStyles()
  button.classList.add('wiredove-share-icon')
  if (!button.getAttribute('title')) {
    button.setAttribute('title', 'Share with ANProto')
  }
  if (!button.getAttribute('aria-label')) {
    button.setAttribute('aria-label', 'Share on ANProto')
  }
  ensureWiredoveLogo(button, { createIfMissing: true })
  attachShareButton(button, payload)
}
