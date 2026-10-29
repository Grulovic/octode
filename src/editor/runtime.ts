import "monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css";
// Load syntax grammars and editing controls without language-service or suggestion engines.
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/editor/contrib/find/browser/findController.js";
import "monaco-editor/esm/vs/editor/contrib/folding/browser/folding.js";
import "monaco-editor/esm/vs/editor/contrib/bracketMatching/browser/bracketMatching.js";
import "monaco-editor/esm/vs/editor/contrib/wordHighlighter/browser/wordHighlighter.js";
import "monaco-editor/esm/vs/editor/contrib/contextmenu/browser/contextmenu.js";
import "monaco-editor/esm/vs/editor/contrib/lineSelection/browser/lineSelection.js";
import "monaco-editor/esm/vs/editor/contrib/clipboard/browser/clipboard.js";
import "monaco-editor/esm/vs/editor/contrib/cursorUndo/browser/cursorUndo.js";
import "monaco-editor/esm/vs/editor/contrib/links/browser/links.js";
import "monaco-editor/esm/vs/editor/contrib/comment/browser/comment.js";
import "monaco-editor/esm/vs/editor/contrib/linesOperations/browser/linesOperations.js";
import "monaco-editor/esm/vs/editor/contrib/multicursor/browser/multicursor.js";
import "monaco-editor/esm/vs/editor/contrib/indentation/browser/indentation.js";
import "monaco-editor/esm/vs/editor/contrib/wordOperations/browser/wordOperations.js";
import {
  conf as phpConf,
  language as phpGrammar,
} from "monaco-editor/esm/vs/basic-languages/php/php";
monaco.languages.register({
  id: "php",
  extensions: [".php", ".phtml"],
  aliases: ["PHP", "php"],
});
monaco.languages.setLanguageConfiguration("php", phpConf);
monaco.languages.setMonarchTokensProvider("php", {
  ...phpGrammar,
  tokenizer: {
    ...phpGrammar.tokenizer,
    phpRoot: [
      [
        /(class|interface|trait|enum)(\s+)([a-zA-Z_]\w*)/,
        ["keyword.php", "", "type.php"],
      ],
      [
        /([a-zA-Z_]\w*)(?=\s*\()/,
        {
          cases: { "@phpKeywords": "keyword.php", "@default": "function.php" },
        },
      ],
      ...phpGrammar.tokenizer.phpRoot,
    ],
  },
});
import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js";
import "monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js";
import "monaco-editor/esm/vs/basic-languages/html/html.contribution.js";
import "monaco-editor/esm/vs/basic-languages/css/css.contribution.js";
import "monaco-editor/esm/vs/basic-languages/scss/scss.contribution.js";
import "monaco-editor/esm/vs/basic-languages/less/less.contribution.js";
import "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js";
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js";
import "monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js";
import "monaco-editor/esm/vs/basic-languages/shell/shell.contribution.js";
import "monaco-editor/esm/vs/basic-languages/rust/rust.contribution.js";
import "monaco-editor/esm/vs/basic-languages/ini/ini.contribution.js";

monaco.languages.register({
  id: "json",
  extensions: [".json", ".jsonc"],
  aliases: ["JSON", "json"],
});
monaco.languages.setMonarchTokensProvider("json", {
  defaultToken: "",
  tokenPostfix: ".json",
  tokenizer: {
    root: [
      [/"(?:[^"\\\r\n]|\\.)*"(?=\s*:)/, "string.key"],
      [/"(?:[^"\\\r\n]|\\.)*"/, "string.value"],
      [/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/, "number"],
      [/\b(?:true|false|null)\b/, "keyword"],
      [/[{}\[\]]/, "delimiter.bracket"],
      [/[:,]/, "delimiter"],
      [/\/\/.*$/, "comment"],
      [/\/\*/, "comment", "@comment"],
    ],
    comment: [
      [/[^*/]+/, "comment"],
      [/\*\//, "comment", "@pop"],
      [/[*/]/, "comment"],
    ],
  },
});
monaco.languages.setLanguageConfiguration("json", {
  brackets: [
    ["{", "}"],
    ["[", "]"],
  ],
  comments: { lineComment: "//", blockComment: ["/*", "*/"] },
});

export { monaco };
