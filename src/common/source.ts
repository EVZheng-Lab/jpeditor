// 谱面对象 ↔ 源码的定位口径。三条路共用一份：`.jpwabc`（`score/jpwimport.ts` 从 ANTLR
// token 取）、文本谱（`pu/ast.ts::SourceSpan` 自带，结构上是这个的超集）、排版层
// （`layout.ts::PageItem.source`，谱面点选与光标联动读它）。
//
// **记行列不记绝对偏移**：偏移随上游任何一次编辑失效，行列由调用方按当时的文档现算
// （`view.state.doc.line(line + 1).from + column`）。详见 `docs/实现/谱面就地编辑.md`。

export interface SourceRef {
  /** 文档行号，0 基 */
  line: number;
  /** 行内列号，0 基 */
  column: number;
  /** 词素字符数 */
  length: number;
}
