import {build} from 'esbuild';
import {cp,mkdir,writeFile} from 'node:fs/promises';
await mkdir('dist/public/assets',{recursive:true});
await build({entryPoints:['src/main.tsx'],bundle:true,minify:true,outfile:'dist/public/assets/community.js',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
await build({entryPoints:['src/server.ts'],bundle:true,platform:'node',target:'node22',format:'esm',outfile:'dist/server.mjs',external:['pg','@electric-sql/pglite']});
await cp('public','dist/public',{recursive:true});
await writeFile('dist/public/index.html','<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>百无禁忌社区 - 有趣的灵魂在这里碰爪</title><meta name="description" content="马卡龙色猫爪社区，免费注册、分享生活、发布帖子、参与回复。"><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/assets/community.css"></head><body><div id="root"></div><script type="module" src="/assets/community.js"></script></body></html>');
