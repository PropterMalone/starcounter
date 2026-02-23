import esbuild from 'esbuild';
import { existsSync, mkdirSync } from 'fs';

if (!existsSync('dist')) {
  mkdirSync('dist', { recursive: true });
}

try {
  await esbuild.build({
    entryPoints: ['worker/bot-daemon.ts'],
    bundle: true,
    outfile: 'dist/bot-daemon.js',
    platform: 'node',
    target: 'node20',
    format: 'esm',
    sourcemap: true,
    // better-sqlite3 has native bindings — must be external
    external: ['better-sqlite3'],
    loader: { '.ts': 'ts' },
  });
  console.log('✓ Bot daemon build completed');
} catch (error) {
  console.error('✗ Bot daemon build failed:', error);
  process.exit(1);
}
