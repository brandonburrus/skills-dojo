import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import starlightThemeFlexoki from 'starlight-theme-flexoki'
export default defineConfig({
  site: 'https://skillsdojo.dev',
  integrations: [
    starlight({
      title: 'Skills Dojo',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/brandonburrus/skills-dojo',
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/brandonburrus/skills-dojo/edit/main/docs/',
      },
      favicon: '/logo.png',
      logo: {
        src: './public/logo.png',
        alt: 'Skills Dojo',
      },
      customCss: ['./src/styles/custom.css'],
      plugins: [starlightThemeFlexoki()],
      components: {
        Footer: './src/components/Footer.astro',
      },
      expressiveCode: {
        themes: ['one-dark-pro'],
      },
      sidebar: [
        {
          label: 'Guides',
          items: [
            { label: 'Quick Start', slug: 'guides/quick-start' },
            { label: 'Selection Evals', slug: 'guides/writing-evals' },
            { label: 'Effectiveness Evals', slug: 'guides/effectiveness-evals' },
            { label: 'Testing Variants', slug: 'guides/testing-variants' },
            { label: 'Setup', slug: 'guides/setup' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Commands', slug: 'reference/commands' },
            { label: 'Evals', slug: 'reference/evals' },
            { label: 'Variants', slug: 'reference/variants' },
            { label: 'Config', slug: 'reference/config' },
          ],
        },
      ],
    }),
  ],
})
