import { FlatDocument } from "../../plugins/PerfOperations/Types/Document";
import { usfm2perf } from "../perf/usfmToPerf";
import { transformPerfNodeToSerializedLexicalNode } from "../perf/perfToLexical";
import Sequence from "../../plugins/PerfOperations/Types/Sequence";
import { PerfKind } from "../../plugins/PerfOperations/types";
import { SerializedElementNode } from "lexical";

//For now only markers that are allowed to be under \p marker
export const createLexicalNodeFromUsfm = (usfm: string, kind: "inline" | "block") => {
  const usfmDocument = String.raw`
  \mt title
  \p
  ${usfm}
  `;

  const perf = usfm2perf(usfmDocument, {
    serverName: "local",
    organizationId: "local",
    languageCode: "any",
    versionId: "any",
  }) as FlatDocument;

  const lexicalSerializedRoot = transformPerfNodeToSerializedLexicalNode({
    source: {
      node: perf.sequences[perf.main_sequence_id] as Sequence,
      kind: PerfKind.Sequence,
    },
    perfSequences: perf.sequences,
  }) as SerializedElementNode<SerializedElementNode>;

  const lexicalSerializedNode =
    kind === "inline"
      ? lexicalSerializedRoot.children[1].children[0]
      : lexicalSerializedRoot.children[1];

  return lexicalSerializedNode;
};
