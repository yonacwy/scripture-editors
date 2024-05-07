import { getPerfKindFromNode } from "./utils";
import { exportNodeToJSON } from "../../lexical/exportNodeToJSON";

import { Mapper } from "../History/operations/defaults";
import { $isUsfmElementNode } from "../../nodes/UsfmElementNode";
import {
  OperationAdd,
  OperationRemove,
  OperationReplace,
  OperationType,
  Path,
} from "../History/operations/index.d";
import { PerfKind } from "./types";

import Epitelete from "./epitelete";
import Sequence from "./Types/Sequence";
import Block from "./Types/Block";
import ContentElement from "./Types/ContentElement";
import { FlatDocument as PerfDocument } from "./Types/Document";
import transformLexicalStateToPerf from "../../converters/perf/lexicalToPerf";
import { SerializedElementNode } from "lexical";

const epi = new Epitelete({ docSetId: "bible" });
const validator = epi.validator;

export const getOperationBuilder =
  (extendedOperations: Array<Record<string, unknown>> = []): Mapper =>
  ({ node, operationType, path }) => {
    if (operationType === OperationType.Move) {
      console.log("SKIPPED MOVE OPERATION");
      return undefined;
    }
    if (!$isUsfmElementNode(node)) return undefined;
    const { "perf-type": perfType } = node.getAttributes?.() ?? {};
    const kind = getPerfKindFromNode(node);

    if (perfType === "graft" || kind === PerfKind.Block) {
      extendedOperations.push({ lexicalNode: node, operationType, perfPath: path, perfKind: kind });
      if (operationType === OperationType.Remove) return buildRemoveOperation(path);
      const serializedNode = exportNodeToJSON(node);
      const { result: perfNode, sequences: sideSequences } = transformLexicalStateToPerf(
        serializedNode as SerializedElementNode,
        kind,
      );
      if (!perfNode) throw new Error("Failed to transform lexical node to perf node");
      const sequences: PerfDocument["sequences"] = {
        ...sideSequences,
        main: { blocks: [perfNode as Block], type: "main" },
      };
      const perfDocument: PerfDocument = {
        schema: {
          structure: "flat",
          structure_version: "0.2.1",
          constraints: [{ name: "perf", version: "0.2.1" }],
        },
        metadata: {},
        sequences,
        main_sequence_id: "main",
      };
      const validation = validator.validate("constraint", "perfDocument", "0.4.0", perfDocument);
      if (validation.errors?.length) {
        console.error(perfDocument, validation.errors);
        throw new Error("Validation failed");
      }
      switch (operationType) {
        case OperationType.Add:
          return buildAddOperation(perfNode, path);
        case OperationType.Replace:
          return buildReplaceOperation(perfNode, path);
        default:
          throw new Error("Invalid operation type");
      }
    }
    return undefined;
  };

const buildAddOperation = (node: Sequence | Block | ContentElement, path: Path): OperationAdd => {
  return {
    path,
    value: node,
    type: OperationType.Add,
  };
};

const buildRemoveOperation = (path: Path): OperationRemove => {
  return {
    path,
    type: OperationType.Remove,
  };
};

const buildReplaceOperation = (
  node: Sequence | Block | ContentElement,
  path: Path,
): OperationReplace => {
  return {
    path,
    value: node,
    type: OperationType.Replace,
  };
};
