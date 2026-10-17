export async function readStartupSession<T>(read: () => Promise<T | null>, timeoutMs = 4000): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve().then(read),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), timeoutMs) }),
    ])
  } catch {
    return null
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
