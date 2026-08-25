<template>
  <div ref="editorHost" class="database-sql-editor" />
</template>

<script setup>
import {
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from "vue";
import {
  defaultKeymap,
  history,
  historyKeymap
} from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  syntaxHighlighting
} from "@codemirror/language";
import {
  MariaSQL,
  PostgreSQL,
  sql
} from "@codemirror/lang-sql";
import {
  EditorState
} from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers
} from "@codemirror/view";

const props = defineProps({
  engine: {
    default: "postgresql",
    type: String
  },
  modelValue: {
    default: "",
    type: String
  },
  runAvailable: {
    default: true,
    type: Boolean
  },
  schema: {
    default: () => ({}),
    type: Object
  }
});
const emit = defineEmits(["focus-run", "run", "update:modelValue"]);
const editorHost = ref(null);
let editor = null;

function completionSchema(schema = {}) {
  return Object.fromEntries((Array.isArray(schema.tables) ? schema.tables : []).map((table) => [
    table.qualifiedName,
    (Array.isArray(table.columns) ? table.columns : []).map((column) => column.name)
  ]));
}

function sqlLanguage() {
  return sql({
    dialect: props.engine === "mysql" ? MariaSQL : PostgreSQL,
    schema: completionSchema(props.schema),
    upperCaseKeywords: true
  });
}

function extensions() {
  return [
    lineNumbers(),
    history(),
    drawSelection(),
    highlightActiveLine(),
    bracketMatching(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    sqlLanguage(),
    keymap.of([
      {
        key: "Tab",
        run() {
          if (!props.runAvailable) {
            return false;
          }
          emit("focus-run");
          return true;
        }
      },
      {
        key: "Mod-Enter",
        preventDefault: true,
        run() {
          emit("run");
          return true;
        }
      },
      ...defaultKeymap,
      ...historyKeymap
    ]),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({
      "aria-keyshortcuts": "Control+Enter Meta+Enter",
      "aria-label": "SQL query editor"
    }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        emit("update:modelValue", update.state.doc.toString());
      }
    }),
    EditorView.theme({
      "&": {
        backgroundColor: "transparent",
        color: "rgb(var(--v-theme-on-surface))",
        fontSize: "0.84rem",
        height: "100%"
      },
      ".cm-content": {
        caretColor: "rgb(var(--v-theme-primary))",
        fontFamily: "var(--vibe64-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
        lineHeight: "1.55",
        padding: "0.75rem 0"
      },
      ".cm-cursor": {
        borderLeftColor: "rgb(var(--v-theme-primary))"
      },
      ".cm-gutters": {
        backgroundColor: "transparent",
        borderRight: "1px solid rgba(var(--v-theme-on-surface), 0.08)",
        color: "rgba(var(--v-theme-on-surface), 0.42)"
      },
      ".cm-activeLine, .cm-activeLineGutter": {
        backgroundColor: "rgba(var(--v-theme-primary), 0.055)"
      },
      ".cm-focused": {
        outline: "none"
      }
    })
  ];
}

function createEditor() {
  if (!editorHost.value) {
    return;
  }
  editor?.destroy();
  editor = new EditorView({
    parent: editorHost.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: extensions()
    })
  });
}

onMounted(createEditor);

watch(() => props.modelValue, (value) => {
  if (!editor || editor.state.doc.toString() === value) {
    return;
  }
  editor.dispatch({
    changes: {
      from: 0,
      insert: value,
      to: editor.state.doc.length
    }
  });
});

watch(() => [props.engine, props.schema], () => {
  if (editor) {
    createEditor();
  }
}, { deep: true });

onBeforeUnmount(() => editor?.destroy());
</script>

<style scoped>
.database-sql-editor {
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.database-sql-editor :deep(.cm-editor),
.database-sql-editor :deep(.cm-scroller) {
  height: 100%;
}
</style>
