/**
 * Report module barrel export
 *
 * @module report
 */
export { HtmlReportGenerator } from "./html/html-report-generator";
export { MarkdownReportGenerator } from "./markdown-generator";
export { ArtifactCopier } from "./artifact-copier";
export { TerminalPresenter } from "./terminal-presenter";
export type {
  TestSummary,
  RunSummary,
  ReportContext,
  ReportConfig,
  IHtmlReportGenerator,
  IMarkdownReportGenerator,
  IArtifactCopier,
  ITerminalPresenter,
} from "./interfaces";
