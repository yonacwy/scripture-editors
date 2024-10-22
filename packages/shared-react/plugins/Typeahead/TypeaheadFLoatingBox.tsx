import { memo, ReactNode, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { FloatingBox } from "../FloatingBox/FloatingBox";
import { TriggerFn } from "shared/plugins/Typeahead";
import { TypeaheadData, useTypeaheadData } from "./useTypeaheadData";
import useCursorCoords from "../FloatingBox/useCursorCoords";

const DOM_ELEMENT = document.body;

const MemoizedFloatingBox = memo(FloatingBox);

export type FloatingMenuCoords = { x: number; y: number } | undefined;

type TypeaheadPluginProps = {
  trigger?: string | TriggerFn;
  children: ReactNode | ((props: { typeaheadData: TypeaheadData | undefined }) => ReactNode);
};

/**
 * TypeaheadPlugin component is responsible for rendering a floating menu
 * when the user's typing matches a trigger function or string
 */
export default function TypeaheadFloatingBox({ trigger, children }: TypeaheadPluginProps) {
  const floatingBoxRef = useRef<HTMLDivElement>(null);
  const typeaheadData = useTypeaheadData(trigger);
  const { coords } = useCursorCoords({
    isOpen: !!typeaheadData,
    floatingBoxRef,
  });

  const renderChildren = useMemo(
    () => (coords ? (typeof children === "function" ? children : () => children) : () => null),
    [children, coords],
  );

  return createPortal(
    <MemoizedFloatingBox
      ref={floatingBoxRef}
      coords={coords}
      style={coords ? undefined : { display: "none" }}
    >
      {renderChildren({ typeaheadData })}
    </MemoizedFloatingBox>,
    DOM_ELEMENT,
  );
}
