import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'

export const editorCodeLanguages = [
  LanguageDescription.of({
    name: 'C',
    extensions: ['c', 'h', 'ino'],
    load: () => import('@codemirror/lang-cpp').then((module) => module.cpp()),
  }),
  LanguageDescription.of({
    name: 'C++',
    alias: ['cpp'],
    extensions: ['cpp', 'c++', 'cc', 'cxx', 'hpp', 'h++', 'hh', 'hxx'],
    load: () => import('@codemirror/lang-cpp').then((module) => module.cpp()),
  }),
  LanguageDescription.of({
    name: 'CSS',
    extensions: ['css'],
    load: () => Promise.resolve(css()),
  }),
  LanguageDescription.of({
    name: 'Go',
    extensions: ['go'],
    load: () => import('@codemirror/lang-go').then((module) => module.go()),
  }),
  LanguageDescription.of({
    name: 'HTML',
    alias: ['xhtml'],
    extensions: ['html', 'htm', 'handlebars', 'hbs'],
    load: () => Promise.resolve(html()),
  }),
  LanguageDescription.of({
    name: 'Java',
    extensions: ['java'],
    load: () => import('@codemirror/lang-java').then((module) => module.java()),
  }),
  LanguageDescription.of({
    name: 'JavaScript',
    alias: ['ecmascript', 'js', 'node'],
    extensions: ['js', 'mjs', 'cjs'],
    load: () => Promise.resolve(javascript()),
  }),
  LanguageDescription.of({
    name: 'JSX',
    extensions: ['jsx'],
    load: () => Promise.resolve(javascript({ jsx: true })),
  }),
  LanguageDescription.of({
    name: 'JSON',
    alias: ['json5'],
    extensions: ['json', 'map'],
    load: () => import('@codemirror/lang-json').then((module) => module.json()),
  }),
  LanguageDescription.of({
    name: 'Python',
    extensions: ['BUILD', 'bzl', 'py', 'pyw'],
    filename: /^(BUCK|BUILD)$/,
    load: () => import('@codemirror/lang-python').then((module) => module.python()),
  }),
  LanguageDescription.of({
    name: 'Rust',
    extensions: ['rs'],
    load: () => import('@codemirror/lang-rust').then((module) => module.rust()),
  }),
  LanguageDescription.of({
    name: 'SQL',
    alias: ['sqlite', 'mysql', 'postgresql'],
    extensions: ['sql'],
    load: () => import('@codemirror/lang-sql').then((module) => module.sql()),
  }),
  LanguageDescription.of({
    name: 'TSX',
    extensions: ['tsx'],
    load: () => Promise.resolve(javascript({ jsx: true, typescript: true })),
  }),
  LanguageDescription.of({
    name: 'TypeScript',
    alias: ['ts'],
    extensions: ['ts', 'mts', 'cts'],
    load: () => Promise.resolve(javascript({ typescript: true })),
  }),
  LanguageDescription.of({
    name: 'YAML',
    alias: ['yml'],
    extensions: ['yaml', 'yml'],
    load: () => import('@codemirror/lang-yaml').then((module) => module.yaml()),
  }),
  LanguageDescription.of({
    name: 'Shell',
    alias: ['bash', 'sh', 'zsh'],
    extensions: ['sh', 'ksh', 'bash'],
    filename: /^PKGBUILD$/,
    load: () => import('@codemirror/legacy-modes/mode/shell').then(
      (module) => new LanguageSupport(StreamLanguage.define(module.shell))
    ),
  }),
  LanguageDescription.of({
    name: 'PowerShell',
    alias: ['pwsh'],
    extensions: ['ps1', 'psd1', 'psm1'],
    load: () => import('@codemirror/legacy-modes/mode/powershell').then(
      (module) => new LanguageSupport(StreamLanguage.define(module.powerShell))
    ),
  }),
] as const
