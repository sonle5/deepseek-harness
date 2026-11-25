/**
 * Nexus brand copy.
 *
 * The product name is the same in every language — it is a proper noun — but
 * the home attribution line is a sentence, and the mark's accessible label has
 * to be translatable the moment either changes. Both live here so the package
 * owns its own copy instead of borrowing the shell's dictionary.
 */

/** English brand copy. */
export const en = {
  'product.name': 'Nexus Superharness',
  'home.attribution': 'Built on DeepSeek Harness',
}

/** Chinese brand copy. */
export const zh = {
  'product.name': 'Nexus Superharness',
  'home.attribution': '基于 DeepSeek Harness 构建',
} satisfies Record<keyof typeof en, string>

/** Japanese brand copy. */
export const ja = {
  'product.name': 'Nexus Superharness',
  'home.attribution': 'DeepSeek Harness を基盤としています',
} satisfies Record<keyof typeof en, string>

/** Spanish brand copy. */
export const es = {
  'product.name': 'Nexus Superharness',
  'home.attribution': 'Creado sobre DeepSeek Harness',
} satisfies Record<keyof typeof en, string>

/** French brand copy. */
export const fr = {
  'product.name': 'Nexus Superharness',
  'home.attribution': 'Propulsé par DeepSeek Harness',
} satisfies Record<keyof typeof en, string>

/** German brand copy. */
export const de = {
  'product.name': 'Nexus Superharness',
  'home.attribution': 'Basiert auf DeepSeek Harness',
} satisfies Record<keyof typeof en, string>

/** Russian brand copy. */
export const ru = {
  'product.name': 'Nexus Superharness',
  'home.attribution': 'На основе DeepSeek Harness',
} satisfies Record<keyof typeof en, string>

/** Portuguese brand copy. */
export const pt = {
  'product.name': 'Nexus Superharness',
  'home.attribution': 'Criado com DeepSeek Harness',
} satisfies Record<keyof typeof en, string>

/** Dictionary key domain of the Nexus brand namespace. */
export type BrandNexusKey = keyof typeof en

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Brand name and home attribution for the Nexus identity. */
    brandNexus: BrandNexusKey
  }
}
