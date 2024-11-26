import { bogbot } from './bogbot.js'
import { profile } from './profile.js'
import { composer } from './composer.js' 
import { render } from './render.js'

document.body.appendChild(await profile())
document.body.appendChild(await composer())

const scroller = document.createElement('div')
scroller.id = 'scroller'

document.body.appendChild(scroller)

const log = await bogbot.getLog()

log.forEach(async (hash) => {
  const rendered = await render(hash)
  scroller.insertBefore(rendered, scroller.firstChild)
})
