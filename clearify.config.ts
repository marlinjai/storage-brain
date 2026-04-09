import { defineConfig } from 'clearify';

export default defineConfig({
  name: 'Storage Brain',
  siteUrl: 'https://storage-brain-docs.lumitra.co',
  hubProject: {
    hubUrl: 'https://docs.lumitra.co',
    hubName: 'ERP Suite',
    description: 'Multi-tenant file storage with workspaces, signed URLs, and S3/R2 adapters',
    status: 'active',
    icon: '📦',
    tags: ['api', 'storage', 'cloudflare', 'self-hosting'],
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
