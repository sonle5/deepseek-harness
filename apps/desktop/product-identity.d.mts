/** Public product identity shared by the Electron runtime and packaging scripts. */
export interface ProductIdentity {
  readonly productName: 'Nexus Superharness'
  readonly shortName: 'Nexus'
  readonly copyright: string
  readonly attribution: 'Built on DeepSeek Harness'
  readonly appId: 'com.onenexus.superharness'
  readonly artifactPrefix: 'nexus-superharness'
  readonly protocol: 'nexus-superharness'
  readonly updatesEnabled: false
  readonly legacyUserDataDirectory: '@deepseek-ai/dsh-desktop'
  readonly developmentBundleName: 'Nexus Superharness Dev.app'
  readonly developmentExecutableName: 'NexusSuperharnessDev'
}

export const PRODUCT_IDENTITY: ProductIdentity
