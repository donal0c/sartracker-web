import { validateRuntimeObservation } from './package-runtime.mjs'

/** Require outer controller observations before describing a generic packaged producer as AppImage or installed Debian proof. */
export function validateProducerPackageTier(proofMode, runtime) {
  if (!['ci-appimage', 'installed-deb'].includes(proofMode)
      || runtime?.expected?.proofMode !== proofMode
      || !Array.isArray(runtime.observations) || runtime.observations.length === 0) {
    throw new Error('Exact package proof mode requires independently bound runtime observations.')
  }
  for (const observation of runtime.observations) validateRuntimeObservation(observation, runtime.expected)
  return runtime.expected
}
