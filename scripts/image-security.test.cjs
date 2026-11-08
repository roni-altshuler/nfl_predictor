/** Exercise Next's installed image stack without provider requests or generated artifacts. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { createRequire } = require('node:module')
const semver = require('next/dist/compiled/semver')
const loadConfig = require('next/dist/server/config').default
const { PHASE_PRODUCTION_SERVER } = require('next/constants')
const { detectContentType, imageOptimizer, ImageOptimizerCache } = require('next/dist/server/image-optimizer')
const nextRequire = createRequire(require.resolve('next/dist/server/image-optimizer'))
const manifest = require('../package.json')
const lock = require('../package-lock.json')
const config = loadConfig(PHASE_PRODUCTION_SERVER, path.resolve(__dirname, '..'))

test('the installed Next image stack retains the patched framework and production sharp pin', () => {
  const nextVersion = require('next/package.json').version
  assert.ok(semver.satisfies(nextVersion, '>=15.5.29 <16'), 'Keep the patched Next 15 maintenance line')
  assert.equal(nextVersion, manifest.dependencies.next)
  assert.equal(lock.packages['node_modules/next'].version, nextVersion)
  assert.equal(manifest.devDependencies['eslint-config-next'], nextVersion)
  assert.equal(lock.packages['node_modules/eslint-config-next'].version, nextVersion)
  const sharp = nextRequire('sharp')
  assert.ok(semver.gte(sharp.versions.sharp, '0.35.5'), 'Check the native library resolved from Next, including nested copies')
  assert.equal(sharp.versions.sharp, manifest.dependencies.sharp, 'sharp is an explicit production dependency')
  const sharpEntries = Object.entries(lock.packages).filter(([name]) => name.endsWith('/sharp'))
  assert.ok(sharpEntries.length > 0)
  for (const [name, entry] of sharpEntries) {
    assert.ok(semver.gte(entry.version, '0.35.5'), `${name} must not reintroduce an older image decoder`)
  }
})

test('the effective production configuration rejects SVG and unapproved remote image hosts', async () => {
  const resolved = await config
  assert.equal(resolved.images.dangerouslyAllowSVG, false)
  assert.deepEqual(resolved.images.remotePatterns, [{ protocol: 'https', hostname: 'a.espncdn.com', port: undefined, pathname: undefined, search: undefined }])
  assert.deepEqual(resolved.images.domains, [])
  const validate = url => ImageOptimizerCache.validateParams({ headers: {} }, { url, w: '16', q: '75' }, resolved, false)
  assert.equal(validate('https://a.espncdn.com/test.png').errorMessage, undefined)
  for (const url of ['https://example.com/test.png', 'http://a.espncdn.com/test.png', 'https://a.espncdn.com.example.com/test.png']) {
    assert.equal(validate(url).errorMessage, '"url" parameter is not allowed')
  }
})

test('benign SVG comments cannot masquerade as AVIF or HEIC and bypass default rejection', async () => {
  const resolved = await config
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'
  for (const prefix of ['', '<!--ftypavif-->', '<!--ftypheic-->']) {
    const buffer = Buffer.from(prefix + svg)
    assert.equal(await detectContentType(buffer), 'image/svg+xml')
    await assert.rejects(
      imageOptimizer({ buffer, etag: 'inert-svg-fixture', cacheControl: '' },
        { href: '/inert.svg', width: 16, quality: 75, mimeType: 'image/png' }, resolved, { isDev: false, silent: true }),
      error => error.statusCode === 400 && error.message.includes('image type is not allowed'),
    )
  }
})

test('a valid raster still passes through the actual native optimizer', async () => {
  const sharp = nextRequire('sharp')
  const buffer = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ffffff' } }).png().toBuffer()
  const result = await imageOptimizer({ buffer, etag: 'inert-raster-fixture', cacheControl: '' },
    { href: '/inert.png', width: 16, quality: 75, mimeType: 'image/png' }, await config, { isDev: false, silent: true })
  assert.equal(result.error, undefined, 'An upstream fallback is not a successful optimization')
  assert.equal(result.contentType, 'image/png')
  const metadata = await sharp(result.buffer).metadata()
  assert.equal(metadata.format, 'png')
  assert.equal(metadata.width, 2)
  assert.equal(metadata.height, 2)
})
