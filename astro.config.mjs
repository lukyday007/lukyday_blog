import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
	site: 'https://lukyday-blog.vercel.app',
	integrations: [
		sitemap(),
		starlight({
			title: "Dayul's Tech Blog",
			lastUpdated: true,
			favicon: '/owl.png',
			head: [
				{
					tag: 'meta',
					attrs: {
						name: 'google-site-verification',
						content: "UFnUU60lojUILDpWoAoFgwIYh-DxlhHk5NLRvuoL3Jw",
					},
				},
				{
					tag: 'script',
					attrs: {
						src: 'https://va.vercel-scripts.com/v1/script.debug.js',
						defer: true,
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
					label: 'Large-Scale',
					autogenerate: { directory: 'large-scale' },
				},
				{
					label: 'CS Basics',
					autogenerate: { directory: 'cs-basics' },
				},
			],
		}),
	],
});