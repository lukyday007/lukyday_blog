import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
	integrations: [
		starlight({
			title: "Dayul's Tech Blog",
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