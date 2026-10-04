import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Threadrift } from "../dist/index.mjs";
import type { GraphJSON } from "@threadrift/core";

const data: GraphJSON = {
  version: "1.0", nextNodeId: 4, root: 0,
  nodes: {
    0: { id: 0, name: "Harness start", x: 500, y: 100, content: "" },
    1: { id: 1, name: "Harness fork", x: 500, y: 350, content: "" },
    2: { id: 2, name: "Left end", x: 300, y: 650, content: "" },
    3: { id: 3, name: "Right end", x: 700, y: 650, content: "" },
  },
  edges: [
    { id: "start", from: 0, to: 1, type: "main", curve: 0 },
    { id: "left", from: 1, to: 2, type: "branch", curve: 40 },
    { id: "right", from: 1, to: 3, type: "main", curve: -40 },
  ],
};

function Viewer({ id }: { id: string }) {
  return <section data-test-viewer={id} style={{ position: "relative", flex: 1, height: 700, border: "1px solid #555" }}>
    <Threadrift.Root initialData={data}>
      <Threadrift.Navigation />
      <Threadrift.Canvas />
    </Threadrift.Root>
  </section>;
}

function Harness() {
  const [first, setFirst] = useState(true);
  return <>
    <button data-test-toggle-first="" onClick={() => setFirst(value => !value)} style={{ height: 44 }}>{first ? "Hide first viewer" : "Show first viewer"}</button>
    <div style={{ display: "flex", gap: 12 }}>
      {first && <Viewer id="first" />}
      <Viewer id="second" />
    </div>
  </>;
}

createRoot(document.getElementById("root")!).render(<Harness />);
