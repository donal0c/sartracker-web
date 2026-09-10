import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const supportedBuilderVersion = '26.16.1'

/** Mirror the selected builder's config default, without overriding an explicit toolset. */
export function appImageToolsetVersion(config) {
  const version = config.toolsets?.appimage ?? '0.0.0'
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid toolsets.appimage: ${JSON.stringify(version)}; expected a toolset version.`)
  }
  return version
}

/** Isolate the pinned builder internal API and require directly owned dependencies. */
export function loadPackageToolchain(manifest) {
  for (const name of ['@electron/asar', 'app-builder-lib', 'builder-util', 'electron-builder']) {
    const declared = manifest.devDependencies?.[name]
    if (typeof declared !== 'string' || !/^\d+\.\d+\.\d+$/.test(declared)) {
      throw new Error(`Package inspection requires a direct exact devDependency on ${name}; install the reviewed toolchain with npm ci.`)
    }
    let installed
    try { installed = require(`${name}/package.json`).version }
    catch (error) { throw new Error(`Package inspection cannot load declared ${name}; run npm ci.`, { cause: error }) }
    if (installed !== declared) throw new Error(`Package inspection ${name}: expected ${declared}, observed ${installed}; run npm ci.`)
  }
  if (manifest.devDependencies['app-builder-lib'] !== supportedBuilderVersion
    || manifest.devDependencies['electron-builder'] !== supportedBuilderVersion) {
    throw new Error(`Package inspection adapter supports electron-builder/app-builder-lib ${supportedBuilderVersion}; review its internal API before changing the pins.`)
  }
  try {
    const { getAppImageTools } = require('app-builder-lib/out/toolsets/linux.js')
    const { Arch } = require('builder-util')
    if (typeof getAppImageTools !== 'function' || !Number.isInteger(Arch?.x64)) throw new Error('Unexpected toolchain API shape.')
    return { getAppImageTools, x64: Arch.x64 }
  } catch (error) {
    throw new Error('Pinned AppImage inspection API is unavailable; run npm ci or review the builder adapter before packaging.', { cause: error })
  }
}
