import { defineConfig } from 'clearify';

export default defineConfig({
  name: 'Storage Brain',
  siteUrl: 'https://storage-brain-docs.lumitra.co',
  hubProject: {
    name: 'Storage Brain',
    description: 'File storage & processing with multi-tenant workspaces',
    status: 'active',
    icon: '📦',
    tags: ['api', 'storage', 'cloudflare'],
    group: 'Lumitra Infrastructure',
  },
  sections: [
    { label: 'Documentation', docsDir: './docs/public' },
    { label: 'Internal', docsDir: './docs/internal', basePath: '/internal', draft: true },
  ],
  mermaid: {
    strategy: 'client',
  },
});
