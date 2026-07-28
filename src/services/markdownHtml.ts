import type { Options } from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from 'rehype-sanitize'

const MARKDOWN_HTML_SANITIZE_SCHEMA: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ['className', 'math-inline', 'math-display'],
    ],
  },
}

export const MARKDOWN_HTML_REHYPE_PLUGINS: NonNullable<Options['rehypePlugins']> = [
  rehypeRaw,
  [rehypeSanitize, MARKDOWN_HTML_SANITIZE_SCHEMA],
]
