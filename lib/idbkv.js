import { openDB, deleteDB } from 'https://cdn.jsdelivr.net/npm/idb@8.0.3/+esm'

export const idbkv = async (appId) => {
  const db = await openDB(appId, 1, {
    upgrade (db) {
      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv')
      }
    }
  })

  const obj = {}
  obj.get = async function (key) {
    return await db.get('kv', key)
  }

  obj.put = async function (key, string) {
    await db.put('kv', string, key)
  }

  obj.rm = async function (key) {
    await db.delete('kv', key)
  }

  obj.clear = async function () {
    db.close()
    await deleteDB(appId)
  }

  return obj
}
