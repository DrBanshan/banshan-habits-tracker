import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const WATCH = process.argv.includes('--watch');

async function build() {
  const ctx = await esbuild.context({
    entryPoints: ['src/main.ts'],
    bundle: true,
    outfile: '.obsidian/plugins/banshan-habits-tracker/main.js',
    external: ['obsidian'],
    format: 'cjs',
    platform: 'browser',
    target: 'es2018',
    minify: true,
    sourcemap: false,
    logLevel: 'info',
    plugins: [
      {
        name: 'copy-manifest',
        setup(build) {
          build.onEnd(() => {
            const manifestSrc = 'manifest.json';
            const manifestDst = '.obsidian/plugins/banshan-habits-tracker/manifest.json';
            if (fs.existsSync(manifestSrc)) {
              fs.copyFileSync(manifestSrc, manifestDst);
              console.log('Copied manifest.json');
            }
          });
        }
      },
      {
        name: 'copy-css',
        setup(build) {
          build.onEnd(() => {
            const cssSrc = 'src/styles.css';
            const cssDst = '.obsidian/plugins/banshan-habits-tracker/styles.css';
            if (fs.existsSync(cssSrc)) {
              fs.copyFileSync(cssSrc, cssDst);
              console.log('Copied styles.css');
            }
          });
        }
      }
    ]
  });

  if (WATCH) {
    await ctx.watch();
    console.log('Watching for changes...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log('Build complete');
  }
}

build().catch(e => {
  console.error(e);
  process.exit(1);
});
