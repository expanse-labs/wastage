import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	// The pin script tests spawn bash and write temp files; a loaded runner has taken 7s, past vitest's 5s default.
	test: { testTimeout: 30_000 }
});
