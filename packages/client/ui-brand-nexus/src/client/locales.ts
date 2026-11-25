/**
 * Nexus brand copy.
 *
 * The product name is the same in every language — it is a proper noun — but
 * the mark's accessible label has to be translatable the moment it changes. It
 * lives here so the package owns its own copy instead of borrowing the shell's
 * dictionary.
 */

/** English brand copy. */
export const en = {
  'product.name': 'Nexus Superharness',
}

/** Chinese brand copy. */
export const zh = {
  'product.name': 'Nexus Superharness',
} satisfies Record<keyof typeof en, string>

/** Japanese brand copy. */
export const ja = {
  'product.name': 'Nexus Superharness',
} satisfies Record<keyof typeof en, string>

/** Spanish brand copy. */
export const es = {
  'product.name': 'Nexus Superharness',
} satisfies Record<keyof typeof en, string>

/** French brand copy. */
export const fr = {
  'product.name': 'Nexus Superharness',
} satisfies Record<keyof typeof en, string>

/** German brand copy. */
export const de = {
  'product.name': 'Nexus Superharness',
} satisfies Record<keyof typeof en, string>

/** Russian brand copy. */
export const ru = {
  'product.name': 'Nexus Superharness',
} satisfies Record<keyof typeof en, string>

/** Portuguese brand copy. */
export const pt = {
  'product.name': 'Nexus Superharness',
} satisfies Record<keyof typeof en, string>

/** Dictionary key domain of the Nexus brand namespace. */
export type BrandNexusKey = keyof typeof en

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Brand name for the Nexus identity. */
    brandNexus: BrandNexusKey
  }
}
