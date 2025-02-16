import fs from 'fs-extra'
import path from 'path'
import glob from 'fast-glob'
import type { SiteConfig } from './config'
import matter from 'gray-matter'
import { normalizePath } from 'vite'
import { createMarkdownRenderer, type MarkdownRenderer } from './markdown'

export interface ContentOptions<T = ContentData[]> {
  /**
   * Include src?
   * default: false
   */
  includeSrc?: boolean
  /**
   * Render src to HTML and include in data?
   * default: false
   */
  render?: boolean
  /**
   * Whether to parse and include excerpt (rendered as HTML)
   * default: false
   */
  excerpt?: boolean
  /**
   * Transform the data. Note the data will be inlined as JSON in the client
   * bundle if imported from components or markdown files.
   */
  transform?: (data: ContentData[]) => T | Promise<T>
}

export interface ContentData {
  url: string
  src: string | undefined
  html: string | undefined
  frontmatter: Record<string, any>
  excerpt: string | undefined
}

/**
 * Create a loader object that can be directly used as the default export
 * of a data loader file.
 */
export function createContentLoader<T = ContentData[]>(
  /**
   * files to glob / watch - relative to <project root>
   */
  pattern: string | string[],
  {
    includeSrc,
    render,
    excerpt: renderExcerpt,
    transform
  }: ContentOptions<T> = {}
): {
  watch: string | string[]
  load: () => Promise<T>
} {
  const config: SiteConfig = (global as any).VITEPRESS_CONFIG
  if (!config) {
    throw new Error(
      'content loader invoked without an active vitepress process, ' +
        'or before vitepress config is resolved.'
    )
  }

  if (typeof pattern === 'string') pattern = [pattern]
  pattern = pattern.map((p) => normalizePath(path.join(config.root, p)))

  let md: MarkdownRenderer

  const cache = new Map<
    string,
    {
      data: any
      timestamp: number
    }
  >()

  return {
    watch: pattern,
    async load(files?: string[]) {
      if (!files) {
        // the loader is being called directly, do a fresh glob
        files = (
          await glob(pattern, {
            ignore: ['**/node_modules/**', '**/dist/**']
          })
        ).sort()
      }

      md =
        md ||
        (await createMarkdownRenderer(
          config.srcDir,
          config.markdown,
          config.site.base,
          config.logger
        ))

      const raw: ContentData[] = []

      for (const file of files) {
        if (!file.endsWith('.md')) {
          continue
        }
        const timestamp = fs.statSync(file).mtimeMs
        const cached = cache.get(file)
        if (cached && timestamp === cached.timestamp) {
          raw.push(cached.data)
        } else {
          const src = fs.readFileSync(file, 'utf-8')
          const { data: frontmatter, excerpt } = matter(src, {
            excerpt: true
          })
          const url =
            '/' +
            normalizePath(path.relative(config.root, file)).replace(
              /\.md$/,
              config.cleanUrls ? '' : '.html'
            )
          const html = render ? md.render(src) : undefined
          const renderedExcerpt = renderExcerpt
            ? excerpt && md.render(excerpt)
            : undefined
          const data: ContentData = {
            src: includeSrc ? src : undefined,
            html,
            frontmatter,
            excerpt: renderedExcerpt,
            url
          }
          cache.set(file, { data, timestamp })
          raw.push(data)
        }
      }
      return (transform ? transform(raw) : raw) as any
    }
  }
}
