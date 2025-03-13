import { InitialConfigType, LexicalComposer } from "@lexical/react/LexicalComposer";
import scriptureNodes from "shared/nodes";
import { useBibleBook } from "./useLexicalState";
import { HistoryPlugin } from "shared-react/plugins/History/HistoryPlugin";
import { ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { getPerfHistoryUpdater } from "shared/plugins/PerfOperations/updatePerfHistory";
import { HistoryMergeListener, createEmptyHistoryState } from "shared/plugins/History";
import { PerfHandlersPlugin } from "shared-react/plugins/PerfHandlers/PerfHandlersPlugin";
import { Tooltip as ReactTooltip } from "react-tooltip";
import { BookStore, getLexicalState } from "shared/contentManager";
import { FlatDocument as PerfDocument } from "shared/plugins/PerfOperations/Types/Document";

import Button from "./Components/Button";

import {
  $getNodeByKey,
  $getSelection,
  LexicalEditor,
  LexicalNode,
  REDO_COMMAND,
  UNDO_COMMAND,
} from "lexical";
import ContentEditablePlugin from "./Components/ContentEditablePlugin";
import { downloadUsfm } from "./downloadUsfm";
import OnEditorUpdate from "./Components/OnEditorUpdate";

import { $isUsfmElementNode } from "shared/nodes/UsfmElementNode";
import { $getCommonAncestorCompatible } from "shared/nodes/scripture/usj/node.utils";
import { ScriptureReference } from "shared/utils/get-marker-action.model";
import { getUsfmMarkerAction } from "shared/utils/usfm/getUsfmMarkerAction";
import getMarker from "shared/utils/usfm/getMarker";
import ScriptureReferencePlugin from "shared-react/plugins/ScriptureReferencePlugin";
import PerfNodesMenuPlugin from "shared-react/plugins/PerfNodesMenuPlugin";

import { CursorHandlerPlugin } from "shared-react/plugins/CursorHandlerPlugin";

import "react-tooltip/dist/react-tooltip.css"; // Required for styling
const theme = {
  // Theme styling goes here
};

function onError(error: Error) {
  console.error(error);
}

export default function Editor({
  serverName,
  organizationId,
  languageCode,
  versionId,
  bookCode,
  editable = true,
}: {
  serverName: string;
  organizationId: string;
  languageCode: string;
  versionId: string;
  bookCode: string;
  editable?: boolean;
}) {
  const bookHandler = useBibleBook({
    serverName,
    organizationId,
    languageCode,
    versionId,
    bookCode,
  }) as BookStore | null;
  const [lexicalState, setLexicalState] = useState("");
  const [selectedMarker, setSelectedMarker] = useState<string>();
  const [perfDocument, setPerfDocument] = useState<PerfDocument | null>(null);
  const [scriptureReference, setScriptureReference] = useState<ScriptureReference | null>({
    book: bookCode,
    chapterNum: 1,
    verseNum: 1,
  });
  const [shouldUseCursorHelper, setShouldUseCursorHelper] = useState(true);
  const editorRef = useRef<HTMLDivElement>(null);
  const [contextMenuKey, setContextMenuKey] = useState<string>("\\");

  const handleKeyPress = (event: KeyboardEvent) => {
    setContextMenuKey(event.key);
  };

  const handleButtonClick = () => {
    document.addEventListener("keydown", handleKeyPress, { once: true });
  };

  useEffect(() => {
    (async () => {
      if (bookHandler) {
        const perf = await bookHandler.read(bookCode);
        setPerfDocument(perf);

        const lexicalState = getLexicalState(perf);

        setLexicalState(JSON.stringify(lexicalState));
      }
    })();
  }, [bookHandler, bookCode]);

  // Unique IDs for each tooltip
  const tooltipIds = {
    undo: "undo-tooltip",
    redo: "redo-tooltip",
    download: "download-tooltip",
    verseBlocks: "verse-blocks-tooltip",
    markers: "markers-tooltip",
    cursor: "cursor-tooltip",
    context: "context-tooltip",
  };

  const initialConfig: InitialConfigType = {
    namespace: "ScriptureEditor",
    theme,
    editorState: lexicalState,
    onError,
    nodes: [...scriptureNodes],
    editable,
  };

  const historyState = useMemo(() => createEmptyHistoryState(), []);

  const handlePerfHistory = useMemo(
    () => (perfDocument ? getPerfHistoryUpdater(perfDocument) : null),
    [perfDocument],
  );

  const toggleClass = (element: HTMLElement | null, className: string) =>
    element?.classList.toggle(className);

  const toolbarMarkerSections = useMemo(() => {
    if (!selectedMarker || !scriptureReference) return null;
    const marker = getMarker(selectedMarker);
    if (!marker?.children) return null;

    return Object.entries(marker.children).reduce<{
      [key: string]: {
        label: string | ReactElement;
        action: (editor: LexicalEditor) => void;
        description: string;
      }[];
    }>((items, [category, markers]) => {
      if (["CharacterStyling"].includes(category)) {
        items[category] = markers.map((marker) => {
          const markerData = getMarker(marker);
          const { action } = getUsfmMarkerAction(marker, markerData);
          return {
            label: marker,
            description: markerData?.description ?? "",
            action: (editor: LexicalEditor) => action({ editor, reference: scriptureReference }),
          };
        });
      }
      return items;
    }, {});
  }, [selectedMarker, scriptureReference]);

  return !lexicalState || !perfDocument ? null : (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="toolbar noprint">
        <div className={"toolbar-section"}>
          <Button
            onClick={(_, editor) => editor.dispatchCommand(UNDO_COMMAND, undefined)}
            data-tooltip-id={tooltipIds.undo}
          >
            <i>undo</i>
          </Button>
          <ReactTooltip id={tooltipIds.undo} place="top" content="Undo last action" />

          <Button
            onClick={(_, editor) => editor.dispatchCommand(REDO_COMMAND, undefined)}
            data-tooltip-id={tooltipIds.redo}
          >
            <i>redo</i>
          </Button>
          <ReactTooltip id={tooltipIds.redo} place="top" content="Redo last undone action" />

          <hr />
          <button
            onClick={() => downloadUsfm(bookHandler, historyState, bookCode)}
            data-tooltip-id={tooltipIds.download}
          >
            <i>download</i>
          </button>
          <ReactTooltip id={tooltipIds.download} place="top" content="Download as USFM file" />

          <hr />
          <button
            onClick={(e) => {
              toggleClass(editorRef.current, "verse-blocks");
              toggleClass(e.currentTarget, "active");
            }}
            data-tooltip-id={tooltipIds.verseBlocks}
          >
            <i>view_agenda</i>
          </button>
          <ReactTooltip
            id={tooltipIds.verseBlocks}
            place="top"
            content="Toggle verse blocks view"
          />

          <button
            className="active"
            onClick={(e) => {
              toggleClass(editorRef.current, "with-markers");
              toggleClass(e.currentTarget, "active");
            }}
            data-tooltip-id={tooltipIds.markers}
          >
            <i>format_paragraph</i>
          </button>
          <ReactTooltip id={tooltipIds.markers} place="top" content="Toggle markers visibility" />

          <button
            className={shouldUseCursorHelper ? "active" : undefined}
            onClick={() => setShouldUseCursorHelper((current) => !current)}
            data-tooltip-id={tooltipIds.cursor}
          >
            <i>highlight_text_cursor</i>
          </button>
          <ReactTooltip id={tooltipIds.cursor} place="top" content="Toggle cursor helper" />
          <hr />
        </div>
        <div className={"toolbar-section"}>
          <button onClick={handleButtonClick} data-tooltip-id={tooltipIds.context}>
            <i>keyboard_command_key</i>: {contextMenuKey}
          </button>
          <ReactTooltip
            id={tooltipIds.context}
            place="top"
            content="Set context menu trigger key"
          />
          <span className="info">{selectedMarker ?? "•"}</span>
          <span className="info">
            {bookCode}{" "}
            {scriptureReference
              ? `${scriptureReference?.chapterNum}:${scriptureReference?.verseNum}`
              : null}
          </span>
          <hr />
        </div>

        {toolbarMarkerSections &&
          Object.entries(toolbarMarkerSections).map(([sectionName, items]) => {
            return (
              <div key={"toolbar-" + sectionName} className={"toolbar-section"}>
                {items.map((item) => (
                  <Button
                    key={`${item.label}-toolbar`}
                    className={`${sectionName}`}
                    onClick={(_, editor) => item.action(editor)}
                    data-marker={item.label}
                    data-tooltip-id={`${item.label}-tooltip`}
                  >
                    {item.label}
                  </Button>
                ))}
                {items.map((item) => (
                  <ReactTooltip
                    key={`${item.label}-tooltip`}
                    id={`${item.label}-tooltip`}
                    place="top"
                    content={item.description || `Apply ${item.label} formatting`}
                  />
                ))}
              </div>
            );
          })}
      </div>
      {shouldUseCursorHelper && (
        <CursorHandlerPlugin
          updateTags={["history-merge"]}
          canContainPlaceHolder={(node: LexicalNode) => node.getType() !== "graft"}
        />
      )}
      <OnEditorUpdate
        updateListener={({ editorState }) => {
          editorState.read(() => {
            const selection = $getSelection();
            if (!selection) return;
            const startEndPoints = selection.getStartEndPoints();
            if (!startEndPoints) return;
            const startNode = $getNodeByKey(startEndPoints[0].key);
            const endNode = $getNodeByKey(startEndPoints[1].key);
            if (!startNode || !endNode) return;

            //This is the selected element expected to be a usfm element;
            const selectedElement = $getCommonAncestorCompatible(startNode, endNode);
            if ($isUsfmElementNode(selectedElement)) {
              setSelectedMarker(selectedElement.getAttribute("data-marker"));
            }
          });
        }}
      />
      <ScriptureReferencePlugin
        book={bookCode}
        onChangeReference={(reference) => {
          setScriptureReference(reference);
        }}
      />
      {scriptureReference && selectedMarker ? (
        <PerfNodesMenuPlugin
          trigger={contextMenuKey}
          scriptureReference={scriptureReference}
          contextMarker={selectedMarker}
        />
      ) : null}

      <div className={"editor-oce"}>
        <ContentEditablePlugin ref={editorRef} />
        <PerfHandlersPlugin />
        <HistoryPlugin
          onChange={handlePerfHistory as HistoryMergeListener}
          externalHistoryState={historyState}
        />
      </div>
    </LexicalComposer>
  );
}
