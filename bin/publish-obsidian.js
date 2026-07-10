#!/usr/bin/env node
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const blogDir = path.resolve(__dirname, '..');
const defaultVaultName = 'codex-obsidian-second-brain';
const remote = 'git@github.com:jessicayang24/my-ai-gateway-vercle.git';

function run(command, args, options = {}) {
  console.log(`$ ${[command, ...args].join(' ')}`);
  execFileSync(command, args, {
    cwd: options.cwd || blogDir,
    stdio: 'inherit'
  });
}

function output(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd || blogDir,
    encoding: 'utf8'
  }).trim();
}

function parseInput(input) {
  if (!input) {
    throw new Error('Usage: node bin/publish-obsidian.js "<obsidian://open?...>" or "/path/to/article.md"');
  }

  if (!input.startsWith('obsidian://')) {
    return { filePath: path.resolve(input) };
  }

  const url = new URL(input);
  const vaultName = url.searchParams.get('vault') || defaultVaultName;
  const file = url.searchParams.get('file');
  if (!file) throw new Error('Obsidian URL is missing the file parameter.');
  return { vaultName, vaultRelativePath: file };
}

function findVault(vaultName) {
  const findScript = [
    'find /Users/yangxiaoba',
    "-path '*/Library' -prune",
    "-o -path '*/.Trash' -prune",
    "-o -path '*/Photos Library.photoslibrary' -prune",
    `-o -type d -name ${JSON.stringify(vaultName)} -print`,
    '2>/dev/null || true'
  ].join(' ');
  const candidates = output('sh', ['-c', findScript]).split('\n').filter(Boolean);

  if (!candidates.length) {
    throw new Error(`Could not find Obsidian vault: ${vaultName}`);
  }

  return candidates[0];
}

function readArticle(parsed) {
  let filePath = parsed.filePath || path.join(findVault(parsed.vaultName), parsed.vaultRelativePath);
  if (!fs.existsSync(filePath) && !filePath.endsWith('.md') && fs.existsSync(`${filePath}.md`)) {
    filePath = `${filePath}.md`;
  }
  if (!fs.existsSync(filePath)) throw new Error(`Article not found: ${filePath}`);
  return { filePath, raw: fs.readFileSync(filePath, 'utf8') };
}

function scalar(frontMatter, name, fallback = '') {
  const match = frontMatter.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'));
  if (!match) return fallback;
  return match[1].trim().replace(/^['"]|['"]$/g, '');
}

function list(frontMatter, name) {
  const match = frontMatter.match(new RegExp(`^${name}:\\n((?:\\s+- .+\\n?)+)`, 'm'));
  if (!match) return [];
  return match[1]
    .split(/\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.replace(/^-\s*/, '').replace(/^['"]|['"]$/g, ''));
}

function slugify(title) {
  return title
    .trim()
    .replace(/[\\/:*?"<>|#%{}^[\]`]+/g, '')
    .replace(/\s+/g, '-');
}

function convertObsidianMarkdown(raw, sourceFile) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`No YAML front matter found in ${sourceFile}`);

  const frontMatter = match[1];
  const title = scalar(frontMatter, 'title', path.basename(sourceFile, '.md'));
  const created = scalar(frontMatter, 'created', new Date().toISOString().slice(0, 10));
  const updated = scalar(frontMatter, 'updated', created);
  const tags = list(frontMatter, 'tags');
  let body = match[2].trimStart();

  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  body = body.replace(new RegExp(`^#\\s+${escapedTitle}\\s*\\n+`), '');
  body = body.replace(/!\[\[([^\]]+)\]\]/g, '![]($1)');
  body = body.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2');
  body = body.replace(/\[\[([^\]]+)\]\]/g, '$1');

  const hexo = [
    '---',
    `title: ${JSON.stringify(title)}`,
    `date: ${created} 00:00:00`,
    `updated: ${updated} 00:00:00`,
    'categories:',
    '  - 投资分析',
    'tags:',
    ...tags.map(tag => `  - ${tag}`),
    '---',
    '',
    body.trimEnd(),
    ''
  ].join('\n');

  return { title, hexo, slug: slugify(title) };
}

function writePost(article) {
  const postDir = path.join(blogDir, 'source', '_posts');
  fs.mkdirSync(postDir, { recursive: true });
  const postPath = path.join(postDir, `${article.slug}.md`);
  fs.writeFileSync(postPath, article.hexo, 'utf8');
  console.log(`Wrote ${postPath}`);
  return postPath;
}

function publishPages() {
  run('npm', ['run', 'build']);

  const tmp = fs.mkdtempSync('/private/tmp/hexo-pages-publish-');
  fs.cpSync(path.join(blogDir, 'public'), tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, '.nojekyll'), '');

  run('git', ['init'], { cwd: tmp });
  run('git', ['checkout', '-b', 'gh-pages'], { cwd: tmp });
  run('git', ['config', 'user.name', 'Jessica Yang'], { cwd: tmp });
  run('git', ['config', 'user.email', 'jessicayang24@users.noreply.github.com'], { cwd: tmp });
  run('git', ['add', '-A'], { cwd: tmp });
  run('git', ['commit', '-m', 'Deploy Hexo site'], { cwd: tmp });
  run('git', ['remote', 'add', 'origin', remote], { cwd: tmp });
  run('git', ['push', '-f', 'origin', 'gh-pages'], { cwd: tmp });
}

function commitSource(postPath) {
  run('git', ['add', postPath, 'bin/publish-obsidian.js', 'Publish Obsidian Article.command']);
  const staged = output('git', ['diff', '--cached', '--name-only']);
  if (!staged) {
    console.log('No source changes to commit.');
    return;
  }
  const message = `Publish ${path.basename(postPath, '.md')}`;
  run('git', ['commit', '-m', message]);
  run('git', ['push']);
}

function main() {
  const parsed = parseInput(process.argv[2]);
  const { filePath, raw } = readArticle(parsed);
  const article = convertObsidianMarkdown(raw, filePath);
  const postPath = writePost(article);
  commitSource(postPath);
  publishPages();
  console.log('');
  console.log('Published:');
  console.log(`https://jessicayang24.github.io/my-ai-gateway-vercle/`);
}

main();
