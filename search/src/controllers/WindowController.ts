import { useContainer } from '@di-framework/core/container';
import { Component } from '@di-framework/core/decorators';
import {
  Controller,
  Endpoint,
  json,
  type PathParams,
  type QueryParams,
  type RequestSpec,
  type ResponseSpec,
} from '@di-framework/http';
import { normalizeDocsVersion } from '../docs-version';
import type { DocPage } from '../models/DocPage';
import { DocumentRepository } from '../repositories/DocumentRepository';
import { router } from '../router';

type WindowPath = { topic: string; cursor: string };
type WindowQuery = { radius?: string; version?: string };

export type WindowChunk = {
  id: string;
  url: string;
  title: string;
  breadcrumbs: string;
  content: string;
};

export type WindowResponse = {
  topic: string;
  version: string;
  cursor: string;
  radius: number;
  currentIndex: number;
  totalSections: number;
  chunks: WindowChunk[];
};

@Controller()
export class WindowController {
  constructor(
    @Component(DocumentRepository) private readonly documents: DocumentRepository
  ) {}

  async getWindow(opts: {
    topic: string;
    cursor: string;
    radius: number;
    version?: string;
  }): Promise<WindowResponse | null> {
    const version = normalizeDocsVersion(opts.version);
    const allPages = await this.documents.findAll();

    // Filter pages for this topic and version, preserving document order
    const topicPrefix = `docs_${opts.topic}`;
    const topicPages = allPages.filter((p) => {
      const isVersionMatch = p.version === version;
      const isTopicMatch =
        p.id.startsWith(topicPrefix) ||
        p.url.includes(`/${opts.topic}.html`);
      return isVersionMatch && isTopicMatch;
    });

    if (topicPages.length === 0) {
      return null;
    }

    // Locate the cursor index
    const cursor = opts.cursor.trim();
    let index = -1;

    // 1. Exact ID match
    index = topicPages.findIndex(
      (p) =>
        p.id === cursor ||
        p.id === `${topicPrefix}__${cursor}` ||
        p.id === `${topicPrefix}__${cursor}__${version}`
    );

    // 2. Anchor slug match in URL
    if (index === -1) {
      index = topicPages.findIndex((p) => p.url.endsWith(`#${cursor}`));
    }

    // 3. Title match (case-insensitive)
    if (index === -1) {
      const lowerCursor = cursor.toLowerCase();
      index = topicPages.findIndex(
        (p) => p.pageTitle.toLowerCase() === lowerCursor
      );
    }

    // 4. Numeric index match
    if (index === -1 && /^\d+$/.test(cursor)) {
      const num = parseInt(cursor, 10);
      if (num >= 0 && num < topicPages.length) {
        index = num;
      }
    }

    if (index === -1) {
      // Default to first chunk if cursor is "root", "intro", or "0"
      if (cursor === 'root' || cursor === 'intro' || cursor === '') {
        index = 0;
      } else {
        return null;
      }
    }

    const radius = Math.max(0, Math.min(opts.radius, 5));
    const start = Math.max(0, index - radius);
    const end = Math.min(topicPages.length, index + radius + 1);
    const sliced = topicPages.slice(start, end);

    return {
      topic: opts.topic,
      version,
      cursor: opts.cursor,
      radius,
      currentIndex: index,
      totalSections: topicPages.length,
      chunks: sliced.map((p) => ({
        id: p.id,
        url: p.url,
        title: p.pageTitle,
        breadcrumbs: p.breadcrumbs,
        content: p.content,
      })),
    };
  }

  @Endpoint({
    summary: 'Documentation window expansion',
    description:
      'Expands context around a matched topic section cursor (slug, chunk id, or index) by a specified neighbor radius.',
    responses: {
      '200': { description: 'Window of neighboring section chunks' },
      '404': { description: 'Topic or cursor not found' },
    },
  })
  static get = router.get<
    RequestSpec<PathParams<WindowPath> & QueryParams<WindowQuery>>,
    ResponseSpec<WindowResponse | { error: string }>
  >('/window/:topic/:cursor', async (req) => {
    const controller = useContainer().resolve(WindowController);
    const radius = Number(req.query.radius ?? '1');
    const result = await controller.getWindow({
      topic: req.params.topic ?? '',
      cursor: req.params.cursor ?? '',
      radius: Number.isFinite(radius) ? radius : 1,
      version: req.query.version,
    });

    if (!result) {
      return json({ error: 'Topic or cursor not found' }, { status: 404 });
    }

    return json(result);
  });
}
