import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
	site: 'https://lukyday-blog.vercel.app',
	integrations: [
		sitemap(),
		starlight({
			title: "Dayul's Tech Blog",
			head: [
				{
					tag: 'meta',
					attrs: {
						name: 'google-site-verification',
						content: "UFnUU60lojUILDpWoAoFgwIYh-DxlhHk5NLRvuoL3Jw",
					},
				},
			],
			defaultLocale: 'root', 
			components: {
				LastUpdated: './src/components/Comments.astro', 
			},
			locales: {
				root: {
					label: '한국어',
					lang: 'ko',
				},
				en: {
					label: 'English',
					lang: 'en',
				},
			},
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					href: 'https://github.com/lukyday007',
				},
			],
			sidebar: [
				{
					label: 'High-Scale',
					autogenerate: { directory: 'high-scale' },
				},
				{
					label: 'CS Basics',
					autogenerate: { directory: 'cs-basics' },
				},
			],
		}),
	],
});