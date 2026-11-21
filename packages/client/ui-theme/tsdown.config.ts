import { clientBundle } from '../tsdown.client.ts'

export default clientBundle(
  import.meta.dirname,
  ['lib/types/index.js'],
  {
    lib: {
      copy: [
        {
          from: 'src/styles/{brand-font.css,Space-Grotesk-OFL.txt,IBM-Plex-Serif-OFL.txt}',
          to: 'lib/styles',
        },
        {
          from: 'src/styles/{space-grotesk-*.woff2,ibm-plex-serif-*.woff2}',
          to: 'lib/styles',
        },
      ],
    },
  },
)
