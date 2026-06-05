import esbuild from 'esbuild';
import { existsSync, mkdirSync } from 'fs';

// Ensure output directory exists
if (!existsSync('worker/dist')) {
  mkdirSync('worker/dist', { recursive: true });
}

const buildOptions = {
  entryPoints: ['worker/bot.ts'],
  bundle: true,
  outfile: 'worker/dist/worker.js',
  platform: 'browser',
  target: 'es2022',
  format: 'esm',
  sourcemap: true,
  minify: process.env.NODE_ENV === 'production',
  loader: {
    '.ts': 'ts',
  },
  // Cloudflare Workers provide these globally
  external: [],
};

try {
  await esbuild.build(buildOptions);
  console.log('✓ Worker build completed successfully');
} catch (error) {
  console.error('✗ Worker build failed:', error);
  process.exit(1);
}
