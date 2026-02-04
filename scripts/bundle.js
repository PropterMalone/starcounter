import esbuild from 'esbuild';
import { existsSync, mkdirSync } from 'fs';

// Ensure dist directory exists
if (!existsSync('dist')) {
  mkdirSync('dist', { recursive: true });
}

// Build configuration
const buildOptions = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'dist/bundle.js',
  platform: 'browser',
  target: 'es2020',
  format: 'esm',
  sourcemap: true,
  minify: process.env.NODE_ENV === 'production',
  loader: {
    '.ts': 'ts',
  },
};

try {
  await esbuild.build(buildOptions);
  console.log('✓ Build completed successfully');
} catch (error) {
  console.error('✗ Build failed:', error);
  process.exit(1);
}
