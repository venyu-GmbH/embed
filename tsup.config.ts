import { defineConfig } from 'tsup';

export default defineConfig({
	entry: ['src/index.ts'],
	format: ['esm', 'iife'],
	globalName: 'VenyuEmbed',
	dts: true,
	clean: true,
	minify: true,
	target: 'es2020',
	outDir: 'dist',
});
