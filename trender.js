import { apds } from './apds.js' 

export const render = async (h) => {
  const get = await apds.get(h)
  const opened = await apds.open(get)
  const blob = await apds.get(opened.substring(13))
  const yaml = await apds.parseYaml(blob)
  //console.log(yaml)
  const handle = yaml.name ? get.substring(0, 10) + ' ' + yaml.name : get.substring(0, 10)
  console.log(`%c${handle} %c| ${yaml.body} -- %c${opened.substring(0, 13)}`, 'color: magenta', 'color: white', 'color: cyan')
  //console.log(opened)
  //console.log(blob)
}
