import { describe, expect, it } from 'vitest'

import viteConfig from '../../vite.config'

describe('vite config', () => {
  it('emits relative asset URLs so packaged Electron file URLs can boot', () => {
    expect(viteConfig).toMatchObject({
      base: './',
    })
  })
})
