/**
 * Build data/corpus.json from Writerside markdown topics, chunked by section.
 * Run from package root: `bun run corpus`
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const ROOT = join(import.meta.dir, '../..');
const topicsDir = process.env.TOPICS_DIR ?? join(ROOT, 'Writerside/topics');
const outFile = process.env.CORPUS_OUT ?? join(import.meta.dir, '../data/corpus.json');
const docsBase = process.env.DOCS_BASE_URL ?? 'https://docs.di-framework.dev';
const versionRaw = process.env.DOCS_VERSION ?? 'latest';
const version =
  versionRaw === 'latest' || versionRaw === 'current'
    ? 'latest'
    : versionRaw.startsWith('v')
      ? versionRaw
      : `v${versionRaw}`;

export interface SectionChunk {
  heading: string;
  slug: string;
  level: number;
  content: string;
}

/**
 * Generates a Writerside-compatible heading anchor slug.
 * Removes explicit attributes like {id="foo"}, lowercases, replaces non-alphanumeric with hyphens.
 */
export function slugifyHeading(heading: string): { title: string; slug: string } {
  let title = heading.trim();
  let explicitId: string | null = null;

  // Check for explicit ID attribute: {id="foo"} or {#foo}
  const idMatch = title.match(/\{#?id=["']?([^"'}\s]+)["']?\}|\{#([^}\s]+)\}/);
  if (idMatch) {
    explicitId = idMatch[1] || idMatch[2];
    title = title.replace(idMatch[0], '').trim();
  }

  if (explicitId) {
    return { title, slug: explicitId };
  }

  // Writerside slugify rule: lowercase, remove special characters, replace whitespace/punctuation with hyphen
  const slug = title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return { title, slug: slug || 'section' };
}

/**
 * Normalizes section content for search indexing while preserving code blocks and readability.
 */
export function cleanSectionContent(rawContent: string): string {
  return rawContent
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [text](url) -> text
    .replace(/^>\s*/gm, '') // Strip blockquote markers
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 12000);
}

/**
 * Splits a markdown topic into preamble and H2/H3 section chunks.
 */
export function parseTopicSections(markdown: string): {
  topicTitle: string;
  sections: SectionChunk[];
} {
  const lines = markdown.split(/\r?\n/);
  const h1Line = lines.find((l) => /^#\s+/.test(l));
  const rawTopicTitle = h1Line ? h1Line.replace(/^#\s+/, '').trim() : '';
  const { title: topicTitle } = slugifyHeading(rawTopicTitle);

  const sections: SectionChunk[] = [];
  let currentHeading = topicTitle;
  let currentSlug = '';
  let currentLevel = 1;
  let currentLines: string[] = [];

  for (const line of lines) {
    if (/^#\s+/.test(line)) {
      // Skip the H1 line itself, already extracted
      continue;
    }

    const h2Match = line.match(/^##\s+(.+)$/);
    const h3Match = line.match(/^###\s+(.+)$/);

    if (h2Match || h3Match) {
      // Save previous section buffer if it has content
      const content = cleanSectionContent(currentLines.join('\n'));
      if (content.length > 0) {
        sections.push({
          heading: currentHeading,
          slug: currentSlug,
          level: currentLevel,
          content,
        });
      }

      currentLines = [];
      const match = h2Match || h3Match;
      const rawHeading = match![1];
      const { title, slug } = slugifyHeading(rawHeading);
      currentHeading = title;
      currentSlug = slug;
      currentLevel = h2Match ? 2 : 3;
    } else {
      currentLines.push(line);
    }
  }

  // Save the trailing section
  const trailingContent = cleanSectionContent(currentLines.join('\n'));
  if (trailingContent.length > 0) {
    sections.push({
      heading: currentHeading,
      slug: currentSlug,
      level: currentLevel,
      content: trailingContent,
    });
  }

  return { topicTitle: topicTitle || 'Documentation', sections };
}

const files = readdirSync(topicsDir).filter((f) => f.endsWith('.md') && f !== 'starter-topic.md');

const docs = files.flatMap((f) => {
  const raw = readFileSync(join(topicsDir, f), 'utf8');
  const topicId = basename(f, '.md');
  const { topicTitle, sections } = parseTopicSections(raw);
  const prefix = version === 'latest' ? '' : `/${version}`;

  return sections.map((section, idx) => {
    const isTopicRoot = idx === 0 && section.slug === '';
    const anchor = isTopicRoot ? '' : `#${section.slug}`;
    const url = `${docsBase.replace(/\/$/, '')}${prefix}/${topicId}.html${anchor}`;

    const objectID = isTopicRoot
      ? version === 'latest'
        ? `docs_${topicId}`
        : `docs_${topicId}__${version}`
      : version === 'latest'
        ? `docs_${topicId}__${section.slug}`
        : `docs_${topicId}__${section.slug}__${version}`;

    const breadcrumbs = isTopicRoot
      ? `Docs|${topicTitle}`
      : `Docs|${topicTitle}|${section.heading}`;

    return {
      objectID,
      url,
      pageTitle: isTopicRoot ? topicTitle : section.heading,
      mainTitle: topicTitle,
      breadcrumbs,
      content: section.content,
      product: 'd',
      version,
    };
  });
});

writeFileSync(
  outFile,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), docs }, null, 2)}\n`,
);

console.log(`Wrote ${docs.length} section chunks across ${files.length} topics → ${outFile}`);
