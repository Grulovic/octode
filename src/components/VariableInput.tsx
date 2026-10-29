import { useRef, type InputHTMLAttributes } from "react";
export default function VariableInput(
  props: InputHTMLAttributes<HTMLInputElement>,
) {
  const mirror = useRef<HTMLDivElement>(null);
  const value = String(props.value ?? "");
  return (
    <div className="variable-input">
      <div className="variable-input-mirror" aria-hidden="true" ref={mirror}>
        {value.split(/(\{\{[^{}]*\}\})/g).map((part, index) =>
          /^\{\{/.test(part) ? (
            <span className="request-variable" key={index}>
              {part}
            </span>
          ) : (
            part
          ),
        )}
      </div>
      <input
        {...props}
        onScroll={(event) => {
          if (mirror.current)
            mirror.current.scrollLeft = event.currentTarget.scrollLeft;
          props.onScroll?.(event);
        }}
      />
    </div>
  );
}
