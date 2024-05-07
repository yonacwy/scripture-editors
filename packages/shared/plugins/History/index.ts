/*
 * This code is adapted from the Lexical project at Facebook's GitHub repository.
 * Original source: https://github.com/facebook/lexical
 */

// TODO: Resolve the issue of an infinite loop occurring when updating the editor state if the user clicks the same position twice in a row. This issue is suspected to be caused by the "updateEditor" function in the lexical module.

import type { EditorState, LexicalEditor, LexicalNode, NodeKey } from "lexical";

import { mergeRegister } from "@lexical/utils";
import { debounce } from "../../utils";
import {
  $isRangeSelection,
  $isRootNode,
  $isTextNode,
  CLEAR_EDITOR_COMMAND,
  CLEAR_HISTORY_COMMAND,
  COMMAND_PRIORITY_EDITOR,
  REDO_COMMAND,
  UNDO_COMMAND,
} from "lexical";
import { UpdateListener } from "lexical/LexicalEditor";
import { HistoryState, HistoryStateEntry, LexicalHistoryManager } from "./HistoryManager";
import { DirtyNodes } from "./DirtyNodes";

type MergeAction = 0 | 1 | 2;
const HISTORY_MERGE = 0;
const HISTORY_PUSH = 1;
const DISCARD_HISTORY_CANDIDATE = 2;

type ChangeType = 0 | 1 | 2 | 3 | 4;
const OTHER = 0;
const COMPOSING_CHARACTER = 1;
const INSERT_CHARACTER_AFTER_SELECTION = 2;
const DELETE_CHARACTER_BEFORE_SELECTION = 3;
const DELETE_CHARACTER_AFTER_SELECTION = 4;

type UpdateListenerArgs = Parameters<UpdateListener>[0];
interface OnChangeArgs extends Omit<UpdateListenerArgs, "normalizedNodes"> {
  editorChanged: boolean;
  history: {
    canRedo: boolean;
    canUndo: boolean;
    mergeHistory: <T extends Record<string, unknown>>(mergeableData: T) => void;
    currentEntry: Record<string, unknown> | null;
  };
}

export type HistoryMergeListener = ({
  dirtyElements,
  dirtyLeaves,
  editorState,
  editorChanged,
  prevEditorState,
  tags,
  history,
}: OnChangeArgs) => void;

type IntentionallyMarkedAsDirtyElement = boolean;

function getDirtyNodes(
  editorState: EditorState,
  dirtyLeaves: Set<NodeKey>,
  dirtyElements: Map<NodeKey, IntentionallyMarkedAsDirtyElement>,
): Array<LexicalNode> {
  const nodeMap = editorState._nodeMap;
  const nodes = [];

  for (const dirtyLeafKey of dirtyLeaves) {
    const dirtyLeaf = nodeMap.get(dirtyLeafKey);

    if (dirtyLeaf !== undefined) {
      nodes.push(dirtyLeaf);
    }
  }

  for (const [dirtyElementKey, intentionallyMarkedAsDirty] of dirtyElements) {
    if (!intentionallyMarkedAsDirty) {
      continue;
    }

    const dirtyElement = nodeMap.get(dirtyElementKey);

    if (dirtyElement !== undefined && !$isRootNode(dirtyElement)) {
      nodes.push(dirtyElement);
    }
  }

  return nodes;
}

function getChangeType(
  prevEditorState: null | EditorState,
  nextEditorState: EditorState,
  dirtyLeavesSet: Set<NodeKey>,
  dirtyElementsSet: Map<NodeKey, IntentionallyMarkedAsDirtyElement>,
  isComposing: boolean,
): ChangeType {
  if (
    prevEditorState === null ||
    (dirtyLeavesSet.size === 0 && dirtyElementsSet.size === 0 && !isComposing)
  ) {
    return OTHER;
  }

  const nextSelection = nextEditorState._selection;
  const prevSelection = prevEditorState._selection;

  if (isComposing) {
    return COMPOSING_CHARACTER;
  }

  if (
    !$isRangeSelection(nextSelection) ||
    !$isRangeSelection(prevSelection) ||
    !prevSelection.isCollapsed() ||
    !nextSelection.isCollapsed()
  ) {
    return OTHER;
  }

  const dirtyNodes = getDirtyNodes(nextEditorState, dirtyLeavesSet, dirtyElementsSet);

  if (dirtyNodes.length === 0) {
    return OTHER;
  }

  // Catching the case when inserting new text node into an element (e.g. first char in paragraph/list),
  // or after existing node.
  if (dirtyNodes.length > 1) {
    const nextNodeMap = nextEditorState._nodeMap;
    const nextAnchorNode = nextNodeMap.get(nextSelection.anchor.key);
    const prevAnchorNode = nextNodeMap.get(prevSelection.anchor.key);

    if (
      nextAnchorNode &&
      prevAnchorNode &&
      !prevEditorState._nodeMap.has(nextAnchorNode.__key) &&
      $isTextNode(nextAnchorNode) &&
      nextAnchorNode.__text.length === 1 &&
      nextSelection.anchor.offset === 1
    ) {
      return INSERT_CHARACTER_AFTER_SELECTION;
    }

    return OTHER;
  }

  const nextDirtyNode = dirtyNodes[0];

  const prevDirtyNode = prevEditorState._nodeMap.get(nextDirtyNode.__key);

  if (
    !$isTextNode(prevDirtyNode) ||
    !$isTextNode(nextDirtyNode) ||
    prevDirtyNode.__mode !== nextDirtyNode.__mode
  ) {
    return OTHER;
  }

  const prevText = prevDirtyNode.__text;
  const nextText = nextDirtyNode.__text;

  if (prevText === nextText) {
    return OTHER;
  }

  const nextAnchor = nextSelection.anchor;
  const prevAnchor = prevSelection.anchor;

  if (nextAnchor.key !== prevAnchor.key || nextAnchor.type !== "text") {
    return OTHER;
  }

  const nextAnchorOffset = nextAnchor.offset;
  const prevAnchorOffset = prevAnchor.offset;
  const textDiff = nextText.length - prevText.length;

  if (textDiff === 1 && prevAnchorOffset === nextAnchorOffset - 1) {
    return INSERT_CHARACTER_AFTER_SELECTION;
  }

  if (textDiff === -1 && prevAnchorOffset === nextAnchorOffset + 1) {
    return DELETE_CHARACTER_BEFORE_SELECTION;
  }

  if (textDiff === -1 && prevAnchorOffset === nextAnchorOffset) {
    return DELETE_CHARACTER_AFTER_SELECTION;
  }

  return OTHER;
}

function isTextNodeUnchanged(
  key: NodeKey,
  prevEditorState: EditorState,
  nextEditorState: EditorState,
): boolean {
  const prevNode = prevEditorState._nodeMap.get(key);
  const nextNode = nextEditorState._nodeMap.get(key);

  const prevSelection = prevEditorState._selection;
  const nextSelection = nextEditorState._selection;
  let isDeletingLine = false;

  if ($isRangeSelection(prevSelection) && $isRangeSelection(nextSelection)) {
    isDeletingLine =
      prevSelection.anchor.type === "element" &&
      prevSelection.focus.type === "element" &&
      nextSelection.anchor.type === "text" &&
      nextSelection.focus.type === "text";
  }

  if (!isDeletingLine && $isTextNode(prevNode) && $isTextNode(nextNode)) {
    return (
      prevNode.__type === nextNode.__type &&
      prevNode.__text === nextNode.__text &&
      prevNode.__mode === nextNode.__mode &&
      prevNode.__detail === nextNode.__detail &&
      prevNode.__style === nextNode.__style &&
      prevNode.__format === nextNode.__format &&
      prevNode.__parent === nextNode.__parent
    );
  }
  return false;
}

function createMergeActionGetter(
  editor: LexicalEditor,
  delay: number,
): (
  prevEditorState: null | EditorState,
  nextEditorState: EditorState,
  currentHistoryEntry: null | HistoryStateEntry,
  dirtyLeaves: Set<NodeKey>,
  dirtyElements: Map<NodeKey, IntentionallyMarkedAsDirtyElement>,
  tags: Set<string>,
) => MergeAction {
  let prevChangeTime = Date.now();
  let prevChangeType = OTHER;

  return (
    prevEditorState,
    nextEditorState,
    currentHistoryEntry,
    dirtyLeaves,
    dirtyElements,
    tags,
  ) => {
    const changeTime = Date.now();

    // If applying changes from history stack there's no need
    // to run history logic again, as history entries already calculated
    if (tags.has("historic")) {
      prevChangeType = OTHER;
      prevChangeTime = changeTime;
      return DISCARD_HISTORY_CANDIDATE;
    }

    const changeType = getChangeType(
      prevEditorState,
      nextEditorState,
      dirtyLeaves,
      dirtyElements,
      editor.isComposing(),
    );

    console.log(
      [
        "OTHER",
        "COMPOSING_CHARACTER",
        "INSERT_CHARACTER_AFTER_SELECTION",
        "DELETE_CHARACTER_BEFORE_SELECTION",
        "DELETE_CHARACTER_AFTER_SELECTION",
      ][changeType],
      tags,
    );

    const mergeAction = (() => {
      const isSameEditor = currentHistoryEntry === null || currentHistoryEntry.editor === editor;
      const shouldPushHistory = tags.has("history-push");
      const shouldMergeHistory = !shouldPushHistory && isSameEditor && tags.has("history-merge");

      if (shouldMergeHistory) {
        return HISTORY_MERGE;
      }

      if (prevEditorState === null) {
        console.log("PUSH SET");
        return HISTORY_PUSH;
      }

      const selection = nextEditorState._selection;
      const hasDirtyNodes = dirtyLeaves.size > 0 || dirtyElements.size > 0;

      if (!hasDirtyNodes) {
        if (selection !== null) {
          return HISTORY_MERGE;
        }

        return DISCARD_HISTORY_CANDIDATE;
      }

      if (
        shouldPushHistory === false &&
        changeType !== OTHER &&
        changeType === prevChangeType &&
        changeTime < prevChangeTime + delay &&
        isSameEditor
      ) {
        return HISTORY_MERGE;
      }

      // A single node might have been marked as dirty, but not have changed
      // due to some node transform reverting the change.
      if (dirtyLeaves.size === 1) {
        const dirtyLeafKey = Array.from(dirtyLeaves)[0];
        if (isTextNodeUnchanged(dirtyLeafKey, prevEditorState, nextEditorState)) {
          return HISTORY_MERGE;
        }
      }
      console.log("PUSH SET");
      return HISTORY_PUSH;
    })();

    prevChangeTime = changeTime;
    prevChangeType = changeType;

    return mergeAction;
  };
}

/**
 * Registers necessary listeners to manage undo/redo history stack and related editor commands.
 * It returns `unregister` callback that cleans up all listeners and should be called on editor unmount.
 * @param editor - The lexical editor.
 * @param historyState - The history state, containing the current state and the undo/redo stack.
 * @param delay - The time (in milliseconds) the editor should delay generating a new history stack,
 * instead of merging the current changes with the current stack.
 * @returns The listeners cleanup callback function.
 */
export function registerHistory(
  editor: LexicalEditor,
  historyState: HistoryState,
  onChange: HistoryMergeListener = () => null, // Update the type of the onChange parameter
  delay: number,
): () => void {
  const dirtyNodes = new DirtyNodes();
  const historyManager = new LexicalHistoryManager(editor, historyState);
  const getMergeAction = createMergeActionGetter(editor, delay);
  const triggerOnChange = debounce(onChange, delay, ({ editorChanged }) => editorChanged);

  const applyChange = ({
    editorState,
    prevEditorState,
    dirtyLeaves,
    dirtyElements,
    tags,
  }: {
    editorState: EditorState;
    prevEditorState: EditorState;
    dirtyElements: Map<NodeKey, IntentionallyMarkedAsDirtyElement>;
    dirtyLeaves: Set<NodeKey>;
    tags: Set<string>;
  }): void => {
    const current = historyManager.getCurrent();
    const currentEditorState = current === null ? null : current.editorState;

    if (current !== null && editorState === currentEditorState) {
      return;
    }
    const mergeAction = getMergeAction(
      prevEditorState,
      editorState,
      current,
      dirtyLeaves,
      dirtyElements,
      tags,
    );
    console.log("MERGE ACTION: ", ["MERGE", "PUSH", "DISCARD"][mergeAction]);
    if (mergeAction === HISTORY_PUSH) {
      dirtyNodes.reset();
      console.log("PUSHING");
      historyManager.push();
    } else if (mergeAction === DISCARD_HISTORY_CANDIDATE) {
      dirtyNodes.reset();
      return;
    }

    historyManager.merge({
      editor,
      editorState,
    });

    dirtyNodes.merge(dirtyLeaves, dirtyElements);
    const editorChanged = dirtyElements.size > 0 || dirtyLeaves.size > 0;
    (() => (!current ? onChange : triggerOnChange))()({
      editorState,
      editorChanged,
      prevEditorState: historyManager.getPrevious()?.editorState || prevEditorState,
      dirtyLeaves: dirtyNodes.getLeaves(),
      dirtyElements: dirtyNodes.getElements(),
      tags,
      history: {
        canUndo: historyManager.canUndo(),
        canRedo: historyManager.canRedo(),
        mergeHistory(historyEntry) {
          historyManager.merge({ ...historyEntry, editor, editorState });
        },
        currentEntry: historyManager.getCurrent(),
      },
    });
  };

  const unregisterCommandListener = mergeRegister(
    editor.registerCommand(
      UNDO_COMMAND,
      () => {
        historyManager.undo();
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    ),
    editor.registerCommand(
      REDO_COMMAND,
      () => {
        historyManager.redo();
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    ),
    editor.registerCommand(
      CLEAR_EDITOR_COMMAND,
      () => {
        historyManager.clear();
        return false;
      },
      COMMAND_PRIORITY_EDITOR,
    ),
    editor.registerCommand(
      CLEAR_HISTORY_COMMAND,
      () => {
        historyManager.reset(editor);
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    ),
    editor.registerUpdateListener(applyChange),
  );

  const unregisterUpdateListener = editor.registerUpdateListener(applyChange);

  return () => {
    unregisterCommandListener();
    unregisterUpdateListener();
  };
}

/**
 * Creates an empty history state.
 * @returns - The empty history state, as an object.
 */
export function createEmptyHistoryState(): HistoryState {
  return {
    current: null,
    redoStack: [],
    undoStack: [],
  };
}
