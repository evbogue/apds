import { bogbot } from './bogbot.js'
import { render } from './render.js'

export const composer = async () => {
  const div = document.createElement('div')
  const ta = document.createElement('textarea')
  
  ta.placeholder = 'Write a message'
  
  div.appendChild(ta)
  
  const b = document.createElement('button')
  
  b.textContent = 'Sign'
  
  b.onclick = async () => {
    const published = await bogbot.compose(ta.value)
    ta.value = ''
    const rendered = await render(published)
    const scroller = document.getElementById('scroller')
    scroller.insertBefore(rendered, scroller.firstChild)
    //const el = document.createElement('div')
    //const obj = {}
    //obj.protocolHash = published
    //obj.sig = await bogbot.find(published)
    //obj.opened = await bogbot.open(obj.sig)
    //obj.content = await bogbot.find(obj.opened.substring(13))
    //el.textContent = JSON.stringify(obj)
    //document.body.appendChild(el)
  }
  
  div.appendChild(b)

  return div
}
