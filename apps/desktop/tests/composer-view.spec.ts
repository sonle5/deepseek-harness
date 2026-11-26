import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ WebContentsView: vi.fn(), session: {}, shell: { openExternal: vi.fn() } }))

const {
  composerInvokeRequest, developmentComposerResources, isComposerSender, isComposerUrl, serveComposerRequest,
} = await import('../src/composer-view.ts')

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function composerCheckout(options: { dist?: boolean; binary?: boolean } = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'desktop-composer-'))
  roots.push(root)
  if (options.dist !== false) {
    await mkdir(join(root, 'dist', 'assets'), { recursive: true })
    await writeFile(join(root, 'dist', 'index.html'), '<html><head></head><body></body></html>')
    await writeFile(join(root, 'dist', 'assets', 'entry.js'), 'globalThis.composer = true')
  }
  if (options.binary !== false) {
    await mkdir(join(root, 'src-tauri', 'target', 'debug'), { recursive: true })
    await writeFile(join(root, 'src-tauri', 'target', 'debug', process.platform === 'win32' ? 'nexus-composer.exe' : 'nexus-composer'), '')
  }
  return root
}

describe('composer partition protocol', () => {
  it('serves only the Composer host from the built renderer', async () => {
    const dist = join(await composerCheckout(), 'dist')
    expect((await serveComposerRequest(new Request('dsh-app://composer/'), dist)).status).toBe(200)
    expect(await (await serveComposerRequest(new Request('dsh-app://composer/assets/entry.js'), dist)).text()).toContain('composer')
    expect((await serveComposerRequest(new Request('dsh-app://composer/missing.js'), dist)).status).toBe(404)
    expect((await serveComposerRequest(new Request('dsh-app://composer/%2e%2e%2f%2e%2e%2fsecret'), dist)).status).toBe(403)
    // The Superharness application and shell documents are unreachable from the Composer partition.
    expect((await serveComposerRequest(new Request('dsh-app://app/'), dist)).status).toBe(404)
    expect((await serveComposerRequest(new Request('dsh-app://shell/welcome.html'), dist)).status).toBe(404)
  })
})

describe('composer IPC sender', () => {
  const frame = (url: string) => ({ url })
  it('accepts only the top frame of the live view on the Composer origin', () => {
    const mainFrame = frame('dsh-app://composer/')
    const contents = { mainFrame } as never
    expect(isComposerSender({ sender: contents, senderFrame: mainFrame } as never, contents)).toBe(true)
    expect(isComposerSender({ sender: contents, senderFrame: mainFrame } as never, undefined)).toBe(false)
    expect(isComposerSender({ sender: {}, senderFrame: mainFrame } as never, contents)).toBe(false)
    expect(isComposerSender({ sender: contents, senderFrame: frame('dsh-app://composer/') } as never, contents)).toBe(false)
    expect(isComposerSender({ sender: contents, senderFrame: null }, contents)).toBe(false)
    const navigated = frame('https://example.com/')
    const elsewhere = { mainFrame: navigated } as never
    expect(isComposerSender({ sender: elsewhere, senderFrame: navigated } as never, elsewhere)).toBe(false)
    const app = frame('dsh-app://app/')
    const appContents = { mainFrame: app } as never
    expect(isComposerSender({ sender: appContents, senderFrame: app } as never, appContents)).toBe(false)
  })

  it('recognizes Composer document URLs', () => {
    expect(isComposerUrl('dsh-app://composer/settings')).toBe(true)
    expect(isComposerUrl('dsh-app://app/')).toBe(false)
    expect(isComposerUrl('dsh-app://user@composer/')).toBe(false)
    expect(isComposerUrl('https://composer/')).toBe(false)
    expect(isComposerUrl('not a url')).toBe(false)
  })

  it('validates command names and argument objects', () => {
    expect(composerInvokeRequest('get_providers', { app: 'claude' })).toEqual({ command: 'get_providers', args: { app: 'claude' } })
    expect(composerInvokeRequest('get_init_error', undefined)).toEqual({ command: 'get_init_error', args: {} })
    expect(composerInvokeRequest('../hello', {})).toBeUndefined()
    expect(composerInvokeRequest('Get', {})).toBeUndefined()
    expect(composerInvokeRequest('get_providers', [])).toBeUndefined()
    expect(composerInvokeRequest('get_providers', null)).toBeUndefined()
    expect(composerInvokeRequest(1, {})).toBeUndefined()
  })
})

describe('development Composer directory', () => {
  it('is optional', () => {
    expect(developmentComposerResources(undefined)).toBeUndefined()
    expect(developmentComposerResources('')).toBeUndefined()
  })

  it('resolves a built checkout', async () => {
    const root = await composerCheckout()
    expect(developmentComposerResources(root)).toEqual({
      dist: join(root, 'dist'),
      binary: join(root, 'src-tauri', 'target', 'debug', process.platform === 'win32' ? 'nexus-composer.exe' : 'nexus-composer'),
    })
  })

  it('fails loudly when set but unusable', async () => {
    expect(() => developmentComposerResources('relative/composer')).toThrow('absolute path')
    expect(() => developmentComposerResources(join(tmpdir(), 'no-such-composer'))).toThrow('no built renderer')
    expect(() => developmentComposerResources(join(tmpdir(), 'no-such-composer'))).toThrow(/DSH_DESKTOP_COMPOSER_DIR/)
    const noBinary = await composerCheckout({ binary: false })
    expect(() => developmentComposerResources(noBinary)).toThrow('no sidecar binary')
  })
})
