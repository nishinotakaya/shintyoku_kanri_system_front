// 各ユーザー（ブラウザ）が選んだ FileSystemDirectoryHandle を IndexedDB に保存して
// 次回以降同じフォルダにアクセスできるようにする。
// Server に固定パスを持たないので、複数ユーザーが各自のローカル PC で完結する。

const DB_NAME = 'attendance-app'
const STORE = 'dir-handles'
const DB_VERSION = 1

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function getStoredDirHandle(key: string): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(key)
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle | undefined) ?? null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

export async function saveDirHandle(key: string, handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(handle, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function clearDirHandle(key: string): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // noop
  }
}

// ハンドルの readwrite 権限を確認 / 要求
export async function ensureRwPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  // queryPermission / requestPermission は File System Access API の実験的メソッドで lib.dom.d.ts に未定義
  const permissionHandle = handle as unknown as {
    queryPermission(descriptor: { mode: 'readwrite' }): Promise<PermissionState>
    requestPermission(descriptor: { mode: 'readwrite' }): Promise<PermissionState>
  }
  const descriptor = { mode: 'readwrite' as const }
  if ((await permissionHandle.queryPermission(descriptor)) === 'granted') return true
  if ((await permissionHandle.requestPermission(descriptor)) === 'granted') return true
  return false
}
