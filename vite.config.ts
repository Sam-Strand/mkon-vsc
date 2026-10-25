import { defineConfig } from 'vite'

export default defineConfig({
    build: {
        target: 'node20',
        lib: {
            entry: 'src/extension.js',
            formats: ['cjs'],
            fileName: () => 'extension.js'
        },
        rollupOptions: {
            external: ['vscode', 'os']
        },
        outDir: 'dist',
        sourcemap: true
    }
})
