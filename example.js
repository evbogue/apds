import { bogbot } from './bogbot.js'
import { profile } from './profile.js'
import { composer } from './composer.js' 
import { render } from './render.js'

await bogbot.start('bog5example')

if (!await bogbot.pubkey()) { 
  const keypair = await bogbot.generate()
  await bogbot.save('keypair', keypair)
}

document.body.appendChild(await profile())
document.body.appendChild(await composer())

const scroller = document.createElement('div')
scroller.id = 'scroller'

document.body.appendChild(scroller)

const log = await bogbot.getLog()

log.forEach(async (hash) => {
  await render.hash(hash, scroller)
})
