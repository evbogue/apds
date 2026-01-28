let apdsInstance = null

const apdsReady = (async () => {
  if (apdsInstance) { return apdsInstance }
  const { apds } = await import(new URL('../apds.js', import.meta.url).href)
  apdsInstance = apds
  await apdsInstance.start('apdsv1-share')
  return apdsInstance
})()

const pageMarkdown = () => {
  const title = document.title ? document.title.trim() : 'Shared link'
  const url = window.location.href
  return `[${title}](${url})`
}

const composeMessage = (raw) => {
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  const base = pageMarkdown()
  if (!trimmed) { return base }
  if (trimmed.includes(window.location.href)) { return trimmed }
  return `${trimmed}\n\n${base}`
}

const loadConfig = async () => {
  const apds = await apdsReady
  return {
    name: (await apds.get('name')) || '',
    keypair: (await apds.keypair()) || ''
  }
}

const saveConfig = async (config) => {
  const apds = await apdsReady
  const name = config.name.trim()
  const keypair = config.keypair.trim()
  if (name) {
    await apds.put('name', name)
  } else {
    await apds.rm('name')
  }
  if (keypair) {
    await apds.put('keypair', keypair)
  } else {
    await apds.rm('keypair')
  }
}

const buildPopover = (config, onClose, initialMessage) => {
  const wrapper = document.createElement('div')
  wrapper.className = 'anproto-popover'
  wrapper.innerHTML = `
    <div class="anproto-card" role="dialog" aria-modal="true" aria-label="Share on ANProto">
      <div class="anproto-header">
        <div>
          <div class="anproto-title">Share on ANProto</div>
        </div>
        <button type="button" class="anproto-close" aria-label="Close">×</button>
      </div>
      <div class="anproto-meta">
        <label>
          <input type="text" name="name" placeholder="Your name" />
        </label>
        <label>
          <div class="anproto-keypair-row">
            <input type="text" name="keypair" placeholder="Paste your keypair" />
            <button type="button" class="anproto-tertiary">Genkey</button>
          </div>
        </label>
      </div>
      <label class="anproto-body">
        <textarea name="message" rows="6"></textarea>
      </label>
      <div class="anproto-preview" aria-live="polite"></div>
      <div class="anproto-actions">
        <button type="button" class="anproto-primary">Preview</button>
        <button type="button" class="anproto-secondary" disabled>Publish</button>
      </div>
    </div>
  `

  const nameInput = wrapper.querySelector('input[name="name"]')
  const keypairInput = wrapper.querySelector('input[name="keypair"]')
  const messageInput = wrapper.querySelector('textarea[name="message"]')
  const closeButton = wrapper.querySelector('.anproto-close')
  const previewButton = wrapper.querySelector('.anproto-primary')
  const publishButton = wrapper.querySelector('.anproto-secondary')
  const genkeyButton = wrapper.querySelector('.anproto-tertiary')
  const previewArea = wrapper.querySelector('.anproto-preview')

  nameInput.value = config.name
  keypairInput.value = config.keypair
  messageInput.value = composeMessage(initialMessage)
  const persist = async () => {
    await saveConfig({
      name: nameInput.value,
      keypair: keypairInput.value
    })
  }

  nameInput.addEventListener('change', persist)
  keypairInput.addEventListener('change', persist)

  closeButton.addEventListener('click', onClose)

  let latestHash = null

  const fetchLatestFromPub = async () => {
    try {
      const apds = await apdsReady
      const pubkey = await apds.pubkey()
      if (!pubkey) { return null }
      const res = await fetch('https://pub.wiredove.net/gossip', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: pubkey
      })
      if (!res.ok) { return null }
      const data = await res.json()
      const messages = Array.isArray(data.messages) ? data.messages : []
      const latestSig = messages.find((msg) => typeof msg === 'string' && msg.endsWith('==')) ||
        messages.find((msg) => typeof msg === 'string' && msg.length > 44)
      if (!latestSig) { return null }
      return await apds.hash(latestSig)
    } catch (err) {
      return null
    }
  }

  const renderPreview = async ({ name, body, timestamp }) => {
    previewArea.innerHTML = ''
    const container = document.createElement('div')
    container.className = 'message'

    const meta = document.createElement('div')
    meta.className = 'message-meta'
    const nameEl = document.createElement('div')
    nameEl.className = 'message-name'
    nameEl.textContent = name || 'anonymous'
    const timeEl = document.createElement('div')
    timeEl.className = 'message-time'
    timeEl.textContent = timestamp || ''
    meta.appendChild(nameEl)
    meta.appendChild(timeEl)

    const messageBody = document.createElement('div')
    messageBody.className = 'message-body'
    const content = document.createElement('div')
    content.className = 'content'
    content.textContent = body || ''
    messageBody.appendChild(content)

    container.appendChild(meta)
    container.appendChild(messageBody)
    previewArea.appendChild(container)
  }

  previewButton.addEventListener('click', async () => {
    previewButton.textContent = 'Previewing...'
    await persist()
    const apds = await apdsReady
    latestHash = await fetchLatestFromPub()
    const pubkey = await apds.pubkey()
    const name = (await apds.get('name')) || ''
    const image = await apds.get('image')
    const message = composeMessage(messageInput.value)
    const meta = {}
    if (name) { meta.name = name }
    if (image) { meta.image = image }
    if (latestHash) { meta.previous = latestHash }
    let content = message
    if (Object.keys(meta).length) {
      content = await apds.createYaml(meta, message)
    }
    const yaml = await apds.parseYaml(content)
    const body = yaml?.body || content
    const timestamp = await apds.human(Date.now())
    await renderPreview({
      name: yaml?.name || name || (pubkey ? pubkey.substring(0, 10) : 'anonymous'),
      body,
      timestamp
    })
    publishButton.disabled = false
    previewButton.textContent = 'Preview'
  })

  publishButton.addEventListener('click', async () => {
    publishButton.textContent = 'Publishing...'
    await persist()
    const apds = await apdsReady
    const pubkey = await apds.pubkey()
    if (!pubkey) {
      publishButton.textContent = 'Publish'
      previewArea.textContent = 'Missing keypair.'
      return
    }
    latestHash = await fetchLatestFromPub()
    if (latestHash) {
      await apds.put('previous', latestHash)
    } else {
      await apds.rm('previous')
    }
    const published = await apds.compose(composeMessage(messageInput.value))
    const signed = await apds.get(published)
    const opened = await apds.open(signed)
    const content = opened ? await apds.get(opened.substring(13)) : null
    const sendToPub = async (msg) => {
      if (!msg) { return }
      await fetch('https://pub.wiredove.net/gossip', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: msg
      })
    }
    await sendToPub(signed)
    await sendToPub(content)
    if (content) {
      const images = content.match(/!\\[.*?\\]\\((.*?)\\)/g)
      if (images) {
        for (const image of images) {
          const src = image.match(/!\\[.*?\\]\\((.*?)\\)/)[1]
          const imgBlob = await apds.get(src)
          if (imgBlob) { await sendToPub(imgBlob) }
        }
      }
    }
    const target = `https://wiredove.net/#${published}`
    window.open(target, '_blank', 'noopener')
    publishButton.textContent = 'Publish'
  })

  genkeyButton.addEventListener('click', async () => {
    genkeyButton.textContent = 'Working...'
    const apds = await apdsReady
    const keypair = await apds.generate()
    keypairInput.value = keypair
    await apds.put('keypair', keypair)
    genkeyButton.textContent = 'Genkey'
  })

  return wrapper
}

const applyStyles = () => {
  if (document.getElementById('anproto-share-styles')) { return }
  const style = document.createElement('style')
  style.id = 'anproto-share-styles'
  style.textContent = `
    .anproto-popover {
      position: fixed;
      inset: 0;
      display: grid;
      place-items: center;
      z-index: 9999;
    }
    .anproto-card {
      width: min(520px, calc(100vw - 32px));
      background: #fff;
      border: 0;
      border-radius: 5px;
      padding: 16px;
      display: grid;
      gap: 16px;
    }
    .anproto-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }
    .anproto-meta {
      display: grid;
      gap: 12px;
    }
    .anproto-meta label,
    .anproto-body {
      display: grid;
      gap: 6px;
    }
    .anproto-body textarea {
      resize: vertical;
    }
    .anproto-preview {
    }
    .anproto-preview:empty {
      display: none;
    }
    .anproto-preview .message {
      position: relative;
    }
    .anproto-preview .message-meta {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 6px;
    }
    .anproto-preview .message-body {
      flex: 1;
      min-width: 0;
    }
    .anproto-preview .content { white-space: pre-wrap; }
    .anproto-keypair-row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      align-items: center;
    }
    .anproto-actions {
      display: flex;
      gap: 12px;
      justify-content: flex-end;
    }
    .anproto-actions button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  `
  document.head.appendChild(style)
}

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
  `
  document.head.appendChild(style)
}

const ensureWiredoveLogo = (button) => {
  const img = button.querySelector('img')
  if (!img) { return }
  if (!img.getAttribute('alt')) { img.setAttribute('alt', 'Wiredove logo') }
  if (!img.getAttribute('src')) {
    img.src = new URL('./assets/dovepurple_sm.png', import.meta.url).href
  }
}

const resolveValue = (value) => {
  return typeof value === 'function' ? value() : value
}

export const attachShareButton = (button, messageText, keypair) => {
  if (!button) { return }
  applyStyles()

  const openPopover = async () => {
    if (document.querySelector('.anproto-popover')) { return }
    const config = await loadConfig()
    const resolvedKeypair = resolveValue(keypair)
    if (typeof resolvedKeypair === 'string') {
      await saveConfig({
        name: config.name,
        keypair: resolvedKeypair
      })
      config.keypair = resolvedKeypair
    }
    const close = () => {
      document.removeEventListener('keydown', handleKeydown)
      document.body.removeChild(popover)
    }
    const popover = buildPopover(config, close, resolveValue(messageText))

    const handleOutside = (event) => {
      if (event.target === popover) { close() }
    }

    const handleKeydown = (event) => {
      if (event.key === 'Escape') { close() }
    }

    document.addEventListener('keydown', handleKeydown)
    popover.addEventListener('click', handleOutside)
    document.body.appendChild(popover)
  }

  button.addEventListener('click', openPopover)
}

export const attachWiredoveShareButton = (button, messageText, keypair) => {
  if (!button) { return }
  applyWiredoveStyles()
  button.classList.add('wiredove-share')
  ensureWiredoveLogo(button)
  attachShareButton(button, messageText, keypair)
}
