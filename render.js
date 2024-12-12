import { bogbot } from './bogbot.js'
import { h } from './lib/h.js'

export const render = {}

render.blob = async (blob) => {
  const hash = await bogbot.hash(blob)

  const div = await document.getElementById(hash)

  try {
    const opened = await bogbot.open(blob)
    const ts = h('span', [await bogbot.human(opened.substring(0, 13))])
    setInterval(async () => {
      ts.textContent = await bogbot.human(opened.substring(0, 13))
    }, 1000)
    if (div) {
      const img = await bogbot.visual(blob.substring(0, 44))
      img.id = 'image'
      img.style = 'width: 30px; height: 30px; float: left; margin-right: 5px; object-fit: cover;'
      div.appendChild(img)
      div.appendChild(h('a', {href: '#' + blob.substring(0, 44), id: 'name'}, [blob.substring(0, 10)]))
      div.appendChild(h('a', {href: '#' + hash, style: 'float: right;'}, [ts]))
      div.appendChild(h('div', {id: opened.substring(13)}))
      const content = await bogbot.find(opened.substring(13))
      if (content) {
        await render.blob(content)
      }
    } else {
      console.log('Div is not in view')
    }
  } catch (err) {
    console.log('Not a valid protocol message')
    const yaml = await bogbot.parseYaml(blob)
    if (div) {
      div.textContent = yaml.body
      div.parentNode.childNodes.forEach(async (node) => {
        if (yaml.name && node.id === 'name') {
          node.textContent = yaml.name
        }
        if (yaml.image && node.id === 'image') {
          const image = await bogbot.find(yaml.image)
          node.src = image
        }
      })
    }
    console.log(yaml)
  }
}

render.hash = async (hash, scroller) => {
  const div = h('div', {id: hash}) 

  scroller.insertBefore(div, scroller.firstChild)

  const sig = await bogbot.find(hash)

  if (sig) {
    await render.blob(sig)
  } else {
    await gossip(hash)
  }

}
