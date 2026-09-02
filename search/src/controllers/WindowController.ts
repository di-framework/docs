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

/**
 * Pure static utilities for documentation window slicing and cursor resolution.
 */
export class DocWindowUtils {
  /**
   * Filters all pages down to those belonging to a specific topic and version.
   */
  static filterTopicPages(
    allPages: readonly DocPage[],
    topic: string,
    version: string
  ): DocPage[] {
    const topicPrefix = `docs_${topic}`;
    return allPages.filter((p) => {
      const isVersionMatch = p.version === version;
      const isTopicMatch =
        p.id.startsWith(topicPrefix) || p.url.includes(`/${topic}.html`);
      return isVersionMatch && isTopicMatch;
    });
  }

  /**
   * Locates the numerical index of a section cursor in the ordered topic pages.
   */
  static findCursorIndex(
    topicPages: readonly DocPage[],
    topic: string,
    rawCursor: string,
    version: string
  ): number {
    const cursor = rawCursor.trim();
    if (!cursor || cursor === 'root' || cursor === 'intro' || cursor === '0') {
      return 0;
    }

    const topicPrefix = `docs_${topic}`;

    // 1. Exact ID match
    const idIndex = topicPages.findIndex(
      (p) =>
        p.id === cursor ||
        p.id === `${topicPrefix}__${cursor}` ||
        p.id === `${topicPrefix}__${cursor}__${version}`
    );
    if (idIndex !== -1) return idIndex;

    // 2. Anchor slug match in URL
    const anchorIndex = topicPages.findIndex((p) => p.url.endsWith(`#${cursor}`));
    if (anchorIndex !== -1) return anchorIndex;

    // 3. Title match (case-insensitive)
    const lowerCursor = cursor.toLowerCase();
    const titleIndex = topicPages.findIndex(
      (p) => p.pageTitle.toLowerCase() === lowerCursor
    );
    if (titleIndex !== -1) return titleIndex;

    // 4. Numeric index match
    if (/^\d+$/.test(cursor)) {
      const num = parseInt(cursor, 10);
      if (num >= 0 && num < topicPages.length) {
        return num;
      }
    }

    return -1;
  }

  /**
   * Slices a window of items around a center index bounded by [0, total].
   */
  static sliceWindow<T>(
    items: readonly T[],
    centerIndex: number,
    rawRadius: number,
    maxRadius = 5
  ): { radius: number; sliced: T[] } {
    const radius = Math.max(0, Math.min(rawRadius, maxRadius));
    const start = Math.max(0, centerIndex - radius);
    const end = Math.min(items.length, centerIndex + radius + 1);
    return {
      radius,
      sliced: items.slice(start, end),
    };
  }

  /**
   * Maps a DocPage entity to a response WindowChunk.
   */
  static formatChunk(page: DocPage): WindowChunk {
    return {
      id: page.id,
      url: page.url,
      title: page.pageTitle,
      breadcrumbs: page.breadcrumbs,
      content: page.content,
    };
  }
}

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

    const topicPages = DocWindowUtils.filterTopicPages(allPages, opts.topic, version);
    if (topicPages.length === 0) {
      return null;
    }

    const index = DocWindowUtils.findCursorIndex(topicPages, opts.topic, opts.cursor, version);
    if (index === -1) {
      return null;
    }

    const { radius, sliced } = DocWindowUtils.sliceWindow(topicPages, index, opts.radius);

    return {
      topic: opts.topic,
      version,
      cursor: opts.cursor,
      radius,
      currentIndex: index,
      totalSections: topicPages.length,
      chunks: sliced.map(DocWindowUtils.formatChunk),
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
