import esbuild from 'esbuild';
import { existsSync, mkdirSync } from 'fs';

// Ensure public directory exists
if (!existsSync('public')) {
  mkdirSync('public', { recursive: true });
}

// Build configuration
const buildOptions = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'public/bundle.js',
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
